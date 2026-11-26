import { useSyncExternalStore } from "react";
import type { AutomationAiSessionIntent } from "./automation-request";

let currentIntent: AutomationAiSessionIntent | null = null;
const listeners = new Set<() => void>();

function notify(): void {
  for (const listener of [...listeners]) listener();
}

export function getAutomationSessionIntent(): AutomationAiSessionIntent | null {
  return currentIntent;
}

export function setAutomationSessionIntent(intent: AutomationAiSessionIntent | null): void {
  currentIntent = intent;
  notify();
}

export function clearAutomationSessionIntent(): void {
  if (currentIntent === null) return;
  currentIntent = null;
  notify();
}

export function useAutomationSessionIntent(): AutomationAiSessionIntent | null {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    getAutomationSessionIntent,
    getAutomationSessionIntent,
  );
}
