import {
  captureComposerSubmission,
  failedComposerSubmissionAction,
  failedComposerSubmissionValue,
  type ComposerSubmissionSnapshot,
} from "@/lib/composer-submission";
import type { PromptHistory } from "./prompt-history";
import type { CaretPlacement } from "./types";

export type RecallDirection = "older" | "newer";

interface WorkingDraft {
  readonly text: string;
  readonly revision: number;
}

interface Recall {
  readonly history: PromptHistory;
  readonly index: number;
  readonly caret: CaretPlacement;
}

export interface ComposerBuffer {
  readonly draft: WorkingDraft;
  readonly recall: Recall | null;
}

const TICKET = Symbol("submission-ticket");

export interface SubmissionTicket {
  readonly message: string;
  readonly scopeKey: string | undefined;
  readonly [TICKET]: {
    readonly snapshot: ComposerSubmissionSnapshot;
    readonly draftRevision: number;
    readonly preview: Recall | null;
  };
}

export function loadedBuffer(text: string, previous: ComposerBuffer | null): ComposerBuffer {
  return { draft: { text, revision: (previous?.draft.revision ?? 0) + 1 }, recall: null };
}

export function shownText(buffer: ComposerBuffer): string {
  return buffer.recall ? buffer.recall.history[buffer.recall.index] : buffer.draft.text;
}

export function restoreCaretOf(buffer: ComposerBuffer): CaretPlacement {
  return buffer.recall?.caret ?? "end";
}

export function editBuffer(buffer: ComposerBuffer, text: string): ComposerBuffer {
  return text === shownText(buffer) ? buffer : loadedBuffer(text, buffer);
}

export function browseBuffer(
  buffer: ComposerBuffer,
  direction: RecallDirection,
  source: () => PromptHistory | null,
): ComposerBuffer | null {
  const { draft, recall } = buffer;
  if (!recall) {
    if (direction === "newer") return null;
    const history = source();
    return history ? { draft, recall: { history, index: 0, caret: "start" } } : null;
  }
  if (direction === "newer" && recall.index === 0) return returnedBuffer(buffer);
  const index = recall.index + (direction === "older" ? 1 : -1);
  if (index >= recall.history.length) return null;
  return { draft, recall: { history: recall.history, index, caret: direction === "older" ? "start" : "end" } };
}

export function returnedBuffer(buffer: ComposerBuffer): ComposerBuffer {
  return buffer.recall ? { draft: buffer.draft, recall: null } : buffer;
}

export function migratedBuffer(buffer: ComposerBuffer, text: string): ComposerBuffer {
  return { draft: { text, revision: buffer.draft.revision + 1 }, recall: buffer.recall };
}

export function submitBuffer(
  buffer: ComposerBuffer,
  scopeKey: string | undefined,
): { readonly buffer: ComposerBuffer; readonly ticket: SubmissionTicket; readonly clearsStoredDraft: boolean } | null {
  const text = shownText(buffer);
  if (!text.trim()) return null;
  const next = buffer.recall ? returnedBuffer(buffer) : loadedBuffer("", buffer);
  return {
    buffer: next,
    ticket: {
      message: text.trim(),
      scopeKey,
      [TICKET]: {
        snapshot: captureComposerSubmission(text),
        draftRevision: next.draft.revision,
        preview: buffer.recall,
      },
    },
    clearsStoredDraft: buffer.recall === null,
  };
}

export function restoreFailedBuffer(
  buffer: ComposerBuffer,
  ticket: SubmissionTicket,
): { readonly buffer: ComposerBuffer; readonly action: "restore" | "preserve" } {
  const { snapshot, draftRevision, preview } = ticket[TICKET];
  const action = failedComposerSubmissionAction(draftRevision, buffer.draft.revision);
  if (action === "preserve") return { buffer, action };
  return {
    buffer: preview
      ? { draft: buffer.draft, recall: preview }
      : loadedBuffer(failedComposerSubmissionValue(snapshot), buffer),
    action,
  };
}

export function takeBuffer(buffer: ComposerBuffer): { readonly buffer: ComposerBuffer; readonly text: string } {
  return { buffer: loadedBuffer("", buffer), text: buffer.draft.text };
}
