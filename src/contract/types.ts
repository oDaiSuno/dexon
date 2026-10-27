import type { InteractiveSnapshot } from "../shared/interactive-tools";
import type { SessionLiveStatus, SessionRelation } from "../shared/session-orchestration";
/** Shared domain types used by the IPC contract. */

import type {
  AgentMessage,
  DeferredContentRef,
  ExtensionStatusItem,
  ExtensionWidgetItem,
  ImageContent,
  SessionTreeNode,
  TextContent,
  ThinkingContent,
  ToolCallContent,
} from "../shared/types";

export interface SessionInfo {
  path: string;
  id: string;
  cwd: string;
  name?: string;
  created: string;
  modified: string;
  messageCount: number;
  firstMessage: string;
  parentSessionId?: string;
  relation?: SessionRelation;
  createdBySessionId?: string;
  projectRoot?: string;
  worktreeBranch?: string;
}

export interface ContextUsageBreakdown {
  systemPrompt: number;
  tools: number;
  agentsAndSkills: number;
  conversation: number;
  toolResults: number;
}

export interface ContextUsageInfo {
  percent: number | null;
  contextWindow: number;
  tokens: number | null;
  reserveTokens?: number;
  breakdown?: ContextUsageBreakdown;
}

export interface SessionDetail {
  sessionId: string;
  filePath: string;
  info: SessionInfo | null;
  tree: SessionTreeNode[];
  leafId: string | null;
  context: PagedContextInfo;
  agentState?: {
    running: boolean;
    state?: SessionRuntimeState;
  };
  /**
   * Context-window usage reconstructed from the persisted session file,
   * present only when the session has no live runtime (idle eviction,
   * restart) and includeState was requested. Live agent state, when
   * available, stays authoritative on agentState.state.contextUsage.
   */
  contextUsage?: ContextUsageInfo | null;
  stats: SessionStatsSummary;
}

export interface SessionStatsSummary {
  userMessages: number;
  assistantMessages: number;
  toolCalls: number;
  toolResults: number;
  totalMessages: number;
  tokens: {
    input: number;
    output: number;
    cacheRead: number;
    cacheWrite: number;
    total: number;
  };
  cost: number;
  costs: { input: number; output: number; cacheRead: number; cacheWrite: number };
  lastCompactionAt: string | null;
}

export interface ContextInfo {
  messages: AgentMessage[];
  entryIds: string[];
  thinkingLevel: string;
  model: { provider: string; modelId: string } | null;
}

export interface HistoryWindow {
  maxTurns?: number;
  maxBytes?: number;
}

export interface TurnOutlineItem {
  entryId: string;
  title: string;
}

export interface PagedContextInfo extends ContextInfo {
  totalMessages: number;
  loadedMessages: number;
  truncatedBefore: boolean;
  previousCursor?: string;
  historyRevision: string;
  outline?: TurnOutlineItem[];
}

export interface EntryContentResult {
  content: TextContent | ImageContent | ThinkingContent | ToolCallContent;
  deferredContent: DeferredContentRef;
}

export interface SessionRuntimeState {
  extensionUi?: InteractiveSnapshot;
  contextUsage?: ContextUsageInfo | null;
  systemPrompt?: string;
  thinkingLevel?: string;
  isStreaming?: boolean;
  streamingMessage?: AgentMessage | null;
  isPromptRunning?: boolean;
  isCompacting?: boolean;
  extensionStatuses?: ExtensionStatusItem[];
  extensionWidgets?: ExtensionWidgetItem[];
  queuedMessages?: { steering?: string[]; followUp?: string[] } | null;
  [key: string]: unknown;
}

export interface WorktreeInfo {
  path: string;
  branch?: string | null;
  isMain?: boolean;
}

export interface DirEntry {
  name: string;
  path: string;
  type: "file" | "directory";
  size?: number;
  mtime?: number;
  [key: string]: unknown;
}

export interface FileContent {
  content: string;
  language?: string;
  size?: number;
  truncated?: boolean;
  encoding?: string;
  [key: string]: unknown;
}

export interface FileMeta {
  size: number;
  mtime: number;
  language?: string;
  kind?: string;
  mime?: string;
  [key: string]: unknown;
}

export interface FuzzyMatch {
  path: string;
  score: number;
  [key: string]: unknown;
}

export interface ModelInfo {
  id: string;
  name: string;
  provider: string;
  /** Input modalities the model accepts; absent means unknown (no UI gating). */
  input?: ("text" | "image")[];
}

export interface ModelCatalogWarning {
  provider: string;
  code: "PROVIDER_REFRESH_FAILED" | "PROVIDER_AVAILABILITY_FAILED" | "MODEL_REFRESH_TIMEOUT";
  message: string;
}

export interface ModelCatalogStatus {
  source: "network" | "cache" | "offline";
  refreshed: boolean;
  aborted: boolean;
  warnings: ModelCatalogWarning[];
}

export interface ModelsListResult {
  models: ModelInfo[];
  defaultModel: { provider: string; modelId: string } | null;
  thinkingLevels: Record<string, string[]>;
  thinkingLevelMaps: Record<string, Record<string, string | null>>;
  nameMap: Record<string, string>;
  catalog: ModelCatalogStatus;
}

export interface ModelPreferencesResult {
  models: ModelInfo[];
  /** null means every available model is enabled, including models added later. */
  enabledModels: string[] | null;
}

export type DefaultThinkingLevel = "off" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max";

export interface ModelDefaultsResult {
  model: { provider: string; modelId: string } | null;
  thinkingLevel: DefaultThinkingLevel;
}

export interface ModelsConfig {
  [key: string]: unknown;
}

export interface ModelsConfigSnapshot {
  config: ModelsConfig;
  version: string;
}

export interface TestResult {
  ok: boolean;
  error?: string;
  [key: string]: unknown;
}

export type ProviderChannelTestResult =
  | { ok: true; latencyMs: number; status?: number; testedAt: string }
  | {
      ok: false;
      reason: "timeout" | "error";
      error: string;
      latencyMs?: number;
      status?: number;
      testedAt: string;
    };

export interface ProviderChannelState {
  enabled: boolean;
  lastTest: ProviderChannelTestResult | null;
}

export interface ProviderChannelsResult {
  channels: Record<string, ProviderChannelState>;
}

export interface ProviderStatus {
  id: string;
  name: string;
  authenticated?: boolean;
  [key: string]: unknown;
}

export interface SkillInfo {
  name: string;
  description?: string;
  path?: string;
  [key: string]: unknown;
}

export interface AgentCommand {
  type: string;
  [key: string]: unknown;
}

export interface AgentEvent {
  type: string;
  [key: string]: unknown;
}

export interface RunningStateEvent {
  type: "running";
  sessionIds: string[];
  sessionStatuses?: Record<string, SessionLiveStatus>;
}

export interface CredentialMutationWarning {
  code: "MODEL_SYNC_FAILED";
  message: string;
}

export interface CredentialMutationResult {
  ok: true;
  synchronized: boolean;
  warning?: CredentialMutationWarning;
}

export type LoginProgressEvent =
  | { type: "auth"; url: string; instructions: string | null; token: string }
  | {
      type: "device_code";
      userCode: string;
      verificationUri: string;
      intervalSeconds: number | null;
      expiresInSeconds: number | null;
    }
  | { type: "progress"; message: string; links?: Array<{ label: string; url: string }> }
  | { type: "select_request"; message: string; options: Array<{ id: string; label: string }>; token: string }
  | { type: "prompt_request"; message: string; placeholder: string | null; token: string; secret: boolean }
  | { type: "success"; warning?: CredentialMutationWarning }
  | { type: "error"; message: string }
  | { type: "cancelled" };

export interface RpcErrorShape {
  code: string;
  message: string;
  detail?: unknown;
}

const RPC_ERROR_TAG: unique symbol = Symbol.for("dexon.rpc-error");

export class RpcError extends Error {
  code: string;
  detail?: unknown;
  readonly [RPC_ERROR_TAG] = true;

  constructor(shape: RpcErrorShape) {
    super(shape.message);
    this.name = "RpcError";
    this.code = shape.code;
    this.detail = shape.detail;
  }
}

export function isRpcError(error: unknown): error is RpcError {
  if (error instanceof RpcError) return true;
  return typeof error === "object" && error !== null && (error as Record<symbol, unknown>)[RPC_ERROR_TAG] === true;
}

export interface UnavailableModelRef {
  provider: string;
  modelId: string;
}

export class ModelUnavailableError extends RpcError {
  constructor(ref: UnavailableModelRef) {
    super({
      code: "MODEL_UNAVAILABLE",
      message: `Model ${ref.provider}/${ref.modelId} is unavailable; switch to another model before sending`,
      detail: { provider: ref.provider, modelId: ref.modelId },
    });
    this.name = "ModelUnavailableError";
  }
}
