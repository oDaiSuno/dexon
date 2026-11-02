import { extractAtQuery, type AtQueryMatch } from "@/lib/file-fuzzy";
import type { ComposerChange, ComposerSnapshot } from "./types";
import { parseSlashQuery, type SlashQuery } from "./command-slot";

export type ComposerTrigger =
  { readonly kind: "slash"; readonly query: SlashQuery } | { readonly kind: "at"; readonly match: AtQueryMatch };

type TriggerSuppression = { readonly kind: "restore" } | { readonly kind: "dismissed"; readonly key: string };

export interface TriggerGate {
  readonly trigger: ComposerTrigger | null;
  readonly suppression: TriggerSuppression | null;
}

export type TriggerGateEvent =
  | { readonly type: "changed"; readonly change: ComposerChange }
  | { readonly type: "dismissed" }
  | { readonly type: "reset" };

export const initialTriggerGate: TriggerGate = { trigger: null, suppression: null };
const RESTORED_SUPPRESSION: TriggerSuppression = { kind: "restore" };

export function composerTrigger(snapshot: ComposerSnapshot | null, atEnabled: boolean): ComposerTrigger | null {
  if (!snapshot || snapshot.caret.kind !== "caret") return null;
  const before = snapshot.masked.slice(0, snapshot.caret.offset);
  const after = snapshot.masked.slice(snapshot.caret.offset);
  const query = parseSlashQuery({ before, after });
  if (query) return { kind: "slash", query };
  if (!atEnabled) return null;
  const match = extractAtQuery(before);
  return match ? { kind: "at", match } : null;
}

export function triggerKey(trigger: ComposerTrigger | null): string | null {
  if (!trigger) return null;
  if (trigger.kind === "slash") return `slash:${trigger.query.key}`;
  const { start, quoted, query } = trigger.match;
  return `at:${start}:${quoted ? 1 : 0}:${query}`;
}

export function triggersEqual(a: ComposerTrigger | null, b: ComposerTrigger | null): boolean {
  return triggerKey(a) === triggerKey(b);
}

export function nextTriggerGate(gate: TriggerGate, event: TriggerGateEvent, atEnabled: boolean): TriggerGate {
  if (event.type === "reset") return initialTriggerGate;
  if (event.type === "dismissed") {
    const key = triggerKey(gate.trigger);
    if (gate.suppression?.kind === "restore" || key === null) return gate;
    return { trigger: gate.trigger, suppression: { kind: "dismissed", key } };
  }
  const trigger = composerTrigger(event.change.snapshot, atEnabled);
  const key = triggerKey(trigger);
  let suppression = gate.suppression;
  if (event.change.cause === "restore") suppression = RESTORED_SUPPRESSION;
  else if (suppression?.kind === "restore") {
    if (event.change.cause === "edit") suppression = null;
  } else if (suppression?.kind === "dismissed" && suppression.key !== key) suppression = null;
  if (triggersEqual(trigger, gate.trigger) && suppression === gate.suppression) return gate;
  return { trigger, suppression };
}

export function openTrigger(gate: TriggerGate, visible: boolean): ComposerTrigger | null {
  if (!visible || !gate.trigger || gate.suppression?.kind === "restore") return null;
  return gate.suppression?.kind === "dismissed" && triggerKey(gate.trigger) === gate.suppression.key
    ? null
    : gate.trigger;
}
