import { type AgentPhase } from "@/hooks/useAgentSession";
import { isAssistantFailure } from "@/lib/message-display";
import type { SessionStatsInfo } from "@/lib/pi-types";
import type { ThinkingExpansionStore } from "@/lib/thinking-expansion-store";
import type { AgentMessage, AssistantMessage, SessionInfo, SessionTreeNode } from "@/lib/types";
import { type ChatInputHandle } from "../ChatInput";
import type { ChannelsSnapshot } from "@shared/channel-types";
import type { ComposerNavigation, ComposerWorkspace } from "../chat-input/types";
import { parseExpandedSkillMessage, skillCommandText, splitLeadingSkillCommand } from "@shared/skill-commands";
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
  onModelIdChange?: (modelId: string | null) => void;
  onOpenFile?: (filePath: string) => void;
  /** True while this chat surface is the page currently shown to the user. */
  visible?: boolean;
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
export const CHAT_COLUMN_PADDING = 16;
export interface NavigatorTurn {
  refIndex: number;
  title: string;
}
export function turnTitleOf(content: AgentMessage["content"]): string {
  const text =
    typeof content === "string"
      ? content
      : Array.isArray(content)
        ? content.flatMap((block) => (block.type === "text" ? [block.text] : [])).join(" ")
        : "";
  const skill = splitLeadingSkillCommand(text) ?? parseExpandedSkillMessage(text);
  const visible = skill ? `${skillCommandText(skill.name)} ${skill.rest}` : text;
  return visible.replace(/\s+/g, " ").trim().slice(0, 200);
}
export function toNavigatorTurns(messages: AgentMessage[]): NavigatorTurn[] {
  const turns: NavigatorTurn[] = [];
  let refIndex = 0;
  for (const message of messages) {
    if (message.role !== "user" && message.role !== "assistant") continue;
    if (message.role === "user") turns.push({ refIndex, title: turnTitleOf(message.content) });
    refIndex += 1;
  }
  return turns;
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
