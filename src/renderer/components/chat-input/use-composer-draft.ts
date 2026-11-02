import { useCallback, useEffect, useRef, useState } from "react";
import { DraftPersistenceController, getDraft } from "@/lib/draft-store";
import { insertAttachmentToken } from "@shared/attachment-tokens";
import { registerStagedPreviewUrl } from "@/lib/attachment-token-previews";
import {
  browseBuffer,
  editBuffer,
  loadedBuffer,
  migratedBuffer,
  restoreCaretOf,
  restoreFailedBuffer,
  returnedBuffer,
  shownText,
  submitBuffer,
  takeBuffer,
  type ComposerBuffer,
  type RecallDirection,
  type SubmissionTicket,
} from "./composer-buffer";
import { carryLocalCommands, type PromptHistory } from "./prompt-history";
import type { CaretPlacement } from "./types";

type Translate = (key: string, fallback: string) => string;

export interface SubmissionNotice {
  readonly tone: "error" | "warning";
  readonly message: string;
  readonly canResend: boolean;
}

export interface ComposerDraft {
  readonly shown: string;
  readonly restoreCaret: CaretPlacement;
  readonly recalling: boolean;
  readonly submissionNotice: SubmissionNotice | null;
  edit(text: string): void;
  browse(direction: RecallDirection, source: () => PromptHistory | null): boolean;
  returnToDraft(): boolean;
  submit(): SubmissionTicket | null;
  restoreFailed(ticket: SubmissionTicket, kind: "send" | "queue", reason: string | null): void;
  takeDraft(): string;
  commit(): void;
  dismissSubmissionNotice(): void;
}

function failureReason(reason: string | null, t: Translate): string {
  const trimmed = reason?.trim().replace(/[。.！!]+$/u, "") ?? "";
  return trimmed || t("submissionFailureUnknownReason", "reason unknown");
}

function extensionForImageMime(mimeType: string): string | null {
  switch (mimeType.split(";")[0]?.trim().toLowerCase()) {
    case "image/png":
      return "png";
    case "image/jpeg":
      return "jpg";
    case "image/gif":
      return "gif";
    case "image/webp":
      return "webp";
    default:
      return null;
  }
}

function isNewWorkspaceScopeKey(scopeKey: string | undefined): scopeKey is string {
  return Boolean(scopeKey?.startsWith("new:"));
}

async function stageLegacyImage(image: { data: string; mimeType: string }): Promise<string | null> {
  try {
    const result = await window.piBridge?.stageClipboardImage?.({
      base64: image.data,
      ext: extensionForImageMime(image.mimeType) ?? "",
    });
    if (!result?.ok) return null;
    registerStagedPreviewUrl(result.staged.path, `data:${image.mimeType};base64,${image.data}`);
    return result.staged.path;
  } catch {
    return null;
  }
}

interface Options {
  draftKey?: string;
  t: Translate;
  onImageNotice: (notice: string) => void;
}

interface PendingLegacyMigration {
  key: string;
  revision: number;
}

export function useComposerDraft({ draftKey, t, onImageNotice }: Options): ComposerDraft {
  const [buffer, setBuffer] = useState(() => loadedBuffer(draftKey ? (getDraft(draftKey)?.value ?? "") : "", null));
  const bufferRef = useRef(buffer);
  const [submissionNotice, setSubmissionNotice] = useState<SubmissionNotice | null>(null);
  const draftKeyRef = useRef<string | undefined>(undefined);
  const migrationGenerationRef = useRef(0);
  const pendingLegacyMigrationRef = useRef<PendingLegacyMigration | null>(null);
  const imageNoticeRef = useRef(onImageNotice);
  imageNoticeRef.current = onImageNotice;
  const persistenceErrorRef = useRef<() => void>(() => {});
  const persistenceRef = useRef<DraftPersistenceController | null>(null);

  persistenceErrorRef.current = () =>
    setSubmissionNotice({
      tone: "warning",
      message: t(
        "draftPersistenceFailed",
        "Draft could not be saved on this device. Your current input is still on screen; check available storage.",
      ),
      canResend: false,
    });
  if (!persistenceRef.current) {
    persistenceRef.current = new DraftPersistenceController(500, undefined, () => persistenceErrorRef.current());
  }

  const apply = useCallback((next: ComposerBuffer) => {
    bufferRef.current = next;
    setBuffer(next);
  }, []);

  const supersedeMigration = useCallback(() => {
    const pending = pendingLegacyMigrationRef.current;
    if (pending?.key === draftKeyRef.current && pending?.revision === bufferRef.current.draft.revision) {
      pendingLegacyMigrationRef.current = null;
      migrationGenerationRef.current += 1;
    }
  }, []);

  const edit = useCallback(
    (text: string) => {
      const next = editBuffer(bufferRef.current, text);
      if (next === bufferRef.current) return;
      supersedeMigration();
      apply(next);
    },
    [apply, supersedeMigration],
  );

  const clearStoredDraft = useCallback(() => {
    if (draftKey) persistenceRef.current?.clear(draftKey);
    if (draftKeyRef.current && draftKeyRef.current !== draftKey) persistenceRef.current?.clear(draftKeyRef.current);
  }, [draftKey]);

  const commit = useCallback(() => {
    const key = draftKeyRef.current;
    if (!key) return;
    const pending = pendingLegacyMigrationRef.current;
    if (pending?.key === key && pending.revision === bufferRef.current.draft.revision) return;
    persistenceRef.current?.commit(key, { value: bufferRef.current.draft.text });
  }, []);

  const browse = useCallback(
    (direction: RecallDirection, source: () => PromptHistory | null) => {
      const next = browseBuffer(bufferRef.current, direction, source);
      if (!next) return false;
      apply(next);
      return true;
    },
    [apply],
  );

  const returnToDraft = useCallback(() => {
    const next = returnedBuffer(bufferRef.current);
    if (next === bufferRef.current) return false;
    apply(next);
    return true;
  }, [apply]);

  const submit = useCallback(() => {
    const result = submitBuffer(bufferRef.current, draftKeyRef.current);
    if (!result) return null;
    setSubmissionNotice(null);
    commit();
    if (result.clearsStoredDraft) supersedeMigration();
    apply(result.buffer);
    if (result.clearsStoredDraft) clearStoredDraft();
    return result.ticket;
  }, [apply, clearStoredDraft, commit, supersedeMigration]);

  const restoreFailed = useCallback(
    (ticket: SubmissionTicket, kind: "send" | "queue", reason: string | null) => {
      const result = restoreFailedBuffer(bufferRef.current, ticket);
      if (result.action === "restore") apply(result.buffer);
      const template =
        result.action === "restore"
          ? kind === "send"
            ? t("messageNotSentDraftRestored", "Not sent: {reason}. Your draft was kept.")
            : t("messageNotQueuedDraftRestored", "Not queued: {reason}. Your draft was kept.")
          : kind === "send"
            ? t("messageNotSentNewDraftKept", "The previous message wasn't sent: {reason}. Your newer draft was kept.")
            : t(
                "messageNotQueuedNewDraftKept",
                "The previous message wasn't queued: {reason}. Your newer draft was kept.",
              );
      setSubmissionNotice({
        tone: "error",
        message: template.replace("{reason}", failureReason(reason, t)),
        canResend: result.action === "restore" && kind === "send",
      });
    },
    [apply, t],
  );

  const takeDraft = useCallback(() => {
    const result = takeBuffer(bufferRef.current);
    supersedeMigration();
    apply(result.buffer);
    clearStoredDraft();
    return result.text;
  }, [apply, clearStoredDraft, supersedeMigration]);

  useEffect(() => {
    if (!draftKey || draftKeyRef.current !== draftKey) return;
    const pending = pendingLegacyMigrationRef.current;
    if (pending?.key === draftKey && pending.revision === bufferRef.current.draft.revision) return;
    persistenceRef.current?.schedule(draftKey, { value: buffer.draft.text });
  }, [draftKey, buffer.draft.text]);

  useEffect(() => {
    const previousKey = draftKeyRef.current;
    const previousMigration = pendingLegacyMigrationRef.current;
    if (previousKey && previousKey !== draftKey) {
      const migrationStillOwnsDraft =
        previousMigration?.key === previousKey && previousMigration.revision === bufferRef.current.draft.revision;
      if (!migrationStillOwnsDraft)
        persistenceRef.current?.commit(previousKey, { value: bufferRef.current.draft.text });
      if (isNewWorkspaceScopeKey(previousKey) && draftKey && !isNewWorkspaceScopeKey(draftKey)) {
        carryLocalCommands(previousKey, draftKey);
      }
    }
    pendingLegacyMigrationRef.current = null;
    const generation = ++migrationGenerationRef.current;
    const draft = draftKey ? getDraft(draftKey) : null;
    draftKeyRef.current = draftKey;
    apply(loadedBuffer(draft?.value ?? "", bufferRef.current));
    const migrationRevision = bufferRef.current.draft.revision;
    if (!draftKey || (!draft?.images?.length && !draft?.files?.length)) {
      return () => {
        migrationGenerationRef.current += 1;
      };
    }
    pendingLegacyMigrationRef.current = { key: draftKey, revision: migrationRevision };
    void (async () => {
      const notices: string[] = [];
      let nextValue = draft.value;
      for (const image of draft.images ?? []) {
        const stagedPath = await stageLegacyImage(image);
        if (stagedPath) nextValue = insertAttachmentToken(nextValue, null, stagedPath).value;
        if (
          generation !== migrationGenerationRef.current ||
          draftKeyRef.current !== draftKey ||
          bufferRef.current.draft.revision !== migrationRevision
        )
          return;
      }
      for (const file of draft.files ?? []) nextValue = insertAttachmentToken(nextValue, null, file.path).value;
      if (
        generation !== migrationGenerationRef.current ||
        draftKeyRef.current !== draftKey ||
        bufferRef.current.draft.revision !== migrationRevision
      )
        return;
      pendingLegacyMigrationRef.current = null;
      if (nextValue !== draft.value) apply(migratedBuffer(bufferRef.current, nextValue));
      persistenceRef.current?.schedule(draftKey, { value: nextValue });
      if (draft.images?.length) {
        notices.push(
          t("draftImageMigrationFailed", "Some images from your draft could not be restored and were removed."),
        );
      }
      if (notices.length > 0) imageNoticeRef.current(notices.join(". "));
    })();
    return () => {
      migrationGenerationRef.current += 1;
    };
  }, [apply, draftKey, t]);

  useEffect(
    () => () => {
      commit();
      persistenceRef.current?.dispose();
    },
    [commit],
  );

  const dismissSubmissionNotice = useCallback(() => setSubmissionNotice(null), []);

  return {
    shown: shownText(buffer),
    restoreCaret: restoreCaretOf(buffer),
    recalling: buffer.recall !== null,
    submissionNotice,
    edit,
    browse,
    returnToDraft,
    submit,
    restoreFailed,
    takeDraft,
    commit,
    dismissSubmissionNotice,
  };
}
