import { extractAtQuery, type AtQueryMatch } from "@/lib/file-fuzzy";
import type { ComposerChange, ComposerSnapshot } from "./types";

export type ComposerTrigger =
  { readonly kind: "slash"; readonly query: string } | { readonly kind: "at"; readonly match: AtQueryMatch };

export interface TriggerGate {
  readonly trigger: ComposerTrigger | null;
  readonly dismissed: string | null;
}

export type TriggerGateEvent =
  | { readonly type: "changed"; readonly change: ComposerChange }
  | { readonly type: "dismissed" }
  | { readonly type: "reset" };

export const initialTriggerGate: TriggerGate = { trigger: null, dismissed: null };

export function composerTrigger(snapshot: ComposerSnapshot | null, atEnabled: boolean): ComposerTrigger | null {
  if (!snapshot) return null;
  const { text } = snapshot;
  if (text.startsWith("/") && !/\s/.test(text.slice(1))) return { kind: "slash", query: text.slice(1) };
  if (!atEnabled || snapshot.caret.kind !== "caret") return null;
  const match = extractAtQuery(snapshot.masked.slice(0, snapshot.caret.offset));
  return match ? { kind: "at", match } : null;
}

export function triggerKey(trigger: ComposerTrigger | null): string | null {
  if (!trigger) return null;
  if (trigger.kind === "slash") return `slash:${trigger.query}`;
  const { start, quoted, query } = trigger.match;
  return `at:${start}:${quoted ? 1 : 0}:${query}`;
}

export function triggersEqual(a: ComposerTrigger | null, b: ComposerTrigger | null): boolean {
  return triggerKey(a) === triggerKey(b);
}

export function nextTriggerGate(gate: TriggerGate, event: TriggerGateEvent, atEnabled: boolean): TriggerGate {
  if (event.type === "reset") return initialTriggerGate;
  const trigger = event.type === "dismissed" ? gate.trigger : composerTrigger(event.change.snapshot, atEnabled);
  const key = triggerKey(trigger);
  const dismissed =
    event.type === "dismissed" || event.change.cause === "restore"
      ? key
      : key === gate.dismissed
        ? gate.dismissed
        : null;
  if (triggersEqual(trigger, gate.trigger) && dismissed === gate.dismissed) return gate;
  return { trigger, dismissed };
}

export function openTrigger(gate: TriggerGate, visible: boolean): ComposerTrigger | null {
  if (!visible || !gate.trigger) return null;
  return triggerKey(gate.trigger) === gate.dismissed ? null : gate.trigger;
}
