import type { Api, Model } from "@earendil-works/pi-ai";
import type {
  AgentSessionEvent,
  SessionEntry as PiSessionEntry,
  SessionManager,
  SettingsManager,
  SlashCommandInfo,
  ToolExposure as PiToolExposure,
  ToolInfo as PiToolInfo,
} from "@earendil-works/pi-coding-agent";
import type { PersistedMessage, SessionEntry } from "./types";

export interface ContextUsage {
  percent: number | null;
  contextWindow: number;
  tokens: number | null;
}

export interface ModelLike {
  id: string;
  provider: string;
}

export type ToolExposure = PiToolExposure;

export type DexonToolOwner = "coding" | "browser" | "orchestration";

export interface ToolDefinitionMetadata {
  readonly defaultActive?: boolean;
  readonly promptSnippet?: string;
  readonly dexonOwner?: DexonToolOwner;
}

export interface ToolLoadoutReader {
  getAllTools(): PiToolInfo[];
  getActiveToolNames(): string[];
  getToolDefinition(name: string): ToolDefinitionMetadata | undefined;
  setActiveToolsByName(names: string[]): void;
}

type AssertNever<T extends never> = T;

export type PiEntryTypesCovered = AssertNever<Exclude<PiSessionEntry["type"], SessionEntry["type"]>>;

export interface NavigateTreeResult {
  editorText?: string;
  cancelled: boolean;
  aborted?: boolean;
}

export interface SessionStatsInfo {
  sessionFile?: string;
  sessionId: string;
  sessionName?: string;
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
  costs?: { input: number; output: number; cacheRead: number; cacheWrite: number };
  lastCompactionAt?: string | null;
  contextUsage?: ContextUsage;
}

interface PromptTemplateLike {
  name: string;
  description?: string;
  argumentHint?: string;
  sourceInfo: SlashCommandInfo["sourceInfo"];
}

interface SkillLike {
  name: string;
  description?: string;
  sourceInfo: SlashCommandInfo["sourceInfo"];
}

interface ResourceLoaderLike {
  getSkills(): { skills: SkillLike[] };
  getAgentsFiles(): { agentsFiles: Array<{ path: string; content: string }> };
}

interface ExtensionRunnerLike {
  getRegisteredCommands(): Array<{
    invocationName: string;
    description?: string;
    sourceInfo: SlashCommandInfo["sourceInfo"];
  }>;
  setUIContext?(uiContext?: unknown, mode?: "tui" | "rpc" | "json" | "print"): void;
}

type DialogOptionsLike = {
  signal?: AbortSignal;
  timeout?: number;
};

type WidgetOptionsLike = {
  placement?: "aboveEditor" | "belowEditor";
};

export interface ExtensionUiContextLike {
  select(title: string, options: string[], opts?: DialogOptionsLike): Promise<string | undefined>;
  confirm(title: string, message: string, opts?: DialogOptionsLike): Promise<boolean>;
  input(title: string, placeholder?: string, opts?: DialogOptionsLike): Promise<string | undefined>;
  editor(title: string, prefill?: string, opts?: DialogOptionsLike): Promise<string | undefined>;
  notify(message: string, type?: "info" | "warning" | "error"): void;
  onTerminalInput(): () => void;
  setStatus(key: string, text: string | undefined): void;
  setWorkingMessage(message?: string): void;
  setWorkingVisible(visible: boolean): void;
  setWorkingIndicator(options?: { frames?: string[]; intervalMs?: number }): void;
  setHiddenThinkingLabel(label?: string): void;
  setWidget(
    key: string,
    content: string[] | ((...args: never[]) => unknown) | undefined,
    options?: WidgetOptionsLike,
  ): void;
  setFooter(factory: unknown): void;
  setHeader(factory: unknown): void;
  setTitle(title: string): void;
  custom<T = unknown>(...args: unknown[]): Promise<T>;
  pasteToEditor(text: string): void;
  setEditorText(text: string): void;
  getEditorText(): string;
  addAutocompleteProvider(): void;
  setEditorComponent(): void;
  getEditorComponent(): undefined;
  readonly theme: unknown;
  getAllThemes(): unknown[];
  getTheme(name: string): undefined;
  setTheme(theme: unknown): { success: boolean; error?: string };
  getToolsExpanded(): boolean;
  setToolsExpanded(expanded: boolean): void;
}

export interface AgentSessionLike {
  readonly sessionId: string;
  readonly sessionFile: string | undefined;
  readonly isStreaming: boolean;
  readonly isCompacting: boolean;
  readonly autoCompactionEnabled: boolean;
  readonly autoRetryEnabled: boolean;
  readonly model: ModelLike | undefined;
  readonly sessionName: string | undefined;
  readonly modelRuntime: {
    getModel: (provider: string, modelId: string) => Model<Api> | undefined;
    getAvailableSnapshot: () => readonly Model<Api>[];
    refresh: (options?: { allowNetwork?: boolean }) => Promise<unknown>;
  };
  readonly sessionManager: SessionManager;
  readonly settingsManager: SettingsManager;
  readonly agent: {
    readonly state?: {
      readonly systemPrompt: string;
      thinkingLevel?: string;
      readonly messages: readonly PersistedMessage[];
      readonly streamingMessage?: unknown;
    };
  };
  readonly extensionRunner: ExtensionRunnerLike;
  readonly promptTemplates: readonly PromptTemplateLike[];
  readonly resourceLoader: ResourceLoaderLike;

  readonly bindExtensions?: unknown;
  refreshContext(): void;
  reload(options?: { beforeSessionStart?: () => void | Promise<void> }): Promise<void>;
  subscribe(listener: (event: AgentSessionEvent) => void): () => void;
  prompt(
    text: string,
    options?: {
      images?: Array<{ type: "image"; data: string; mimeType: string }>;
      expandPromptTemplates?: boolean;
      streamingBehavior?: "steer" | "followUp";
      source?: "interactive" | "rpc";
    },
  ): Promise<void>;
  sendCustomMessage(
    message: {
      customType: string;
      content: string | Array<{ type: "text"; text: string }>;
      display: boolean;
      details?: unknown;
    },
    options?: { triggerTurn?: boolean; deliverAs?: "steer" | "followUp" | "nextTurn" },
  ): Promise<void>;
  abort(): Promise<void>;
  setModel(model: ModelLike): Promise<void>;
  navigateTree(targetId: string, options?: { summarize?: boolean }): Promise<NavigateTreeResult>;
  setThinkingLevel(level: string): void;
  compact(customInstructions?: string): Promise<unknown>;
  setSessionName(name: string): void;
  getSessionStats(): Omit<SessionStatsInfo, "sessionName">;
  getLastAssistantText(): string | undefined;
  setAutoCompactionEnabled(enabled: boolean): void;
  setAutoRetryEnabled(enabled: boolean): void;
  steer(
    text: string,
    images?: Array<{ type: "image"; data: string; mimeType: string }>,
    options?: { source?: "interactive" | "rpc" | "extension" },
  ): Promise<"handled" | "queued">;
  followUp(
    text: string,
    images?: Array<{ type: "image"; data: string; mimeType: string }>,
    options?: { source?: "interactive" | "rpc" | "extension" },
  ): Promise<"handled" | "queued">;
  readonly pendingMessageCount: number;
  getSteeringMessages(): readonly string[];
  getFollowUpMessages(): readonly string[];
  clearQueue(): { steering: string[]; followUp: string[] };
  abortCompaction(): void;
  getContextUsage(): ContextUsage | undefined;
}
