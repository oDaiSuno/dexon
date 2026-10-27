export interface AgentEvent {
  type: string;
  [key: string]: unknown;
}

export type EventListener = (event: AgentEvent) => void;

export type CustomUiComponent = {
  render: (width: number) => string[];
  handleInput?: (data: string) => void;
  dispose?: () => void;
  invalidate?: () => void;
};

export type ExtensionCommandContextActionsLike = {
  waitForIdle: () => Promise<void>;
  newSession: () => Promise<{ cancelled: boolean }>;
  fork: () => Promise<{ cancelled: boolean }>;
  navigateTree: (targetId: string, options?: { summarize?: boolean }) => Promise<{ cancelled: boolean }>;
  switchSession: () => Promise<{ cancelled: boolean }>;
  reload: () => Promise<void>;
};

export type ExtensionBindingOptions = {
  forceEmptySystemPrompt?: boolean;
};

export type ExternalSessionCommand = "compact" | "reload";

export interface OrchestratedTurnOutcome {
  reply?: string;
  error?: string;
  stopped?: boolean;
  unavailableModel?: { provider: string; modelId: string };
}
