import type { SshTarget } from "../shared/workspace-ref";

export interface RemoteHostCandidate {
  alias: string;
  host: string;
  user?: string;
  port?: number;
  proxyJump?: string;
  identityReady: boolean;
  source: "ssh-config" | "recent";
  lastOpenedPath?: string;
}

export interface RemoteDirEntry {
  name: string;
  path: string;
  isGitRepo: boolean;
  gitBranch?: string;
  mtimeMs?: number;
}

export type RemoteBrowseResult =
  | {
      status: "ready";
      target: SshTarget;
      currentPath: string;
      remoteHome: string;
      rttMs: number;
      entries: RemoteDirEntry[];
    }
  | {
      status: "host-key-unverified";
      target: SshTarget;
      host: string;
      remoteIp?: string;
      keyType: string;
      fingerprint: string;
      rawHostKeyLine?: string;
    }
  | { status: "auth-required"; target: SshTarget; copyIdCommand: string; detail?: string }
  | { status: "python-missing"; target: SshTarget; installCommand: string; canAutoInstall: boolean; detail?: string }
  | { status: "error"; target: SshTarget; message: string };

export type WorkspaceConnectionStatus = "connected" | "reconnecting" | "offline";
export type WorkspaceTrustMode = "read-only" | "trusted";
export type WorkspaceContainmentState = "verified-clean" | "pending" | "verified-leak";

export interface WorkspaceRuleLens {
  localAgentsMd: boolean;
  localSkillCount: number;
  credentialsBlocked: true;
  remoteAgentsMdPaths: string[];
  remoteSkillCount: number;
  ancestorBoundary: "git-root" | "remote-home";
  boundaryPath: string;
  syncedAt: number | null;
}

export interface RemoteWorkspaceStateSnapshot {
  workspace: string;
  hostLabel: string;
  authorityLabel: string;
  remotePath: string;
  connection: WorkspaceConnectionStatus;
  rttMs?: number;
  reconnectAttempt?: number;
  maxReconnectAttempts?: number;
  lastError?: string;
  workspaceTrust: WorkspaceTrustMode;
  trustRevision: number;
  remoteSkillCount: number;
  localSkillCount: number;
  ruleLens: WorkspaceRuleLens;
  containment: {
    state: WorkspaceContainmentState;
    activeRemoteProcessCount: number;
    leakedPgid?: number;
    detail?: string;
  };
  cachedBranch?: string;
}

export interface RemoteWorkspaceStateEvent {
  workspace: string;
  state: RemoteWorkspaceStateSnapshot;
  transition?: "connected" | "disconnected" | "reconnected-clean" | "trusted" | "read-only";
  reconciledCleanPgid?: number;
}

export interface RemoteTrustPromptEvent {
  promptId: string;
  workspace: string;
  sessionId?: string;
  status: "pending" | "resolved";
  kind: "process_start" | "remote_skill";
  command?: string;
  skillName?: string;
  cwd: string;
  remoteHostLabel: string;
  remoteSkillCount: number;
}
