import { extractAtQuery, type AtQueryMatch } from "@/lib/file-fuzzy";
import type { ComposerChange, ComposerSnapshot } from "./types";
import { parseSlashQuery, type SlashQuery } from "./command-slot";

export type ComposerTrigger =
  { readonly kind: "slash"; readonly query: SlashQuery } | { readonly kind: "at"; readonly match: AtQueryMatch };

export type TriggerMode = "closed" | "range-edit" | "open";

export interface TriggerGate {
  readonly trigger: ComposerTrigger | null;
  readonly mode: TriggerMode;
}

export type TriggerGateEvent =
  | { readonly type: "changed"; readonly change: ComposerChange }
  | { readonly type: "dismissed" }
  | { readonly type: "reset" };

export const initialTriggerGate: TriggerGate = { trigger: null, mode: "closed" };

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
    return gate.mode === "closed" ? gate : { trigger: gate.trigger, mode: "closed" };
  }
  const trigger = composerTrigger(event.change.snapshot, atEnabled);
  let mode: TriggerMode;
  if (event.change.cause === "restore") mode = "closed";
  else if (event.change.cause === "edit") {
    mode = trigger !== null ? "open" : event.change.snapshot.caret.kind === "range" ? "range-edit" : "closed";
  } else if (gate.mode === "range-edit" && event.change.snapshot.caret.kind === "range") {
    mode = "range-edit";
  } else {
    mode =
      trigger !== null && (gate.mode === "range-edit" || (gate.mode === "open" && triggersEqual(trigger, gate.trigger)))
        ? "open"
        : "closed";
  }
  if (triggersEqual(trigger, gate.trigger) && mode === gate.mode) return gate;
  return { trigger, mode };
}

export function openTrigger(gate: TriggerGate, visible: boolean): ComposerTrigger | null {
  return visible && gate.mode === "open" ? gate.trigger : null;
}
