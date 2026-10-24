import type {
  BuiltinSlashCommandResult,
  CompactResultInfo,
  QueuedMessages,
  SlashCommandInfo,
} from "@/hooks/useAgentSession";
import type { RefObject } from "react";
import type { ModelCatalogStatus } from "@contract/types";
import type { ChannelsSnapshot } from "@shared/channel-types";
import type { AtQueryMatch } from "@/lib/file-fuzzy";

export interface ChatInputProps {
  onSend: (message: string) => void | Promise<unknown> | { ok?: boolean };
  onAbort: () => void;
  onSteer?: (message: string) => Promise<void> | void;
  onFollowUp?: (message: string) => Promise<void> | void;
  onPromptWithStreamingBehavior?: (message: string, behavior: "steer" | "followUp") => Promise<void> | void;
  isStreaming: boolean;
  model?: { provider: string; modelId: string } | null;
  isAutoModelSelection?: boolean;
  modelNames?: Record<string, string>;
  modelList?: { id: string; name: string; provider: string; input?: ("text" | "image")[] }[];
  modelCatalog?: ModelCatalogStatus;
  modelRefreshing?: boolean;
  onModelChange?: (provider: string, modelId: string) => void;
  onModelsRefresh?: () => Promise<void> | void;
  onModelsRefreshCancel?: () => void;
  onCompact?: () => void;
  onAbortCompaction?: () => void;
  isCompacting?: boolean;
  compactError?: string | null;
  compactResult?: CompactResultInfo | null;
  onDismissCompactResult?: () => void;
  contextUsage?: { percent: number | null; contextWindow: number; tokens: number | null } | null;
  thinkingLevel?: "auto" | "off" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max";
  onThinkingLevelChange?: (level: "auto" | "off" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max") => void;
  availableThinkingLevels?: string[] | null;
  thinkingLevelMap?: Record<string, string | null> | null;
  queuedMessages?: QueuedMessages | null;
  onRecallQueue?: () => void;
  slashCommands?: SlashCommandInfo[];
  slashCommandsLoading?: boolean;
  onLoadSlashCommands?: () => Promise<SlashCommandInfo[]> | SlashCommandInfo[];
  onBuiltinCommand?: (message: string) => Promise<BuiltinSlashCommandResult>;
  soundEnabled?: boolean;
  onSoundToggle?: () => void;
  onAudioUnlock?: () => void;
  draftKey?: string;
  /** Session working directory — enables the @ file autocomplete menu. */
  cwd?: string | null;
  /** Whether this input is currently user-visible and interactive. */
  visible?: boolean;
  remote?: ComposerRemote | null;
  navigation?: ComposerNavigation;
}

export interface ComposerRemote {
  sessionId: string;
  snapshot: ChannelsSnapshot;
  onSnapshotChange: (snapshot: ChannelsSnapshot) => void;
}

export interface ComposerNavigation {
  openResources: () => void;
  openRemote: () => void;
  openModelSettings: () => void;
}

export interface ComposerEditableHandle {
  getValue(): string;
  replaceAll(text: string): void;
  insertTextAtCaret(text: string): void;
  pasteTextAtCaret(text: string): void;
  insertTokenAtCaret(path: string): void;
  insertSkillAtStart(name: string): void;
  completeAtQuery(atQuery: AtQueryMatch, entryPath: string, isDir: boolean): void;
  focus(): void;
}

export interface ChatInputHandle {
  insertText: (text: string) => void;
  prependText: (text: string) => void;
  addFiles: (files: File[]) => void;
}

export type ChatInputPropsWithVisible = ChatInputProps & { visible: boolean };
export type ChatInputModel = NonNullable<ChatInputProps["model"]>;
export type ChatInputModelList = NonNullable<ChatInputProps["modelList"]>;
export type ChatInputRef<T> = RefObject<T | null>;
