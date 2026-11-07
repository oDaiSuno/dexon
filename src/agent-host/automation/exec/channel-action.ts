import type { Json } from "../../../shared/automation/spec";
import type { EffectObservation } from "../../effect-observation";
import type { ChannelActionPlan, EffectPolicy } from "../core/plan";
import { renderText } from "../spec/values";
import { rejected } from "./observations";
import type { AttemptContext, AutomationChannelPort } from "./types";

export function channelPolicy(call: ChannelActionPlan, channels: AutomationChannelPort): EffectPolicy {
  const capability = channels.deliveryCapability(call.to.accountId)?.idempotency;
  return capability?.kind === "provider_key"
    ? { kind: "idempotent", windowMs: capability.windowMs, providerAccountId: call.to.accountId }
    : { kind: "unsafe", providerAccountId: call.to.accountId };
}
export function createChannelAction(channels: AutomationChannelPort) {
  return async (call: ChannelActionPlan, ctx: AttemptContext): Promise<EffectObservation<Json>> => {
    if (
      !ctx.grant.channelTargets.some(
        (target) => target.accountId === call.to.accountId && target.peerId === call.to.peerId,
      )
    )
      return rejected("grant_violation", "Channel target is not approved");
    if (ctx.signal.aborted) return rejected("aborted", "Delivery cancelled before dispatch", true);
    return channels.deliver({
      ...call.to,
      text: renderText(call.textTmpl, ctx.values),
      format: call.format === "markdown" ? "rich" : "text",
      idempotencyKey: ctx.effectKey,
      singleMessageOnly: true,
    });
  };
}
