import { existsSync } from "fs";
import type { SessionManager } from "@earendil-works/pi-coding-agent";
import type { RpcServer } from "../contract/rpc";
import type { SessionEntry, SessionInfo } from "../shared/types";
import { getRpcSession, listRpcSessions, type AgentSessionWrapper } from "./rpc-manager";
import { buildSessionInfoFromManager, listAllSessions, resolveSessionPath } from "./session-reader";
import { buildHistoryRevision, buildUnsavedHistoryRevision } from "./session-history";
import { getSessionContentSnapshot } from "./session-content-cache";
import { getSessionOrigin } from "./session-origin-store";
import { sessionIndex } from "./session-index";

export interface SessionSource {
  filePath: string;
  manager: SessionManager;
  entries: SessionEntry[];
  historyRevision: string;
}

function hasUserMessage(entries: SessionEntry[]): boolean {
  return entries.some(
    (entry) => entry.type === "message" && (entry.message as unknown as { role?: unknown }).role === "user",
  );
}

function readUnsaved(session: AgentSessionWrapper | undefined): SessionSource | null {
  if (!session?.isAlive()) return null;
  if (session.sessionFile && existsSync(session.sessionFile)) return null;
  const manager = session.inner.sessionManager;
  const entries = manager.getEntries() as unknown as SessionEntry[];
  if (!hasUserMessage(entries) && !getSessionOrigin(session.sessionId)) return null;
  return { filePath: "", manager, entries, historyRevision: buildUnsavedHistoryRevision(session.sessionId) };
}

export function findUnsavedSession(sessionId: string): SessionSource | null {
  return readUnsaved(getRpcSession(sessionId));
}

export async function openSessionSource(sessionId: string): Promise<SessionSource | null> {
  const filePath = await resolveSessionPath(sessionId);
  if (!filePath) return findUnsavedSession(sessionId);
  const { manager, entries } = getSessionContentSnapshot(filePath);
  return { filePath, manager, entries, historyRevision: buildHistoryRevision(filePath, sessionId) };
}

export async function describeSessionSource(source: SessionSource): Promise<SessionInfo | null> {
  if (source.filePath) {
    const indexed = await sessionIndex.refreshPath(source.filePath);
    if (indexed) return indexed;
  }
  return buildSessionInfoFromManager(source.filePath, source.manager, source.entries);
}

export async function listHistorySessions(): Promise<SessionInfo[]> {
  const saved = await listAllSessions();
  const savedIds = new Set(saved.map((session) => session.id));
  const unsaved: SessionInfo[] = [];
  for (const session of listRpcSessions()) {
    if (savedIds.has(session.sessionId)) continue;
    const source = readUnsaved(session);
    const info = source ? await describeSessionSource(source) : null;
    if (info && !savedIds.has(info.id)) unsaved.push(info);
  }
  if (unsaved.length === 0) return saved;
  return [...unsaved, ...saved].sort((left, right) => Date.parse(right.modified) - Date.parse(left.modified));
}

export function announceSessionOnFirstMessage(server: RpcServer, session: AgentSessionWrapper): void {
  let announced = false;
  const off = session.onEvent((event) => {
    if (announced) return;
    if (event.type !== "message_end" || (event.message as { role?: unknown } | undefined)?.role !== "user") return;
    announced = true;
    setImmediate(() => {
      off();
      const source = readUnsaved(session);
      if (!source) return;
      void describeSessionSource(source).then((info) => {
        if (info) server.emit("sessions.changed", info.id, { cwd: info.cwd, sessionId: info.id, session: info });
      });
    });
  });
}
