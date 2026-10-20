import {
  DEFAULT_SESSION_ORCHESTRATION_SETTINGS,
  normalizeSessionOrchestrationSettings,
  type SessionOrchestrationSettings,
} from "../../shared/session-orchestration";
import { callMain } from "../parent-rpc";

const SETTINGS_PULL_TIMEOUT_MS = 5_000;

let current: SessionOrchestrationSettings = { ...DEFAULT_SESSION_ORCHESTRATION_SETTINGS };
let onSettingsChanged: (() => void) | null = null;
const installedPorts = new WeakSet<object>();

export function getSessionOrchestrationSettings(): SessionOrchestrationSettings {
  return current;
}

export function sessionOrchestrationEnabled(): boolean {
  return current.enabled;
}

function unwrapSettings(result: unknown): unknown {
  if (result && typeof result === "object" && "settings" in result) {
    return (result as { settings?: unknown }).settings;
  }
  return result;
}

function applySettings(value: unknown): void {
  const next = normalizeSessionOrchestrationSettings(value);
  const previous = current;
  current = next;
  const changed = (Object.keys(next) as Array<keyof SessionOrchestrationSettings>).some(
    (key) => JSON.stringify(next[key]) !== JSON.stringify(previous[key]),
  );
  if (changed) onSettingsChanged?.();
}

async function pullFromMain(): Promise<unknown> {
  try {
    return await callMain<unknown>("sessionOrchestration.getSettings", undefined, SETTINGS_PULL_TIMEOUT_MS);
  } catch {
    return undefined;
  }
}

export async function refreshSessionOrchestrationSettings(): Promise<void> {
  const answer = await pullFromMain();
  if (answer === undefined) return;
  applySettings(unwrapSettings(answer));
}

export function initializeSessionOrchestrationSettings(options: { onSettingsChanged: () => void }): void {
  onSettingsChanged = options.onSettingsChanged;
  const port = process.parentPort;
  if (!port || installedPorts.has(port)) return;
  installedPorts.add(port);
  port.on("message", (event: { data?: unknown }) => {
    const message = event?.data as { type?: string; settings?: unknown } | undefined;
    if (message?.type !== "session-orchestration:settings") return;
    applySettings(message.settings);
  });
  void refreshSessionOrchestrationSettings();
}
