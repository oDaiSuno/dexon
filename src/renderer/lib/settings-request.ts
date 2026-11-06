import type { SettingsTab } from "@/components/SettingsConfig";

type RequestListener = (tab: SettingsTab) => void;

const listeners = new Set<RequestListener>();
let pending: SettingsTab | null = null;

export function requestSettings(tab: SettingsTab): void {
  if (!listeners.size) {
    pending = tab;
    return;
  }
  for (const listener of [...listeners]) listener(tab);
}

export function subscribeSettingsRequest(listener: RequestListener): () => void {
  listeners.add(listener);
  if (pending !== null) {
    const tab = pending;
    pending = null;
    listener(tab);
  }
  return () => {
    listeners.delete(listener);
  };
}
