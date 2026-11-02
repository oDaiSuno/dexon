import { extractAtQuery, type AtQueryMatch } from "@/lib/file-fuzzy";
import type { ComposerChange, ComposerSnapshot } from "./types";
import { parseSlashQuery, type SlashQuery } from "./command-slot";

export type ComposerTrigger =
  | { readonly kind: "slash"; readonly query: SlashQuery; readonly trailing: boolean }
  | { readonly kind: "at"; readonly match: AtQueryMatch };

export interface TriggerGate {
  readonly trigger: ComposerTrigger | null;
  readonly restored: boolean;
  readonly dismissedKey: string | null;
  readonly open: boolean;
}

export type TriggerGateEvent =
  | { readonly type: "changed"; readonly change: ComposerChange }
  | { readonly type: "dismissed" }
  | { readonly type: "reset" };

export const initialTriggerGate: TriggerGate = {
  trigger: null,
  restored: false,
  dismissedKey: null,
  open: false,
};

export function composerTrigger(snapshot: ComposerSnapshot | null, atEnabled: boolean): ComposerTrigger | null {
  if (!snapshot || snapshot.caret.kind !== "caret") return null;
  const before = snapshot.masked.slice(0, snapshot.caret.offset);
  const after = snapshot.masked.slice(snapshot.caret.offset);
  const query = parseSlashQuery({ before, after });
  if (query) return { kind: "slash", query, trailing: after.length > 0 };
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
    if (gate.restored || key === null) return gate;
    if (!gate.open && gate.dismissedKey === key) return gate;
    return { trigger: gate.trigger, restored: false, dismissedKey: key, open: false };
  }
  const { cause, snapshot } = event.change;
  const trigger = composerTrigger(snapshot, atEnabled);
  if (cause === "restore") {
    return { trigger, restored: true, dismissedKey: null, open: false };
  }
  if (gate.restored && cause !== "edit") {
    return { trigger, restored: true, dismissedKey: null, open: false };
  }
  const key = triggerKey(trigger);
  const dismissedKey = cause === "edit" ? null : key === null || key === gate.dismissedKey ? gate.dismissedKey : null;
  let open = false;
  if (trigger !== null && key !== dismissedKey) {
    if (cause === "edit" || trigger.kind === "at" || !trigger.trailing) {
      open = true;
    } else {
      open = gate.open && triggersEqual(trigger, gate.trigger);
    }
  }
  if (
    triggersEqual(trigger, gate.trigger) &&
    !gate.restored &&
    dismissedKey === gate.dismissedKey &&
    open === gate.open
  ) {
    return gate;
  }
  return { trigger, restored: false, dismissedKey, open };
}

export function openTrigger(gate: TriggerGate, visible: boolean): ComposerTrigger | null {
  return visible && gate.open ? gate.trigger : null;
}
