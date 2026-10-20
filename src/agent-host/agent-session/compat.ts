import { SessionManager } from "@earendil-works/pi-coding-agent";
import type { AgentSessionLike } from "../../shared/pi-types";
import { isSessionToolName } from "../../shared/session-orchestration";
import { isBrowserToolName } from "../browser-tools";
import { isSessionToolsType } from "../session-entry-compat";

const CODING_TOOL_NAMES = ["read", "bash", "edit", "write", "grep", "find", "ls"];
const LEGACY_CHANNEL_PROMPT = /^\[外部消息来源：(微信|Telegram|飞书 \/ Lark)\]\n/;
const LEGACY_CHANNEL_PROMPT_DELIMITER = "\n---\n";

type PersistedSessionTools = {
  version: 1;
  toolNames: string[];
};

function parsePersistedSessionTools(value: unknown): string[] | undefined {
  if (!value || typeof value !== "object") return undefined;
  const state = value as Partial<PersistedSessionTools>;
  if (
    state.version !== 1 ||
    !Array.isArray(state.toolNames) ||
    !state.toolNames.every((name) => typeof name === "string")
  ) {
    return undefined;
  }
  return [...new Set(state.toolNames.map((name) => name.trim()).filter(Boolean))];
}

export function getLegacySessionToolNames(sessionManager: Pick<SessionManager, "getEntries">): string[] | undefined {
  const entries = sessionManager.getEntries();
  for (let index = entries.length - 1; index >= 0; index -= 1) {
    const entry = entries[index];
    if (entry.type !== "custom" || !isSessionToolsType(entry.customType)) continue;
    const toolNames = parsePersistedSessionTools(entry.data);
    if (toolNames !== undefined) return toolNames;
  }
  return undefined;
}

function stripLegacyChannelPromptText(text: string): string {
  if (!LEGACY_CHANNEL_PROMPT.test(text)) return text;
  const delimiter = text.indexOf(LEGACY_CHANNEL_PROMPT_DELIMITER);
  return delimiter < 0 ? text : text.slice(delimiter + LEGACY_CHANNEL_PROMPT_DELIMITER.length);
}

export function stripLegacyChannelPrompts(messages: unknown[]): unknown[] {
  return messages.map((message) => {
    if (!message || typeof message !== "object" || (message as { role?: unknown }).role !== "user") return message;
    const user = message as { content?: unknown };
    if (typeof user.content === "string") {
      const content = stripLegacyChannelPromptText(user.content);
      return content === user.content ? message : { ...message, content };
    }
    if (!Array.isArray(user.content)) return message;

    let changed = false;
    const content = user.content.map((block) => {
      if (!block || typeof block !== "object" || (block as { type?: unknown }).type !== "text") return block;
      const text = (block as { text?: unknown }).text;
      if (typeof text !== "string") return block;
      const stripped = stripLegacyChannelPromptText(text);
      if (stripped === text) return block;
      changed = true;
      return { ...block, text: stripped };
    });
    return changed ? { ...message, content } : message;
  });
}

export function withExtensionTools(session: AgentSessionLike, toolNames: string[]): string[] {
  if (toolNames.length === 0) return [];

  const codingToolNames = new Set(CODING_TOOL_NAMES);
  const extensionToolNames = session
    .getAllTools()
    .map((t) => t.name)
    .filter((name) => !codingToolNames.has(name) && !isBrowserToolName(name) && !isSessionToolName(name));

  return [...new Set([...toolNames, ...extensionToolNames])];
}
