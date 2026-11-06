import { randomUUID } from "node:crypto";
import type {
  ChannelAccountConfig,
  ChannelId,
  ChannelLoginEvent,
  ChannelLoginStartRequest,
  ChannelProbeResult,
  ChannelStatus,
  DeliveryReceipt,
  FeishuDomain,
  InboundEnvelope,
} from "../../shared/channel-types";
import type { AgentMessage } from "../../shared/types";
import type { EffectErrorCode } from "../effect-observation";
import { splitChannelText } from "./outbound-renderer";
import type { ChannelStateStore } from "./state-store";

export interface ChannelSecret {
  token: string;
  providerAccountId: string;
  providerUsername?: string;
  baseUrl: string;
}

export interface AdapterStartContext {
  account: ChannelAccountConfig;
  secret: ChannelSecret;
  signal: AbortSignal;
  state: ChannelStateStore;
  onInbound: (envelope: InboundEnvelope) => Promise<void>;
  onStatus: (patch: Partial<ChannelStatus>) => void;
  log: (message: string) => void;
}

export interface AdapterSendContext {
  account: ChannelAccountConfig;
  secret: ChannelSecret;
  peerId: string;
  text: string;
  contextToken?: string;
  threadId?: string;
  replyToMessageId?: string;
  runId?: string;
  idempotencyKey?: string;
  singleMessageOnly?: boolean;
  format?: "text" | "rich";
  attachments?: OutboundAttachment[];
}

export interface ProactiveDeliveryCapability {
  readonly idempotency:
    | { readonly kind: "provider_key"; readonly windowMs: number; readonly maxKeyLength: number }
    | { readonly kind: "none" };
  readonly needsContextToken: boolean;
}

export interface ChannelDeliverRequest {
  readonly accountId: string;
  readonly peerId: string;
  readonly text: string;
  readonly idempotencyKey?: string;
  readonly singleMessageOnly?: boolean;
  readonly format?: "text" | "rich";
  readonly threadId?: string;
  readonly replyToMessageId?: string;
  readonly contextToken?: string;
  readonly attachments?: OutboundAttachment[];
}

export class ChannelSendFailure extends Error {
  readonly code: EffectErrorCode;
  readonly applied: "no" | "maybe";
  readonly transient: boolean;
  readonly partsDelivered: number;

  constructor(
    applied: "no" | "maybe",
    transient: boolean,
    partsDelivered: number,
    options: { cause?: unknown; code?: EffectErrorCode } = {},
  ) {
    super(options.cause instanceof Error ? options.cause.message : "Channel delivery failed", options);
    this.name = "ChannelSendFailure";
    this.code = options.code ?? "transport";
    this.applied = applied;
    this.transient = transient;
    this.partsDelivered = partsDelivered;
  }
}

export function validateChannelSend(context: AdapterSendContext, textLimit: number): void {
  const units = splitChannelText(context.text, textLimit).length + (context.attachments?.length ?? 0);
  const code = units === 0 ? "invalid_input" : context.singleMessageOnly && units > 1 ? "output_too_large" : null;
  if (code) {
    const cause = new Error(
      code === "invalid_input" ? "Cannot send an empty message" : "Output exceeds one message unit",
    );
    throw new ChannelSendFailure("no", false, 0, { code, cause });
  }
}

export interface OutboundAttachment {
  kind: "image" | "voice" | "file" | "video";
  path: string;
  name?: string;
  mime?: string;
}

export interface DownloadedInboundAttachment {
  kind: "image" | "voice" | "file" | "video";
  data: Buffer;
  name?: string;
  mime?: string;
}

export interface StagedInboundAttachment extends Omit<DownloadedInboundAttachment, "data"> {
  path: string;
  size: number;
}

export interface AdapterDownloadInboundContext {
  account: ChannelAccountConfig;
  secret: ChannelSecret;
  envelope: InboundEnvelope;
}

export interface AdapterTypingContext {
  account: ChannelAccountConfig;
  secret: ChannelSecret;
  peerId: string;
  contextToken?: string;
  threadId?: string;
  typing: boolean;
}

export type ChannelTurnProgressEvent =
  | { type: "message"; phase: "start" | "update" | "end"; message: AgentMessage }
  | { type: "tool_start"; toolCallId: string; toolName: string; args: unknown }
  | { type: "tool_update"; toolCallId: string; toolName: string; args: unknown; partialResult: unknown }
  | { type: "tool_end"; toolCallId: string; toolName: string; result: unknown; isError: boolean };

export interface AdapterTurnContext extends Omit<AdapterSendContext, "text"> {
  peerKind: "dm" | "group";
}

export interface AdapterTurnOutput {
  update(event: ChannelTurnProgressEvent): void;
  finish(text: string): Promise<DeliveryReceipt>;
  cancel(): Promise<void>;
}

export interface AdapterLoginPollResult {
  event: ChannelLoginEvent;
  credential?: ChannelSecret;
  account?: {
    appId?: string;
    domain?: FeishuDomain;
    ownerUserId?: string;
    displayName?: string;
  };
  finalize?: () => void;
}

export type AdapterLoginStartOptions = ChannelLoginStartRequest & { localTokens: string[] };

export interface ChannelAdapter {
  id: ChannelId;
  readonly proactiveDelivery: ProactiveDeliveryCapability;
  start(context: AdapterStartContext): Promise<void>;
  send(context: AdapterSendContext): Promise<DeliveryReceipt>;
  downloadInbound?(context: AdapterDownloadInboundContext): Promise<DownloadedInboundAttachment[]>;
  beginTurn?(context: AdapterTurnContext): AdapterTurnOutput;
  setTyping?(context: AdapterTypingContext): Promise<void>;
  probe(account: ChannelAccountConfig, secret: ChannelSecret): Promise<ChannelProbeResult>;
  startLogin?(options: AdapterLoginStartOptions): Promise<ChannelLoginEvent>;
  pollLogin?(sessionKey: string): Promise<AdapterLoginPollResult>;
  submitLoginCode?(sessionKey: string, code: string): void;
  cancelLogin?(sessionKey: string): void;
}

export interface ChannelCardSession<Card> {
  readonly messageId: string;
  update(content: string): Promise<void>;
  finish(card: Card): Promise<void>;
}
export interface ChannelCardTurnRenderer<Card> {
  update(event: ChannelTurnProgressEvent): void;
  renderDraft(): string;
  renderFinal(text: string): { card: Card; answerTruncated: boolean };
}
export interface ChannelCardTurnSupport<Card> {
  startCard(card: Card): Promise<ChannelCardSession<Card>>;
  sendCard(card: Card): Promise<DeliveryReceipt>;
  sendPlain(text: string): Promise<DeliveryReceipt>;
  addReaction(emojiType: string): Promise<string>;
  removeReaction(reactionId: string): Promise<void>;
  receipt(messageId: string): DeliveryReceipt;
  canFallback(error: unknown): boolean;
  streamingCard(): Card;
  interruptedCard(): Card;
}
export class BufferedCardTurnOutput<Card> implements AdapterTurnOutput {
  private timer: ReturnType<typeof setTimeout> | null = null;
  private tail: Promise<void> = Promise.resolve();
  private session: ChannelCardSession<Card> | undefined;
  private lastDraft = "";
  private lastError: unknown;
  private disabled = false;
  private finished = false;
  private reactionTail: Promise<void> = Promise.resolve();
  private reactionId: string | undefined;
  private readonly context: AdapterTurnContext;
  private readonly intervalMs: number;
  private readonly builder: ChannelCardTurnRenderer<Card>;
  private readonly sender: ChannelCardTurnSupport<Card>;
  private readonly timers: Pick<typeof globalThis, "setTimeout" | "clearTimeout">;
  constructor(
    context: AdapterTurnContext,
    intervalMs: number,
    builder: ChannelCardTurnRenderer<Card>,
    sender: ChannelCardTurnSupport<Card>,
    timers: Pick<typeof globalThis, "setTimeout" | "clearTimeout">,
  ) {
    this.context = context;
    this.intervalMs = intervalMs;
    this.builder = builder;
    this.sender = sender;
    this.timers = timers;
    this.queueReaction("THINKING");
    this.schedule(0);
  }
  private queueReaction(emojiType: string): void {
    if (!this.context.replyToMessageId) return;
    this.reactionTail = this.reactionTail
      .then(async () => {
        if (this.reactionId) {
          const previous = this.reactionId;
          this.reactionId = undefined;
          await this.sender.removeReaction(previous).catch(() => undefined);
        }
        this.reactionId = await this.sender.addReaction(emojiType);
      })
      .catch(() => {
        this.reactionId = undefined;
      });
  }
  update(event: ChannelTurnProgressEvent): void {
    if (this.finished) return;
    this.builder.update(event);
    this.schedule(this.intervalMs);
  }
  private schedule(delayMs: number): void {
    if (this.finished || this.disabled || this.timer) return;
    this.timer = this.timers.setTimeout(() => {
      this.timer = null;
      try {
        this.flush();
      } catch (error) {
        this.lastError = error;
        this.disabled = true;
      }
    }, delayMs);
  }
  private flush(): void {
    const draft = this.builder.renderDraft();
    if (!draft || draft === this.lastDraft) return;
    this.lastDraft = draft;
    this.tail = this.tail
      .then(async () => {
        if (this.disabled) return;
        if (!this.session) this.session = await this.sender.startCard(this.sender.streamingCard());
        if (!this.finished) await this.session.update(draft);
      })
      .catch((error) => {
        this.lastError = error;
        this.disabled = true;
      });
  }
  private async sendDurableFinal(text: string, card: Card): Promise<DeliveryReceipt> {
    try {
      return await this.sender.sendCard(card);
    } catch (error) {
      if (!this.sender.canFallback(error)) throw error;
      return this.sender.sendPlain(text);
    }
  }
  async finish(text: string): Promise<DeliveryReceipt> {
    this.finished = true;
    if (this.timer) this.timers.clearTimeout(this.timer);
    this.timer = null;
    await this.tail;
    try {
      const final = this.builder.renderFinal(text);
      let result: DeliveryReceipt;
      if (this.session) {
        if (final.answerTruncated) {
          await this.session.finish(final.card).catch(() => undefined);
          result = await this.sender.sendPlain(text);
        } else {
          try {
            await this.session.finish(final.card);
            result = this.sender.receipt(this.session.messageId);
          } catch {
            result = await this.sendDurableFinal(text, final.card);
          }
        }
      } else {
        if (this.lastError && !this.sender.canFallback(this.lastError)) throw this.lastError;
        result = final.answerTruncated
          ? await this.sender.sendPlain(text)
          : await this.sendDurableFinal(text, final.card);
      }
      this.queueReaction("DONE");
      return result;
    } catch (error) {
      this.queueReaction("ERROR");
      throw error;
    }
  }
  async cancel(): Promise<void> {
    this.finished = true;
    if (this.timer) this.timers.clearTimeout(this.timer);
    this.timer = null;
    await this.tail;
    await this.session?.finish(this.sender.interruptedCard()).catch(() => undefined);
    this.queueReaction("ERROR");
  }
}

export function createChannelReceipt(
  context: Pick<AdapterSendContext, "account" | "peerId">,
  messageId: string,
): DeliveryReceipt {
  return {
    id: randomUUID(),
    channel: context.account.channel,
    accountId: context.account.id,
    peerId: context.peerId,
    messageId,
    deliveredAt: new Date().toISOString(),
  };
}

export function waitForChannelDelay(ms: number, signal: AbortSignal): Promise<void> {
  if (signal.aborted) return Promise.resolve();
  return new Promise((resolve) => {
    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      signal.removeEventListener("abort", finish);
      resolve();
    };
    const timer = setTimeout(finish, ms);
    signal.addEventListener("abort", finish, { once: true });
  });
}

export interface ChannelRuntimeOptions {
  random?: () => number;
  sleep?: (ms: number, signal: AbortSignal) => Promise<void>;
  now?: () => number;
  turnTimers?: Pick<typeof globalThis, "setTimeout" | "clearTimeout">;
}
