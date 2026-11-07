import type { ChannelAccountConfig, ChannelId } from "../../shared/channel-types";
import type { EffectErrorCode, EffectObservation } from "../effect-observation";
import { FeishuApiError } from "./adapters/feishu/api";
import { ChannelContext, CHANNEL_NAMES, deliveryError, nonblank } from "./channel-context";
import { ChannelSendFailure } from "./types";
import type { AdapterSendContext, ChannelDeliverRequest, ChannelSecret, ProactiveDeliveryCapability } from "./types";
function validDelivery(request: ChannelDeliverRequest): boolean {
  if (!request || !nonblank(request.accountId) || !nonblank(request.peerId) || !nonblank(request.text)) return false;
  if (/[\u0000\uD800-\uDFFF]/u.test(request.text)) return false;
  if (request.singleMessageOnly !== undefined && typeof request.singleMessageOnly !== "boolean") return false;
  if (request.format !== undefined && request.format !== "text" && request.format !== "rich") return false;
  if ([request.idempotencyKey, request.threadId, request.replyToMessageId].some((v) => v !== undefined && !nonblank(v)))
    return false;
  if (request.contextToken !== undefined && typeof request.contextToken !== "string") return false;
  return (
    request.attachments === undefined ||
    (Array.isArray(request.attachments) &&
      request.attachments.every(
        (item) =>
          item &&
          ["image", "voice", "file", "video"].includes(item.kind) &&
          nonblank(item.path) &&
          (item.name === undefined || typeof item.name === "string") &&
          (item.mime === undefined || typeof item.mime === "string"),
      ))
  );
}
function notApplied(code: EffectErrorCode, message: string): EffectObservation<never> {
  return { kind: "not_applied", transient: false, error: { code, message } };
}

export function deliveryCapability(
  runtime: ChannelContext,
  channelOrAccountId: string,
): ProactiveDeliveryCapability | null {
  try {
    const channel = Object.hasOwn(CHANNEL_NAMES, channelOrAccountId)
      ? (channelOrAccountId as ChannelId)
      : runtime.config.getAccount(channelOrAccountId)?.channel;
    return channel ? (runtime.registry.get(channel).proactiveDelivery ?? null) : null;
  } catch {
    return null;
  }
}
export async function deliverChannel(
  runtime: ChannelContext,
  request: ChannelDeliverRequest,
): Promise<EffectObservation<{ messageId?: string }>> {
  let dispatched = false;
  let success: EffectObservation<{ messageId?: string }> | undefined;
  let account: ChannelAccountConfig | undefined;
  let secret: ChannelSecret | null = null;
  try {
    if (!validDelivery(request)) return notApplied("invalid_input", "投递请求无效");
    account = runtime.config.getAccount(request.accountId);
    if (!account || !account.enabled) return notApplied("invalid_input", "消息渠道账号不存在或已停用");
    if (account.channel === "feishu" && !nonblank(account.appId))
      return notApplied("invalid_input", "飞书/Lark 应用 ID 缺失");
    secret = await runtime.getSecret(account);
    if (!secret || !nonblank(secret.token)) return notApplied("missing_secret", "消息渠道凭证不可用");
    const adapter = runtime.registry.get(account.channel);
    const contextToken = request.contextToken ?? runtime.state.getContextToken(account.id, request.peerId);
    if (adapter.proactiveDelivery.needsContextToken && !nonblank(contextToken)) {
      return notApplied("missing_secret", "该用户尚未向机器人发送消息，无法建立回复上下文");
    }
    const context: AdapterSendContext = {
      account,
      secret,
      peerId: request.peerId,
      text: request.text,
      contextToken,
      idempotencyKey: request.idempotencyKey,
      threadId: request.threadId,
      replyToMessageId: request.replyToMessageId,
      attachments: request.attachments,
      singleMessageOnly: request.singleMessageOnly ?? true,
      format: request.format ?? "text",
    };
    dispatched = true;
    const receipt = await adapter.send(context);
    success = { kind: "applied", output: { messageId: receipt.messageId } };
    for (const update of [
      () => runtime.state.addDelivery(receipt),
      () => runtime.emitStatus(context.account, { lastOutboundAt: Date.now(), lastEventAt: Date.now() }),
      () => runtime.addActivity(context.account, "outbound", "sent", context.peerId),
    ]) {
      try {
        update();
      } catch (error) {
        runtime.log(`delivery bookkeeping failed: ${deliveryError(error, secret)}`);
      }
    }
    return success;
  } catch (error) {
    if (success) return success;
    const message = deliveryError(error, secret);
    let observation: EffectObservation<never> = dispatched
      ? { kind: "maybe_applied", error: { code: "transport", message } }
      : notApplied("internal", message);
    try {
      if (dispatched && error instanceof ChannelSendFailure) {
        const detail = { code: error.code, message };
        observation =
          error.applied === "no" && error.partsDelivered === 0
            ? { kind: "not_applied", transient: error.transient, error: detail }
            : { kind: "maybe_applied", error: detail };
      } else if (dispatched && error instanceof FeishuApiError && !error.deliveryUnknown) {
        observation = notApplied("provider_rejected", message);
      }
      if (account) runtime.addActivity(account, "outbound", "failed", request.peerId, message);
    } catch (error) {
      runtime.log(`delivery observation bookkeeping failed: ${deliveryError(error, secret)}`);
    }
    return observation;
  }
}
