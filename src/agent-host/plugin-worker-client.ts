import type { spawn } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { ToolExecutionContext } from "../shared/toolchains/types";
import { TOOLCHAIN_ERROR_CODES } from "../shared/toolchains/types.ts";
import { ToolchainError } from "../shared/toolchains/errors.ts";
import type { PluginsResponse } from "../shared/api-types";
import {
  PLUGIN_WORKER_RESULT_MARKER,
  type PluginWorkerRequest,
  type PluginWorkerResponse,
} from "./plugin-worker-protocol.ts";
import { extractIsolatedNodeJobResult, IsolatedJobError, runIsolatedNodeJob } from "./isolated-node-job.ts";
import { redactDiagnostic } from "./subprocess-cwd.ts";

const PLUGIN_WORKER_TIMEOUT_MS = 3 * 60_000;

export interface PluginWorkerClientOptions {
  signal?: AbortSignal;
  entryPath?: string;
  execPath?: string;
  timeoutMs?: number;
  terminationGraceMs?: number;
  spawnProcess?: typeof spawn;
}

function spawnEnvironment(context: ToolExecutionContext): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {};
  for (const [key, value] of Object.entries(context.nativeEnv)) {
    if (typeof value === "string") env[key] = value;
  }
  env.ELECTRON_RUN_AS_NODE = "1";
  env.PI_DESKTOP_PLUGIN_WORKER = "1";
  env.PI_DESKTOP_TOOLCHAIN_REVISION = String(context.inventoryRevision);
  return env;
}

export function extractPluginWorkerResponse(output: string): PluginWorkerResponse | undefined {
  return extractIsolatedNodeJobResult(output, PLUGIN_WORKER_RESULT_MARKER) as PluginWorkerResponse | undefined;
}

function responseError(response: Extract<PluginWorkerResponse, { ok: false }>): ToolchainError {
  const code = (TOOLCHAIN_ERROR_CODES as readonly string[]).includes(response.error.code)
    ? response.error.code
    : "TOOLCHAIN_INTERNAL";
  const message = redactDiagnostic(response.error.message);
  if (/\b(?:spawn|run)\s+(?:npm|node)\b.*(?:ENOENT|not found)/i.test(message)) {
    return new ToolchainError({ code: "TOOLCHAIN_NODE_REQUIRED", capability: "js.npm", message });
  }
  if (/\b(?:spawn|run)\s+git\b.*(?:ENOENT|not found)/i.test(message)) {
    return new ToolchainError({ code: "TOOLCHAIN_GIT_REQUIRED", capability: "vcs.git", message });
  }
  return new ToolchainError({ code, message });
}

export async function runPluginWorker(
  request: PluginWorkerRequest,
  context: ToolExecutionContext,
  options: PluginWorkerClientOptions = {},
): Promise<PluginsResponse> {
  const entryPath = options.entryPath ?? join(dirname(fileURLToPath(import.meta.url)), "plugin-worker.mjs");
  try {
    const response = (await runIsolatedNodeJob({
      entryPath,
      signal: options.signal,
      input: request,
      marker: PLUGIN_WORKER_RESULT_MARKER,
      timeoutMs: options.timeoutMs ?? PLUGIN_WORKER_TIMEOUT_MS,
      maxInputBytes: 64 * 1024,
      env: spawnEnvironment(context),
      execPath: options.execPath,
      terminationGraceMs: options.terminationGraceMs,
      spawnProcess: options.spawnProcess,
      label: "Plugin worker",
      parseResult: (output) => extractPluginWorkerResponse(output) || undefined,
      sanitizeStderr: redactDiagnostic,
    })) as PluginWorkerResponse;
    if (response.ok) return response.result;
    throw responseError(response);
  } catch (error) {
    if (!(error instanceof IsolatedJobError)) throw error;
    throw new ToolchainError({ code: "TOOLCHAIN_INTERNAL", message: error.message, cause: error.cause });
  }
}
