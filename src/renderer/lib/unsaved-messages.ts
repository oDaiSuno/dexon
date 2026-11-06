import { PRIMARY_ENVIRONMENT_ID, type EnvironmentId } from "@contract/environment";

export function newSessionDraftKey(cwd: string | null, environmentId: EnvironmentId = PRIMARY_ENVIRONMENT_ID): string {
  return environmentId === PRIMARY_ENVIRONMENT_ID
    ? `new:${cwd ?? "untitled"}`
    : `new:${JSON.stringify([environmentId, cwd ?? "untitled"])}`;
}

let temporaryIds = 0;

export class UnsavedMessages {
  private awaitingSave: string | null = null;
  private streaming: { entryId: string; startedAt: number | undefined } | null = null;

  nextEntryId(): string {
    temporaryIds += 1;
    return `live-${temporaryIds}`;
  }

  startStreaming(startedAt?: number): string {
    this.streaming = { entryId: this.nextEntryId(), startedAt };
    return this.streaming.entryId;
  }

  streamingEntryId(startedAt?: number): string {
    return this.streaming?.entryId ?? this.startStreaming(startedAt);
  }

  resumeStreaming(startedAt?: number): string {
    if (this.streaming && this.streaming.startedAt !== startedAt) return this.startStreaming(startedAt);
    return this.streamingEntryId(startedAt);
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
const draftPromotions = new Map<string, string>();

export function takeDraftPromotion(source: string, target: string): boolean {
  if (draftPromotions.get(source) !== target) return false;
  draftPromotions.delete(source);
  return true;
}

export function unsavedMessagesFor(
  sessionId: string | null,
  newSessionCwd: string | null,
  environmentId: EnvironmentId = PRIMARY_ENVIRONMENT_ID,
): UnsavedMessages {
  const key = conversationKey(sessionId, newSessionCwd, environmentId);
  const existing = conversations.get(key);
  if (existing) return existing;
  const created = new UnsavedMessages();
  draftPromotions.delete(key);
  conversations.set(key, created);
  return created;
}

export function carryUnsavedMessages(
  newSessionCwd: string,
  sessionId: string,
  environmentId: EnvironmentId = PRIMARY_ENVIRONMENT_ID,
): void {
  const key = newSessionDraftKey(newSessionCwd, environmentId);
  const pending = conversations.get(key);
  if (!pending) return;
  draftPromotions.set(key, sessionId);
  conversations.delete(key);
  conversations.set(conversationKey(sessionId, null, environmentId), pending);
}

function conversationKey(sessionId: string | null, newSessionCwd: string | null, environmentId: EnvironmentId): string {
  return sessionId ?? newSessionDraftKey(newSessionCwd, environmentId);
}
