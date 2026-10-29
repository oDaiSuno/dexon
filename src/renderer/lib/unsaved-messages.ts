let temporaryIds = 0;

export class UnsavedMessages {
  private awaitingSave: string | null = null;
  private streaming: { entryId: string; startedAt: number | undefined } | null = null;

  nextEntryId(): string {
    temporaryIds += 1;
    return `live-${temporaryIds}`;
  }

  streamingEntryId(startedAt?: number): string {
    if (this.streaming === null || this.streaming.startedAt !== startedAt) {
      this.streaming = { entryId: this.nextEntryId(), startedAt };
    }
    return this.streaming.entryId;
  }

  endStreaming(): string | null {
    const entryId = this.streaming?.entryId ?? null;
    this.streaming = null;
    return entryId;
  }

  awaitSave(entryId: string): void {
    this.awaitingSave = entryId;
  }

  takeAwaitingSave(): string | null {
    const awaiting = this.awaitingSave;
    this.awaitingSave = null;
    return awaiting;
  }
}

const conversations = new Map<string, UnsavedMessages>();

export function unsavedMessagesFor(sessionId: string | null, newSessionCwd: string | null): UnsavedMessages {
  const key = conversationKey(sessionId, newSessionCwd);
  const existing = conversations.get(key);
  if (existing) return existing;
  const created = new UnsavedMessages();
  conversations.set(key, created);
  return created;
}

export function carryUnsavedMessages(newSessionCwd: string, sessionId: string): void {
  const pending = conversations.get(conversationKey(null, newSessionCwd));
  if (!pending) return;
  conversations.delete(conversationKey(null, newSessionCwd));
  conversations.set(conversationKey(sessionId, null), pending);
}

function conversationKey(sessionId: string | null, newSessionCwd: string | null): string {
  return sessionId ?? `new:${newSessionCwd ?? "untitled"}`;
}
