import {
  SESSION_ORCHESTRATION_LIMITS,
  type SessionLiveStatus,
  type SessionModelRef,
  type SessionRelation,
} from "../../shared/session-orchestration";
import type { AgentMessage, SessionInfo } from "../../shared/types";
import { getRpcSession } from "../rpc-manager";
import { buildSessionContext } from "../session-reader";
import { listHistorySessions, openSessionSource } from "../session-source";
import { messageContentText } from "../session-title";
import { sessionModelView } from "./model-view";
import { sameProjectRoot } from "./project-scope";
import { limitReply, writeSessionTranscript, type TranscriptSummary } from "./transcript";

export interface SessionToolView {
  sessionId: string;
  title: string;
  cwd: string;
  status: SessionLiveStatus | "idle";
  relation?: SessionRelation;
  createdBySessionId?: string;
  createdByCaller: boolean;
  model: SessionModelRef | null;
  thinkingLevel: string | null;
  modelAvailable: boolean;
}

export interface SessionReadView {
  sessionId: string;
  title: string;
  status: SessionLiveStatus | "idle";
  lastReply: string;
  lastReplyTruncated: boolean;
  transcript: TranscriptSummary;
  model: SessionModelRef | null;
  thinkingLevel: string | null;
  modelAvailable: boolean;
}

export type UsableModelList = readonly { id: string; provider: string }[] | null;

export function clampNumber(value: number | undefined, fallback: number, minimum: number, maximum: number): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return fallback;
  return Math.min(maximum, Math.max(minimum, Math.trunc(value)));
}

export function liveStatusOf(sessionId: string): SessionLiveStatus | "idle" {
  const session = getRpcSession(sessionId);
  if (!session?.isAlive()) return "idle";
  return session.liveStatus();
}

export function isSessionRunning(sessionId: string): boolean {
  return getRpcSession(sessionId)?.isRunning() === true;
}

export function liveSessionTitle(sessionId: string): string | undefined {
  const name = getRpcSession(sessionId)?.inner.sessionName;
  return typeof name === "string" && name.trim() ? name.trim() : undefined;
}

export function sessionTitleOf(session: SessionInfo): string {
  if (session.name && session.name.trim()) return session.name.trim();
  return session.firstMessage || "(no messages)";
}

export async function sessionCwd(sessionId: string): Promise<string | undefined> {
  const live = getRpcSession(sessionId);
  if (live?.isAlive() && live.cwd) return live.cwd;
  const info = (await listHistorySessions()).find((session) => session.id === sessionId);
  return info?.cwd;
}

export async function sessionMessages(sessionId: string): Promise<AgentMessage[]> {
  const live = getRpcSession(sessionId);
  if (live?.isAlive()) {
    const state = live.inner.agent.state as { messages?: unknown } | undefined;
    if (Array.isArray(state?.messages)) return state.messages as AgentMessage[];
  }
  const source = await openSessionSource(sessionId);
  if (!source) return [];
  return buildSessionContext(source.entries).messages;
}

export async function lastSessionReply(sessionId: string): Promise<string | undefined> {
  const live = getRpcSession(sessionId);
  const liveReply = live?.isAlive() ? live.inner.getLastAssistantText()?.trim() : "";
  if (liveReply) return liveReply;
  const reply = lastAssistantText(await sessionMessages(sessionId));
  return reply || undefined;
}

export async function listSessionViews(options: {
  callerId: string;
  callerProjectRoot?: string;
  limit?: number;
  usable: UsableModelList;
}): Promise<{ sessions: SessionToolView[] }> {
  const limit = clampNumber(
    options.limit,
    SESSION_ORCHESTRATION_LIMITS.listDefault,
    1,
    SESSION_ORCHESTRATION_LIMITS.listMax,
  );
  const sessions: SessionToolView[] = [];
  for (const session of await listHistorySessions()) {
    if (options.callerProjectRoot && !sameProjectRoot(session.projectRoot ?? session.cwd, options.callerProjectRoot)) {
      continue;
    }
    sessions.push({
      sessionId: session.id,
      title: sessionTitleOf(session),
      cwd: session.cwd,
      status: liveStatusOf(session.id),
      ...(session.relation ? { relation: session.relation } : {}),
      ...(session.createdBySessionId ? { createdBySessionId: session.createdBySessionId } : {}),
      createdByCaller: session.createdBySessionId === options.callerId,
      ...(await sessionModelView(session.id, options.usable)),
    });
    if (sessions.length >= limit) break;
  }
  return { sessions };
}

export async function readSessionView(sessionId: string, usable: UsableModelList): Promise<SessionReadView> {
  const source = await openSessionSource(sessionId);
  const messages = source ? buildSessionContext(source.entries).messages : [];
  const info = (await listHistorySessions()).find((session) => session.id === sessionId);
  const title = info ? sessionTitleOf(info) : (liveSessionTitle(sessionId) ?? sessionId);
  const status = liveStatusOf(sessionId);
  return {
    sessionId,
    title,
    status,
    ...limitReply(lastAssistantText(messages)),
    transcript: writeSessionTranscript({
      sessionId,
      title,
      cwd: info?.cwd ?? (getRpcSession(sessionId)?.cwd || process.cwd()),
      status,
      ...(info?.createdBySessionId ? { createdBySessionId: info.createdBySessionId } : {}),
      messages,
    }),
    ...(await sessionModelView(sessionId, usable)),
  };
}

function contentText(message: AgentMessage): string {
  return messageContentText(message.content as unknown).trim();
}

function lastAssistantText(messages: AgentMessage[]): string {
  const lastAssistant = [...messages].reverse().find((message) => message.role === "assistant");
  return lastAssistant ? contentText(lastAssistant) : "";
}
