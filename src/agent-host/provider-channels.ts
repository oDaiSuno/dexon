import { readFileSync } from "node:fs";
import path from "node:path";
import type { ProviderChannelState, ProviderChannelTestResult } from "../contract/types";
import { atomicWrite, desktopUserDataPath } from "./desktop-state-file";

type ProviderChannelsFile = {
  version: 1;
  channels: Record<string, ProviderChannelState>;
};

function channelsFilePath(): string {
  return path.join(desktopUserDataPath(), "provider-channels.json");
}

function normalizeTest(value: unknown): ProviderChannelTestResult | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  if (typeof record.ok !== "boolean" || typeof record.testedAt !== "string" || !record.testedAt) return null;
  const latencyMs = typeof record.latencyMs === "number" ? record.latencyMs : undefined;
  const status = typeof record.status === "number" ? record.status : undefined;
  const testedAt = record.testedAt;
  if (record.ok) {
    if (latencyMs === undefined) return null;
    return { ok: true, latencyMs, ...(status !== undefined ? { status } : {}), testedAt };
  }
  const reason = record.reason === "timeout" || record.reason === "error" ? record.reason : undefined;
  const error = typeof record.error === "string" ? record.error : undefined;
  if (!reason || error === undefined) return null;
  return {
    ok: false,
    reason,
    error,
    ...(latencyMs !== undefined ? { latencyMs } : {}),
    ...(status !== undefined ? { status } : {}),
    testedAt,
  };
}

function normalizeState(value: unknown): Record<string, ProviderChannelState> {
  if (!value || typeof value !== "object") return {};
  const candidate = value as Partial<ProviderChannelsFile>;
  if (candidate.version !== 1 || !candidate.channels || typeof candidate.channels !== "object") return {};
  const channels: Record<string, ProviderChannelState> = {};
  for (const [rawProvider, rawEntry] of Object.entries(candidate.channels)) {
    const provider = rawProvider.trim();
    if (!provider || !rawEntry || typeof rawEntry !== "object" || Array.isArray(rawEntry)) continue;
    const entry = rawEntry as Partial<ProviderChannelState>;
    if (typeof entry.enabled !== "boolean") continue;
    channels[provider] = { enabled: entry.enabled, lastTest: normalizeTest(entry.lastTest) };
  }
  return channels;
}

export function readProviderChannels(): Record<string, ProviderChannelState> {
  try {
    return normalizeState(JSON.parse(readFileSync(channelsFilePath(), "utf8")));
  } catch {
    return {};
  }
}

export function updateProviderChannel(
  provider: string,
  patch: Partial<ProviderChannelState>,
): Record<string, ProviderChannelState> {
  const channels = readProviderChannels();
  const current = channels[provider] ?? { enabled: true, lastTest: null };
  channels[provider] = { ...current, ...patch };
  atomicWrite(channelsFilePath(), { version: 1, channels } satisfies ProviderChannelsFile);
  return channels;
}

export function disabledProviderIds(): Set<string> {
  return new Set(
    Object.entries(readProviderChannels())
      .filter(([, state]) => state.enabled === false)
      .map(([provider]) => provider),
  );
}
