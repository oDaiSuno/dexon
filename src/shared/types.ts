import type { AutomationPromptBadge } from "./automation/prompt-context";
import type { QuestionDraft, QuestionnaireRequest } from "./interactive-tools";
import type { SessionRelation, SessionSourceRef } from "./session-orchestration";

export interface SessionHeader {
  type: "session";
  version?: number;
  id: string;
  timestamp: string;
  cwd: string;
  parentSession?: string;
}

export interface SessionEntryBase {
  type: string;
  id: string;
  parentId: string | null;
  timestamp: string;
}

export interface TextContent {
  type: "text";
  text: string;
  deferredContent?: DeferredContentRef;
}

export interface DeferredContentRef {
  entryId: string;
  blockIndex?: number;
  originalBytes: number;
  contentType?: "text" | "image" | "thinking" | "toolCall";
}

export interface ImageContent {
  type: "image";
  source: {
    type: "base64" | "url";
    media_type?: string;
    data?: string;
    url?: string;
  };
  deferredContent?: DeferredContentRef;
}

export interface ThinkingContent {
  type: "thinking";
  thinking: string;
  deferredContent?: DeferredContentRef;
}

export interface ToolCallContent {
  type: "toolCall";
  toolCallId: string;
  toolName: string;
  input: Record<string, unknown>;
  deferredContent?: DeferredContentRef;
}

export type AssistantContentBlock = TextContent | ImageContent | ThinkingContent | ToolCallContent;

export interface UserMessage {
  role: "user";
  content: string | (TextContent | ImageContent)[];
  channelSource?: "weixin" | "telegram" | "feishu";
  channelAttachments?: ChannelMessageAttachment[];
  sessionSource?: SessionSourceRef;
  automationPrompt?: AutomationPromptBadge;
  syntheticSource?: "branch_summary";
  versions?: { entryIds: string[]; index: number };
  timestamp?: number;
}

export interface ChannelMessageAttachment {
  kind: "image" | "voice" | "file" | "video";
  name?: string;
  mime?: string;
}

export interface BlockTiming {
  startedAt: number;
  endedAt?: number;
}

export interface DexonTiming {
  blocks: BlockTiming[];
}

export interface AssistantMessage {
  role: "assistant";
  content: AssistantContentBlock[];
  model: string;
  provider: string;
  stopReason?: string;
  errorMessage?: string;
  retry?: { attempt: number; maxAttempts: number };
  dexonTiming?: DexonTiming;
  timestamp?: number;
  usage?: {
    input: number;
    output: number;
    cacheRead: number;
    cacheWrite: number;
    cost: {
      input: number;
      output: number;
      cacheRead: number;
      cacheWrite: number;
      total: number;
    };
  };
}

export interface ToolResultMessage {
  role: "toolResult";
  toolCallId: string;
  toolName?: string;
  content: (TextContent | ImageContent)[];
  isError?: boolean;
  details?: unknown;
  timestamp?: number;
}

export interface CustomMessage {
  role: "custom";
  customType: string;
  content: string | (TextContent | ImageContent)[];
  display: boolean;
  details?: unknown;
  timestamp?: number;
}

export type AgentMessage = UserMessage | AssistantMessage | ToolResultMessage | CustomMessage;

export interface SystemRecord {
  readonly role: "system";
  readonly content: string | TextContent[];
  readonly sections?: Readonly<Record<string, string | null>>;
  readonly toolsAdded?: ReadonlyArray<{
    readonly name: string;
    readonly description?: string;
    readonly parameters?: unknown;
  }>;
  readonly toolsRemoved?: ReadonlyArray<{ readonly name: string }>;
  readonly timestamp: number;
}

export type PersistedMessage = AgentMessage | SystemRecord;

export interface Usage {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
  cacheWrite1h?: number;
  reasoning?: number;
  totalTokens: number;
  cost: {
    input: number;
    output: number;
    cacheRead: number;
    cacheWrite: number;
    total: number;
  };
}

export type ExtensionUiRequest =
  | QuestionnaireRequest
  | {
      type: "extension_ui_request";
      id: string;
      method: "select";
      title: string;
      options: string[];
      timeout?: number;
      expiresAt?: number;
    }
  | {
      type: "extension_ui_request";
      id: string;
      method: "confirm";
      title: string;
      message: string;
      timeout?: number;
      expiresAt?: number;
    }
  | {
      type: "extension_ui_request";
      id: string;
      method: "input";
      title: string;
      placeholder?: string;
      timeout?: number;
      expiresAt?: number;
    }
  | {
      type: "extension_ui_request";
      id: string;
      method: "editor";
      title: string;
      prefill?: string;
      timeout?: number;
      expiresAt?: number;
    }
  | {
      type: "extension_ui_request";
      id: string;
      method: "notify";
      message: string;
      notifyType?: "info" | "warning" | "error";
    }
  | {
      type: "extension_ui_request";
      id: string;
      method: "setStatus";
      statusKey: string;
      statusText?: string;
    }
  | {
      type: "extension_ui_request";
      id: string;
      method: "setWidget";
      widgetKey: string;
      widgetLines?: string[];
      widgetPlacement?: "aboveEditor" | "belowEditor";
    }
  | {
      type: "extension_ui_request";
      id: string;
      method: "setTitle";
      title: string;
    }
  | {
      type: "extension_ui_request";
      id: string;
      method: "set_editor_text";
      text: string;
    }
  | {
      type: "extension_ui_request";
      id: string;
      method: "custom";
      lines: string[];
      closed?: boolean;
    };

export type ExtensionUiResponse =
  | { type: "extension_ui_response"; id: string; answers: QuestionDraft[] }
  | { type: "extension_ui_response"; id: string; value: string }
  | { type: "extension_ui_response"; id: string; confirmed: boolean }
  | { type: "extension_ui_response"; id: string; cancelled: true };

export interface ExtensionStatusItem {
  key: string;
  text: string;
}

export interface ExtensionWidgetItem {
  key: string;
  lines: string[];
  placement: "aboveEditor" | "belowEditor";
}

export interface SessionMessageEntry extends SessionEntryBase {
  type: "message";
  message: PersistedMessage;
}

export interface ThinkingLevelChangeEntry extends SessionEntryBase {
  type: "thinking_level_change";
  thinkingLevel: string;
}

export interface ModelChangeEntry extends SessionEntryBase {
  type: "model_change";
  provider: string;
  modelId: string;
}

export interface CompactionEntry extends SessionEntryBase {
  type: "compaction";
  summary: string;
  firstKeptEntryId: string;
  tokensBefore: number;
  details?: unknown;
  usage?: Usage;
  fromHook?: boolean;
  systemMessage?: SystemRecord;
}

export interface UsageEntry extends SessionEntryBase {
  type: "usage";
  kind: string;
  provider: string;
  model: string;
  usage: Usage;
  note?: string;
}

export interface ContextEditEntry extends SessionEntryBase {
  type: "context_edit";
  targetId: string;
  replacement: { content: string | AssistantContentBlock[] } | null;
}

export interface BranchSummaryEntry extends SessionEntryBase {
  type: "branch_summary";
  fromId: string;
  summary: string;
  details?: unknown;
  fromHook?: boolean;
}

export interface CustomEntry extends SessionEntryBase {
  type: "custom";
  customType: string;
  data?: unknown;
}

export interface CustomMessageEntry extends SessionEntryBase {
  type: "custom_message";
  customType: string;
  content: string | (TextContent | ImageContent)[];
  details?: unknown;
  display: boolean;
}

export interface LabelEntry extends SessionEntryBase {
  type: "label";
  targetId: string;
  label: string | undefined;
}

export interface SessionInfoEntry extends SessionEntryBase {
  type: "session_info";
  name?: string;
}

export type SessionEntry =
  | SessionMessageEntry
  | ThinkingLevelChangeEntry
  | ModelChangeEntry
  | CompactionEntry
  | BranchSummaryEntry
  | CustomEntry
  | CustomMessageEntry
  | LabelEntry
  | SessionInfoEntry
  | UsageEntry
  | ContextEditEntry;

export type FileEntry = SessionHeader | SessionEntry;

export interface SessionTreeEntry {
  id: string;
  type: string;
  role?: AgentMessage["role"];
  preview?: string;
}

export interface SessionTreeNode {
  entry: SessionTreeEntry;
  children: SessionTreeNode[];
  label?: string;
  compressedEntryIds?: string[];
}

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

export interface SessionContext {
  messages: AgentMessage[];
  entryIds: string[];
  thinkingLevel: string;
  model: { provider: string; modelId: string } | null;
}
