import { readFile } from "node:fs/promises";
import path from "node:path";
import { RpcError, type SessionNamingModelRef, type SessionNamingSettingsResult } from "../contract/types";
import { atomicWriteAsync, desktopUserDataPath } from "./desktop-state-file";

const writeQueues = new Map<string, Promise<unknown>>();

function settingsFilePath(): string {
  return path.join(desktopUserDataPath(), "session-naming.json");
}

function serializeWrite<T>(filePath: string, task: () => Promise<T>): Promise<T> {
  const previous = writeQueues.get(filePath) ?? Promise.resolve();
  const next = previous.catch(() => undefined).then(task);
  const tail = next.finally(() => {
    if (writeQueues.get(filePath) === tail) writeQueues.delete(filePath);
  });
  writeQueues.set(filePath, tail);
  return next;
}

function normalizeModel(value: unknown): SessionNamingModelRef | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const { provider, modelId } = value as Record<string, unknown>;
  if (
    typeof provider !== "string" ||
    typeof modelId !== "string" ||
    !provider.trim() ||
    !modelId.trim() ||
    provider.length > 200 ||
    modelId.length > 200 ||
    /\p{Cc}/u.test(provider) ||
    /\p{Cc}/u.test(modelId)
  ) {
    return null;
  }
  return { provider: provider.trim(), modelId: modelId.trim() };
}

async function readSettingsFromFile(filePath: string): Promise<SessionNamingSettingsResult> {
  const defaults: SessionNamingSettingsResult = { enabled: true, model: null, configured: false };
  try {
    const value: unknown = JSON.parse(await readFile(filePath, "utf8"));
    if (!value || typeof value !== "object" || Array.isArray(value)) return defaults;
    const record = value as Record<string, unknown>;
    if (record.version !== 1) return defaults;
    return {
      enabled: typeof record.enabled === "boolean" ? record.enabled : true,
      model: normalizeModel(record.model),
      configured: true,
    };
  } catch {
    return defaults;
  }
}

export async function readSessionNamingSettings(): Promise<SessionNamingSettingsResult> {
  return readSettingsFromFile(settingsFilePath());
}

export async function writeSessionNamingSettings(patch: unknown): Promise<SessionNamingSettingsResult> {
  if (!patch || typeof patch !== "object" || Array.isArray(patch)) {
    throw new RpcError({ code: "BAD_REQUEST", message: "Session naming settings must be an object" });
  }
  const input = patch as { enabled?: unknown; model?: unknown };
  if (input.enabled !== undefined && typeof input.enabled !== "boolean") {
    throw new RpcError({ code: "BAD_REQUEST", message: "enabled must be a boolean" });
  }
  const normalizedModel = normalizeModel(input.model);
  if (input.model !== undefined && input.model !== null && !normalizedModel) {
    throw new RpcError({
      code: "BAD_REQUEST",
      message:
        "model must be null or contain non-empty provider and modelId strings of at most 200 characters without control characters",
    });
  }
  const inputEnabled = input.enabled;
  const inputModel = input.model;
  const filePath = settingsFilePath();
  return serializeWrite(filePath, async () => {
    const current = await readSettingsFromFile(filePath);
    const enabled = inputEnabled === undefined ? current.enabled : inputEnabled;
    const model = inputModel === undefined ? current.model : normalizedModel;
    await atomicWriteAsync(filePath, { version: 1, enabled, model });
    return { enabled, model, configured: true };
  });
}
