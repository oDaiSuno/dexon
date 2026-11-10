import type { Streams } from "../contract/api";
import type { RpcServer } from "../contract/rpc";
import type { SessionInfo } from "../shared/types";
import { didSessionRootsChange } from "./session-watch-policy";

export type SessionChangeCause = NonNullable<Streams["sessions.changed"]["cause"]>;

export type IndexChange = { kind: "file"; path: string } | { kind: "subtree"; dir: string } | { kind: "unknown" };

export interface EntryChange {
  filePath: string;
  before: SessionInfo | null;
  after: SessionInfo | null;
  cause: SessionChangeCause;
}

export interface IndexDelta {
  changes: EntryChange[];
  fullRefresh: boolean;
}

export function rootsChanged(changes: readonly EntryChange[]): boolean {
  return changes.some((change) => didSessionRootsChange(change.before, change.after));
}

export function emitIndexDelta(server: RpcServer, delta: IndexDelta): void {
  const cause =
    delta.changes.length > 0 && delta.changes.every((change) => change.cause === "live-append")
      ? "live-append"
      : "external";
  if (delta.fullRefresh || delta.changes.length > 32) {
    server.emit("sessions.changed", "*", { cwd: null, fullRefresh: true, cause });
    return;
  }
  for (const { before, after, cause } of delta.changes) {
    if (after) {
      server.emit("sessions.changed", after.id, { cwd: after.cwd, sessionId: after.id, session: after, cause });
    } else if (before) {
      server.emit("sessions.changed", before.id, { cwd: before.cwd, sessionId: before.id, deleted: true, cause });
    }
  }
}
