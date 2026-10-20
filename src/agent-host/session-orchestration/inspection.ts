import {
  SESSION_ORCHESTRATION_LIMITS,
  type SessionLiveStatus,
  type SessionRelation,
} from "../../shared/session-orchestration";
import type { AgentMessage, SessionInfo } from "../../shared/types";
import { worktreePathsEqual } from "../../shared/worktree-path";
import { getRpcSession } from "../rpc-manager";
import { buildSessionContext } from "../session-reader";
import { listHistorySessions, openSessionSource } from "../session-source";
import { messageContentText } from "../session-title";

export interface SessionToolView {
  sessionId: string;
  title: string;
  cwd: string;
  status: SessionLiveStatus | "idle";
  relation?: SessionRelation;
  createdBySessionId?: string;
  createdByCaller: boolean;
}

export interface SessionToolCallSummary {
  toolName: string;
  input?: string;
  result?: string;
}

export interface SessionReadView {
  sessionId: string;
  title: string;
  status: SessionLiveStatus | "idle";
  lastReply: string;
  truncated: boolean;
  toolCalls: SessionToolCallSummary[];
}

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
  scope?: "project" | "all";
  limit?: number;
}): Promise<{ sessions: SessionToolView[] }> {
  const limit = clampNumber(
    options.limit,
    SESSION_ORCHESTRATION_LIMITS.listDefault,
    1,
    SESSION_ORCHESTRATION_LIMITS.listMax,
  );
  const sessions: SessionToolView[] = [];
  for (const session of await listHistorySessions()) {
    if (
      options.scope !== "all" &&
      options.callerProjectRoot &&
      !worktreePathsEqual(session.projectRoot ?? session.cwd, options.callerProjectRoot)
    ) {
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
    });
    if (sessions.length >= limit) break;
  }
  return { sessions };
}

export async function readSessionView(options: {
  sessionId: string;
  maxChars?: number;
  toolCalls?: number;
}): Promise<SessionReadView> {
  const maxChars = clampNumber(
    options.maxChars,
    SESSION_ORCHESTRATION_LIMITS.readDefaultChars,
    1,
    SESSION_ORCHESTRATION_LIMITS.readMaxChars,
  );
  const maxToolCalls = clampNumber(
    options.toolCalls,
    SESSION_ORCHESTRATION_LIMITS.readToolCallsDefault,
    0,
    SESSION_ORCHESTRATION_LIMITS.readToolCallsMax,
  );
  const info = (await listHistorySessions()).find((session) => session.id === options.sessionId);
  const messages = await sessionMessages(options.sessionId);
  const reply = lastAssistantText(messages);
  const truncated = truncate(reply, maxChars);
  return {
    sessionId: options.sessionId,
    title: info ? sessionTitleOf(info) : (liveSessionTitle(options.sessionId) ?? options.sessionId),
    status: liveStatusOf(options.sessionId),
    lastReply: truncated.text,
    truncated: truncated.truncated,
    toolCalls: recentToolCalls(messages, maxToolCalls),
  };
}

function contentText(message: AgentMessage): string {
  return messageContentText(message.content as unknown).trim();
}

function lastAssistantText(messages: AgentMessage[]): string {
  const lastAssistant = [...messages].reverse().find((message) => message.role === "assistant");
  return lastAssistant ? contentText(lastAssistant) : "";
}

function truncate(text: string, maxChars: number): { text: string; truncated: boolean } {
  if (text.length <= maxChars) return { text, truncated: false };
  return { text: text.slice(0, maxChars), truncated: true };
}

function recentToolCalls(messages: AgentMessage[], limit: number): SessionToolCallSummary[] {
  if (limit <= 0) return [];
  const names = new Map<string, string>();
  const summaries: SessionToolCallSummary[] = [];
  for (const message of messages) {
    if (message.role === "assistant") {
      for (const block of message.content) {
        if (block.type !== "toolCall") continue;
        names.set(block.toolCallId, block.toolName);
        summaries.push({ toolName: block.toolName, input: compactJson(block.input) });
      }
      continue;
    }
    if (message.role !== "toolResult") continue;
    const toolName = message.toolName ?? names.get(message.toolCallId) ?? "tool";
    const result = message.content
      .filter((block) => block.type === "text")
      .map((block) => block.text)
      .join(" ");
    const pending = [...summaries].reverse().find((summary) => summary.toolName === toolName && !summary.result);
    if (pending) pending.result = result.slice(0, 400);
    else summaries.push({ toolName, result: result.slice(0, 400) });
  }
  return summaries.slice(-limit);
}

function compactJson(value: unknown): string {
  try {
    const serialized = JSON.stringify(value);
    return serialized.length > 400 ? `${serialized.slice(0, 400)}…` : serialized;
  } catch {
    return "";
  }
}
