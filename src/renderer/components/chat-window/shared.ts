import { type AgentPhase } from "@/hooks/useAgentSession";
import { isAssistantFailure } from "@/lib/message-display";
import type { SessionStatsInfo } from "@/lib/pi-types";
import type { ThinkingExpansionStore } from "@/lib/thinking-expansion-store";
import type { AgentMessage, AssistantMessage, SessionInfo, SessionTreeNode } from "@/lib/types";
import { type ChatInputHandle } from "../ChatInput";
import { type ChatMinimapMessage } from "../ChatMinimap";
export interface Props {
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
  onSessionStatsChange?: (stats: SessionStatsInfo | null) => void;
  onSessionStatsPanelOpen?: () => void;
  onContextUsageChange?: (
    usage: { percent: number | null; contextWindow: number; tokens: number | null } | null,
  ) => void;
  onOpenFile?: (filePath: string) => void;
  /** True while this chat surface is the page currently shown to the user. */
  visible?: boolean;
  thinkingExpansionStore: ThinkingExpansionStore;
  processDetailsExpansionStore: ThinkingExpansionStore;
}
export function phaseLabel(phase: AgentPhase, t: (key: string, fallback: string) => string): string {
  if (phase?.kind === "running_tools") {
    const names = phase.tools.map((t) => t.name);
    const running = t("runningTools", "Running");
    if (names.length === 0) return t("runningTool", "Running tool…");
    if (names.length === 1) return `${running} ${names[0]}…`;
    if (names.length <= 3) return `${running} ${names.join(", ")}…`;
    return `${running} ${names.slice(0, 2).join(", ")} (+${names.length - 2})…`;
  }
  if (phase?.kind === "waiting_model") return t("waitingForModel", "Waiting for model…");
  if (phase?.kind === "running_command") return t("runningCommand", "Running command…");
  return t("thinking", "Thinking…");
}
export const CHAT_MINIMAP_WIDTH = 36;
export const CHAT_COLUMN_PADDING = 16;
export const CHAT_INPUT_RIGHT_PADDING = CHAT_COLUMN_PADDING + CHAT_MINIMAP_WIDTH;
export function toMinimapMessage(message: AgentMessage | Partial<AgentMessage>): ChatMinimapMessage | null {
  if (message.role !== "user" && message.role !== "assistant") return null;
  const content = message.content;
  if (message.role === "user") {
    const preview =
      typeof content === "string"
        ? content
        : Array.isArray(content)
          ? content.flatMap((block) => (block.type === "text" ? [block.text] : [])).join(" ")
          : "";
    return { role: "user", preview: preview.slice(0, 200), hasText: true };
  }
  const blocks = Array.isArray(content) ? content : [];
  const text = blocks.flatMap((block) => (block.type === "text" ? [block.text] : [])).join(" ");
  const toolNames = blocks.flatMap((block) => (block.type === "toolCall" ? [block.toolName] : []));
  return {
    role: "assistant",
    preview: (text || toolNames.join(", ")).slice(0, 200),
    hasText: text.length > 0,
  };
}
export function findRetriedFailureIndices(messages: AgentMessage[]): Set<number> {
  const retried = new Set<number>();
  let laterAssistantInTurn = false;
  for (let idx = messages.length - 1; idx >= 0; idx--) {
    const message = messages[idx];
    if (message.role === "user") {
      laterAssistantInTurn = false;
    } else if (message.role === "assistant") {
      if (laterAssistantInTurn && isAssistantFailure(message as AssistantMessage)) retried.add(idx);
      laterAssistantInTurn = true;
    }
  }
  return retried;
}
