import type {
  ChannelAccountConfig,
  DeliveryReceipt,
  InboundAttachment,
  InboundEnvelope,
} from "../../../../shared/channel-types";
import { splitChannelText } from "../../outbound-renderer";
import type {
  AdapterSendContext,
  AdapterStartContext,
  AdapterTurnContext,
  AdapterTurnOutput,
  ChannelAdapter,
  ChannelSecret,
  ChannelCardTurnSupport,
  ChannelRuntimeOptions,
} from "../../types";
import {
  BufferedCardTurnOutput,
  ChannelSendFailure,
  validateChannelSend,
  createChannelReceipt as receipt,
  waitForChannelDelay,
} from "../../types";
import { safeChannelError } from "../../redaction";
import {
  canFallbackFromFeishuCard,
  defaultFeishuDependencies,
  FeishuApiError,
  type FeishuAdapterDependencies,
  type FeishuCredentials,
  type FeishuResourceRequest,
  type FeishuWsConnection,
} from "./api";
import type { FeishuBotIdentity, FeishuMenuEvent, FeishuMessageEvent, FeishuMessageMention } from "./protocol-types";
import { FeishuAppRegistration } from "./app-registration";
import {
  buildFeishuInterruptedCard,
  buildFeishuStreamingCard,
  FeishuRichMessageBuilder,
  type FeishuCard,
} from "./rich-renderer";
const FEISHU_TEXT_LIMIT = 20_000;
const FEISHU_RECONNECT_STABLE_MS = 60_000;
const FEISHU_RECONNECT_MAX_DELAY_MS = 30_000;
const FEISHU_MENU_COMMANDS: Readonly<Record<string, string>> = {
  pi_help: "/help",
  pi_status: "/status",
  pi_new: "/new",
  pi_compact: "/compact",
  pi_reload: "/reload",
};
function credentials(account: ChannelAccountConfig, secret: ChannelSecret): FeishuCredentials {
  const appId = account.appId?.trim();
  if (!appId) throw new Error("飞书/Lark App ID 尚未配置");
  const domain = account.domain === "lark" ? "lark" : "feishu";
  return { appId, appSecret: secret.token, domain };
}
export function isFatalFeishuConnectionError(error: Error): boolean {
  return /(?:app[ _-]?(?:id|secret)|credential|client assertion|token).{0,40}(?:invalid|incorrect|expired|missing|empty|mismatch)|(?:invalid|incorrect|expired|missing|empty|mismatch).{0,40}(?:app[ _-]?(?:id|secret)|credential|client assertion|token)|permission|forbidden|unauthori[sz]ed|access denied|scope|权限|授权|凭证|密钥|鉴权|认证/i.test(
    error.message,
  );
}
export function feishuReconnectDelay(retryCount: number, random = Math.random): number {
  const exponent = Math.max(0, Math.min(5, Math.floor(retryCount) - 1));
  const base = Math.min(1_000 * 2 ** exponent, 25_000);
  const jitterWindow = Math.min(5_000, Math.ceil(base * 0.2));
  const jitter = Math.floor(Math.max(0, Math.min(0.999_999, random())) * (jitterWindow + 1));
  return Math.min(FEISHU_RECONNECT_MAX_DELAY_MS, base + jitter);
}
function parseContent(content: string): Record<string, unknown> | null {
  try {
    const parsed = JSON.parse(content) as unknown;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}
function normalizeMessageText(text: string): string {
  return text
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}
function stripBotMentionKeys(text: string, mentions: FeishuMessageMention[] | undefined, botOpenId: string): string {
  let result = text;
  for (const mention of mentions ?? []) {
    if (mention.id.open_id === botOpenId && mention.key) result = result.split(mention.key).join("");
  }
  return normalizeMessageText(result);
}
function postNodeText(value: unknown, botOpenId: string): string {
  if (!value || typeof value !== "object" || Array.isArray(value)) return "";
  const node = value as Record<string, unknown>;
  if (node.tag === "text" || node.tag === "a") return typeof node.text === "string" ? node.text : "";
  if (node.tag === "at") {
    if (node.user_id === botOpenId) return "";
    const name = typeof node.user_name === "string" ? node.user_name : "";
    return name ? `@${name}` : "";
  }
  return "";
}
function extractPostText(content: Record<string, unknown>, botOpenId: string): string {
  const direct = Array.isArray(content.content) ? content : undefined;
  const localized = direct
    ? direct
    : Object.values(content).find(
        (value): value is Record<string, unknown> =>
          value !== null &&
          typeof value === "object" &&
          !Array.isArray(value) &&
          Array.isArray((value as Record<string, unknown>).content),
      );
  if (!localized) return "";
  const title = typeof localized.title === "string" ? localized.title : "";
  const rows = (localized.content as unknown[])
    .filter(Array.isArray)
    .map((row) => (row as unknown[]).map((node) => postNodeText(node, botOpenId)).join(""));
  return normalizeMessageText([title, ...rows].filter(Boolean).join("\n"));
}
const MEDIA_KINDS: Readonly<Record<string, InboundAttachment["kind"] | undefined>> = {
  image: "image",
  file: "file",
  audio: "voice",
  media: "video",
  video: "video",
};
function contentAndAttachments(
  event: FeishuMessageEvent,
  botOpenId: string,
): { text: string; attachments: InboundAttachment[] } {
  const type = event.message.message_type;
  const content = parseContent(event.message.content);
  if (type === "text") return { text: typeof content?.text === "string" ? content.text : "", attachments: [] };
  if (type === "post") return { text: content ? extractPostText(content, botOpenId) : "", attachments: [] };
  const kind = MEDIA_KINDS[type];
  const name = type === "file" && typeof content?.file_name === "string" ? content.file_name : undefined;
  return { text: "", attachments: kind ? [{ kind, ...(name !== undefined ? { name } : {}) }] : [] };
}
function downloadableResources(event: FeishuMessageEvent): FeishuResourceRequest[] {
  const content = parseContent(event.message.content);
  const kind = MEDIA_KINDS[event.message.message_type];
  if (!content || !kind) return [];
  const key = kind === "image" ? content.image_key : content.file_key;
  const fileKey = typeof key === "string" ? key.trim() : "";
  if (!fileKey) return [];
  const fileName = typeof content.file_name === "string" ? content.file_name : undefined;
  const media =
    kind === "voice"
      ? { name: fileName || "voice.opus", mime: "audio/ogg" }
      : kind === "video"
        ? { name: fileName || "video.mp4", mime: "video/mp4" }
        : kind === "file" && fileName
          ? { name: fileName }
          : {};
  return [
    {
      messageId: event.message.message_id,
      fileKey,
      resourceType: kind === "image" ? "image" : "file",
      kind,
      ...media,
    },
  ];
}
export function normalizeFeishuEvent(
  event: FeishuMessageEvent,
  account: ChannelAccountConfig,
  bot: FeishuBotIdentity,
): InboundEnvelope | null {
  if (!event.message?.message_id || !event.message.chat_id || event.sender?.sender_type !== "user") return null;
  const senderId = event.sender.sender_id?.open_id;
  if (!senderId) return null;
  const peerKind = event.message.chat_type === "p2p" ? "dm" : "group";
  const mentions = event.message.mentions;
  const mentionsBot = Boolean(mentions?.some((mention) => mention.id.open_id === bot.openId));
  const normalized = contentAndAttachments(event, bot.openId);
  const text = stripBotMentionKeys(normalized.text, mentions, bot.openId);
  const threadId = event.message.thread_id || event.message.root_id;
  const parentMessageId = event.message.parent_id || event.message.root_id;
  const timestamp = Number(event.message.create_time);
  return {
    id: event.message.message_id,
    channel: "feishu",
    accountId: account.id,
    peer: { kind: peerKind, id: peerKind === "dm" ? senderId : event.message.chat_id },
    ...(threadId ? { threadId } : {}),
    sender: { id: senderId },
    text,
    mentionsBot,
    ...(parentMessageId ? { replyTo: { messageId: parentMessageId } } : {}),
    attachments: normalized.attachments,
    timestamp: Number.isFinite(timestamp) && timestamp > 0 ? timestamp : Date.now(),
    providerContext: { replyToMessageId: event.message.message_id },
  };
}
export function normalizeFeishuMenuEvent(
  event: FeishuMenuEvent,
  account: ChannelAccountConfig,
): InboundEnvelope | null {
  const senderId = event.operator?.operator_id?.open_id;
  const eventKey = event.event_key?.trim();
  const text = eventKey ? FEISHU_MENU_COMMANDS[eventKey] : undefined;
  if (!senderId || !text) return null;
  const rawTimestamp = Number(event.create_time ?? event.timestamp);
  const timestamp =
    Number.isFinite(rawTimestamp) && rawTimestamp > 0
      ? rawTimestamp * (rawTimestamp < 10_000_000_000 ? 1_000 : 1)
      : Date.now();
  const id = event.event_id?.trim() || `menu:${senderId}:${eventKey}:${timestamp}`;
  const senderName = event.operator?.operator_name?.trim();
  return {
    id,
    channel: "feishu",
    accountId: account.id,
    peer: { kind: "dm", id: senderId },
    sender: { id: senderId, ...(senderName ? { name: senderName } : {}) },
    text,
    mentionsBot: true,
    attachments: [],
    timestamp,
  };
}
type DeliveryProgress = { partsDelivered: number };
function sendRoute(context: Omit<AdapterSendContext, "text">) {
  return {
    peerId: context.peerId,
    ...(context.replyToMessageId ? { replyToMessageId: context.replyToMessageId } : {}),
    ...(context.threadId ? { replyInThread: true } : {}),
    ...(context.idempotencyKey !== undefined ? { uuid: context.idempotencyKey } : {}),
  };
}
function deliveryFailure(error: unknown, progress: DeliveryProgress): ChannelSendFailure {
  const rejected = error instanceof FeishuApiError && !error.deliveryUnknown && progress.partsDelivered === 0;
  const transient = error instanceof FeishuApiError && [99991400, 99991401, 99991402].includes(error.providerCode ?? 0);
  return new ChannelSendFailure(rejected ? "no" : "maybe", transient, progress.partsDelivered, {
    cause: error,
    code: rejected ? "provider_rejected" : "transport",
  });
}
export class FeishuAdapter implements ChannelAdapter {
  readonly id = "feishu" as const;
  readonly proactiveDelivery = { idempotency: { kind: "none" }, needsContextToken: false } as const;
  private readonly pendingMedia = new Map<string, FeishuMessageEvent>();
  constructor(
    private readonly dependencies: FeishuAdapterDependencies = defaultFeishuDependencies,
    private readonly cardUpdateIntervalMs = 400,
    private readonly appRegistration = new FeishuAppRegistration(),
    private readonly runtimeOptions: ChannelRuntimeOptions = {},
  ) {}
  async startLogin(options: Parameters<NonNullable<ChannelAdapter["startLogin"]>>[0]) {
    return this.appRegistration.start(options);
  }
  async pollLogin(sessionKey: string) {
    return this.appRegistration.poll(sessionKey);
  }
  cancelLogin(sessionKey: string): void {
    this.appRegistration.cancel(sessionKey);
  }
  async start(context: AdapterStartContext): Promise<void> {
    const { account, secret, signal, state, onInbound, onStatus } = context;
    const credential = credentials(account, secret);
    let connection: FeishuWsConnection | undefined;
    let finishConnection: (() => void) | undefined;
    let retryCount = 0;
    let outerFailures = 0;
    const now = this.runtimeOptions.now ?? Date.now;
    const sleep = this.runtimeOptions.sleep ?? waitForChannelDelay;
    const running = (lastConnectedAt = now()) =>
      onStatus({
        state: "running",
        connected: true,
        retryCount: 0,
        lastConnectedAt,
        lastError: undefined,
      });
    const onAbort = () => finishConnection?.();
    signal.addEventListener("abort", onAbort, { once: true });
    onStatus({ state: "starting", connected: false, lastStartAt: Date.now(), retryCount: 0, lastError: undefined });
    try {
      const bot = await this.dependencies.getBotIdentity(credential);
      if (account.providerAccountId && account.providerAccountId !== bot.openId) {
        throw new Error("App ID/App Secret 与已保存的飞书/Lark机器人身份不匹配");
      }
      if (signal.aborted) return;
      const inFlight = new Set<string>();
      const dispatchInbound = (eventId: string, envelope: InboundEnvelope, sourceEvent?: FeishuMessageEvent) => {
        if (state.isProcessed(account.id, eventId) || inFlight.has(eventId)) return;
        inFlight.add(eventId);
        if (sourceEvent && envelope.attachments.length > 0) {
          this.pendingMedia.set(`${account.id}:${envelope.id}`, sourceEvent);
        }
        onStatus({ lastInboundAt: Date.now(), lastEventAt: Date.now() });
        void onInbound(envelope)
          .then(() => state.markProcessed(account.id, eventId))
          .catch((error) => {
            context.log(`飞书/Lark 入站消息处理失败：${safeChannelError(error)}`);
          })
          .finally(() => {
            this.pendingMedia.delete(`${account.id}:${envelope.id}`);
            inFlight.delete(eventId);
          });
      };
      const onMessage = (event: FeishuMessageEvent) => {
        const eventId = event.message?.message_id || event.event_id;
        onStatus({ lastEventAt: Date.now() });
        if (!eventId || state.isProcessed(account.id, eventId) || inFlight.has(eventId)) return;
        const envelope = normalizeFeishuEvent(event, account, bot);
        if (!envelope) {
          state.markProcessed(account.id, eventId);
          return;
        }
        dispatchInbound(eventId, envelope, event);
      };
      const onMenu = (event: FeishuMenuEvent) => {
        onStatus({ lastEventAt: Date.now() });
        const envelope = normalizeFeishuMenuEvent(event, account);
        const providerEventId = event.event_id?.trim() || envelope?.id;
        const eventId = providerEventId?.startsWith("menu:") ? providerEventId : `menu:${providerEventId || "unknown"}`;
        if (state.isProcessed(account.id, eventId) || inFlight.has(eventId)) return;
        if (account.commandsEnabled !== true || !envelope) {
          state.markProcessed(account.id, eventId);
          return;
        }
        dispatchInbound(eventId, envelope);
      };
      while (!signal.aborted) {
        let connectionError: Error | undefined;
        let connectedAt: number | undefined;
        const connectionDone = new Promise<void>((resolve) => {
          finishConnection = resolve;
        });
        try {
          connection = await this.dependencies.connect(
            credential,
            { onMessage, onMenu },
            {
              onError: (error) => {
                connectionError ??= error;
                finishConnection?.();
              },
              onReconnecting: () => {
                retryCount += 1;
                onStatus({ state: "reconnecting", connected: false, retryCount });
              },
              onReconnected: () => {
                retryCount = 0;
                running();
              },
            },
            signal,
          );
          if (!connectionError && !signal.aborted) {
            connectedAt = now();
            running(connectedAt);
          }
          await connectionDone;
        } catch (error) {
          connectionError ??= error instanceof Error ? error : new Error(String(error));
        }
        connection?.close();
        connection = undefined;
        finishConnection = undefined;
        if (signal.aborted) break;
        if (!connectionError) continue;
        if (isFatalFeishuConnectionError(connectionError)) {
          onStatus({ state: "error", connected: false, lastError: safeChannelError(connectionError) });
          throw connectionError;
        }
        if (connectedAt !== undefined && now() - connectedAt >= FEISHU_RECONNECT_STABLE_MS) outerFailures = 0;
        outerFailures += 1;
        retryCount = outerFailures;
        onStatus({
          state: "reconnecting",
          connected: false,
          retryCount,
          lastError: safeChannelError(connectionError),
        });
        await sleep(feishuReconnectDelay(outerFailures, this.runtimeOptions.random), signal);
      }
    } finally {
      signal.removeEventListener("abort", onAbort);
      connection?.close();
      onStatus({ state: "stopped", connected: false });
    }
  }
  async downloadInbound(context: Parameters<NonNullable<ChannelAdapter["downloadInbound"]>>[0]) {
    const event = this.pendingMedia.get(`${context.account.id}:${context.envelope.id}`);
    if (!event) throw new Error("飞书/Lark 附件上下文已过期，请重新发送");
    const resources = downloadableResources(event);
    if (resources.length === 0) throw new Error("飞书/Lark 消息没有可下载的媒体资源标识");
    return Promise.all(
      resources.map((request) =>
        this.dependencies.downloadResource(credentials(context.account, context.secret), request),
      ),
    );
  }
  async send(context: AdapterSendContext): Promise<DeliveryReceipt> {
    validateChannelSend(context, FEISHU_TEXT_LIMIT);
    const units = splitChannelText(context.text, FEISHU_TEXT_LIMIT).length + (context.attachments?.length ?? 0);
    if (units > 1) context = { ...context, idempotencyKey: undefined };
    const progress = { partsDelivered: 0 };
    try {
      if (!context.attachments?.length) return await this.sendMessage(context, progress);
      let result = context.text.trim() ? await this.sendMessage(context, progress) : undefined;
      for (const attachment of context.attachments) {
        const keepThreadRoute = Boolean(context.threadId && context.replyToMessageId);
        const route = sendRoute({
          ...context,
          replyToMessageId: keepThreadRoute || !result ? context.replyToMessageId : undefined,
          threadId: keepThreadRoute ? context.threadId : undefined,
        });
        const messageId = await this.dependencies.sendMedia(credentials(context.account, context.secret), {
          ...route,
          ...attachment,
        });
        progress.partsDelivered += 1;
        result = receipt(context, messageId);
      }
      return result!;
    } catch (error) {
      throw deliveryFailure(error, progress);
    }
  }
  private async sendMessage(context: AdapterSendContext, progress: DeliveryProgress): Promise<DeliveryReceipt> {
    if ((context.format === "rich" || (context.format !== "text" && context.runId)) && this.dependencies.sendCard) {
      const final = new FeishuRichMessageBuilder().renderFinal(context.text);
      if (!final.answerTruncated) {
        try {
          const messageId = await this.dependencies.sendCard(credentials(context.account, context.secret), {
            ...sendRoute(context),
            card: final.card,
          });
          progress.partsDelivered += 1;
          return receipt(context, messageId);
        } catch (error) {
          if (!canFallbackFromFeishuCard(error)) throw error;
        }
      }
    }
    return this.sendPlain(context, progress);
  }
  private async sendPlain(
    context: AdapterSendContext,
    progress: DeliveryProgress = { partsDelivered: 0 },
  ): Promise<DeliveryReceipt> {
    const chunks = splitChannelText(context.text, FEISHU_TEXT_LIMIT);
    if (chunks.length === 0) throw new Error("Cannot send an empty Feishu/Lark message");
    const credential = credentials(context.account, context.secret);
    let messageId = "";
    for (const text of chunks) {
      messageId = await this.dependencies.sendText(credential, { ...sendRoute(context), text });
      progress.partsDelivered += 1;
    }
    return receipt(context, messageId);
  }
  beginTurn(context: AdapterTurnContext): AdapterTurnOutput {
    const credential = () => credentials(context.account, context.secret);
    const route = sendRoute(context);
    const sender: ChannelCardTurnSupport<FeishuCard> = {
      streamingCard: buildFeishuStreamingCard,
      interruptedCard: buildFeishuInterruptedCard,
      canFallback: canFallbackFromFeishuCard,
      receipt: (id) => receipt(context, id),
      startCard: (card) => this.dependencies.startRichCard(credential(), { ...route, card }),
      sendCard: async (card) => receipt(context, await this.dependencies.sendCard(credential(), { ...route, card })),
      sendPlain: (text) => this.sendPlain({ ...context, text }),
      addReaction: (emoji) =>
        context.replyToMessageId
          ? this.dependencies.addReaction(credential(), context.replyToMessageId, emoji)
          : Promise.reject(new Error("Missing Feishu source message ID")),
      removeReaction: (id) =>
        context.replyToMessageId
          ? this.dependencies.removeReaction(credential(), context.replyToMessageId, id)
          : Promise.resolve(),
    };
    return new BufferedCardTurnOutput(
      context,
      this.cardUpdateIntervalMs,
      new FeishuRichMessageBuilder(),
      sender,
      this.runtimeOptions.turnTimers ?? globalThis,
    );
  }
  async probe(account: ChannelAccountConfig, secret: ChannelSecret) {
    try {
      const bot = await this.dependencies.getBotIdentity(credentials(account, secret));
      const platform = account.domain === "lark" ? "Lark" : "飞书";
      return {
        ok: true,
        accountId: account.id,
        providerAccountId: bot.openId,
        displayName: bot.name,
        message: `${platform} ${bot.name} (${bot.openId}) 连接正常`,
      };
    } catch (error) {
      return { ok: false, accountId: account.id, message: safeChannelError(error) };
    }
  }
}
