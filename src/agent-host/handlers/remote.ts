import { mkdirSync, readFileSync } from "node:fs";
import { spawn } from "node:child_process";
import path from "node:path";
import { randomUUID } from "node:crypto";
import type { RpcServer } from "../../contract/rpc";
import { RpcError } from "../../contract/types";
import type {
  RemoteBrowseResult,
  RemoteTrustPromptEvent,
  RemoteWorkspaceStateSnapshot,
  WorkspaceConnectionStatus,
  WorkspaceTrustMode,
  WorkspaceContainmentState,
} from "../../contract/workspace";
import {
  formatSshAuthority,
  formatSshHostLabel,
  hostIdOf,
  keyOf,
  normalizePosixPath,
  parseSshConnectInput,
  parseWorkspaceInput,
  type PosixAbsPath,
  type WorkspaceKey,
  type WorkspaceRef,
} from "../../shared/workspace-ref";
import { desktopUserDataPath } from "../desktop-state-file";
import { getOrCreateHost, getHost } from "../workspace/registry";
import { RemoteConnectError } from "../workspace/host/errors";
import { buildSshArgv } from "../workspace/host/ssh/argv";
import { acceptHostKey, KnownHostsError } from "../workspace/host/ssh/known-hosts";
import type { ExecutionHost } from "../workspace/host/execution-host";
import { containmentLedger } from "../managed-process/containment-ledger";

type RemoteWorkspaceRef = Extract<WorkspaceRef, { kind: "ssh" }>;

export type TrustPromptRequest = Omit<RemoteTrustPromptEvent, "promptId" | "status">;

export interface RemoteTrustGate {
  openTrustPrompt(request: TrustPromptRequest): Promise<WorkspaceTrustMode>;
}

interface PendingTrustPrompt {
  event: RemoteTrustPromptEvent;
  settle: (trust: WorkspaceTrustMode) => void;
}

const TRUST_MODES: readonly WorkspaceTrustMode[] = ["read-only", "trusted"];
const globalTrustStore = new Map<WorkspaceKey, WorkspaceTrustMode>();

export function isRemoteWorkspaceTrusted(workspace: WorkspaceKey): boolean {
  return globalTrustStore.get(workspace) === "trusted";
}

function badRequest(message: string): RpcError {
  return new RpcError({ code: "BAD_REQUEST", message });
}

function notFound(message: string): RpcError {
  return new RpcError({ code: "NOT_FOUND", message });
}

function parseWorkspace(input: unknown): WorkspaceRef {
  if (typeof input !== "string") throw badRequest("A workspace address is required");
  const parsed = parseWorkspaceInput(input);
  if (!parsed.ok) throw badRequest(parsed.error);
  return parsed.value;
}

function parseRemoteWorkspace(input: unknown): RemoteWorkspaceRef {
  const ref = parseWorkspace(input);
  if (ref.kind !== "ssh") throw badRequest("A remote server workspace is required");
  return ref;
}

function isTrustMode(value: unknown): value is WorkspaceTrustMode {
  return TRUST_MODES.includes(value as WorkspaceTrustMode);
}

function dexonKnownHostsPath(): string {
  const dir = path.join(desktopUserDataPath(), "ssh");
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  return path.join(dir, "known_hosts");
}

function parseSshTarget(target: unknown): RemoteWorkspaceRef["target"] {
  if (!target || typeof target !== "object") throw badRequest("A target is required");
  const { host, user, port } = target as { host?: unknown; user?: unknown; port?: unknown };
  if (typeof host !== "string") throw badRequest("target.host is required");
  const parsed = parseWorkspaceInput(
    `ssh://${typeof user === "string" ? `${user}@` : ""}${host.includes(":") ? `[${host}]` : host}${typeof port === "number" ? `:${port}` : ""}/`,
  );
  if (!parsed.ok || parsed.value.kind !== "ssh") throw badRequest("Invalid server target");
  return parsed.value.target;
}

function connectionStatus(host: ExecutionHost | null): WorkspaceConnectionStatus {
  if (!host) return "offline";
  const event = host.connectionState();
  if (event.state === "connected") return "connected";
  if (event.state === "reconnecting" || event.state === "connecting") return "reconnecting";
  return "offline";
}

function initialState(ref: RemoteWorkspaceRef): RemoteWorkspaceStateSnapshot {
  const containmentEntry = containmentLedger.get(keyOf(ref));
  return {
    workspace: keyOf(ref),
    hostLabel: formatSshHostLabel(ref.target),
    authorityLabel: formatSshAuthority(ref.target),
    remotePath: ref.root,
    connection: "offline",
    workspaceTrust: "read-only",
    trustRevision: 0,
    remoteSkillCount: 0,
    localSkillCount: 0,
    ruleLens: {
      localAgentsMd: false,
      localSkillCount: 0,
      credentialsBlocked: true,
      remoteAgentsMdPaths: [],
      remoteSkillCount: 0,
      ancestorBoundary: "remote-home",
      boundaryPath: "~",
      syncedAt: null,
    },
    containment: {
      state: (containmentEntry.state === "clear"
        ? "verified-clean"
        : containmentEntry.state) as WorkspaceContainmentState,
      activeRemoteProcessCount: 0,
      ...(containmentEntry.state === "verified-leak" && "leakedPgid" in containmentEntry
        ? { leakedPgid: containmentEntry.leakedPgid }
        : {}),
    },
  };
}

function remoteConnectFailureToResult(error: unknown, target: RemoteWorkspaceRef["target"]): RemoteBrowseResult {
  if (error instanceof RemoteConnectError) {
    const failure = error.failure;
    if (failure.code === "host-key-unverified") {
      return {
        status: "host-key-unverified",
        target,
        host: failure.host,
        keyType: failure.keyType,
        fingerprint: failure.fingerprint,
        ...(failure.remoteIp ? { remoteIp: failure.remoteIp } : {}),
        ...(failure.rawHostKeyLine ? { rawHostKeyLine: failure.rawHostKeyLine } : {}),
      };
    }
    if (failure.code === "auth-required") {
      return { status: "auth-required", target, copyIdCommand: failure.copyIdCommand };
    }
    if (failure.code === "python-missing" || failure.code === "python-too-old") {
      const installCommand = failure.code === "python-missing" ? failure.installCommand : "python3 --version";
      return {
        status: "python-missing",
        target,
        installCommand,
        canAutoInstall: failure.code === "python-missing" && failure.canAutoInstall,
      };
    }
  }
  return { status: "error", target, message: error instanceof Error ? error.message : String(error) };
}

export function registerRemoteHandlers(server: RpcServer): RemoteTrustGate {
  const states = new Map<WorkspaceKey, RemoteWorkspaceStateSnapshot>();
  const pendingPrompts = new Map<string, PendingTrustPrompt>();

  const getOrInitState = (ref: RemoteWorkspaceRef): RemoteWorkspaceStateSnapshot => {
    const key = keyOf(ref);
    const existing = states.get(key);
    if (existing) return existing;
    const initial = initialState(ref);
    states.set(key, initial);
    return initial;
  };

  const syncState = (ref: RemoteWorkspaceRef): void => {
    const key = keyOf(ref);
    const current = states.get(key);
    if (!current) return;
    const host = getHost(key);
    const connectionEvent = host?.connectionState();
    const connection = connectionStatus(host);
    const facts = host?.facts();
    const containmentEntry = containmentLedger.get(key);
    const containmentState: WorkspaceContainmentState =
      containmentEntry.state === "clear" ? "verified-clean" : containmentEntry.state;
    const leakedPgid =
      containmentEntry.state === "verified-leak" && "leakedPgid" in containmentEntry
        ? containmentEntry.leakedPgid
        : undefined;
    const updated: RemoteWorkspaceStateSnapshot = {
      ...current,
      connection,
      ...(connectionEvent?.rttMs !== undefined ? { rttMs: connectionEvent.rttMs } : {}),
      ...(connectionEvent?.attempt !== undefined ? { reconnectAttempt: connectionEvent.attempt } : {}),
      ...(connectionEvent?.maxAttempts !== undefined ? { maxReconnectAttempts: connectionEvent.maxAttempts } : {}),
      ...(connectionEvent?.error !== undefined ? { lastError: connectionEvent.error } : {}),
      ...(facts ? { cachedBranch: current.cachedBranch } : {}),
      containment: {
        state: containmentState,
        activeRemoteProcessCount: 0,
        ...(leakedPgid !== undefined ? { leakedPgid } : {}),
      },
    };
    states.set(key, updated);
  };

  const setTrust = (ref: RemoteWorkspaceRef, trust: WorkspaceTrustMode): RemoteWorkspaceStateSnapshot => {
    const key = keyOf(ref);
    let current = states.get(key);
    if (!current) {
      current = initialState(ref);
      states.set(key, current);
    }
    if (current.workspaceTrust === trust) {
      return current;
    }
    const next: RemoteWorkspaceStateSnapshot = {
      ...current,
      workspaceTrust: trust,
      trustRevision: current.trustRevision + 1,
    };
    globalTrustStore.set(key, trust);
    states.set(key, next);
    server.emit("workspace.state", key, {
      workspace: key,
      state: next,
      transition: trust === "trusted" ? "trusted" : "read-only",
    });
    return next;
  };

  const attachConnectionListener = (ref: RemoteWorkspaceRef, host: ExecutionHost): (() => void) => {
    return host.onConnection((event) => {
      syncState(ref);
      const key = keyOf(ref);
      const state = states.get(key)!;
      const transition =
        event.state === "connected"
          ? ("connected" as const)
          : event.state === "offline"
            ? ("disconnected" as const)
            : undefined;
      server.emit("workspace.state", key, {
        workspace: key,
        state,
        ...(transition ? { transition } : {}),
      });
    });
  };

  server.handle({
    "remote.hosts": () => {
      const sshConfigPath = path.join(process.env.HOME ?? "~", ".ssh", "config");
      const candidates: Array<{
        alias: string;
        host: string;
        user?: string;
        port?: number;
        identityReady: boolean;
        source: "ssh-config";
      }> = [];
      try {
        const config = readFileSync(sshConfigPath, "utf8");
        let alias = "";
        let hostname = "";
        let user: string | undefined;
        let port: number | undefined;
        for (const line of config.split("\n")) {
          const trimmed = line.trim();
          const lower = trimmed.toLowerCase();
          if (lower.startsWith("host ") && !lower.startsWith("hostname")) {
            if (alias && hostname && !alias.includes("*")) {
              candidates.push({
                alias,
                host: hostname,
                ...(user ? { user } : {}),
                ...(port ? { port } : {}),
                identityReady: true,
                source: "ssh-config",
              });
            }
            alias = trimmed.slice(5).trim();
            hostname = "";
            user = undefined;
            port = undefined;
          } else if (lower.startsWith("hostname ")) {
            hostname = trimmed.slice(9).trim();
          } else if (lower.startsWith("user ")) {
            user = trimmed.slice(5).trim();
          } else if (lower.startsWith("port ")) {
            port = Number(trimmed.slice(5).trim());
          }
        }
        if (alias && hostname && !alias.includes("*")) {
          candidates.push({
            alias,
            host: hostname,
            ...(user ? { user } : {}),
            ...(port ? { port } : {}),
            identityReady: true,
            source: "ssh-config",
          });
        }
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      }
      return { hosts: candidates };
    },

    "remote.parse": (params) => {
      const { input } = (params ?? {}) as { input?: unknown };
      if (typeof input !== "string") throw badRequest("A server address is required");
      return parseSshConnectInput(input);
    },

    "remote.browse": async (params) => {
      const { target, path: browsePath } = (params ?? {}) as { target?: unknown; path?: unknown };
      const sshTarget = parseSshTarget(target);
      const dummyRef: RemoteWorkspaceRef = {
        kind: "ssh",
        target: sshTarget,
        root: normalizePosixPath(typeof browsePath === "string" && browsePath.startsWith("/") ? browsePath : "/"),
      };
      const workspaceKey = keyOf(dummyRef);
      const host = getOrCreateHost(workspaceKey);
      if (!host) {
        return remoteConnectFailureToResult(new Error("Cannot create connection"), sshTarget);
      }
      try {
        await host.connect();
        const result = await host.request("browseDir", {
          path:
            typeof browsePath === "string" && browsePath.startsWith("/")
              ? normalizePosixPath(browsePath as PosixAbsPath)
              : null,
        });
        return {
          status: "ready",
          target: sshTarget,
          currentPath: result.currentPath,
          remoteHome: result.remoteHome,
          rttMs: host.connectionState().rttMs ?? 0,
          entries: [...result.entries],
        } satisfies RemoteBrowseResult;
      } catch (error) {
        return remoteConnectFailureToResult(error, sshTarget);
      }
    },

    "remote.acceptHostKey": async (params) => {
      const { target, fingerprint } = (params ?? {}) as { target?: unknown; fingerprint?: unknown };
      if (typeof fingerprint !== "string") throw badRequest("fingerprint is required");
      const sshTarget = parseSshTarget(target);
      try {
        await acceptHostKey(sshTarget, fingerprint, { knownHostsPath: dexonKnownHostsPath() });
      } catch (error) {
        if (error instanceof KnownHostsError) throw new RpcError({ code: error.code, message: error.message });
        throw error;
      }
      return { ok: true as const };
    },

    "remote.installPython": async (params) => {
      const { target } = (params ?? {}) as { target?: unknown };
      const sshTarget = parseSshTarget(target);
      const sshBinary = process.env.DEXON_SSH_BINARY ?? "ssh";
      const argv = buildSshArgv(
        {
          target: sshTarget,
          controlPath: null,
          dexonKnownHostsPath: dexonKnownHostsPath(),
          userKnownHostsPath: path.join(process.env.HOME ?? "~", ".ssh", "known_hosts"),
          connectTimeoutSeconds: 20,
        },
        {
          kind: "exec",
          remoteCommand:
            "sudo -n apt-get update && sudo -n apt-get install -y python3 || sudo -n dnf install -y python3 || sudo -n yum install -y python3 || sudo -n apk add --no-cache python3 || brew install python3",
        },
      );
      await new Promise<void>((resolve, reject) => {
        const child = spawn(sshBinary, argv, { stdio: ["ignore", "ignore", "pipe"] });
        let stderr = "";
        child.stderr?.on("data", (chunk: Buffer) => {
          stderr = (stderr + chunk.toString("utf8")).slice(-2048);
        });
        child.on("error", reject);
        child.on("close", (code) => {
          if (code === 0) resolve();
          else reject(new RpcError({ code: "UNAVAILABLE", message: stderr.trim() || "Failed to install python3" }));
        });
      });
      return { ok: true as const };
    },

    "remote.workspaceState": (params) => {
      const ref = parseWorkspace((params as { workspace?: unknown } | undefined)?.workspace);
      if (ref.kind !== "ssh") return { state: null };
      const key = keyOf(ref);
      const existing = states.get(key);
      if (existing) syncState(ref);
      return { state: states.get(key) ?? null };
    },

    "remote.workspacesSnapshot": () => {
      for (const key of states.keys()) {
        const parsed = parseWorkspaceInput(key);
        if (parsed.ok && parsed.value.kind === "ssh") syncState(parsed.value);
      }
      return { states: Object.fromEntries(states) };
    },

    "remote.trustSet": (params) => {
      const { workspace, trust } = (params ?? {}) as { workspace?: unknown; trust?: unknown };
      const ref = parseRemoteWorkspace(workspace);
      if (!isTrustMode(trust)) throw badRequest("Trust must be read-only or trusted");
      return { state: setTrust(ref, trust) };
    },

    "remote.syncRules": async (params) => {
      const ref = parseRemoteWorkspace((params as { workspace?: unknown } | undefined)?.workspace);
      const key = keyOf(ref);
      const host = getOrCreateHost(key);
      if (!host) throw new RpcError({ code: "UNAVAILABLE", message: "No connection for this workspace" });
      try {
        await host.connect();
        await host.request("probeAndMirror", { root: ref.root, createIfMissing: false });
        let current = states.get(key);
        if (!current) {
          current = initialState(ref);
          states.set(key, current);
        }
        syncState(ref);
        return { state: states.get(key)! };
      } catch (error) {
        throw new RpcError({ code: "UNAVAILABLE", message: error instanceof Error ? error.message : "Sync failed" });
      }
    },

    "remote.reconnect": async (params) => {
      const ref = parseRemoteWorkspace((params as { workspace?: unknown } | undefined)?.workspace);
      const key = keyOf(ref);
      const host = getOrCreateHost(key);
      if (!host) throw new RpcError({ code: "UNAVAILABLE", message: "No connection for this workspace" });
      let current = states.get(key);
      if (!current) {
        current = initialState(ref);
        states.set(key, current);
      }
      const detach = attachConnectionListener(ref, host);
      try {
        const priorContainment = containmentLedger.get(key);
        await host.reconnect();
        if (priorContainment.state !== "clear") {
          containmentLedger.setClean(key);
        }
        syncState(ref);
        const state = states.get(key)!;
        if (priorContainment.state !== "clear") {
          const cleanPgid = "leakedPgid" in priorContainment ? priorContainment.leakedPgid : undefined;
          server.emit("workspace.state", key, {
            workspace: key,
            state,
            transition: "reconnected-clean",
            ...(cleanPgid !== undefined ? { reconciledCleanPgid: cleanPgid } : {}),
          });
        }
        return { state };
      } catch (error) {
        throw new RpcError({
          code: "UNAVAILABLE",
          message: error instanceof Error ? error.message : "Reconnect failed",
        });
      } finally {
        detach();
      }
    },

    "remote.disconnect": async (params) => {
      const ref = parseRemoteWorkspace((params as { workspace?: unknown } | undefined)?.workspace);
      const key = keyOf(ref);
      const host = getHost(key);
      if (host) {
        await host.dispose().catch(() => undefined);
      }
      let current = states.get(key);
      if (!current) {
        current = initialState(ref);
        states.set(key, current);
      }
      const updated = { ...current, connection: "offline" as const };
      states.set(key, updated);
      server.emit("workspace.state", key, { workspace: key, state: updated, transition: "disconnected" });
      return { state: updated };
    },

    "remote.cleanupRetry": async (params) => {
      const ref = parseRemoteWorkspace((params as { workspace?: unknown } | undefined)?.workspace);
      const key = keyOf(ref);
      const host = getOrCreateHost(key);
      if (host && host.connectionState().state === "connected") {
        const ledgerEntries = containmentLedger.all().filter((entry) => entry.workspace === key);
        if (ledgerEntries.length > 0) {
          const tickets = ledgerEntries
            .filter((entry) => entry.entry.state === "pending" || entry.entry.state === "verified-leak")
            .map((entry) => ({
              version: 2 as const,
              platform: "ssh" as const,
              workspace: entry.workspace,
              hostId: hostIdOf(ref),
              processId: "runId" in entry.entry ? String(entry.entry.runId) : "",
              runId: "runId" in entry.entry ? entry.entry.runId : "",
              hostInstanceId: "",
              bootId: "",
              pid: 0,
              pgid: "leakedPgid" in entry.entry ? (entry.entry.leakedPgid ?? 0) : 0,
              startFingerprint: "",
              nonce: randomUUID(),
              createdAt: Date.now(),
            }));
          const result = await host.request("reconcileRuns", { tickets }).catch(() => null);
          if (result) containmentLedger.applyEvidence(result.evidence);
        }
      }
      syncState(ref);
      return { state: getOrInitState(ref) };
    },

    "remote.trustPromptResolve": (params) => {
      const { promptId, decision } = (params ?? {}) as { promptId?: unknown; decision?: unknown };
      if (typeof promptId !== "string" || (decision !== "trust" && decision !== "keep-read-only")) {
        throw badRequest("A prompt id and a decision are required");
      }
      const prompt = pendingPrompts.get(promptId);
      if (!prompt) throw notFound("Trust prompt not found");
      pendingPrompts.delete(promptId);
      const trust: WorkspaceTrustMode = decision === "trust" ? "trusted" : "read-only";
      const state = setTrust(parseRemoteWorkspace(prompt.event.workspace), trust);
      prompt.settle(trust);
      server.emit("workspace.trustPrompt", prompt.event.workspace, { ...prompt.event, status: "resolved" });
      return { state };
    },
  });

  return {
    async openTrustPrompt(request) {
      const workspace = keyOf(parseRemoteWorkspace(request.workspace));
      const event: RemoteTrustPromptEvent = { ...request, workspace, promptId: randomUUID(), status: "pending" };
      return new Promise<WorkspaceTrustMode>((settle) => {
        pendingPrompts.set(event.promptId, { event, settle });
        server.emit("workspace.trustPrompt", workspace, event);
      });
    },
  };
}
