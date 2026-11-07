import { DatabaseSync } from "node:sqlite";
import { generateSchema } from "./schema";

export interface Clock {
  now(): number;
}
export const systemClock: Clock = { now: () => Date.now() };
export type StoreChange =
  | { readonly kind: "task_saved" | "task_enabled" | "task_disabled" | "task_deleted"; readonly taskId: string }
  | { readonly kind: "run_created" | "run_ready" | "run_ended" | "run_changed"; readonly runId: string }
  | { readonly kind: "trigger_armed" | "trigger_due"; readonly taskId: string; readonly triggerId: string }
  | { readonly kind: "step_waiting"; readonly runId: string; readonly stepIndex: number }
  | { readonly kind: "signal_emitted"; readonly taskId: string; readonly name: string };
export interface StoreUnavailable {
  readonly unavailable: "locked" | "sqlite_missing" | "migration_failed";
  readonly detail: string;
}
type ChangeListener = (change: StoreChange) => void;
export interface AutomationDatabase {
  readonly db: DatabaseSync;
  readonly clock: Clock;
  close(): void;
  withTx<T>(fn: () => T): T;
  notifyChange(change: StoreChange): void;
  onCommit(listener: ChangeListener): () => void;
}

export function openAutomationDb(dbPath: string, clock: Clock = systemClock): AutomationDatabase | StoreUnavailable {
  let db: DatabaseSync | undefined;
  try {
    if (typeof DatabaseSync === "undefined")
      return { unavailable: "sqlite_missing", detail: "node:sqlite is unavailable" };
    db = new DatabaseSync(dbPath);
    db.exec(
      "PRAGMA busy_timeout = 0; PRAGMA journal_mode = WAL; PRAGMA synchronous = FULL; PRAGMA foreign_keys = ON; PRAGMA locking_mode = EXCLUSIVE;",
    );
    const version = db.prepare("PRAGMA user_version").get() as { user_version: number };
    if (version.user_version > 1) throw new Error("Automation database version is newer than this runtime");
    db.exec("BEGIN IMMEDIATE");
    db.exec(generateSchema());
    db.exec("PRAGMA user_version = 1; COMMIT");
    return createDatabase(db, clock);
  } catch (error) {
    if (db) {
      try {
        db.close();
      } catch {}
    }
    const detail = error instanceof Error ? error.message : String(error);
    return { unavailable: /locked|busy/i.test(detail) ? "locked" : "migration_failed", detail };
  }
}
function createDatabase(db: DatabaseSync, clock: Clock): AutomationDatabase {
  const listeners = new Set<ChangeListener>();
  let pending: StoreChange[] | null = null;
  return {
    db,
    clock,
    close() {
      db.close();
      listeners.clear();
    },
    withTx<T>(fn: () => T): T {
      if (pending !== null) throw new Error("Nested automation transactions are not allowed");
      db.exec("BEGIN IMMEDIATE");
      pending = [];
      let result: T;
      let committed: StoreChange[];
      try {
        result = fn();
        if (result instanceof Promise) throw new Error("Automation transactions must be synchronous");
        db.exec("COMMIT");
        committed = pending;
      } catch (error) {
        db.exec("ROLLBACK");
        throw error;
      } finally {
        pending = null;
      }
      for (const change of committed)
        for (const listener of [...listeners]) {
          try {
            listener(change);
          } catch {}
        }
      return result;
    },
    notifyChange(change) {
      if (pending === null) throw new Error("Automation changes must be recorded in a transaction");
      pending.push(change);
    },
    onCommit(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}
