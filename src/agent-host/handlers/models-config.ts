import { existsSync, mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, unlinkSync, writeFileSync } from "fs";
import { createHash } from "crypto";
import { tmpdir } from "os";
import path from "path";
import { ModelRuntime, getAgentDir } from "@earendil-works/pi-coding-agent";
import type { RpcServer } from "../../contract/rpc";
import { RpcError, type ProviderChannelTestResult } from "../../contract/types";
import { getSharedModelRuntime, reloadSharedModelRuntimeConfig } from "../model-runtime";
import { readProviderChannels, updateProviderChannel } from "../provider-channels";

function getModelsPath(): string {
  return path.join(getAgentDir(), "models.json");
}

type ModelsFileSnapshot = { raw: string | null; version: string };

function modelsContentVersion(raw: string | null): string {
  return raw === null ? "missing" : `sha256:${createHash("sha256").update(raw, "utf8").digest("hex")}`;
}

function readModelsFileSnapshot(): ModelsFileSnapshot {
  const p = getModelsPath();
  if (!existsSync(p)) return { raw: null, version: modelsContentVersion(null) };
  const raw = readFileSync(p, "utf8");
  return { raw, version: modelsContentVersion(raw) };
}

function readModelsJsonSnapshot(): { config: Record<string, unknown>; version: string } {
  const snapshot = readModelsFileSnapshot();
  if (snapshot.raw === null) return { config: { providers: {} }, version: snapshot.version };
  try {
    return { config: JSON.parse(snapshot.raw) as Record<string, unknown>, version: snapshot.version };
  } catch (e) {
    // ISSUE-009: never silently return empty and allow overwrite of corrupt file
    throw new RpcError({
      code: "PARSE_ERROR",
      message: `Failed to parse models.json: ${e instanceof Error ? e.message : String(e)}`,
    });
  }
}

function modelsConfigConflict(expectedVersion: string, currentVersion: string): RpcError {
  return new RpcError({
    code: "CONFLICT",
    message: "models.json changed outside this editor; current edits were not saved",
    detail: { expectedVersion, currentVersion },
  });
}

function writeModelsJson(data: Record<string, unknown>, expectedVersion: string): string {
  const p = getModelsPath();
  mkdirSync(path.dirname(p), { recursive: true });
  const initial = readModelsFileSnapshot();
  if (initial.version !== expectedVersion) throw modelsConfigConflict(expectedVersion, initial.version);
  // ISSUE-009: atomic write via temp + rename; keep .bak of previous good file
  const tmp = `${p}.${process.pid}.tmp`;
  const bak = `${p}.bak`;
  const serialized = JSON.stringify(data, null, 2);
  writeFileSync(tmp, serialized, "utf8");
  try {
    const beforeCommit = readModelsFileSnapshot();
    if (beforeCommit.version !== expectedVersion) throw modelsConfigConflict(expectedVersion, beforeCommit.version);
    if (beforeCommit.raw !== null) {
      try {
        writeFileSync(bak, beforeCommit.raw, "utf8");
      } catch {
        /* ignore bak failure */
      }
    }
    renameSync(tmp, p);
  } catch (e) {
    try {
      unlinkSync(tmp);
    } catch {
      /* ignore */
    }
    throw e;
  }
  return modelsContentVersion(serialized);
}

type ProbeModelResult =
  | { ok: true; latencyMs: number; status?: number; responseText: string }
  | { ok: false; reason: "timeout" | "error"; error: string; latencyMs?: number; status?: number };

const TEST_TIMEOUT_MS = 20_000;

async function probeModel(
  modelRuntime: ModelRuntime,
  model: NonNullable<ReturnType<ModelRuntime["getModel"]>>,
): Promise<ProbeModelResult> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), TEST_TIMEOUT_MS);
  const failureReason = (): "timeout" | "error" => (controller.signal.aborted ? "timeout" : "error");
  let status: number | undefined;
  const startedAt = Date.now();
  try {
    const message = await modelRuntime.completeSimple(
      model,
      {
        messages: [
          {
            role: "user",
            content: "Reply with OK only.",
            timestamp: Date.now(),
          },
        ],
      },
      {
        maxTokens: 16,
        timeoutMs: TEST_TIMEOUT_MS,
        maxRetries: 0,
        cacheRetention: "none",
        signal: controller.signal,
        onResponse: (response: { status: number }) => {
          status = response.status;
        },
      },
    );

    const latencyMs = Date.now() - startedAt;
    if (message.stopReason === "error" || message.stopReason === "aborted") {
      return {
        ok: false,
        reason: failureReason(),
        error: message.errorMessage ?? (controller.signal.aborted ? "Test timed out" : "Model returned an error"),
        latencyMs,
        ...(status !== undefined ? { status } : {}),
      };
    }
    const responseText = message.content
      .filter((b) => b.type === "text")
      .map((b) => (b as { text: string }).text)
      .join("")
      .slice(0, 300);
    return { ok: true, latencyMs, ...(status !== undefined ? { status } : {}), responseText };
  } catch (e) {
    return {
      ok: false,
      reason: failureReason(),
      error: e instanceof Error ? e.message : String(e),
      latencyMs: Date.now() - startedAt,
    };
  } finally {
    clearTimeout(timeout);
  }
}

function channelResultOf(probe: ProbeModelResult): ProviderChannelTestResult {
  const testedAt = new Date().toISOString();
  return probe.ok
    ? {
        ok: true,
        latencyMs: probe.latencyMs,
        ...(probe.status !== undefined ? { status: probe.status } : {}),
        testedAt,
      }
    : {
        ok: false,
        reason: probe.reason,
        error: probe.error,
        ...(probe.latencyMs !== undefined ? { latencyMs: probe.latencyMs } : {}),
        ...(probe.status !== undefined ? { status: probe.status } : {}),
        testedAt,
      };
}

function requireProviderName(value: unknown): string {
  const provider = typeof value === "string" ? value.trim() : "";
  if (!provider || provider.length > 200) {
    throw new RpcError({ code: "BAD_REQUEST", message: "provider must be a channel name" });
  }
  return provider;
}

async function requireKnownProvider(provider: string): Promise<void> {
  const runtime = await getSharedModelRuntime();
  if (!runtime.getProvider(provider)) {
    throw new RpcError({ code: "BAD_REQUEST", message: `Unknown channel: ${provider}` });
  }
}

export function registerModelsConfigHandlers(server: RpcServer): void {
  server.handle({
    "modelsConfig.get": () => readModelsJsonSnapshot(),

    "modelsConfig.set": async (params) => {
      const body = params as { config?: unknown; expectedVersion?: unknown };
      const config = body?.config as Record<string, unknown> | undefined;
      // ISSUE-009: refuse to persist empty overwrite without explicit providers key from a real load
      if (!config || typeof config !== "object" || !("providers" in config)) {
        throw new RpcError({ code: "BAD_REQUEST", message: "Invalid models config payload" });
      }
      if (typeof body.expectedVersion !== "string" || !body.expectedVersion) {
        throw new RpcError({ code: "BAD_REQUEST", message: "expectedVersion is required" });
      }
      const version = writeModelsJson(config, body.expectedVersion);
      await reloadSharedModelRuntimeConfig();
      return { ok: true as const, version };
    },

    "modelsConfig.test": async (params) => {
      const body = params as unknown as {
        providerName?: string;
        provider?: Record<string, unknown>;
        model?: Record<string, unknown>;
      };
      const providerName = typeof body.providerName === "string" ? body.providerName.trim() : "";
      if (!providerName) return { ok: false, error: "providerName is required" };
      if (!body.provider || typeof body.provider !== "object") {
        return { ok: false, error: "provider is required" };
      }
      if (!body.model || typeof body.model !== "object") {
        return { ok: false, error: "model is required" };
      }
      const modelId = typeof body.model.id === "string" ? body.model.id.trim() : "";
      if (!modelId) return { ok: false, error: "Model ID is required" };

      let tempDir: string | undefined;
      try {
        tempDir = mkdtempSync(path.join(tmpdir(), "dexon-model-test-"));
        const modelsPath = path.join(tempDir, "models.json");
        writeFileSync(
          modelsPath,
          JSON.stringify(
            {
              providers: {
                [providerName]: {
                  ...body.provider,
                  models: [{ ...body.model, id: modelId }],
                },
              },
            },
            null,
            2,
          ),
          "utf8",
        );

        const modelRuntime = await ModelRuntime.create({ modelsPath, allowModelNetwork: false });
        const loadError = modelRuntime.getError();
        if (loadError) return { ok: false, error: loadError };

        const model = modelRuntime.getModel(providerName, modelId);
        if (!model) return { ok: false, error: `Model not found: ${providerName}/${modelId}` };

        const auth = await modelRuntime.getAuth(model);
        if (!auth) return { ok: false, error: `No authentication found for "${providerName}"` };

        const probe = await probeModel(modelRuntime, model);
        return probe.ok
          ? { ok: true, latencyMs: probe.latencyMs, status: probe.status, responseText: probe.responseText }
          : { ok: false, error: probe.error, latencyMs: probe.latencyMs, status: probe.status };
      } catch (e) {
        return { ok: false, error: e instanceof Error ? e.message : String(e) };
      } finally {
        if (tempDir) {
          try {
            rmSync(tempDir, { recursive: true, force: true });
          } catch {
            /* ignore */
          }
        }
      }
    },

    "modelsConfig.channels.get": () => ({ channels: readProviderChannels() }),

    "modelsConfig.channels.setEnabled": async (params) => {
      const provider = requireProviderName((params as { provider?: unknown })?.provider);
      const enabled = (params as { enabled?: unknown })?.enabled;
      if (typeof enabled !== "boolean") {
        throw new RpcError({ code: "BAD_REQUEST", message: "enabled must be a boolean" });
      }
      await requireKnownProvider(provider);
      return { channels: updateProviderChannel(provider, { enabled }) };
    },

    "modelsConfig.channels.test": async (params) => {
      const provider = requireProviderName((params as { provider?: unknown })?.provider);
      await requireKnownProvider(provider);
      let result: ProviderChannelTestResult;
      try {
        const runtime = await getSharedModelRuntime();
        const model = (await runtime.getAvailable(provider))[0];
        result = model
          ? channelResultOf(await probeModel(runtime, model))
          : channelResultOf({
              ok: false,
              reason: "error",
              error: "No model of this channel has working credentials",
            });
      } catch (e) {
        result = channelResultOf({ ok: false, reason: "error", error: e instanceof Error ? e.message : String(e) });
      }
      updateProviderChannel(provider, { lastTest: result });
      return result;
    },
  });
}
