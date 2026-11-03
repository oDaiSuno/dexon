import type { HostId, WorkspaceKey } from "../../shared/workspace-ref.ts";

export interface RemoteReaperTicket {
  readonly version: 2;
  readonly platform: "ssh";
  readonly workspace: WorkspaceKey;
  readonly hostId: HostId;
  readonly processId: string;
  readonly runId: string;
  readonly hostInstanceId: string;
  readonly bootId: string;
  readonly pid: number;
  readonly pgid: number;
  readonly startFingerprint: string;
  readonly nonce: string;
  readonly createdAt: number;
}

export type CleanupEvidence =
  | {
      readonly state: "verified-clean";
      readonly workspace: WorkspaceKey;
      readonly runId: string;
      readonly method: "group-empty" | "boot-changed";
    }
  | {
      readonly state: "pending";
      readonly workspace: WorkspaceKey;
      readonly runId: string;
      readonly reason: "transport-dropped" | "stop-timeout";
    }
  | {
      readonly state: "verified-leak";
      readonly workspace: WorkspaceKey;
      readonly runId: string;
      readonly detail: string;
    };
