import type { WorkspaceKey } from "../../shared/workspace-ref.ts";
import type { CleanupEvidence } from "./containment-types.ts";

export type ContainmentBucketState =
  | { readonly state: "clear" }
  | { readonly state: "pending"; readonly reason: "transport-dropped" | "stop-timeout" }
  | {
      readonly state: "verified-leak";
      readonly detail: string;
      readonly leakedPgid?: number;
    };

export type ContainmentEntry =
  | { readonly state: "clear" }
  | { readonly state: "pending"; readonly runId: string; readonly reason: "transport-dropped" | "stop-timeout" }
  | { readonly state: "verified-leak"; readonly runId: string; readonly detail: string; readonly leakedPgid?: number };

export class ContainmentLedger {
  private readonly buckets = new Map<WorkspaceKey, ContainmentEntry>();

  isBlocked(workspace: WorkspaceKey): boolean {
    const entry = this.buckets.get(workspace);
    if (!entry || entry.state === "clear") return false;
    return true;
  }

  setPending(workspace: WorkspaceKey, runId: string, reason: "transport-dropped" | "stop-timeout"): void {
    this.buckets.set(workspace, { state: "pending", runId, reason });
  }

  setLeaked(workspace: WorkspaceKey, runId: string, detail: string, leakedPgid?: number): void {
    this.buckets.set(workspace, {
      state: "verified-leak",
      runId,
      detail,
      ...(leakedPgid !== undefined ? { leakedPgid } : {}),
    });
  }

  setClean(workspace: WorkspaceKey): void {
    this.buckets.set(workspace, { state: "clear" });
  }

  get(workspace: WorkspaceKey): ContainmentEntry {
    return this.buckets.get(workspace) ?? { state: "clear" };
  }

  applyEvidence(evidence: readonly CleanupEvidence[]): void {
    for (const item of evidence) {
      if (item.state === "verified-clean") {
        this.setClean(item.workspace);
      } else if (item.state === "pending") {
        this.setPending(item.workspace, item.runId, item.reason);
      } else {
        this.setLeaked(item.workspace, item.runId, item.detail);
      }
    }
  }

  all(): Array<{ workspace: WorkspaceKey; entry: ContainmentEntry }> {
    return [...this.buckets.entries()].map(([workspace, entry]) => ({ workspace, entry }));
  }
}

export const containmentLedger = new ContainmentLedger();
