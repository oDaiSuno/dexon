import { randomUUID } from "node:crypto";
import { linkSync, mkdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { EnvironmentDescriptor } from "../contract/environment.ts";
import { projectManagedProcessCapability } from "../main/managed-process/capability.ts";
import { ManagedProcessReaper } from "../main/managed-process/reaper.ts";
import { resolveBundledCorePaths } from "../main/toolchains/bundled-core.ts";
import { resolveRuntimeCatalogPath } from "../main/toolchains/catalog.ts";
import { ToolchainManager } from "../main/toolchains/manager.ts";
import { readProcessCreationTimestampMs } from "../shared/process-creation-time.ts";
import {
  DEFAULT_SESSION_ORCHESTRATION_SETTINGS,
  normalizeSessionOrchestrationSettings,
} from "../shared/session-orchestration.ts";
import { isExecutionIntent } from "../shared/toolchains/types.ts";
import { browserCapabilityRuntime } from "./browser-capability-runtime.ts";
import {
  buildEnvironmentDescriptor,
  ensureEnvironmentIdentity,
  type EnvironmentIdentity,
} from "./environment-identity.ts";
import { applyManagedProcessOwnerIdentity } from "./managed-process/owner-identity.ts";
import { MainProcessRpcError, setActiveEnvironmentDescriptor, setStandaloneMainRequestHandler } from "./parent-rpc.ts";
import { refreshSessionOrchestrationSettings } from "./session-orchestration/settings.ts";
import { StandaloneSecretStore } from "./standalone-secrets.ts";
import { toolchainRuntime } from "./toolchain-runtime.ts";

export interface StandaloneHostPlatform extends EnvironmentIdentity {
  getDescriptor(): EnvironmentDescriptor;
  dispose(): Promise<void>;
}

function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "EPERM";
  }
}

function claimDaemonStateDirectoryLock(stateDir: string, hostInstanceId: string, startTimestampMs: number): () => void {
  mkdirSync(stateDir, { recursive: true, mode: 0o700 });
  const lockPath = path.join(stateDir, "daemon-owner.lock");
  const tempPath = `${lockPath}.${process.pid}.${randomUUID()}.tmp`;
  const payload = JSON.stringify({ pid: process.pid, startTimestampMs, hostInstanceId });
  const readLock = () => {
    const text = readFileSync(lockPath, "utf8");
    try {
      return JSON.parse(text) as { pid?: unknown; startTimestampMs?: unknown; hostInstanceId?: unknown } | null;
    } catch {
      return null;
    }
  };
  try {
    writeFileSync(tempPath, payload, { encoding: "utf8", flag: "wx", mode: 0o600 });
    for (let attempt = 0; attempt < 8; attempt += 1) {
      try {
        try {
          linkSync(tempPath, lockPath);
        } catch (error) {
          const code = (error as NodeJS.ErrnoException).code ?? "";
          if (!["EPERM", "EACCES", "ENOSYS", "ENOTSUP", "EOPNOTSUPP", "EXDEV"].includes(code)) throw error;
          writeFileSync(lockPath, payload, { encoding: "utf8", flag: "wx", mode: 0o600 });
        }
        if (readLock()?.hostInstanceId === hostInstanceId) {
          return () => {
            try {
              if (readLock()?.hostInstanceId === hostInstanceId) rmSync(lockPath, { force: true });
            } catch {
              return;
            }
          };
        }
      } catch (error) {
        const code = (error as NodeJS.ErrnoException).code;
        if (code === "ENOENT") continue;
        if (code !== "EEXIST") throw error;
      }
      try {
        const existing = readLock();
        const ownerPid = typeof existing?.pid === "number" && Number.isInteger(existing.pid) ? existing.pid : null;
        if (ownerPid !== null && ownerPid > 1 && ownerPid !== process.pid && isProcessAlive(ownerPid)) {
          const liveStart = readProcessCreationTimestampMs(ownerPid);
          if (liveStart === null || liveStart === existing?.startTimestampMs) {
            throw new Error(`State directory ${stateDir} is already owned by active daemon PID ${ownerPid}`);
          }
        }
        if (readLock()?.hostInstanceId === existing?.hostInstanceId) rmSync(lockPath, { force: true });
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      }
    }
    throw new Error(`Unable to claim state directory ${stateDir}`);
  } finally {
    rmSync(tempPath, { force: true });
  }
}

export async function initializeStandaloneHostPlatform(options: {
  stateDir?: string;
  label?: string;
  piVersion: string;
  allowLanBind?: boolean;
}): Promise<StandaloneHostPlatform> {
  const identity = ensureEnvironmentIdentity(options);
  const { stateDir } = identity;
  const hostInstanceId = randomUUID();
  const startTimestampMs = readProcessCreationTimestampMs(process.pid) ?? Date.now();
  const releaseLock = claimDaemonStateDirectoryLock(stateDir, hostInstanceId, startTimestampMs);
  process.env.PI_DESKTOP_USER_DATA = stateDir;
  const secrets = new StandaloneSecretStore(path.join(stateDir, "channels.secrets.json"));
  const reaper = new ManagedProcessReaper(path.join(stateDir, "managed-processes-reaper.v2.json"));
  try {
    await reaper.initialize();
    applyManagedProcessOwnerIdentity({
      version: 1,
      mainPid: process.pid,
      mainStartFingerprint: String(startTimestampMs),
      mainImagePath: realpathSync.native(process.execPath),
      hostInstanceId,
    });
  } catch (error) {
    releaseLock();
    throw error;
  }
  const applicationRoot = fileURLToPath(new URL("../../", import.meta.url));
  const catalogOptions = { isPackaged: false, resourcesRoot: applicationRoot, applicationRoot };
  const bundledCore = resolveBundledCorePaths(catalogOptions);
  const toolchains = new ToolchainManager({
    userDataRoot: stateDir,
    homeDir: homedir(),
    fetchImpl: globalThis.fetch,
    catalogPath: resolveRuntimeCatalogPath(catalogOptions),
    coreCatalogPath: bundledCore.catalogPath,
    bundledCoreRoot: bundledCore.coreRoot,
  });
  const unsubscribeToolchains = toolchains.subscribe((snapshot) => toolchainRuntime.apply(snapshot));
  toolchainRuntime.apply(await toolchains.initialize());
  const descriptor = buildEnvironmentDescriptor({
    ...identity,
    piVersion: options.piVersion,
    capabilities: {
      browser: false,
      nativeDialogs: false,
      revealInFileManager: false,
      managedProcesses: true,
      toolchainInstall: true,
    },
  });
  const readUiState = (): Record<string, unknown> => {
    try {
      const value: unknown = JSON.parse(readFileSync(path.join(stateDir, "ui-state.json"), "utf8"));
      return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
    } catch {
      return {};
    }
  };
  const handlers: Record<string, (params: unknown) => unknown> = {
    "managedProcesses.getSettings": () => {
      const status = reaper.status();
      const capability = projectManagedProcessCapability({
        platform: process.platform,
        arch: process.arch,
        reaperReady: status.ready,
        helper: null,
        ownerReady: true,
      });
      return {
        enabled: capability.ready && readUiState().managedProcessesEnabled !== false,
        reaperReady: status.ready,
        capability,
      };
    },
    "managedProcesses.register": (params) => reaper.register((params as { record?: unknown } | undefined)?.record),
    "managedProcesses.unregister": (params) => reaper.unregister(params),
    "managedProcesses.confirmLanBind": () => ({ confirmed: Boolean(options.allowLanBind) }),
    "managedProcesses.selectExportTarget": (params) => {
      const suggestedName = (params as { suggestedName?: unknown } | undefined)?.suggestedName;
      const name =
        typeof suggestedName === "string" && /^[a-z0-9][a-z0-9._-]{0,127}$/iu.test(suggestedName)
          ? suggestedName
          : "managed-process.log";
      const directory = path.join(stateDir, "exports");
      mkdirSync(directory, { recursive: true, mode: 0o700 });
      const fileName = `${randomUUID()}-${name}`;
      return { path: path.join(directory, fileName), fileName };
    },
    "toolchain.getSnapshot": () => toolchains.getSnapshot(),
    "toolchain.resolve": (params) => {
      const body = params as { cwd?: unknown; intent?: unknown; trusted?: unknown } | undefined;
      if (
        typeof body?.cwd !== "string" ||
        !path.isAbsolute(body.cwd) ||
        body.cwd.length > 4_096 ||
        /[\0\r\n]/u.test(body.cwd) ||
        !isExecutionIntent(body.intent) ||
        typeof body.trusted !== "boolean"
      ) {
        throw new Error("Invalid Host toolchain resolution request");
      }
      return toolchains.resolveForProject(body.cwd, { intent: body.intent, trusted: body.trusted });
    },
    "sessionOrchestration.getSettings": () =>
      normalizeSessionOrchestrationSettings(
        readUiState().sessionOrchestration ?? DEFAULT_SESSION_ORCHESTRATION_SETTINGS,
      ),
    "browser.sessionEnded": () => undefined,
    "browser.capabilities": () => browserCapabilityRuntime.getSnapshot(),
  };
  setStandaloneMainRequestHandler(async (method, params) => {
    if (method.startsWith("channelSecrets.")) return secrets.handle(method, params);
    const handler = Object.hasOwn(handlers, method) ? handlers[method] : undefined;
    if (handler) return handler(params);
    if (method.startsWith("browser.")) {
      throw new MainProcessRpcError({
        message: "Browser tools are unavailable in headless daemon mode",
        code: "BROWSER_UNAVAILABLE",
        retryable: false,
      });
    }
    throw new Error(`Unsupported Host request: ${method}`);
  });
  setActiveEnvironmentDescriptor(descriptor);
  await refreshSessionOrchestrationSettings();
  return {
    ...identity,
    getDescriptor: () => structuredClone(descriptor),
    async dispose() {
      setStandaloneMainRequestHandler(null);
      unsubscribeToolchains();
      try {
        await reaper.reapAll();
      } finally {
        releaseLock();
      }
    },
  };
}
