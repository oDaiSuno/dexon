import type { RpcServer } from "../../contract/rpc";
import type {
  ChannelAccountConfig,
  ChannelAccountView,
  ChannelBinding,
  ChannelId,
  ChannelLoginEvent,
  ChannelLoginStartRequest,
  ChannelProbeResult,
  ChannelsSnapshot,
} from "../../shared/channel-types";
import type { EffectObservation } from "../effect-observation";
import type { AgentSessionWrapper } from "../rpc-manager";
import { ChannelContext, deliveryError, type ChannelManagerOptions } from "./channel-context";
import { ChannelInbound } from "./channel-inbound";
import { ChannelLogin } from "./channel-login";
import { deliverChannel, deliveryCapability } from "./channel-delivery";
import { fingerprintSecret, safeChannelError } from "./redaction";
import type { ChannelDeliverRequest, ProactiveDeliveryCapability } from "./types";
export type { ChannelManagerOptions } from "./channel-context";
type RuntimeEntry = { controller: AbortController; task: Promise<void> };
export class ChannelManager {
  private readonly context: ChannelContext;
  private readonly inbound: ChannelInbound;
  private readonly login: ChannelLogin;
  private readonly runtimes = new Map<string, RuntimeEntry>();
  private readonly starting = new Map<string, RuntimeEntry>();
  private initialized: Promise<void> | null = null;
  constructor(
    server: RpcServer,
    bindSessionEvents: (session: AgentSessionWrapper, sessionId: string) => void,
    options: ChannelManagerOptions = {},
  ) {
    this.context = new ChannelContext(server, bindSessionEvents, options);
    this.inbound = new ChannelInbound(this.context);
    this.login = new ChannelLogin(this.context, (accountId) => this.restartAccount(accountId));
  }
  initialize(): Promise<void> {
    if (!this.initialized) {
      const attempt = (async () => {
        await this.context.media.initialize();
        for (const account of this.context.config.listAccounts()) {
          if (account.enabled) await this.startAccount(account.id).catch(() => undefined);
        }
      })();
      this.initialized = attempt;
      void attempt.catch(() => {
        if (this.initialized === attempt) this.initialized = null;
      });
    }
    return this.initialized;
  }
  async snapshot(): Promise<ChannelsSnapshot> {
    await this.initialize();
    const accounts: ChannelAccountView[] = await Promise.all(
      this.context.config.listAccounts().map(async (account) => {
        try {
          const secret = await this.context.getSecret(account);
          return {
            ...account,
            configured: Boolean(secret),
            ...(secret ? { credentialFingerprint: fingerprintSecret(secret.token) } : {}),
          };
        } catch {
          return { ...account, configured: false };
        }
      }),
    );
    return {
      accounts,
      statuses: this.context.config.listAccounts().map((account) => this.context.status(account)),
      pairings: this.context.state.listPairings(),
      bindings: this.context.config.listBindings(),
      activities: this.context.state.listActivities(),
    };
  }
  async upsertAccount(account: ChannelAccountConfig): Promise<ChannelsSnapshot> {
    const previous = this.context.config.getAccount(account.id);
    const saved = this.context.config.upsertAccount(account);
    if (
      previous &&
      (previous.toolNames.length !== saved.toolNames.length ||
        previous.toolNames.some((name, index) => name !== saved.toolNames[index]))
    ) {
      const syncedSessionIds = new Set<string>();
      for (const binding of this.context.config.listBindings()) {
        if (binding.accountId !== saved.id) continue;
        const updated = this.context.writeBinding({ ...binding, toolNames: saved.toolNames });
        if (!updated.sessionId || syncedSessionIds.has(updated.sessionId)) continue;
        syncedSessionIds.add(updated.sessionId);
        await this.context.bridge.syncTools(updated, saved.toolNames);
      }
    }
    if (saved.enabled) await this.restartAccount(saved.id);
    else await this.stopAccount(saved.id);
    return this.snapshot();
  }
  async connectAccount(account: ChannelAccountConfig): Promise<ChannelsSnapshot> {
    if (this.context.config.getAccount(account.id)) throw new Error("消息渠道账号已存在，请使用凭证更新功能");
    const secret = await this.context.getSecret(account);
    if (!secret) throw new Error("消息渠道凭证尚未写入系统安全存储");
    try {
      const probe = await this.context.registry.get(account.channel).probe(account, secret);
      if (!probe.ok) throw new Error(probe.message);
      const providerAccountId = probe.providerAccountId ?? secret.providerAccountId;
      const providerUsername = probe.providerUsername ?? secret.providerUsername;
      await this.context.setSecret(account.channel, account.id, {
        ...secret,
        providerAccountId,
        ...(providerUsername ? { providerUsername } : {}),
      });
      const saved = this.context.config.upsertAccount({
        ...account,
        name: account.name.trim() || providerUsername || probe.displayName || `${account.channel} ${providerAccountId}`,
        enabled: true,
        providerAccountId,
        ...(providerUsername ? { providerUsername } : {}),
        updatedAt: new Date().toISOString(),
      });
      await this.restartAccount(saved.id);
      return this.snapshot();
    } catch (error) {
      await this.context.deleteSecret(account).catch(() => undefined);
      this.context.config.deleteAccount(account.id);
      this.context.state.deleteAccount(account.id);
      this.context.statuses.delete(account.id);
      throw error;
    }
  }
  async deleteAccount(accountId: string): Promise<ChannelsSnapshot> {
    const account = this.context.config.getAccount(accountId);
    await this.stopAccount(accountId);
    if (account) await this.context.deleteSecret(account);
    this.context.config.deleteAccount(accountId);
    this.context.state.deleteAccount(accountId);
    this.context.statuses.delete(accountId);
    return this.snapshot();
  }
  async startAccount(accountId: string): Promise<void> {
    const account = this.context.config.getAccount(accountId);
    if (!account) throw new Error("Channel account not found");
    if (!account.enabled) throw new Error("Channel account is disabled");
    if (this.runtimes.has(accountId)) return;
    const pending = this.starting.get(accountId);
    if (pending) return pending.task;
    const controller = new AbortController();
    const task = this.startAccountRuntime(account, controller);
    const entry = { controller, task };
    this.starting.set(accountId, entry);
    try {
      await task;
    } finally {
      if (this.starting.get(accountId) === entry) this.starting.delete(accountId);
    }
  }
  private async startAccountRuntime(account: ChannelAccountConfig, controller: AbortController): Promise<void> {
    const secret = await this.context.getSecret(account);
    if (controller.signal.aborted) return;
    if (!secret) {
      const message = "消息渠道账号尚未配置凭证";
      this.context.emitStatus(account, { state: "error", connected: false, lastError: message });
      throw new Error(message);
    }
    const adapter = this.context.registry.get(account.channel);
    this.context.emitStatus(account, { state: "starting", connected: false, lastError: undefined });
    const task = adapter
      .start({
        account,
        secret,
        signal: controller.signal,
        state: this.context.state,
        onInbound: (envelope) => this.inbound.handle(envelope),
        onStatus: (patch) => this.context.emitStatus(account, patch),
        log: (message) => this.context.log(`[${account.id}] ${message}`),
      })
      .catch((error) => {
        if (!controller.signal.aborted) {
          const message = safeChannelError(error);
          this.context.emitStatus(account, { state: "error", connected: false, lastError: message });
          this.context.addActivity(account, "system", "failed", undefined, message);
        }
      })
      .finally(() => {
        if (this.runtimes.get(account.id)?.controller === controller) this.runtimes.delete(account.id);
      });
    this.runtimes.set(account.id, { controller, task });
  }
  async stopAccount(accountId: string): Promise<void> {
    const starting = this.starting.get(accountId);
    if (starting) {
      starting.controller.abort();
      await starting.task.catch(() => undefined);
      if (this.starting.get(accountId) === starting) this.starting.delete(accountId);
    }
    const runtime = this.runtimes.get(accountId);
    if (runtime) {
      runtime.controller.abort();
      await Promise.race([runtime.task, new Promise<void>((resolve) => setTimeout(resolve, 2_000))]);
      this.runtimes.delete(accountId);
    }
    const account = this.context.config.getAccount(accountId);
    if (account) this.context.emitStatus(account, { state: "stopped", connected: false });
  }
  async restartAccount(accountId: string): Promise<void> {
    await this.stopAccount(accountId);
    if (this.context.config.getAccount(accountId)?.enabled) await this.startAccount(accountId);
  }
  async probe(accountId: string): Promise<ChannelProbeResult> {
    const account = this.context.config.getAccount(accountId);
    if (!account) throw new Error("Channel account not found");
    const secret = await this.context.getSecret(account);
    if (!secret) return { ok: false, message: "消息渠道账号尚未配置凭证", accountId };
    return this.context.registry.get(account.channel).probe(account, secret);
  }
  async approvePairing(pairingId: string): Promise<ChannelsSnapshot> {
    const pairing = this.context.state.removePairing(pairingId);
    if (!pairing) throw new Error("Pairing request not found or expired");
    const account = this.context.config.getAccount(pairing.accountId);
    if (!account) throw new Error("Channel account not found");
    if (!account.allowFrom.includes(pairing.peerId)) account.allowFrom.push(pairing.peerId);
    this.context.config.upsertAccount(account);
    const secret = await this.context.getSecret(account).catch(() => null);
    const contextToken = this.context.state.getContextToken(account.id, pairing.peerId);
    if (secret && (account.channel !== "weixin" || contextToken)) {
      try {
        await this.context.registry.get(account.channel).send({
          account,
          secret,
          peerId: pairing.peerId,
          contextToken,
          text: "Dexon 配对已批准，现在可以开始对话。",
        });
      } catch (error) {
        this.context.log(`[${account.id}] pairing approval notification failed: ${deliveryError(error, secret)}`);
      }
    }
    return this.snapshot();
  }
  async rejectPairing(pairingId: string): Promise<ChannelsSnapshot> {
    if (!this.context.state.removePairing(pairingId)) throw new Error("Pairing request not found or expired");
    return this.snapshot();
  }
  async upsertBinding(binding: ChannelBinding): Promise<ChannelsSnapshot> {
    this.context.writeBinding(binding);
    return this.snapshot();
  }
  async deleteBinding(bindingId: string): Promise<ChannelsSnapshot> {
    this.context.config.deleteBinding(bindingId);
    this.context.server.emit("channels.binding", bindingId, { action: "delete", bindingId });
    return this.snapshot();
  }
  async testSend(accountId: string, peerId: string, message: string): Promise<{ ok: true; messageId: string }> {
    const account = this.context.config.getAccount(accountId);
    if (!account) throw new Error("Channel account not found");
    const secret = await this.context.getSecret(account);
    if (!secret) throw new Error("Channel credential is unavailable");
    const contextToken = this.context.state.getContextToken(accountId, peerId);
    if (account.channel === "weixin" && !contextToken)
      throw new Error("该用户尚未向机器人发送消息，无法建立回复上下文");
    const receipt = await this.context.send({ account, secret, peerId, text: message, contextToken });
    return { ok: true, messageId: receipt.messageId };
  }
  startLogin(request: ChannelLoginStartRequest): Promise<ChannelLoginEvent> {
    return this.login.startLogin(request);
  }
  waitLogin(channel: ChannelId, sessionKey: string): Promise<ChannelLoginEvent> {
    return this.login.waitLogin(channel, sessionKey);
  }
  submitLoginCode(channel: ChannelId, sessionKey: string, code: string): void {
    this.login.submitLoginCode(channel, sessionKey, code);
  }
  cancelLogin(channel: ChannelId, sessionKey: string): void {
    this.login.cancelLogin(channel, sessionKey);
  }
  deliveryCapability(channelOrAccountId: string): ProactiveDeliveryCapability | null {
    return deliveryCapability(this.context, channelOrAccountId);
  }
  deliver(request: ChannelDeliverRequest): Promise<EffectObservation<{ messageId?: string }>> {
    return deliverChannel(this.context, request);
  }
  async shutdown(): Promise<void> {
    for (const accountId of [...this.runtimes.keys()]) await this.stopAccount(accountId);
    this.login.shutdown();
    await this.context.media.dispose();
  }
}
