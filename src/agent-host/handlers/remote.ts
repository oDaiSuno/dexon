import { randomUUID } from "node:crypto";
import type { RpcServer } from "../../contract/rpc";
import { RpcError } from "../../contract/types";
import type {
  RemoteTrustPromptEvent,
  RemoteWorkspaceStateSnapshot,
  WorkspaceTrustMode,
} from "../../contract/workspace";
import {
  formatSshAuthority,
  formatSshHostLabel,
  keyOf,
  parseSshConnectInput,
  parseWorkspaceInput,
  type WorkspaceKey,
  type WorkspaceRef,
} from "../../shared/workspace-ref";

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

function badRequest(message: string): RpcError {
  return new RpcError({ code: "BAD_REQUEST", message });
}

function unavailable(): never {
  throw new RpcError({ code: "UNAVAILABLE", message: "Remote servers cannot be connected yet" });
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

function initialState(ref: RemoteWorkspaceRef): RemoteWorkspaceStateSnapshot {
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
    containment: { state: "verified-clean", activeRemoteProcessCount: 0 },
  };
}

export function registerRemoteHandlers(server: RpcServer): RemoteTrustGate {
  const states = new Map<WorkspaceKey, RemoteWorkspaceStateSnapshot>();
  const pendingPrompts = new Map<string, PendingTrustPrompt>();

  const setTrust = (ref: RemoteWorkspaceRef, trust: WorkspaceTrustMode): RemoteWorkspaceStateSnapshot => {
    const key = keyOf(ref);
    const current = states.get(key) ?? initialState(ref);
    if (current.workspaceTrust === trust) {
      states.set(key, current);
      return current;
    }
    const next = { ...current, workspaceTrust: trust, trustRevision: current.trustRevision + 1 };
    states.set(key, next);
    server.emit("workspace.state", key, {
      workspace: key,
      state: next,
      transition: trust === "trusted" ? "trusted" : "read-only",
    });
    return next;
  };

  server.handle({
    "remote.hosts": () => ({ hosts: [] }),

    "remote.parse": (params) => {
      const { input } = (params ?? {}) as { input?: unknown };
      if (typeof input !== "string") throw badRequest("A server address is required");
      return parseSshConnectInput(input);
    },

    "remote.browse": unavailable,
    "remote.acceptHostKey": unavailable,
    "remote.installPython": unavailable,

    "remote.workspaceState": (params) => {
      const ref = parseWorkspace((params as { workspace?: unknown } | undefined)?.workspace);
      return { state: ref.kind === "ssh" ? (states.get(keyOf(ref)) ?? null) : null };
    },

    "remote.workspacesSnapshot": () => ({ states: Object.fromEntries(states) }),

    "remote.trustSet": (params) => {
      const { workspace, trust } = (params ?? {}) as { workspace?: unknown; trust?: unknown };
      const ref = parseRemoteWorkspace(workspace);
      if (!isTrustMode(trust)) throw badRequest("Trust must be read-only or trusted");
      return { state: setTrust(ref, trust) };
    },

    "remote.syncRules": unavailable,
    "remote.reconnect": unavailable,
    "remote.disconnect": unavailable,
    "remote.cleanupRetry": unavailable,

    "remote.trustPromptResolve": (params) => {
      const { promptId, decision } = (params ?? {}) as { promptId?: unknown; decision?: unknown };
      if (typeof promptId !== "string" || (decision !== "trust" && decision !== "keep-read-only"))
        throw badRequest("A prompt id and a decision are required");
      const prompt = pendingPrompts.get(promptId);
      if (!prompt) throw new RpcError({ code: "NOT_FOUND", message: "Trust prompt not found" });
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
