import fs from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { getAgentDir } from "@earendil-works/pi-coding-agent";
import { RpcError } from "../contract/types";
import {
  CODEMODE_TOOL_NAME,
  DEFAULT_CODEMODE_ENABLED,
  normalizeCodemodeMode,
  type CodemodeAvailability,
  type CodemodeProjectOverride,
  type CodemodeSettingsPatch,
  type CodemodeSettingsResult,
} from "../shared/codemode";

const require = createRequire(import.meta.url);
const writeQueues = new Map<string, Promise<unknown>>();
const effectiveCaches = new Map<string, Map<string, boolean>>();
const changeListeners = new Set<() => void | Promise<void>>();

export function onCodemodeSettingsChanged(listener: () => void | Promise<void>): () => void {
  changeListeners.add(listener);
  return () => {
    changeListeners.delete(listener);
  };
}

type Settings = Record<string, unknown>;

function configPath(): string {
  return path.resolve(getAgentDir(), "settings.json");
}

function cwdKey(cwd?: string): string {
  return cwd ? path.resolve(cwd) : "";
}

function cacheFor(filePath: string): Map<string, boolean> {
  let cache = effectiveCaches.get(filePath);
  if (!cache) {
    cache = new Map();
    effectiveCaches.set(filePath, cache);
  }
  return cache;
}

function serialize<T>(filePath: string, task: () => Promise<T>): Promise<T> {
  const previous = writeQueues.get(filePath) ?? Promise.resolve();
  const next = previous.catch(() => undefined).then(task);
  const tail = next
    .catch(() => undefined)
    .finally(() => {
      if (writeQueues.get(filePath) === tail) writeQueues.delete(filePath);
    });
  writeQueues.set(filePath, tail);
  return next;
}

function asSettings(value: unknown): Settings | null {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Settings) : null;
}

async function readObject(filePath: string): Promise<Settings | null> {
  try {
    return asSettings(JSON.parse(await fs.readFile(filePath, "utf8")));
  } catch {
    return null;
  }
}

async function readSettingsForWrite(filePath: string): Promise<Settings> {
  let raw: string;
  try {
    raw = await fs.readFile(filePath, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException | null)?.code === "ENOENT") return {};
    throw new RpcError({
      code: "INTERNAL",
      message: error instanceof Error ? error.message : "Failed to read settings file",
    });
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new RpcError({ code: "INTERNAL", message: "Existing settings.json is not valid JSON" });
  }
  const record = asSettings(parsed);
  if (!record) {
    throw new RpcError({ code: "INTERNAL", message: "Existing settings.json must contain a JSON object" });
  }
  return record;
}

function isModifier(entry: unknown): boolean {
  return typeof entry === "string" && (entry.startsWith("+") || entry.startsWith("-"));
}

function enabledFor(entries: unknown, inherited = DEFAULT_CODEMODE_ENABLED): boolean {
  if (!Array.isArray(entries)) return inherited;
  let enabled = entries.length > 0 && entries.every(isModifier) ? inherited : entries.includes(CODEMODE_TOOL_NAME);
  for (const entry of entries) {
    if (entry === `+${CODEMODE_TOOL_NAME}`) enabled = true;
    else if (entry === `-${CODEMODE_TOOL_NAME}`) enabled = false;
  }
  return enabled;
}

function updatedTools(entries: unknown, enabled: boolean): unknown[] {
  const current: unknown[] = Array.isArray(entries) ? entries : [];
  const modifiersOnly = !Array.isArray(entries) || (current.length > 0 && current.every(isModifier));
  const tools = current.filter(
    (entry) => entry !== CODEMODE_TOOL_NAME && entry !== `+${CODEMODE_TOOL_NAME}` && entry !== `-${CODEMODE_TOOL_NAME}`,
  );
  if (modifiersOnly) tools.push(`${enabled ? "+" : "-"}${CODEMODE_TOOL_NAME}`);
  else if (enabled) tools.push(CODEMODE_TOOL_NAME);
  return tools;
}

async function projectOverride(
  globalConfigPath: string,
  globalEnabled: boolean,
  cwd?: string,
): Promise<CodemodeProjectOverride | null> {
  if (!cwd) return null;
  const filePath = path.join(cwd, ".pi", "settings.json");
  if (path.resolve(filePath) === path.resolve(globalConfigPath)) return null;
  const project = await readObject(filePath);
  if (!project) return null;
  const mode = asSettings(project.codemode)?.mode;
  const overrideMode = mode === "on" || mode === "only" ? mode : undefined;
  const entries = project.defaultTools;
  const affectsCodemode =
    Array.isArray(entries) &&
    (entries.length === 0 ||
      !entries.every(isModifier) ||
      entries.includes(`+${CODEMODE_TOOL_NAME}`) ||
      entries.includes(`-${CODEMODE_TOOL_NAME}`));
  const overrideEnabled = affectsCodemode ? enabledFor(entries, globalEnabled) : undefined;
  if (overrideMode === undefined && overrideEnabled === undefined) return null;
  return {
    filePath,
    ...(overrideEnabled !== undefined ? { enabled: overrideEnabled } : {}),
    ...(overrideMode !== undefined ? { mode: overrideMode } : {}),
  };
}

export async function checkCodemodeAvailability(): Promise<CodemodeAvailability> {
  try {
    const wasmPath = require.resolve("quickjs-wasi/quickjs.wasm");
    const workerPath = fileURLToPath(import.meta.resolve("@earendil-works/pi-codemode/worker"));
    await Promise.all([fs.access(wasmPath, fs.constants.R_OK), fs.access(workerPath, fs.constants.R_OK)]);
    return { available: true };
  } catch (error) {
    return {
      available: false,
      reason: "missing_sandbox",
      detail: error instanceof Error ? error.message : String(error),
    };
  }
}

async function resultFor(
  filePath: string,
  settings: Settings,
  availability: CodemodeAvailability,
  cwd?: string,
): Promise<CodemodeSettingsResult> {
  const enabled = enabledFor(settings.defaultTools);
  const override = settings.defaultProjectTrust === "never" ? null : await projectOverride(filePath, enabled, cwd);
  return {
    enabled,
    mode: normalizeCodemodeMode(asSettings(settings.codemode)?.mode),
    configPath: filePath,
    availability,
    projectOverride: override,
  };
}

function remember(result: CodemodeSettingsResult, cwd?: string): boolean {
  const enabled = result.availability.available && (result.projectOverride?.enabled ?? result.enabled);
  const cache = cacheFor(result.configPath);
  cache.set(cwdKey(cwd), enabled);
  cache.set("", result.availability.available && result.enabled);
  return enabled;
}

export function isCodemodeEnabledForCwd(cwd?: string): boolean {
  const cache = cacheFor(configPath());
  return cache.get(cwdKey(cwd)) ?? cache.get("") ?? DEFAULT_CODEMODE_ENABLED;
}

export async function readCodemodeSettings(cwd?: string): Promise<CodemodeSettingsResult> {
  if (cwd !== undefined && typeof cwd !== "string") {
    throw new RpcError({ code: "BAD_REQUEST", message: "cwd must be a string" });
  }
  const filePath = configPath();
  return serialize(filePath, async () => {
    const result = await resultFor(
      filePath,
      (await readObject(filePath)) ?? {},
      await checkCodemodeAvailability(),
      cwd,
    );
    remember(result, cwd);
    return result;
  });
}

export async function refreshEffectiveCodemode(cwd?: string): Promise<boolean> {
  const result = await readCodemodeSettings(cwd);
  return result.availability.available && (result.projectOverride?.enabled ?? result.enabled);
}

async function renameWithRetry(source: string, target: string): Promise<void> {
  const delays = [10, 25, 50, 100];
  for (let attempt = 0; ; attempt += 1) {
    try {
      await fs.rename(source, target);
      return;
    } catch (error) {
      const code = (error as NodeJS.ErrnoException | null)?.code;
      if (attempt >= delays.length || (code !== "EPERM" && code !== "EBUSY" && code !== "EACCES")) throw error;
      await new Promise((resolve) => setTimeout(resolve, delays[attempt]));
    }
  }
}

async function writeAtomically(filePath: string, settings: Settings): Promise<void> {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  const temporaryPath = `${filePath}.${process.pid}.${randomUUID()}.tmp`;
  try {
    await fs.writeFile(temporaryPath, `${JSON.stringify(settings, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
    await renameWithRetry(temporaryPath, filePath);
  } catch (error) {
    await fs.unlink(temporaryPath).catch(() => undefined);
    throw error;
  }
}

function validatePatch(patch: CodemodeSettingsPatch): void {
  if (!asSettings(patch)) {
    throw new RpcError({ code: "BAD_REQUEST", message: "Code Mode settings must be an object" });
  }
  if (patch.enabled !== undefined && typeof patch.enabled !== "boolean") {
    throw new RpcError({ code: "BAD_REQUEST", message: "enabled must be a boolean" });
  }
  if (patch.mode !== undefined && patch.mode !== "on" && patch.mode !== "only") {
    throw new RpcError({ code: "BAD_REQUEST", message: "mode must be on or only" });
  }
  if (patch.cwd !== undefined && typeof patch.cwd !== "string") {
    throw new RpcError({ code: "BAD_REQUEST", message: "cwd must be a string" });
  }
}

export async function writeCodemodeSettings(patch: CodemodeSettingsPatch): Promise<CodemodeSettingsResult> {
  validatePatch(patch);
  const { enabled, mode, cwd } = patch;
  const filePath = configPath();
  return serialize(filePath, async () => {
    const settings = await readSettingsForWrite(filePath);
    if (enabled !== undefined) settings.defaultTools = updatedTools(settings.defaultTools, enabled);
    if (mode !== undefined) settings.codemode = { ...asSettings(settings.codemode), mode };
    await writeAtomically(filePath, settings);
    const availability = await checkCodemodeAvailability();
    const cwds = new Set([...cacheFor(filePath).keys(), cwdKey(cwd), ""]);
    await Promise.all(
      [...cwds].map(async (key) => remember(await resultFor(filePath, settings, availability, key || undefined), key)),
    );
    await Promise.all(
      [...changeListeners].map((listener) =>
        Promise.resolve()
          .then(listener)
          .catch(() => undefined),
      ),
    );
    return resultFor(filePath, settings, availability, cwd);
  });
}
