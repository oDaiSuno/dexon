import type {
  ChannelAccountConfig,
  ChannelId,
  ChannelLoginEvent,
  ChannelLoginStartRequest,
} from "../../shared/channel-types";
import { ChannelContext, CHANNEL_NAMES, digest, deliveryError } from "./channel-context";
import type { ChannelSecret } from "./types";
const LOGIN_SUCCESS_RETENTION_MS = 60_000;
export class ChannelLogin {
  private readonly loginWaits = new Map<string, Promise<ChannelLoginEvent>>();
  private readonly loginWaitCleanupTimers = new Map<string, ReturnType<typeof setTimeout>>();
  constructor(
    private readonly context: ChannelContext,
    private readonly restartAccount: (accountId: string) => Promise<void>,
  ) {}
  async startLogin(request: ChannelLoginStartRequest): Promise<ChannelLoginEvent> {
    const adapter = this.context.registry.get(request.channel);
    if (!adapter.startLogin) throw new Error(`${request.channel} does not use interactive login`);
    const localTokens: string[] = [];
    if (request.channel === "weixin") {
      for (const account of this.context.config.listAccounts().filter((item) => item.channel === request.channel)) {
        const secret = await this.context.getSecret(account).catch(() => null);
        if (secret?.token) localTokens.push(secret.token);
      }
    }
    return this.context.emitLogin(await adapter.startLogin({ ...request, localTokens: localTokens.slice(-10) }));
  }
  waitLogin(channel: ChannelId, sessionKey: string): Promise<ChannelLoginEvent> {
    const key = `${channel}\0${sessionKey}`;
    const existing = this.loginWaits.get(key);
    if (existing) return existing;
    const pending = this.waitLoginOnce(channel, sessionKey);
    this.loginWaits.set(key, pending);
    void pending.then(
      (event) => {
        if (this.loginWaits.get(key) !== pending) return;
        if (event.phase !== "confirmed") {
          this.loginWaits.delete(key);
          return;
        }
        const timer = setTimeout(() => {
          if (this.loginWaits.get(key) === pending) this.loginWaits.delete(key);
          this.loginWaitCleanupTimers.delete(key);
        }, LOGIN_SUCCESS_RETENTION_MS);
        timer.unref?.();
        this.loginWaitCleanupTimers.set(key, timer);
      },
      () => {
        if (this.loginWaits.get(key) === pending) this.loginWaits.delete(key);
      },
    );
    return pending;
  }
  private async waitLoginOnce(channel: ChannelId, sessionKey: string): Promise<ChannelLoginEvent> {
    const adapter = this.context.registry.get(channel);
    if (!adapter.pollLogin) throw new Error(`${channel} does not use interactive login`);
    const result = await adapter.pollLogin(sessionKey);
    const loginError = (message: string, accountId?: string) =>
      this.context.emitLogin({ channel, sessionKey, phase: "error", message, ...(accountId ? { accountId } : {}) });
    if (result.credential && result.event.accountId) {
      try {
        const accountId = result.event.accountId;
        const now = new Date().toISOString();
        const existing = this.context.config.getAccount(accountId);
        const previousSecret = await this.context.getSecret({ channel, id: accountId }).catch(() => null);
        const ownerUserId = result.account?.ownerUserId?.trim();
        const appId = result.account?.appId?.trim();
        const domain = result.account?.domain;
        if (
          channel === "feishu" &&
          (!appId ||
            !/^cli_[A-Za-z0-9]+$/.test(appId) ||
            !domain ||
            `feishu-${digest(`${domain}\0${appId}`, 24)}` !== accountId)
        ) {
          return loginError("飞书/Lark 返回的应用信息无效，请重新扫码。");
        }
        const allowFrom = new Set(existing?.allowFrom ?? []);
        if (ownerUserId) allowFrom.add(ownerUserId);
        const baseUrl =
          channel === "feishu"
            ? domain === "lark"
              ? "https://open.larksuite.com"
              : "https://open.feishu.cn"
            : result.credential.baseUrl;
        const credential: ChannelSecret = { ...result.credential, baseUrl };
        const provisional: ChannelAccountConfig = {
          id: accountId,
          channel,
          name: existing?.name || result.account?.displayName || `${CHANNEL_NAMES[channel]} ${accountId.slice(-6)}`,
          enabled: true,
          ...(channel !== "feishu" ? { providerAccountId: credential.providerAccountId } : {}),
          ...(credential.providerUsername ? { providerUsername: credential.providerUsername } : {}),
          ...(ownerUserId ? { userId: ownerUserId } : {}),
          baseUrl,
          ...(channel === "feishu" && appId ? { appId } : {}),
          ...(channel === "feishu" && domain ? { domain } : {}),
          dmPolicy: existing?.dmPolicy ?? (channel === "feishu" && ownerUserId ? "allowlist" : "pairing"),
          allowFrom: [...allowFrom],
          groupPolicy: existing?.groupPolicy ?? "disabled",
          groupIds: existing?.groupIds ?? [],
          groupAllowFrom: existing?.groupAllowFrom ?? [],
          requireMention: existing?.requireMention ?? true,
          commandsEnabled: existing?.commandsEnabled ?? false,
          ...(existing?.defaultCwd ? { defaultCwd: existing.defaultCwd } : {}),
          toolNames: existing?.toolNames ?? [],
          createdAt: existing?.createdAt ?? now,
          updatedAt: now,
        };
        try {
          await this.context.setSecret(channel, accountId, credential);
          this.context.config.upsertAccount(provisional);
        } catch {
          if (previousSecret) await this.context.setSecret(channel, accountId, previousSecret).catch(() => undefined);
          else await this.context.secretAccess.delete(channel, accountId).catch(() => undefined);
          try {
            if (existing) this.context.config.upsertAccount(existing);
            else this.context.config.deleteAccount(accountId);
          } catch (error) {
            this.context.log(`login rollback failed: ${deliveryError(error, credential)}`);
          }
          return loginError("应用已创建，但安全保存失败。请在飞书/Lark 后台删除该应用后重试。", accountId);
        }
        const probe = await adapter
          .probe(provisional, credential)
          .catch(() => ({ ok: false as const, accountId, message: "无法验证机器人身份，请检查网络后重试。" }));
        if (!probe.ok) {
          const message = `应用已创建并安全保存，但连接检查失败：${deliveryError(probe.message, credential)}`;
          this.context.emitStatus(provisional, { state: "error", connected: false, lastError: message });
          return loginError(message, accountId);
        }
        const providerAccountId = probe.providerAccountId ?? credential.providerAccountId;
        const providerUsername = probe.providerUsername ?? credential.providerUsername;
        const provider = { providerAccountId, ...(providerUsername ? { providerUsername } : {}) };
        try {
          await this.context.setSecret(channel, accountId, { ...credential, ...provider });
          this.context.config.upsertAccount({
            ...provisional,
            ...provider,
            name:
              existing?.name ||
              providerUsername ||
              probe.displayName ||
              result.account?.displayName ||
              provisional.name,
            updatedAt: new Date().toISOString(),
          });
          await this.restartAccount(accountId);
        } catch {
          return loginError("应用已创建并安全保存，但机器人启动失败。账号已保留，可稍后重试。", accountId);
        }
        result.event = {
          ...result.event,
          message: channel === "feishu" ? "飞书/Lark 机器人已创建并连接。" : result.event.message,
        };
      } finally {
        result.finalize?.();
      }
    }
    return this.context.emitLogin(result.event);
  }
  submitLoginCode(channel: ChannelId, sessionKey: string, code: string): void {
    const adapter = this.context.registry.get(channel);
    if (!adapter.submitLoginCode) throw new Error(`${channel} does not accept login verification codes`);
    adapter.submitLoginCode(sessionKey, code);
  }
  cancelLogin(channel: ChannelId, sessionKey: string): void {
    const adapter = this.context.registry.get(channel);
    if (!adapter.cancelLogin) throw new Error(`${channel} does not use interactive login`);
    adapter.cancelLogin(sessionKey);
    this.context.emitLogin({ channel, sessionKey, phase: "cancelled", message: "登录已取消。" });
  }
  shutdown(): void {
    for (const timer of this.loginWaitCleanupTimers.values()) clearTimeout(timer);
    this.loginWaitCleanupTimers.clear();
    this.loginWaits.clear();
  }
}
