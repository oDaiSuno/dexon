import { type AgentPhase } from "@/hooks/useAgentSession";
import { isAssistantFailure } from "@/lib/message-display";
import type { SessionStatsInfo } from "@/lib/pi-types";
import type { ReadingPositionRegistry } from "@/lib/reading-position-store";
import type { ThinkingExpansionStore } from "@/lib/thinking-expansion-store";
import type { AgentMessage, AssistantMessage, SessionInfo, SessionTreeNode } from "@/lib/types";
import { type ChatInputHandle } from "../ChatInput";
import type { ContextUsageInfo, TurnOutlineItem } from "@contract/types";
import type { ChannelsSnapshot } from "@shared/channel-types";
import type { ComposerNavigation, ComposerWorkspace } from "../chat-input/types";
import type { UsageCompaction } from "../app-shell/use-session-info";
import { turnTitleOf } from "@shared/turn-title";
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
  onContextUsageChange?: (usage: ContextUsageInfo | null) => void;
  onCompactionChange?: (compaction: UsageCompaction | null) => void;
  onModelIdChange?: (modelId: string | null) => void;
  onOpenFile?: (filePath: string) => void;
  /** True while this chat surface is the page currently shown to the user. */
  visible?: boolean;
  readingPositions?: ReadingPositionRegistry;
  thinkingExpansionStore: ThinkingExpansionStore;
  processDetailsExpansionStore: ThinkingExpansionStore;
  channelSnapshot?: ChannelsSnapshot;
  onChannelSnapshotChange?: (snapshot: ChannelsSnapshot) => void;
  navigation?: ComposerNavigation;
  workspace?: ComposerWorkspace | null;
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

export function isAnswerTextStreaming(message: Partial<AgentMessage> | null | undefined): boolean {
  const blocks = message?.content;
  if (!Array.isArray(blocks)) return false;
  for (let index = blocks.length - 1; index >= 0; index -= 1) {
    const block = blocks[index];
    if (!block) continue;
    if (block.type === "text") {
      if (block.text.trim() === "") continue;
      return true;
    }
    return false;
  }
  return false;
}
export const CHAT_COLUMN_PADDING = 16;
export interface NavigatorTurn {
  key: string;
  title: string;
  refIndex?: number;
  entryId?: string;
}
export function toNavigatorTurns(
  messages: AgentMessage[],
  entryIds: string[],
  olderOutline: TurnOutlineItem[],
): NavigatorTurn[] {
  const loaded: NavigatorTurn[] = [];
  let refIndex = 0;
  messages.forEach((message, index) => {
    if (message.role !== "user" && message.role !== "assistant") return;
    if (message.role === "user") {
      const entryId = entryIds[index];
      loaded.push({
        key: entryId ? `entry:${entryId}` : `ref:${refIndex}`,
        title: turnTitleOf(message.content),
        refIndex,
        ...(entryId ? { entryId } : {}),
      });
    }
    refIndex += 1;
  });
  return [
    ...olderOutline.map((item): NavigatorTurn => ({
      key: `outline:${item.entryId}`,
      title: item.title,
      entryId: item.entryId,
    })),
    ...loaded,
  ];
}
export interface TurnFailureClassification {
  retried: Set<number>;
  resolved: Set<number>;
}
export function classifyTurnFailures(messages: AgentMessage[]): TurnFailureClassification {
  const retried = new Set<number>();
  const resolved = new Set<number>();
  let laterAssistantInTurn = false;
  let laterSuccessInTurn = false;
  for (let idx = messages.length - 1; idx >= 0; idx--) {
    const message = messages[idx];
    if (message.role === "user") {
      laterAssistantInTurn = false;
      laterSuccessInTurn = false;
    } else if (message.role === "assistant") {
      const assistant = message as AssistantMessage;
      if (isAssistantFailure(assistant)) {
        if (laterAssistantInTurn) retried.add(idx);
        if (laterSuccessInTurn) resolved.add(idx);
      }
      laterAssistantInTurn = true;
      if (assistant.stopReason !== "error" && assistant.stopReason !== "aborted") laterSuccessInTurn = true;
    }
  }
  return { retried, resolved };
}
