import { type EventStreamConnectionStatus } from "@/lib/event-stream-connection";
import type { AgentMessage, SessionInfo, SessionTreeNode } from "@/lib/types";
import type { ModelInfo, SessionDetail, SessionRuntimeState } from "@contract/types";
import { isNearChatBottom } from "../chat-scroll-policy";
export let scrollMagnetEngaged = false;
export function getScrollMagnetEngaged(): boolean {
  return scrollMagnetEngaged;
}
export function setScrollMagnetEngaged(value: boolean): void {
  scrollMagnetEngaged = value;
}
export type SessionData = SessionDetail;
export type AgentStateResponse = SessionRuntimeState;
export interface StreamingState {
  isStreaming: boolean;
  streamingMessage: Partial<AgentMessage> | null;
}
export type StreamAction =
  { type: "start" } | { type: "update"; message: Partial<AgentMessage> } | { type: "end" } | { type: "reset" };
export function streamReducer(state: StreamingState, action: StreamAction): StreamingState {
  switch (action.type) {
    case "start":
      return { isStreaming: true, streamingMessage: null };
    case "update":
      return { isStreaming: true, streamingMessage: action.message };
    case "end":
    case "reset":
      return { isStreaming: false, streamingMessage: null };
    default:
      return state;
  }
}
export interface AgentEvent {
  type: string;
  [key: string]: unknown;
}
export interface CompactCommandResult {
  tokensBefore?: number;
  estimatedTokensAfter?: number;
}
export interface LastAssistantTextResponse {
  text?: string;
}
export interface QueuedMessages {
  steering: string[];
  followUp: string[];
}
export function normalizeQueuedMessages(q?: { steering?: string[]; followUp?: string[] } | null): QueuedMessages {
  return { steering: q?.steering ?? [], followUp: q?.followUp ?? [] };
}
export type { NoticeItem } from "@/lib/notice-queue";
export type AgentPhase =
  | { kind: "waiting_model" }
  | { kind: "running_command" }
  | { kind: "running_tools"; tools: { id: string; name: string }[] }
  | null;
export interface RetryInfo {
  attempt: number;
  maxAttempts: number;
  errorMessage?: string;
  retryAt: number;
  waiting: boolean;
}
export interface CompactResultInfo {
  reason: "manual" | "threshold" | "overflow" | "auto" | string;
  tokensBefore: number;
  estimatedTokensAfter: number;
}
export interface SlashCommandInfo {
  name: string;
  description?: string;
  source: "extension" | "prompt" | "skill";
  sourceInfo?: {
    path: string;
    source: string;
    scope: "user" | "project" | "temporary";
    origin: "package" | "top-level";
    baseDir?: string;
  };
}
export type BuiltinSlashCommandResult =
  { handled: false } | { handled: true; message?: string; error?: string; action?: "openSessionStats" };
export interface UseAgentSessionOptions {
  session: SessionInfo | null;
  newSessionCwd: string | null;
  onAgentEnd?: () => void;
  onSessionCreated?: (session: SessionInfo) => void;
  onSessionForked?: (newSessionId: string) => void;
  modelsRefreshKey?: number;
  chatInputRef?: React.RefObject<ChatInputHandle | null>;
  onBranchDataChange?: (
    tree: SessionTreeNode[],
    activeLeafId: string | null,
    onLeafChange: (leafId: string | null) => void,
  ) => void;
  onSystemPromptChange?: (prompt: string | null) => void;
  onSessionStatsPanelOpen?: () => void;
  /**
   * Stable message elements used to preserve a reading anchor across hidden
   * history pagination. The chat window owns the array; the runtime only
   * reads it while the page is visible.
   */
  messageRefs?: { current: (HTMLDivElement | null)[] };
  /**
   * Whether the chat page is actually visible to the user. Reading-side
   * wiring (input listeners, geometry observation, scroll pacing) pauses
   * while false; the runtime keeps streaming. Defaults to true.
   */
  readingVisible?: boolean;
}
export type ThinkingLevelOption = "auto" | "off" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max";
export const PROGRAMMATIC_SCROLL_IGNORE_MS = 700;
export const USER_SCROLL_INTENT_MS = 1200;
export function isNearBottomExcludingSpacer(container: HTMLElement): boolean {
  const spacer = container.querySelector<HTMLElement>("[data-run-spacer]");
  return isNearChatBottom({
    scrollTop: container.scrollTop,
    scrollHeight: container.scrollHeight,
    clientHeight: container.clientHeight,
    spacerHeight: spacer ? spacer.offsetHeight : 0,
  });
}
export const PROMPT_SETTLE_INITIAL_DELAY_MS = 800;
export const PROMPT_SETTLE_POLL_MS = 600;
export const PROMPT_SETTLE_MAX_MS = 20_000;
export const AGENT_STATE_RECONCILE_MS = 15_000;
export const EVENT_STREAM_CONNECT_TIMEOUT_MS = 5_000;
export const INITIAL_HISTORY_TURNS = 20;
export const HISTORY_PAGE_MAX_BYTES = 1024 * 1024;
export const DEFERRED_CONTENT_CACHE_SIZE = 12;
export const NOTICE_EXIT_ANIMATION_MS = 180;
export const SCROLL_KEYS = new Set([
  "ArrowUp",
  "ArrowDown",
  "PageUp",
  "PageDown",
  "Home",
  "End",
  " ",
  "Space",
  "Spacebar",
]);
export class EventStreamConnectionError extends Error {
  constructor(public readonly status: Exclude<EventStreamConnectionStatus, "connected">) {
    super(`EVENT_STREAM_${status.toUpperCase()}`);
    this.name = "EventStreamConnectionError";
  }
}
export function createNoticeId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}
export function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
export function extractMessageText(message: Partial<AgentMessage>): string {
  const content = (message as { content?: unknown }).content;
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .map((block) =>
      block &&
      typeof block === "object" &&
      (block as { type?: string }).type === "text" &&
      typeof (block as { text?: unknown }).text === "string"
        ? (block as { text: string }).text
        : "",
    )
    .filter(Boolean)
    .join("\n");
}
export function imageSignature(block: unknown): string {
  if (!block || typeof block !== "object" || (block as { type?: unknown }).type !== "image") return "";
  const source = (block as { source?: unknown }).source;
  if (source && typeof source === "object") {
    const src = source as { type?: unknown; media_type?: unknown; data?: unknown; url?: unknown };
    return [
      src.type === "url" ? "url" : "base64",
      typeof src.media_type === "string" ? src.media_type : "",
      typeof src.data === "string" ? src.data : "",
      typeof src.url === "string" ? src.url : "",
    ].join(":");
  }
  const flat = block as { data?: unknown; mimeType?: unknown };
  return [
    "base64",
    typeof flat.mimeType === "string" ? flat.mimeType : "",
    typeof flat.data === "string" ? flat.data : "",
    "",
  ].join(":");
}
export function userMessageKey(message: Partial<AgentMessage>): string {
  const content = (message as { content?: unknown }).content;
  if (typeof content === "string") return JSON.stringify({ text: content, images: [] });
  if (!Array.isArray(content)) return JSON.stringify({ text: "", images: [] });
  return JSON.stringify({
    text: extractMessageText(message),
    images: content.map(imageSignature).filter(Boolean),
  });
}
export function readCompactResult(result: unknown, reason: string): CompactResultInfo | null {
  if (!result || typeof result !== "object") return null;
  const r = result as CompactCommandResult;
  if (typeof r.tokensBefore !== "number" || typeof r.estimatedTokensAfter !== "number") return null;
  return { reason, tokensBefore: r.tokensBefore, estimatedTokensAfter: r.estimatedTokensAfter };
}
export interface ChatInputHandle {
  insertText: (text: string) => void;
  insertIfEmpty: (content: string) => void;
  prependText: (text: string) => void;
  addFiles: (files: File[]) => void;
}
export type SelectedModel = { provider: string; modelId: string };
export type ModelEntry = ModelInfo;
export type SlashCommandsResponse = {
  commands?: SlashCommandInfo[];
};
