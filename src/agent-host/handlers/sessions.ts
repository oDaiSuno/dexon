import { readFileSync, realpathSync, statSync, unlinkSync } from "fs";
import path from "path";
import { SessionManager } from "@earendil-works/pi-coding-agent";
import type { RpcServer } from "../../contract/rpc";
import { RpcError, type HistoryWindow, type SessionDetail, type SessionRuntimeState } from "../../contract/types";
import type { SessionTreeNode } from "../../shared/types";
import { callMain } from "../parent-rpc";
import type { ManagedProcessService } from "../managed-process/service";
import { clearSessionEventBinding } from "../session-event-binding";
import { getRpcSession, getRpcSessionStatuses, getRunningRpcSessionIds, disposeAllRpcSessions } from "../rpc-manager";
import { resolveSessionContextWindow } from "../model-runtime";
import {
  buildSessionContext,
  getSessionIndexMetrics,
  invalidateSessionPathCache,
  emitIndexedSessionChange,
  resolveSessionPath,
} from "../session-reader";
import {
  buildSessionHistoryPage,
  decodeHistoryCursor,
  readSessionEntryContent,
  StaleHistoryCursorError,
} from "../session-history";
import { invalidateSessionContent } from "../session-content-cache";
import {
  describeSessionSource,
  findUnsavedSession,
  listHistorySessions,
  openSessionSource,
  type SessionSource,
} from "../session-source";
import { reconstructSessionContextUsage } from "../session-context-usage";
import { computeSessionStats } from "../session-stats";
import { sessionIndex } from "../session-index";
import { deleteSessionLeafChoice } from "../session-leaf-store";
import { deleteSessionOrigin } from "../session-origin-store";
import { resolveSessionLeafId } from "../session-leaf";
import { removeSessionTranscript } from "../session-orchestration/transcript";
import { projectSessionTreeForResponse } from "../project-tree";
import {
  logSessionPerformance,
  resolveSessionTraceId,
  roundSessionMilliseconds,
  sessionPerformanceBytesEnabled,
} from "../session-performance";

function canonicalPathForComparison(candidate: string): string {
  const resolved = path.resolve(candidate);
  let canonical = resolved;
  try {
    const realpath = realpathSync.native ?? realpathSync;
    canonical = realpath(resolved);
  } catch {
    // Historical session cwd values can refer to directories that no longer exist.
  }
  return process.platform === "win32" ? canonical.toLowerCase() : canonical;
}

async function requireSessionSource(id: string): Promise<SessionSource> {
  const source = await openSessionSource(id);
  if (!source) throw new RpcError({ code: "NOT_FOUND", message: "Session not found" });
  return source;
}

function removeSessionFile(filePath: string) {
  try {
    unlinkSync(filePath);
  } catch (e) {
    throw new RpcError({
      code: "INTERNAL",
      message: e instanceof Error ? e.message : String(e),
    });
  }
  invalidateSessionContent(filePath);
  return sessionIndex.removePath(filePath);
}

export interface SessionHandlerDeps {
  managedProcesses: ManagedProcessService;
}

export function registerSessionHandlers(server: RpcServer, deps: SessionHandlerDeps): () => Promise<void> {
  const { managedProcesses } = deps;

  function sessionIsRunning(id: string): boolean {
    const session = getRpcSession(id);
    return Boolean(session?.isAlive() && session.isRunning());
  }

  async function collectDescendantIds(rootId: string): Promise<string[]> {
    const sessions = await listHistorySessions();
    const childrenByParent = new Map<string, string[]>();
    for (const session of sessions) {
      const parentId = session.parentSessionId;
      if (!parentId) continue;
      const siblings = childrenByParent.get(parentId);
      if (siblings) siblings.push(session.id);
      else childrenByParent.set(parentId, [session.id]);
    }
    const visited = new Set<string>([rootId]);
    const collected: string[] = [];
    let frontier = [rootId];
    while (frontier.length > 0) {
      const next: string[] = [];
      for (const parentId of frontier) {
        for (const childId of childrenByParent.get(parentId) ?? []) {
          if (visited.has(childId)) continue;
          visited.add(childId);
          collected.push(childId);
          next.push(childId);
        }
      }
      frontier = next;
    }
    return collected;
  }

  async function deleteOneSession(id: string, force: boolean): Promise<void> {
    const savedPath = await resolveSessionPath(id);
    const unsaved = savedPath ? null : findUnsavedSession(id);
    if (!savedPath && !unsaved) throw new RpcError({ code: "NOT_FOUND", message: "Session not found" });
    const existing = getRpcSession(id);
    const activeProcesses = managedProcesses.activeForSession(id);
    if (activeProcesses.length > 0 && !force) {
      throw new RpcError({
        code: "CONFLICT",
        message: "Session still owns managed processes. Stop them before deleting.",
        detail: { managedProcessCount: activeProcesses.length },
      });
    }
    if (activeProcesses.length > 0) {
      await Promise.all(
        activeProcesses.map((process) => managedProcesses.stop(process.processId, process.runId, "graceful", "user")),
      );
    }
    if (existing?.isAlive()) {
      if (existing.isRunning() && !force) {
        throw new RpcError({
          code: "CONFLICT",
          message: "Session is still running. Stop it before deleting.",
        });
      }
      await existing.abortAndDispose();
      clearSessionEventBinding(existing.sessionId || id);
    }
    const filePath = savedPath ?? (await resolveSessionPath(id));
    const deletedSession = filePath ? removeSessionFile(filePath) : null;
    deleteSessionOrigin(id);
    deleteSessionLeafChoice(id);
    removeSessionTranscript(id);
    invalidateSessionPathCache(id);
    void callMain("browser.sessionEnded", { sessionId: id }).catch(() => undefined);
    server.emit("sessions.changed", id, {
      cwd: deletedSession?.cwd ?? unsaved?.manager.getCwd() ?? null,
      sessionId: id,
      deleted: true,
    });
  }

  server.handle({
    "sessions.list": async (params) => {
      const traceId = resolveSessionTraceId();
      const startedAt = performance.now();
      try {
        const requestedCwd = (params as { cwd?: unknown } | undefined)?.cwd;
        if (requestedCwd !== undefined && (typeof requestedCwd !== "string" || !path.isAbsolute(requestedCwd))) {
          throw new RpcError({ code: "BAD_REQUEST", message: "absolute cwd required" });
        }
        const canonicalCwd = typeof requestedCwd === "string" ? canonicalPathForComparison(requestedCwd) : undefined;
        const allSessions = await listHistorySessions();
        const sessions = canonicalCwd
          ? allSessions.filter((session) => canonicalPathForComparison(session.cwd) === canonicalCwd)
          : allSessions;
        const indexMetrics = getSessionIndexMetrics();
        logSessionPerformance("sessions.list", {
          traceId,
          ok: true,
          totalMs: roundSessionMilliseconds(performance.now() - startedAt),
          sessionsReturned: sessions.length,
          filesDiscovered: indexMetrics.filesDiscovered,
          filesParsed: indexMetrics.filesParsed,
          filesReused: indexMetrics.filesReused,
          invalidFiles: indexMetrics.invalidFiles,
          indexRefreshMs: indexMetrics.totalMs,
        });
        return {
          sessions,
          runningSessionIds: getRunningRpcSessionIds(),
          sessionStatuses: getRpcSessionStatuses(),
        };
      } catch (error) {
        logSessionPerformance("sessions.list", {
          traceId,
          ok: false,
          totalMs: roundSessionMilliseconds(performance.now() - startedAt),
          error: error instanceof Error ? error.name : "UnknownError",
        });
        throw error;
      }
    },

    "sessions.get": async (params) => {
      const {
        id,
        includeState,
        traceId: requestedTraceId,
        historyWindow,
      } = params as {
        id: string;
        includeState?: boolean;
        traceId?: string;
        historyWindow?: HistoryWindow;
      };
      const traceId = resolveSessionTraceId(requestedTraceId);
      const startedAt = performance.now();
      let stateMs = 0;
      try {
        const agentStatePromise: Promise<SessionDetail["agentState"]> = (async () => {
          if (!includeState) return undefined;
          const stateStartedAt = performance.now();
          const existing = getRpcSession(id);
          const result = existing?.isAlive()
            ? { running: true, state: (await existing.send({ type: "get_state" })) as SessionRuntimeState }
            : { running: false };
          stateMs = performance.now() - stateStartedAt;
          return result;
        })();

        const openStartedAt = performance.now();
        const source = await requireSessionSource(id);
        const openMs = performance.now() - openStartedAt;
        const { filePath, manager: sm, entries, historyRevision } = source;

        const contextStartedAt = performance.now();
        const leafId = resolveSessionLeafId(id, entries, sm.getLeafId());
        const tree = projectSessionTreeForResponse(sm.getTree() as never) as SessionTreeNode[];
        const context = buildSessionHistoryPage({ entries, leafId, historyWindow, historyRevision });
        const stats = computeSessionStats(entries);
        const contextMs = performance.now() - contextStartedAt;

        const infoStartedAt = performance.now();
        const contextUsagePromise: Promise<SessionDetail["contextUsage"]> = (async () => {
          if (!includeState) return undefined;
          // Live state is authoritative — including its "unknown after
          // compaction" answer. Reconstruct from the session file only when no
          // live runtime remains (idle eviction, app restart).
          const state = await agentStatePromise;
          if (state?.running) return undefined;
          try {
            return await reconstructSessionContextUsage({
              manager: sm,
              resolveContextWindow: resolveSessionContextWindow,
            });
          } catch (error) {
            console.warn(
              "[agent-host] failed to reconstruct context usage:",
              error instanceof Error ? error.message : error,
            );
            return undefined;
          }
        })();

        const [info, agentState, contextUsage] = await Promise.all([
          describeSessionSource(source),
          agentStatePromise,
          contextUsagePromise,
        ]);
        const infoMs = performance.now() - infoStartedAt;

        const detail: SessionDetail = {
          sessionId: id,
          filePath,
          info,
          leafId,
          tree,
          context,
          stats,
          ...(agentState !== undefined ? { agentState } : {}),
          ...(contextUsage !== undefined ? { contextUsage } : {}),
        };
        const responseBytes = sessionPerformanceBytesEnabled()
          ? Buffer.byteLength(JSON.stringify(detail), "utf8")
          : undefined;
        logSessionPerformance("sessions.get", {
          traceId,
          ok: true,
          totalMs: roundSessionMilliseconds(performance.now() - startedAt),
          openMs: roundSessionMilliseconds(openMs),
          contextMs: roundSessionMilliseconds(contextMs),
          infoMs: roundSessionMilliseconds(infoMs),
          stateMs: roundSessionMilliseconds(stateMs),
          entryCount: entries.length,
          messageCount: context.messages.length,
          fileBytes: filePath ? statSync(filePath).size : 0,
          ...(responseBytes === undefined ? {} : { responseBytes }),
        });
        return detail;
      } catch (error) {
        logSessionPerformance("sessions.get", {
          traceId,
          ok: false,
          totalMs: roundSessionMilliseconds(performance.now() - startedAt),
          error: error instanceof Error ? error.name : "UnknownError",
        });
        throw error;
      }
    },

    "sessions.context": async (params) => {
      const { id, leafId, historyWindow } = params as { id: string; leafId?: string; historyWindow?: HistoryWindow };
      const { entries, historyRevision } = await requireSessionSource(id);
      const resolvedLeafId = leafId ?? resolveSessionLeafId(id, entries, entries.at(-1)?.id ?? null);
      const context = buildSessionHistoryPage({ entries, leafId: resolvedLeafId, historyWindow, historyRevision });
      return { context };
    },

    "sessions.contextPage": async (params) => {
      const { id, cursor, maxTurns, maxBytes } = params as {
        id: string;
        cursor: string;
        maxTurns?: number;
        maxBytes?: number;
      };
      const { entries, historyRevision } = await requireSessionSource(id);
      try {
        const context = buildSessionHistoryPage({
          entries,
          leafId: resolveSessionLeafId(id, entries, entries.at(-1)?.id ?? null),
          historyWindow: { maxTurns, maxBytes },
          historyRevision,
          cursor: decodeHistoryCursor(cursor),
        });
        return { context };
      } catch (error) {
        if (error instanceof StaleHistoryCursorError) {
          throw new RpcError({ code: "STALE_CURSOR", message: error.message });
        }
        if (error instanceof Error && error.message === "Invalid session history cursor") {
          throw new RpcError({ code: "BAD_REQUEST", message: error.message });
        }
        throw error;
      }
    },

    "sessions.entryContent": async (params) => {
      const { id, entryId, blockIndex = 0 } = params as { id: string; entryId: string; blockIndex?: number };
      const { entries } = await requireSessionSource(id);
      const content = readSessionEntryContent(entries, entryId, blockIndex);
      if (content === null) {
        throw new RpcError({ code: "NOT_FOUND", message: "Session entry content not found" });
      }
      return {
        content,
        deferredContent: {
          entryId,
          blockIndex,
          originalBytes: Buffer.byteLength(JSON.stringify(content), "utf8"),
          contentType: content.type,
        },
      };
    },

    "sessions.export": async (params) => {
      const { id, format = "md" } = params as { id: string; format?: "md" | "json" };
      const filePath = await resolveSessionPath(id);
      if (!filePath) throw new RpcError({ code: "NOT_FOUND", message: "Session not found" });
      const raw = readFileSync(filePath, "utf8");
      if (format === "json") {
        return { content: raw, suggestedName: `session-${id}.json` };
      }
      // Simple markdown export of session file content
      const sm = SessionManager.open(filePath);
      const context = buildSessionContext(sm.getEntries() as never);
      const lines: string[] = [`# Session ${id}`, ""];
      for (const msg of context.messages as Array<{ role: string; content: unknown }>) {
        lines.push(`## ${msg.role}`, "");
        if (typeof msg.content === "string") lines.push(msg.content);
        else if (Array.isArray(msg.content)) {
          for (const block of msg.content as Array<{ type?: string; text?: string }>) {
            if (block.type === "text" && block.text) lines.push(block.text);
          }
        }
        lines.push("");
      }
      return { content: lines.join("\n"), suggestedName: `session-${id}.md` };
    },

    "sessions.delete": async (params) => {
      const { id, force } = params as { id: string; force?: boolean };
      const savedPath = await resolveSessionPath(id);
      const unsaved = savedPath ? null : findUnsavedSession(id);
      if (!savedPath && !unsaved) throw new RpcError({ code: "NOT_FOUND", message: "Session not found" });
      const descendants = await collectDescendantIds(id);
      if (!force) {
        const runningDescendants = descendants.filter(sessionIsRunning);
        if (runningDescendants.length > 0) {
          throw new RpcError({
            code: "CONFLICT",
            message: "A sub-session is still running. Stop it before deleting.",
            detail: { sessionIds: runningDescendants },
          });
        }
        const busyDescendants = descendants.filter(
          (descendant) => managedProcesses.activeForSession(descendant).length > 0,
        );
        if (busyDescendants.length > 0) {
          throw new RpcError({
            code: "CONFLICT",
            message: "A sub-session still owns managed processes. Stop them before deleting.",
            detail: { sessionIds: busyDescendants },
          });
        }
      }
      for (const descendant of [...descendants].reverse()) await deleteOneSession(descendant, Boolean(force));
      await deleteOneSession(id, Boolean(force));
      return { ok: true as const };
    },

    "sessions.descendants": async (params) => {
      const { id } = params as { id: string };
      const savedPath = await resolveSessionPath(id);
      const unsaved = savedPath ? null : findUnsavedSession(id);
      if (!savedPath && !unsaved) throw new RpcError({ code: "NOT_FOUND", message: "Session not found" });
      const sessionIds = await collectDescendantIds(id);
      return { sessionIds, runningSessionIds: sessionIds.filter(sessionIsRunning) };
    },

    "sessions.rename": async (params) => {
      const { id, name } = params as { id: string; name: string };
      if (!name?.trim()) {
        throw new RpcError({ code: "BAD_REQUEST", message: "name is required" });
      }
      const existing = getRpcSession(id);
      if (existing?.isAlive()) {
        await existing.send({ type: "set_session_name", name: name.trim() });
      } else {
        const filePath = await resolveSessionPath(id);
        if (!filePath) throw new RpcError({ code: "NOT_FOUND", message: "Session not found" });
        const sm = SessionManager.open(filePath);
        // ISSUE-014: SDK uses appendSessionInfo, not setSessionName
        sm.appendSessionInfo(name.trim());
        invalidateSessionContent(filePath);
      }
      await emitIndexedSessionChange(server, id, null);
      return { ok: true as const };
    },
  });

  return async () => {
    await disposeAllRpcSessions();
  };
}
