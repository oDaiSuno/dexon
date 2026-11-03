import type { RemoteWorkspaceStateSnapshot, WorkspaceConnectionStatus, WorkspaceTrustMode } from "@contract/workspace";
import { describeWorkspaceKey } from "@shared/workspace-ref";

export type RemoteWorkspaceStates = Readonly<Record<string, RemoteWorkspaceStateSnapshot>>;

export type WorkspaceFacts =
  | { kind: "local"; key: string }
  | {
      kind: "ssh";
      key: string;
      hostLabel: string;
      authorityLabel: string;
      remotePath: string;
      folderName: string;
      connection: WorkspaceConnectionStatus;
      trust: WorkspaceTrustMode;
      rttMs?: number;
      state: RemoteWorkspaceStateSnapshot | null;
    };

export const REMOTE_CONNECTION_LOOK = {
  connected: { labelKey: "sshSidebarHostConnected", tone: "quiet", pulse: false, dashed: false },
  reconnecting: { labelKey: "sshSidebarHostReconnecting", tone: "warning", pulse: true, dashed: false },
  offline: { labelKey: "sshSidebarHostOffline", tone: "quiet", pulse: false, dashed: true },
} as const satisfies Record<
  WorkspaceConnectionStatus,
  { labelKey: string; tone: string; pulse: boolean; dashed: boolean }
>;

export function workspaceFacts(folder: string, statesByWorkspace: RemoteWorkspaceStates): WorkspaceFacts {
  const description = describeWorkspaceKey(folder);
  const key = description.workspaceKey;
  if (!description.isSsh || !description.hostLabel || !description.authorityLabel) return { kind: "local", key };
  const state = statesByWorkspace[key] ?? null;
  return {
    kind: "ssh",
    key,
    hostLabel: description.hostLabel,
    authorityLabel: description.authorityLabel,
    remotePath: description.displayPath,
    folderName: description.folderName,
    connection: state?.connection ?? "offline",
    trust: state?.workspaceTrust ?? "read-only",
    rttMs: state?.rttMs,
    state,
  };
}
