import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { parseAutomationPromptPayload, type AutomationPromptPayload } from "../shared/automation/prompt-context";
import type { SessionEntry } from "../shared/types";
import { AUTOMATION_PROMPT_CANCELLED_TYPE, AUTOMATION_PROMPT_TYPE } from "./session-entry-compat";

type ContextReader = Pick<ExtensionContext["sessionManager"], "getBranch" | "buildSessionProjection">;
type ContextMessage = { role: string; timestamp?: number; content?: unknown };

export function automationPromptsOnBranch(path: readonly SessionEntry[]): {
  byEntryId: Map<string, AutomationPromptPayload>;
  pending: AutomationPromptPayload | null;
} {
  const byEntryId = new Map<string, AutomationPromptPayload>();
  let pending: AutomationPromptPayload | null = null;
  for (const entry of path) {
    if (entry.type === "custom" && entry.customType === AUTOMATION_PROMPT_TYPE) {
      pending = parseAutomationPromptPayload(entry.data);
    } else if (entry.type === "custom" && entry.customType === AUTOMATION_PROMPT_CANCELLED_TYPE) {
      pending = null;
    } else if (entry.type === "message" && entry.message.role !== "system") {
      if (entry.message.role === "user" && pending) byEntryId.set(entry.id, pending);
      pending = null;
    } else if (entry.type === "branch_summary" || entry.type === "compaction") {
      pending = null;
    }
  }
  return { byEntryId, pending };
}

function contextPrefix(payload: AutomationPromptPayload): string {
  return `<automation_context>\n${payload.hiddenContext}\n</automation_context>\n\n`;
}

function changePrefix<T extends ContextMessage>(message: T, payload: AutomationPromptPayload, remove = false): T {
  const prefix = contextPrefix(payload);
  if (typeof message.content === "string") {
    if (remove && !message.content.startsWith(prefix)) return message;
    return { ...message, content: remove ? message.content.slice(prefix.length) : prefix + message.content };
  }
  if (!Array.isArray(message.content)) return message;
  const first = message.content[0];
  if (first?.type === "text" && typeof first.text === "string") {
    if (remove && !first.text.startsWith(prefix)) return message;
    const text = remove ? first.text.slice(prefix.length) : prefix + first.text;
    const rest = message.content.slice(1);
    const content = remove && !text ? rest : [{ ...first, text }, ...rest];
    return { ...message, content };
  }
  return remove ? message : { ...message, content: [{ type: "text", text: prefix }, ...message.content] };
}

export function withAutomationPromptContext<T extends ContextMessage>(
  messages: T[],
  manager?: ContextReader,
  clean: (messages: T[]) => T[] = (messages) => messages,
): T[] {
  if (!manager) return clean(messages);
  const branch = manager.getBranch() as unknown as SessionEntry[];
  const { byEntryId } = automationPromptsOnBranch(branch);
  if (byEntryId.size === 0) return clean(messages);
  const users = manager
    .buildSessionProjection()
    .entries.flatMap(({ sourceEntry, messages: projected }) =>
      projected.filter((message) => message.role === "user").map((message) => ({ message, id: sourceEntry.id })),
    );
  const matched = new Map<number, AutomationPromptPayload>();
  let sourceIndex = users.length - 1;
  let unprefixed = messages;
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (message.role !== "user") continue;
    let match = sourceIndex;
    while (match >= 0 && users[match].message.timestamp !== message.timestamp) match -= 1;
    if (match < 0) continue;
    sourceIndex = match - 1;
    const source = users[match];
    const payload = byEntryId.get(source.id);
    if (!payload) continue;
    matched.set(index, payload);
    if (JSON.stringify(message.content) === JSON.stringify(source.message.content)) continue;
    const next = changePrefix(message, payload, true);
    if (next === message) continue;
    if (unprefixed === messages) unprefixed = [...messages];
    unprefixed[index] = next;
  }
  const cleaned = clean(unprefixed);
  if (matched.size === 0) return cleaned;
  const result = [...cleaned];
  for (const [index, payload] of matched) {
    const next = changePrefix(cleaned[index], payload);
    result[index] = JSON.stringify(next.content) === JSON.stringify(messages[index].content) ? messages[index] : next;
  }
  return result;
}
