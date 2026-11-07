import type { EffectError } from "../../effect-observation";
import type { Json } from "../../../shared/automation/spec";
import type { SignalEmit } from "../../../shared/automation/views";
import type { ScheduleTriggerPlan, WatchTriggerPlan } from "./plan";
import { createCalendar, type SlotCalendar } from "./calendar";
import { evalCond, readPath, resolveValue, type ResolveContext } from "../spec/values";
import { requestDigest } from "../spec/grant";
export { parseCron, matchesCron, createCalendar, type SlotCalendar } from "./calendar";

export interface ScheduleState {
  readonly kind: "schedule";
  readonly lastFiredForMs: number | null;
}
export interface ThresholdState {
  readonly kind: "threshold";
  readonly consecutiveUnhealthy: number;
  readonly alarm: "closed" | "open";
  readonly cooldownUntilMs: number | null;
  readonly lastSampleAtMs: number | null;
}
export interface ItemsState {
  readonly kind: "items";
  readonly seenKeys: Readonly<Record<string, number>>;
  readonly cursor: Json;
  readonly lastSampleAtMs: number | null;
}
export type TriggerState = ScheduleState | ThresholdState | ItemsState;
export interface ScheduleTick {
  readonly fire: { readonly scheduledForMs: number; readonly late: boolean; readonly dedupeKey: string } | null;
  readonly skippedSlots: number;
  readonly nextDueAtMs: number;
}
export function planScheduleTick(
  plan: ScheduleTriggerPlan,
  dueAtMs: number,
  nowMs: number,
  calendar: SlotCalendar,
): ScheduleTick {
  if (nowMs < dueAtMs) return { fire: null, skippedSlots: 0, nextDueAtMs: dueAtMs };
  const slots = calendar.latestAtOrBefore
    ? [calendar.latestAtOrBefore(nowMs)]
    : calendar.slotsBetween(dueAtMs - 1, nowMs, Number.MAX_SAFE_INTEGER);
  const latest = slots.at(-1);
  const late = latest !== undefined && nowMs - latest > plan.misfireGraceMs;
  const fire =
    latest !== undefined &&
    latest >= dueAtMs &&
    (!late || (plan.catchup === "once" && nowMs - latest <= plan.catchupWindowMs))
      ? { scheduledForMs: latest, late, dedupeKey: `${plan.id}@${latest}` }
      : null;
  const count =
    "everyMs" in plan.calendar
      ? Math.floor((nowMs - dueAtMs) / plan.calendar.everyMs) + 1
      : calendar.slotsBetween(dueAtMs - 1, nowMs, 10000).length;
  return { fire, skippedSlots: Math.max(0, count - (fire ? 1 : 0)), nextDueAtMs: calendar.nextAfter(nowMs) };
}

export type WatchSampleResult =
  | { readonly kind: "sample_ok"; readonly output: Json; readonly healthy?: boolean; readonly cursor?: Json }
  | { readonly kind: "sample_failed"; readonly error: EffectError }
  | { readonly kind: "probe_fault"; readonly error: EffectError };
export type WatchSample = WatchSampleResult;
export interface WatchFire {
  readonly trigger: Json;
  readonly input: Json;
  readonly dedupeKey: string | null;
}
export interface WatchReduction {
  readonly state: ThresholdState | ItemsState;
  readonly fires: readonly WatchFire[];
  readonly signals: readonly SignalEmit[];
  readonly nextDueAtMs: number;
  readonly error: EffectError | null;
}
export function initialTriggerState(plan: ScheduleTriggerPlan | WatchTriggerPlan): TriggerState {
  if (plan.kind === "schedule") return { kind: "schedule", lastFiredForMs: null };
  return plan.mode.type === "threshold"
    ? { kind: "threshold", consecutiveUnhealthy: 0, alarm: "closed", cooldownUntilMs: null, lastSampleAtMs: null }
    : { kind: "items", seenKeys: {}, cursor: null, lastSampleAtMs: null };
}
export function initialDueAtMs(plan: ScheduleTriggerPlan | WatchTriggerPlan, nowMs: number): number {
  return plan.kind === "watch" ? nowMs + plan.everyMs : createCalendar(plan.calendar, nowMs).nextAfter(nowMs);
}
function scope(output: Json, item?: Json, ok = true): ResolveContext {
  return { input: null, trigger: null, run: { id: "" }, steps: new Map(), probe: { ok, output }, item };
}
export function reduceWatchSample(
  plan: WatchTriggerPlan,
  state: ThresholdState | ItemsState,
  sample: WatchSample,
  nowMs: number,
): WatchReduction {
  const base = { fires: [] as WatchFire[], signals: [] as SignalEmit[], nextDueAtMs: nowMs + plan.everyMs };
  if (sample.kind === "probe_fault") return { ...base, state, error: sample.error };
  if (plan.mode.type === "threshold" && state.kind === "threshold") {
    const stale =
      state.lastSampleAtMs !== null &&
      (nowMs < state.lastSampleAtMs ||
        (plan.staleResetGapMs !== null && nowMs - state.lastSampleAtMs > plan.staleResetGapMs));
    const previous = stale ? { ...state, consecutiveUnhealthy: 0, alarm: "closed" as const } : state;
    const healthy =
      sample.kind === "sample_ok" && (sample.healthy ?? evalCond(plan.mode.healthy, scope(sample.output)));
    const consecutiveUnhealthy = healthy ? 0 : previous.consecutiveUnhealthy + 1;
    const shouldFire =
      !healthy &&
      consecutiveUnhealthy >= plan.mode.consecutive &&
      previous.alarm === "closed" &&
      (previous.cooldownUntilMs === null || nowMs >= previous.cooldownUntilMs);
    return {
      ...base,
      state: {
        kind: "threshold",
        consecutiveUnhealthy,
        alarm: healthy ? "closed" : shouldFire ? "open" : previous.alarm,
        cooldownUntilMs: shouldFire ? nowMs + plan.mode.cooldownMs : previous.cooldownUntilMs,
        lastSampleAtMs: nowMs,
      },
      fires: shouldFire
        ? [
            {
              trigger: {
                kind: "watch_alarm",
                triggerId: plan.id,
                firedAtMs: nowMs,
                sample: sample.kind === "sample_ok" ? sample.output : { error: { ...sample.error, detail: null } },
              },
              input: null,
              dedupeKey: null,
            },
          ]
        : [],
      error: sample.kind === "sample_failed" ? sample.error : null,
    };
  }
  if (plan.mode.type !== "items" || state.kind !== "items") throw new Error("Watch state does not match its plan");
  if (sample.kind === "sample_failed") return { ...base, state, error: sample.error };
  const mode = plan.mode;
  try {
    const items = readPath(sample.output, mode.itemsPath);
    if (!Array.isArray(items)) throw new Error(`Items path is not an array: ${mode.itemsPath}`);
    const seen = Object.fromEntries(
      Object.entries(state.seenKeys).filter(
        ([, at]) => mode.dedupeWindowMs === null || (nowMs >= at && nowMs - at < mode.dedupeWindowMs),
      ),
    );
    for (const item of items) {
      const key = readPath(item, mode.keyPath);
      if (typeof key !== "string" && typeof key !== "number") throw new Error(`Missing item key: ${mode.keyPath}`);
      const itemScope = scope(sample.output, item);
      if (mode.match && !evalCond(mode.match, itemScope)) continue;
      const payload =
        mode.emit.kind === "start"
          ? mode.emit.input === null
            ? item
            : resolveValue(mode.emit.input, itemScope)
          : mode.emit.payload === null
            ? item
            : resolveValue(mode.emit.payload, itemScope);
      const identity = mode.emit.kind === "start" ? String(key) : `${key}:${requestDigest({ payload })}`;
      if (Object.hasOwn(seen, identity)) continue;
      seen[identity] = nowMs;
      if (mode.emit.kind === "signal")
        base.signals.push({ name: mode.emit.name, key: String(key), payload, eventId: `${plan.id}:${identity}` });
      else
        base.fires.push({
          trigger: { kind: "watch_item", triggerId: plan.id, firedAtMs: nowMs, itemKey: String(key), item },
          input: payload,
          dedupeKey: String(key),
        });
    }
    return {
      ...base,
      state: {
        kind: "items",
        seenKeys: seen,
        cursor:
          sample.cursor ??
          (mode.cursorPath === null ? state.cursor : (readPath(sample.output, mode.cursorPath) ?? null)),
        lastSampleAtMs: nowMs,
      },
      error: null,
    };
  } catch (error) {
    return {
      fires: [],
      signals: [],
      nextDueAtMs: base.nextDueAtMs,
      state,
      error: { code: "invalid_input", message: error instanceof Error ? error.message : String(error) },
    };
  }
}
export function observeTickGap(
  lastTickAtMs: number | null,
  nowMs: number,
  expectedMs: number,
): { readonly gapMs: number; readonly discontinuity: boolean } {
  const gapMs = lastTickAtMs === null ? 0 : nowMs - lastTickAtMs;
  return { gapMs, discontinuity: lastTickAtMs !== null && (gapMs < 0 || gapMs > expectedMs * 3) };
}
