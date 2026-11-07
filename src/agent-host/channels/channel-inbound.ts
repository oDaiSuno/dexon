import { randomInt, randomUUID } from "node:crypto";
import path from "node:path";
import type { ChannelAccountConfig, ChannelBinding, InboundEnvelope } from "../../shared/channel-types";
import { resolveSessionPath } from "../session-reader";
import { sessionIndex } from "../session-index";
import { unavailableModelOf } from "../agent-session/model-gate";
import { channelCommandHelpText, parseChannelCommand, type ParsedChannelCommand } from "./channel-commands";
import { ChannelContext, CHANNEL_NAMES, digest, routeKey, userDataPath, outboundAttachment } from "./channel-context";
import { LaneScheduler } from "./lane-scheduler";
import { CHANNEL_MEDIA_MAX_ATTACHMENTS } from "./media-store";
import { safeChannelError } from "./redaction";
import { evaluateInboundPolicy } from "./policy";
import type { AdapterSendContext, AdapterTurnOutput, StagedInboundAttachment } from "./types";
const PAIRING_TTL_MS = 10 * 60_000;
export class ChannelInbound {
  private readonly lanes = new LaneScheduler();
  constructor(private readonly context: ChannelContext) {}
  private resolveBinding(account: ChannelAccountConfig, envelope: InboundEnvelope): ChannelBinding {
    const bindings = this.context.config
      .listBindings()
      .filter(
        (binding) =>
          binding.channel === envelope.channel &&
          binding.accountId === envelope.accountId &&
          binding.peerKind === envelope.peer.kind &&
          binding.peerId === envelope.peer.id,
      );
    const existing =
      bindings.find((binding) => (binding.threadId ?? "") === (envelope.threadId ?? "")) ??
      bindings.find((binding) => !binding.threadId);
    if (existing) return existing;
    const now = new Date().toISOString();
    return this.context.writeBinding({
      id: digest(routeKey(envelope), 32),
      channel: envelope.channel,
      accountId: envelope.accountId,
      peerKind: envelope.peer.kind,
      peerId: envelope.peer.id,
      ...(envelope.threadId ? { threadId: envelope.threadId } : {}),
      cwd:
        account.defaultCwd ??
        path.join(userDataPath(), "channel-workspaces", envelope.channel, account.id, digest(routeKey(envelope), 20)),
      toolNames: account.toolNames,
      createdAt: now,
      lastUsedAt: now,
    });
  }
  private async handleCommand(
    account: ChannelAccountConfig,
    binding: ChannelBinding,
    command: ParsedChannelCommand,
  ): Promise<{ finalText: string; sessionId?: string; notifySession?: boolean }> {
    if (command.name !== "compact" && command.args) return { finalText: `用法：/${command.name}` };
    if (command.name === "help") return { finalText: channelCommandHelpText() };
    if (command.name === "status") {
      const session = this.context.bridge.getSessionStatus(binding);
      return {
        finalText: [
          `渠道：${CHANNEL_NAMES[account.channel]} · ${this.context.statuses.get(account.id)?.connected ? "已连接" : "未连接"}`,
          `会话：${session.hasSession ? "已绑定" : "尚未创建"}`,
          `Agent：${session.running ? "处理中" : "空闲"}`,
          "IM 命令：已启用",
        ].join("\n"),
      };
    }
    if (command.name === "new") {
      const created = await this.context.bridge.newSession(binding, account.toolNames);
      return {
        sessionId: created.sessionId,
        notifySession: true,
        finalText: "已开始新的独立会话，后续消息将使用新的上下文。",
      };
    }
    if (!binding.sessionId)
      return { finalText: command.name === "compact" ? "当前还没有可压缩的会话。" : "当前还没有可重新加载的会话。" };
    const result = await this.context.bridge.runCommand(
      binding,
      command.name,
      command.name === "compact" && command.args ? command.args : undefined,
    );
    return {
      sessionId: result.sessionId,
      notifySession: true,
      finalText: command.name === "compact" ? "当前会话上下文已压缩。" : "已重新加载扩展、Skills、Prompts 和工具。",
    };
  }
  private async handlePairing(context: Omit<AdapterSendContext, "text">, envelope: InboundEnvelope): Promise<void> {
    if (this.context.state.findPairing(context.account.id, envelope.sender.id)) return;
    const now = Date.now();
    const pairing = {
      id: randomUUID(),
      code: String(randomInt(100_000, 1_000_000)),
      channel: context.account.channel,
      accountId: context.account.id,
      peerId: envelope.sender.id,
      createdAt: new Date(now).toISOString(),
      expiresAt: new Date(now + PAIRING_TTL_MS).toISOString(),
    };
    this.context.addPairing(pairing);
    await this.context.send({
      ...context,
      text: `Dexon 配对码：${pairing.code}\n请在桌面应用的“设置 → 消息渠道”中批准此请求。`,
    });
  }
  async handle(envelope: InboundEnvelope): Promise<void> {
    await this.lanes.run(routeKey(envelope), async () => {
      const account = this.context.config.getAccount(envelope.accountId);
      if (!account || !account.enabled) return;
      const secret = await this.context.getSecret(account);
      if (!secret) throw new Error("Channel credential is unavailable");
      const context = {
        account,
        secret,
        peerId: envelope.peer.id,
        contextToken: envelope.providerContext?.contextToken,
        threadId: envelope.threadId,
        replyToMessageId: envelope.providerContext?.replyToMessageId,
      };
      const decision = evaluateInboundPolicy(account, envelope);
      if (decision !== "allow") {
        if (decision === "pair") await this.handlePairing(context, envelope);
        this.context.addActivity(
          account,
          "inbound",
          "ignored",
          envelope.peer.id,
          decision === "pair" ? "等待配对批准" : "访问策略拒绝",
        );
        return;
      }
      if (!envelope.text.trim() && envelope.attachments.length === 0) {
        await this.context.send({ ...context, text: "消息内容为空。" });
        return;
      }
      const binding = this.resolveBinding(account, envelope);
      const adapter = this.context.registry.get(account.channel);
      const reply = (text: string) => this.context.send({ ...context, text }, undefined, adapter);
      let stagedAttachments: StagedInboundAttachment[] = [];
      if (envelope.attachments.length > 0 && adapter.downloadInbound) {
        try {
          if (envelope.attachments.length > CHANNEL_MEDIA_MAX_ATTACHMENTS)
            throw new Error(`单条消息最多支持 ${CHANNEL_MEDIA_MAX_ATTACHMENTS} 个附件`);
          stagedAttachments = await this.context.media.stage(
            account.id,
            envelope.id,
            await adapter.downloadInbound({ account, secret, envelope }),
          );
        } catch (error) {
          this.context.log(`[${account.id}] media download failed: ${safeChannelError(error)}`);
          await reply("附件下载或校验失败。请确认文件不超过 20 MiB，并重新发送受支持的图片、文件或语音。");
          this.context.addActivity(account, "inbound", "ignored", envelope.peer.id, "附件处理失败");
          return;
        }
      }
      if (!envelope.text.trim() && stagedAttachments.length === 0) {
        await reply("当前渠道或消息类型尚不支持该媒体附件。");
        return;
      }
      this.context.addActivity(account, "inbound", "accepted", envelope.peer.id);
      const { replyToMessageId, ...typingContext } = context;
      const setTyping = (typing: boolean) => adapter.setTyping?.({ ...typingContext, typing }).catch(() => undefined);
      await setTyping(true);
      const turnContext = { ...context, runId: envelope.id };
      let progressiveOutput: AdapterTurnOutput | undefined;
      try {
        const command = account.commandsEnabled === true ? parseChannelCommand(envelope.text) : null;
        progressiveOutput = command ? undefined : adapter.beginTurn?.({ ...turnContext, peerKind: envelope.peer.kind });
        const turn = command
          ? await this.handleCommand(account, binding, command)
          : {
              ...(await this.context.bridge.runTurn(
                binding,
                envelope,
                (event) => progressiveOutput?.update(event),
                stagedAttachments,
                account.toolNames,
              )),
              notifySession: true,
            };
        if (turn.sessionId && binding.sessionId !== turn.sessionId) {
          binding.sessionId = turn.sessionId;
          binding.lastUsedAt = new Date().toISOString();
          this.context.writeBinding(binding);
        }
        if (turn.notifySession && turn.sessionId) {
          const cwd = "cwd" in turn && typeof turn.cwd === "string" ? turn.cwd : binding.cwd;
          const sessionPath = await resolveSessionPath(turn.sessionId).catch(() => null);
          const session = sessionPath ? await sessionIndex.refreshPath(sessionPath).catch(() => null) : null;
          if (session)
            this.context.server.emit("sessions.changed", session.id, {
              cwd: session.cwd,
              sessionId: session.id,
              session,
            });
          else this.context.server.emit("sessions.changed", "*", { cwd, sessionId: turn.sessionId, fullRefresh: true });
        }
        await this.context.send(
          { ...turnContext, text: turn.finalText || "Agent 已完成处理，但没有生成文本回复。" },
          progressiveOutput,
          adapter,
        );
        const generatedFiles =
          "generatedFiles" in turn && Array.isArray(turn.generatedFiles)
            ? turn.generatedFiles.filter((filePath): filePath is string => typeof filePath === "string")
            : [];
        if (!command && generatedFiles.length > 0 && ["weixin", "telegram", "feishu"].includes(account.channel)) {
          try {
            await this.context.send(
              {
                ...typingContext,
                runId: envelope.id,
                ...(account.channel === "feishu" && replyToMessageId ? { replyToMessageId } : {}),
                attachments: generatedFiles.map(outboundAttachment),
                text: "",
              },
              undefined,
              adapter,
            );
          } catch (error) {
            this.context.log(`[${account.id}] generated file delivery failed: ${safeChannelError(error)}`);
            this.context.addActivity(account, "outbound", "failed", envelope.peer.id, "生成文件发送失败");
          }
        }
        this.context.sent(account, envelope.peer.id);
      } catch (error) {
        const unavailable = unavailableModelOf(error);
        if (unavailable) {
          await this.context.send(
            { ...turnContext, text: `这个会话用的模型 ${unavailable.modelId} 不可用，请回到 Dexon 换一个模型` },
            progressiveOutput,
            adapter,
          );
          this.context.sent(account, envelope.peer.id);
          return;
        }
        await progressiveOutput?.cancel().catch(() => undefined);
        this.context.addActivity(account, "outbound", "failed", envelope.peer.id, safeChannelError(error));
        throw error;
      } finally {
        await setTyping(false);
      }
    });
  }
}
