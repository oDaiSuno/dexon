import type { AgentMessage } from "./types";

export interface SessionHistoryValue {
  messages: AgentMessage[];
  entryIds: string[];
}

export function normalizeSessionHistory(messages: AgentMessage[], entryIds: string[]): SessionHistoryValue {
  if (entryIds.length === messages.length) return { messages, entryIds };
  return {
    messages,
    entryIds: Array.from({ length: messages.length }, (_, index) => entryIds[index] ?? ""),
  };
}

export function appendLocalHistoryMessage(
  history: SessionHistoryValue,
  message: AgentMessage,
  entryId = "",
): SessionHistoryValue {
  const current = normalizeSessionHistory(history.messages, history.entryIds);
  return { messages: [...current.messages, message], entryIds: [...current.entryIds, entryId] };
}

export function replaceLastHistoryMessage(
  history: SessionHistoryValue,
  message: AgentMessage,
  entryId?: string,
): SessionHistoryValue {
  const current = normalizeSessionHistory(history.messages, history.entryIds);
  if (current.messages.length === 0) return appendLocalHistoryMessage(current, message, entryId);
  return {
    messages: [...current.messages.slice(0, -1), message],
    entryIds: entryId === undefined ? current.entryIds : [...current.entryIds.slice(0, -1), entryId],
  };
}

export function nameLastHistoryEntry(history: SessionHistoryValue, entryId: string): SessionHistoryValue {
  const current = normalizeSessionHistory(history.messages, history.entryIds);
  const index = current.entryIds.length - 1;
  if (index < 0 || current.entryIds[index] === entryId) return current;
  const entryIds = [...current.entryIds];
  entryIds[index] = entryId;
  return { messages: current.messages, entryIds };
}

export function renameHistoryEntry(
  history: SessionHistoryValue,
  fromEntryId: string,
  toEntryId: string,
): SessionHistoryValue {
  const current = normalizeSessionHistory(history.messages, history.entryIds);
  const index = current.entryIds.lastIndexOf(fromEntryId);
  if (index === -1) return current;
  const entryIds = [...current.entryIds];
  entryIds[index] = toEntryId;
  return { messages: current.messages, entryIds };
}

export function removeLastHistoryMessage(history: SessionHistoryValue): SessionHistoryValue {
  const current = normalizeSessionHistory(history.messages, history.entryIds);
  return { messages: current.messages.slice(0, -1), entryIds: current.entryIds.slice(0, -1) };
}
