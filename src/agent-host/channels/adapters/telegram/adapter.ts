import { setTimeout as sleep } from "node:timers/promises";
import type {
  ChannelAccountConfig,
  DeliveryReceipt,
  InboundAttachment,
  InboundEnvelope,
} from "../../../../shared/channel-types";
import type {
  AdapterSendContext,
  AdapterStartContext,
  AdapterTurnContext,
  AdapterTurnOutput,
  AdapterTypingContext,
  ChannelAdapter,
  ChannelTurnProgressEvent,
} from "../../types";
import { ChannelSendFailure, createChannelReceipt, validateChannelSend } from "../../types";
import { CHANNEL_COMMAND_MENU } from "../../channel-commands";
import { splitChannelText } from "../../outbound-renderer";
import { safeChannelError } from "../../redaction";
import * as api from "./api";
import type {
  TelegramFileAttachment,
  TelegramMessage,
  TelegramMessageEntity,
  TelegramUpdate,
  TelegramUser,
} from "./protocol-types";
import { TELEGRAM_RICH_SAFE_LIMIT, TelegramRichMessageBuilder } from "./rich-renderer";

const POLL_TIMEOUT_SECONDS = 30;
const MAX_RETRY_DELAY_MS = 30_000;
const DEFAULT_DRAFT_INTERVAL_MS = 400;

type TurnTimers = Pick<typeof globalThis, "setTimeout" | "clearTimeout">;
type TelegramAttachment = { metadata: InboundAttachment; file?: TelegramFileAttachment };

function telegramChat({ secret, peerId, threadId }: Pick<AdapterSendContext, "secret" | "peerId" | "threadId">) {
  return { baseUrl: secret.baseUrl, token: secret.token, chatId: peerId, threadId };
}

function rateLimitDelay(retryAfter = 1): number {
  return Math.min(Math.max(retryAfter, 1) * 1_000, MAX_RETRY_DELAY_MS);
}

function telegramDraftId(value: string): number {
  let hash = 2_166_136_261;
  for (const character of value) {
    hash ^= character.codePointAt(0) ?? 0;
    hash = Math.imul(hash, 16_777_619);
  }
  return hash >>> 1 || 1;
}

class TelegramTurnOutput implements AdapterTurnOutput {
  private readonly builder = new TelegramRichMessageBuilder();
  private timer: ReturnType<typeof setTimeout> | null = null;
  private tail: Promise<void> = Promise.resolve();
  private lastDraft = "";
  private mode: "rich" | "plain" | "disabled";
  private finished = false;
  private reactionTail: Promise<void> = Promise.resolve();

  constructor(
    private readonly context: AdapterTurnContext,
    private readonly intervalMs: number,
    private readonly sendFinal: (markdown: string, fallbackText: string) => Promise<DeliveryReceipt>,
    private readonly timers: TurnTimers,
  ) {
    const chatId = Number(context.peerId);
    this.mode = context.peerKind === "dm" && Number.isSafeInteger(chatId) ? "rich" : "disabled";
    this.queueReaction("👀");
    this.schedule(0);
  }

  private queueReaction(emoji: string): void {
    const messageId = this.context.replyToMessageId;
    if (!messageId) return;
    this.reactionTail = this.reactionTail
      .then(() => api.setTelegramMessageReaction({ ...telegramChat(this.context), messageId, emoji }))
      .then(
        () => undefined,
        () => undefined,
      );
  }

  update(event: ChannelTurnProgressEvent): void {
    if (this.finished) return;
    this.builder.update(event);
    this.schedule(this.intervalMs);
  }

  private schedule(delayMs: number): void {
    if (this.finished || this.mode === "disabled" || this.timer) return;
    this.timer = this.timers.setTimeout(() => {
      this.timer = null;
      try {
        this.flush();
      } catch {
        this.mode = "disabled";
      }
    }, delayMs);
  }

  private flush(): void {
    const richDraft = this.builder.renderDraft();
    const plainDraft = this.builder.renderPlainDraft();
    const next = this.mode === "rich" ? richDraft : plainDraft;
    if (!next || next === this.lastDraft) return;
    this.lastDraft = next;
    const draftId = telegramDraftId(this.context.runId ?? `${this.context.account.id}:${this.context.peerId}`);
    this.tail = this.tail.then(async () => {
      if (this.finished || this.mode === "disabled") return;
      if (this.mode === "rich") {
        try {
          if ([...richDraft].length > TELEGRAM_RICH_SAFE_LIMIT) {
            throw new Error("Telegram Rich Message draft exceeds the safe limit");
          }
          await api.sendTelegramRichMessageDraft({ ...telegramChat(this.context), draftId, markdown: richDraft });
          return;
        } catch {
          this.mode = "plain";
          this.lastDraft = plainDraft;
        }
      }
      if (this.finished) return;
      try {
        await api.sendTelegramMessageDraft({ ...telegramChat(this.context), draftId, text: plainDraft });
      } catch {
        this.mode = "disabled";
      }
    });
  }

  async finish(text: string): Promise<DeliveryReceipt> {
    this.finished = true;
    if (this.timer) this.timers.clearTimeout(this.timer);
    this.timer = null;
    await this.tail;
    let markdown = "";
    try {
      markdown = this.builder.renderFinal(text);
    } catch {
      markdown = "";
    }
    try {
      const result = await this.sendFinal(markdown, text);
      this.queueReaction("👍");
      return result;
    } catch (error) {
      this.queueReaction("👎");
      throw error;
    }
  }

  async cancel(): Promise<void> {
    this.finished = true;
    if (this.timer) this.timers.clearTimeout(this.timer);
    this.timer = null;
    await this.tail;
    this.queueReaction("👎");
  }
}

function delay(ms: number, signal: AbortSignal): Promise<void> {
  return sleep(ms, undefined, { signal }).catch(() => undefined);
}

function telegramErrorMessage(error: unknown): string {
  if (error instanceof api.TelegramApiError) {
    if (error.errorCode === 409)
      return "Telegram polling 冲突：请关闭其他使用该 Bot Token 的 poller，并确认 Bot 未配置 webhook";
    if ([401, 403].includes(error.errorCode)) return "Telegram Bot Token 无效或机器人访问已被撤销，请更新 Token";
    if (error.errorCode === 429) return `Telegram 请求受限，将在 ${error.retryAfter ?? 1} 秒后重试`;
    if (error.errorCode >= 500) return "Telegram 服务暂时不可用，稍后将自动重试";
  }
  if (error instanceof TypeError || (error instanceof Error && /fetch failed|network/i.test(error.message))) {
    return "Telegram 网络请求失败，稍后将自动重试";
  }
  return safeChannelError(error);
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function mentionsTelegramBot(
  text: string,
  entities: TelegramMessageEntity[],
  botId: string,
  botUsername?: string,
): boolean {
  const username = botUsername?.replace(/^@/, "").toLowerCase();
  return (
    entities.some((entity) => {
      if (entity.type === "text_mention") return String(entity.user?.id ?? "") === botId;
      if (!username || (entity.type !== "mention" && entity.type !== "bot_command")) return false;
      return text
        .slice(entity.offset, entity.offset + entity.length)
        .toLowerCase()
        .endsWith(`@${username}`);
    }) || Boolean(username && new RegExp(`@${escapeRegExp(username)}(?![a-z0-9_])`, "i").test(text))
  );
}

function removeTelegramBotMention(text: string, botUsername?: string): string {
  const username = botUsername?.replace(/^@/, "");
  if (!username) return text.trim();
  return text.replace(new RegExp(`@${escapeRegExp(username)}(?![a-z0-9_])`, "gi"), "").trim();
}

function telegramAttachments(update: TelegramUpdate): TelegramAttachment[] {
  const message = update.message;
  if (!message) return [];
  const attachments: TelegramAttachment[] = [];
  if (message.photo?.length)
    attachments.push({
      metadata: { kind: "image", mime: "image/jpeg" },
      file: message.photo.filter((item) => item.file_id).at(-1),
    });
  for (const [kind, file] of [
    ["voice", message.voice],
    ["file", message.document],
    ["file", message.audio],
    ["video", message.video ?? message.animation ?? message.video_note],
  ] as const) {
    if (!file) continue;
    attachments.push({
      metadata: {
        kind,
        ...(kind === "file" && file.file_name ? { name: file.file_name } : {}),
        ...(file.mime_type ? { mime: file.mime_type } : {}),
      },
      ...(kind !== "video" ? { file } : {}),
    });
  }
  return attachments;
}

export function normalizeTelegramUpdate(
  update: TelegramUpdate,
  account: ChannelAccountConfig,
  bot: Pick<TelegramUser, "id" | "username">,
): InboundEnvelope | null {
  const message = update.message;
  const sender = message?.from;
  if (!message || !sender || sender.is_bot || message.chat.type === "channel") return null;
  const peerKind = message.chat.type === "private" ? "dm" : "group";
  const originalText = message.text ?? message.caption ?? "";
  const entities = message.text ? (message.entities ?? []) : (message.caption_entities ?? []);
  const mentionsBot = mentionsTelegramBot(originalText, entities, String(bot.id), bot.username);
  const senderName = [sender.first_name, sender.last_name].filter(Boolean).join(" ").trim();
  const repliedMessage = message.reply_to_message;
  const repliedText = repliedMessage?.text ?? repliedMessage?.caption;
  const repliedSenderId = repliedMessage?.from?.id ?? repliedMessage?.sender_chat?.id;
  const replyTo = repliedMessage && {
    messageId: String(repliedMessage.message_id),
    ...(repliedText ? { text: repliedText } : {}),
    ...(repliedSenderId !== undefined ? { senderId: String(repliedSenderId) } : {}),
  };
  return {
    id: String(update.update_id),
    channel: "telegram",
    accountId: account.id,
    peer: { kind: peerKind, id: String(message.chat.id) },
    ...(message.message_thread_id !== undefined ? { threadId: String(message.message_thread_id) } : {}),
    sender: {
      id: String(sender.id),
      ...(senderName ? { name: senderName } : {}),
      ...(sender.username ? { username: sender.username } : {}),
    },
    text: peerKind === "group" ? removeTelegramBotMention(originalText, bot.username) : originalText,
    mentionsBot,
    ...(replyTo ? { replyTo } : {}),
    attachments: telegramAttachments(update).map(({ metadata }) => metadata),
    timestamp: message.date * 1_000,
    providerContext: { replyToMessageId: String(message.message_id) },
  };
}

export class TelegramAdapter implements ChannelAdapter {
  readonly id = "telegram" as const;
  readonly proactiveDelivery = { idempotency: { kind: "none" }, needsContextToken: false } as const;
  private readonly pendingMedia = new Map<string, TelegramUpdate>();

  constructor(
    private readonly sleep: (ms: number, signal: AbortSignal) => Promise<void> = delay,
    private readonly draftIntervalMs = DEFAULT_DRAFT_INTERVAL_MS,
    private readonly turnTimers: TurnTimers = globalThis,
  ) {}

  async start(context: AdapterStartContext): Promise<void> {
    const { account, secret, signal, state, onInbound, onStatus } = context;
    let offset = Number.parseInt(state.getCursor(account.id), 10);
    if (!Number.isSafeInteger(offset) || offset < 0) offset = 0;
    let failures = 0;
    const request = { baseUrl: secret.baseUrl, token: secret.token, signal };
    const reconnect = async (error: unknown): Promise<void> => {
      if (error instanceof api.TelegramApiError && [401, 403, 409].includes(error.errorCode)) {
        throw new Error(telegramErrorMessage(error));
      }
      failures += 1;
      const retryAfter = error instanceof api.TelegramApiError ? error.retryAfter : undefined;
      const backoff = retryAfter
        ? rateLimitDelay(retryAfter)
        : Math.min(2_000 * 2 ** Math.min(failures - 1, 4), MAX_RETRY_DELAY_MS);
      onStatus({
        state: "reconnecting",
        connected: false,
        retryCount: failures,
        lastError: telegramErrorMessage(error),
      });
      await this.sleep(backoff, signal);
    };
    onStatus({ state: "starting", connected: false, lastStartAt: Date.now(), retryCount: 0 });

    try {
      let bot: TelegramUser | undefined;
      while (!signal.aborted && !bot) {
        try {
          bot = await api.getTelegramBot(request);
        } catch (error) {
          if (signal.aborted) break;
          await reconnect(error);
        }
      }
      if (!bot) return;
      if (account.providerAccountId && account.providerAccountId !== String(bot.id)) {
        throw new Error("Telegram Bot Token 与已保存的机器人账号不匹配");
      }
      try {
        if (account.commandsEnabled === true) {
          await api.setTelegramCommands({ ...request, commands: CHANNEL_COMMAND_MENU.map((item) => ({ ...item })) });
        } else if (account.commandsEnabled === false) {
          await api.deleteTelegramCommands(request);
        }
      } catch (error) {
        if (!signal.aborted) context.log(`Telegram 命令菜单同步失败：${telegramErrorMessage(error)}`);
      }
      failures = 0;
      onStatus({ state: "running", connected: true, lastConnectedAt: Date.now(), lastError: undefined });

      while (!signal.aborted) {
        try {
          const updates = await api.getTelegramUpdates({
            ...request,
            ...(offset > 0 ? { offset } : {}),
            timeoutSeconds: POLL_TIMEOUT_SECONDS,
          });
          if (signal.aborted) break;

          for (const update of updates) {
            const eventId = String(update.update_id);
            if (!state.isProcessed(account.id, eventId)) {
              const envelope = normalizeTelegramUpdate(update, account, bot);
              if (envelope) {
                onStatus({ lastInboundAt: Date.now(), lastEventAt: Date.now() });
                this.pendingMedia.set(envelope.id, update);
                try {
                  await onInbound(envelope);
                } catch (error) {
                  context.log(
                    `Telegram 入站消息处理失败（event ${eventId.slice(0, 128)}）：${safeChannelError(error)}`,
                  );
                } finally {
                  this.pendingMedia.delete(envelope.id);
                }
              }
              state.markProcessed(account.id, eventId);
            }
          }

          const nextOffset = Math.max(offset, ...updates.map((update) => update.update_id + 1));
          if (nextOffset > offset) {
            offset = nextOffset;
            state.setCursor(account.id, String(offset));
          }
          failures = 0;
          onStatus({ state: "running", connected: true, lastEventAt: Date.now(), retryCount: 0, lastError: undefined });
        } catch (error) {
          if (signal.aborted) break;
          await reconnect(error);
        }
      }
    } finally {
      onStatus({ state: "stopped", connected: false });
    }
  }

  private async retryRateLimit<T>(operation: () => Promise<T>): Promise<T> {
    for (let attempts = 0; ; attempts += 1) {
      try {
        return await operation();
      } catch (error) {
        if (!(error instanceof api.TelegramApiError) || error.errorCode !== 429 || attempts >= 2) throw error;
        await this.sleep(rateLimitDelay(error.retryAfter), new AbortController().signal);
      }
    }
  }

  async downloadInbound(context: Parameters<NonNullable<ChannelAdapter["downloadInbound"]>>[0]) {
    const update = this.pendingMedia.get(context.envelope.id);
    if (!update) throw new Error("Telegram 附件上下文已过期，请重新发送");
    return Promise.all(
      telegramAttachments(update)
        .filter(({ file }) => file?.file_id)
        .map(async ({ metadata, file }) => ({
          ...metadata,
          data: await api.downloadTelegramFile({
            baseUrl: context.secret.baseUrl,
            token: context.secret.token,
            fileId: file!.file_id!,
          }),
          ...(metadata.kind === "voice" ? { name: "voice.ogg", mime: metadata.mime || "audio/ogg" } : {}),
        })),
    );
  }

  private async sendMessages(context: AdapterSendContext, markdown: string): Promise<DeliveryReceipt> {
    let messageId = "";
    let partsDelivered = 0;
    const request = () => ({
      ...telegramChat(context),
      replyToMessageId: partsDelivered === 0 ? context.replyToMessageId : undefined,
    });
    const sendPart = async (operation: () => Promise<TelegramMessage>): Promise<void> => {
      const message = await this.retryRateLimit(operation);
      partsDelivered += 1;
      messageId = String(message.message_id);
    };
    try {
      let chunks = splitChannelText(context.text, 4_000);
      if (context.format !== "text" && markdown.trim() && [...markdown].length <= TELEGRAM_RICH_SAFE_LIMIT) {
        try {
          await sendPart(() => api.sendTelegramRichMessage({ ...request(), markdown }));
          chunks = [];
        } catch (error) {
          if (!(error instanceof api.TelegramApiError) || ![400, 404].includes(error.errorCode)) throw error;
        }
      }
      for (const chunk of chunks) {
        await sendPart(() => api.sendTelegramMessage({ ...request(), html: api.escapeTelegramHtml(chunk) }));
      }
      for (const attachment of context.attachments ?? []) {
        await sendPart(() => api.sendTelegramMedia({ ...request(), ...attachment }));
      }
      if (partsDelivered === 0) throw new Error("Cannot send an empty Telegram message");
      return createChannelReceipt(context, messageId);
    } catch (error) {
      if (partsDelivered > 0) throw new ChannelSendFailure("maybe", false, partsDelivered, { cause: error });
      throw error;
    }
  }

  async send(context: AdapterSendContext): Promise<DeliveryReceipt> {
    validateChannelSend(context, 4_000);
    const markdown =
      context.format === "text" || !context.text.trim()
        ? ""
        : new TelegramRichMessageBuilder().renderFinal(context.text);
    return this.sendMessages(context, markdown);
  }

  beginTurn(context: AdapterTurnContext): AdapterTurnOutput {
    return new TelegramTurnOutput(
      context,
      this.draftIntervalMs,
      (markdown, text) => this.sendMessages({ ...context, text, attachments: undefined }, markdown),
      this.turnTimers,
    );
  }

  async setTyping(context: AdapterTypingContext): Promise<void> {
    if (!context.typing) return;
    await api.sendTelegramChatAction(telegramChat(context));
  }

  async probe(account: ChannelAccountConfig, secret: AdapterStartContext["secret"]) {
    try {
      const bot = await api.getTelegramBot({ baseUrl: secret.baseUrl, token: secret.token });
      const providerUsername = bot.username ? `@${bot.username.replace(/^@/, "")}` : undefined;
      return {
        ok: true,
        accountId: account.id,
        providerAccountId: String(bot.id),
        ...(providerUsername ? { providerUsername } : {}),
        displayName: [bot.first_name, providerUsername].filter(Boolean).join(" "),
        message: `Telegram ${providerUsername ?? bot.first_name} (${bot.id}) 连接正常`,
      };
    } catch (error) {
      return { ok: false, accountId: account.id, message: telegramErrorMessage(error) };
    }
  }
}
