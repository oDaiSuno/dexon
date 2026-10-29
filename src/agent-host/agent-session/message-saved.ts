import type { AgentEvent } from "./types";

interface SavedEntryLike {
  type?: unknown;
  id?: unknown;
  message?: unknown;
  content?: unknown;
}

interface LeafReaderLike {
  getLeafEntry?: () => SavedEntryLike | undefined;
}

export function announceSavedMessage(
  sessionManager: LeafReaderLike,
  message: unknown,
  emit: (event: AgentEvent) => void,
): void {
  queueMicrotask(() => {
    const entryId = savedEntryId(sessionManager, message);
    if (entryId !== null) emit({ type: "message_saved", entryId });
  });
}

function savedEntryId(sessionManager: LeafReaderLike, message: unknown): string | null {
  try {
    const readLeaf = sessionManager.getLeafEntry;
    if (typeof readLeaf !== "function") return null;
    const leaf = readLeaf.call(sessionManager);
    if (!leaf || typeof leaf.id !== "string" || leaf.id === "") return null;
    return belongsTo(leaf, message) ? leaf.id : null;
  } catch {
    return null;
  }
}

function belongsTo(leaf: SavedEntryLike, message: unknown): boolean {
  if (leaf.type === "message") return leaf.message === message;
  if (leaf.type === "custom_message") return leaf.content === contentOf(message);
  return false;
}

function contentOf(message: unknown): unknown {
  return message && typeof message === "object" ? (message as { content?: unknown }).content : undefined;
}
