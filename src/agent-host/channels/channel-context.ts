import { createHash, randomUUID } from "node:crypto";
import { homedir } from "node:os";
import path from "node:path";
import type { RpcServer } from "../../contract/rpc";
import type {
  ChannelAccountConfig,
  ChannelActivity,
  ChannelBinding,
  ChannelId,
  ChannelLoginEvent,
  ChannelPairingRequest,
  ChannelStatus,
  InboundEnvelope,
} from "../../shared/channel-types";
import type { AgentSessionWrapper } from "../rpc-manager";
import { callMain } from "../parent-rpc";
import { AdapterRegistry } from "./adapter-registry";
import { ChannelConfigStore } from "./config-store";
import { ChannelMediaStore } from "./media-store";
import { PiSessionBridge } from "./pi-session-bridge";
import { safeChannelError } from "./redaction";
import { ChannelStateStore } from "./state-store";
import type { AdapterSendContext, AdapterTurnOutput, ChannelAdapter, ChannelSecret, OutboundAttachment } from "./types";
type SessionBridge = Pick<PiSessionBridge, "getSessionStatus" | "newSession" | "runCommand" | "runTurn" | "syncTools">;
type SecretAccess = {
  get: (channel: ChannelId, accountId: string) => Promise<ChannelSecret | null>;
  set: (channel: ChannelId, accountId: string, secret: ChannelSecret) => Promise<void>;
  delete: (channel: ChannelId, accountId: string) => Promise<void>;
};
export type ChannelManagerOptions = {
  dataDirectory?: string;
  registry?: AdapterRegistry;
  secretAccess?: SecretAccess;
  bridge?: SessionBridge;
};
export const CHANNEL_NAMES = { weixin: "微信", telegram: "Telegram", feishu: "飞书 / Lark" };
const MIME_TYPES: Record<string, string> = {
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".ogg": "audio/ogg",
  ".opus": "audio/ogg",
  ".mp3": "audio/mpeg",
  ".m4a": "audio/mp4",
  ".wav": "audio/wav",
  ".silk": "audio/silk",
  ".mp4": "video/mp4",
  ".pdf": "application/pdf",
  ".txt": "text/plain",
  ".md": "text/markdown",
  ".json": "application/json",
  ".zip": "application/zip",
};
export function userDataPath(): string {
  return (
    process.env.PI_DESKTOP_USER_DATA?.trim() ||
    (process.env.PI_CODING_AGENT_DIR ? path.join(process.env.PI_CODING_AGENT_DIR, "desktop") : "") ||
    path.join(homedir(), ".pi", "desktop")
  );
}
function secretKey(channel: ChannelId, accountId: string): string {
  return `channel:${channel}:${accountId}`;
}
export function nonblank(value: unknown): value is string {
  return typeof value === "string" && Boolean(value.trim());
}
function isChannelSecret(value: unknown): value is ChannelSecret {
  const record = value as Partial<ChannelSecret> | null;
  return Boolean(record && nonblank(record.token) && nonblank(record.providerAccountId) && nonblank(record.baseUrl));
}
export function digest(value: string, length: number): string {
  return createHash("sha256").update(value).digest("hex").slice(0, length);
}
export function routeKey(envelope: InboundEnvelope): string {
  return [envelope.channel, envelope.accountId, envelope.peer.kind, envelope.peer.id, envelope.threadId ?? ""].join(
    ":",
  );
}
export function outboundAttachment(filePath: string): OutboundAttachment {
  const mime = MIME_TYPES[path.extname(filePath).toLowerCase()];
  const kind = mime?.startsWith("image/")
    ? "image"
    : mime?.startsWith("audio/")
      ? "voice"
      : mime?.startsWith("video/")
        ? "video"
        : "file";
  return { kind, path: filePath, name: path.basename(filePath), ...(mime ? { mime } : {}) };
}
export function deliveryError(error: unknown, secret?: ChannelSecret | null): string {
  try {
    return safeChannelError(error)
      .split(secret?.token || "\0")
      .join("[REDACTED]");
  } catch {
    return "消息渠道操作失败";
  }
}
export class ChannelContext {
  readonly server: RpcServer;
  readonly config: ChannelConfigStore;
  readonly state: ChannelStateStore;
  readonly registry: AdapterRegistry;
  readonly media: ChannelMediaStore;
  readonly bridge: SessionBridge;
  readonly secretAccess: SecretAccess;
  readonly statuses = new Map<string, ChannelStatus>();
  constructor(
    server: RpcServer,
    bindSessionEvents: (session: AgentSessionWrapper, sessionId: string) => void,
    options: ChannelManagerOptions = {},
  ) {
    this.server = server;
    const base = options.dataDirectory ?? userDataPath();
    this.config = new ChannelConfigStore(path.join(base, "channels.json"));
    this.state = new ChannelStateStore(path.join(base, "channels.state.json"));
    this.media = new ChannelMediaStore(path.join(base, "channel-media"));
    this.registry = options.registry ?? new AdapterRegistry();
    this.bridge = options.bridge ?? new PiSessionBridge(bindSessionEvents);
    this.secretAccess = options.secretAccess ?? {
      get: async (channel, accountId) => {
        const value = await callMain<unknown>("channelSecrets.get", { key: secretKey(channel, accountId) });
        return isChannelSecret(value) ? value : null;
      },
      set: async (channel, accountId, secret) => {
        await callMain("channelSecrets.set", { key: secretKey(channel, accountId), value: secret });
      },
      delete: async (channel, accountId) => {
        await callMain("channelSecrets.delete", { key: secretKey(channel, accountId) });
      },
    };
  }
  log(message: string): void {
    try {
      process.parentPort?.postMessage({ type: "log", message: `[channels] ${message}` });
    } catch {
      return;
    }
  }
  status(account: ChannelAccountConfig): ChannelStatus {
    return (
      this.statuses.get(account.id) ?? {
        channel: account.channel,
        accountId: account.id,
        state: "stopped",
        connected: false,
      }
    );
  }
  emitStatus(account: ChannelAccountConfig, patch: Partial<ChannelStatus>): void {
    const next = { ...this.status(account), ...patch, channel: account.channel, accountId: account.id };
    this.statuses.set(account.id, next);
    this.server.emit("channels.status", account.id, next);
  }
  addActivity(
    account: ChannelAccountConfig,
    direction: ChannelActivity["direction"],
    outcome: ChannelActivity["outcome"],
    peerId?: string,
    detail?: string,
  ): void {
    const full: ChannelActivity = {
      channel: account.channel,
      accountId: account.id,
      direction,
      outcome,
      ...(peerId === undefined ? {} : { peerId }),
      ...(detail === undefined ? {} : { detail }),
      id: randomUUID(),
      at: new Date().toISOString(),
    };
    this.state.addActivity(full);
    this.server.emit("channels.activity", account.id, full);
  }
  sent(account: ChannelAccountConfig, peerId: string): void {
    this.emitStatus(account, { lastOutboundAt: Date.now(), lastEventAt: Date.now() });
    this.addActivity(account, "outbound", "sent", peerId);
  }
  async getSecret(account: Pick<ChannelAccountConfig, "channel" | "id">): Promise<ChannelSecret | null> {
    return this.secretAccess.get(account.channel, account.id);
  }
  async setSecret(channel: ChannelId, accountId: string, secret: ChannelSecret): Promise<void> {
    await this.secretAccess.set(channel, accountId, secret);
  }
  async deleteSecret(account: Pick<ChannelAccountConfig, "channel" | "id">): Promise<void> {
    await this.secretAccess.delete(account.channel, account.id);
  }
  emitLogin(event: ChannelLoginEvent): ChannelLoginEvent {
    this.server.emit("channels.login", event.sessionKey, event);
    return event;
  }
  addPairing(pairing: ChannelPairingRequest): void {
    this.state.upsertPairing(pairing);
    this.server.emit("channels.pairing", pairing.accountId, pairing);
  }
  writeBinding(binding: ChannelBinding): ChannelBinding {
    const saved = this.config.upsertBinding(binding);
    this.server.emit("channels.binding", saved.id, { action: "upsert", bindingId: saved.id, binding: saved });
    return saved;
  }
  async send(context: AdapterSendContext, output?: AdapterTurnOutput, adapter?: ChannelAdapter) {
    const receipt = await (output
      ? output.finish(context.text)
      : (adapter ?? this.registry.get(context.account.channel)).send(context));
    this.state.addDelivery(receipt);
    return receipt;
  }
}
