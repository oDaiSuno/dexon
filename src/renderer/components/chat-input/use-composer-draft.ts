import { useCallback, useEffect, useRef, useState, type SetStateAction } from "react";
import { DraftPersistenceController, getDraft } from "@/lib/draft-store";
import {
  failedComposerSubmissionAction,
  failedComposerSubmissionValue,
  type ComposerSubmissionSnapshot,
} from "@/lib/composer-submission";
import { insertAttachmentToken } from "@shared/attachment-tokens";
import { registerStagedPreviewUrl } from "@/lib/attachment-token-previews";

type Translate = (key: string, fallback: string) => string;

export interface SubmissionNotice {
  tone: "error" | "warning";
  message: string;
  canResend: boolean;
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

interface Options {
  draftKey?: string;
  t: Translate;
  onImageNotice: (notice: string) => void;
}

interface PendingLegacyMigration {
  key: string;
  revision: number;
}

export function useComposerDraft({ draftKey, t, onImageNotice }: Options) {
  const [value, setValueState] = useState(() => (draftKey ? (getDraft(draftKey)?.value ?? "") : ""));
  const [submissionNotice, setSubmissionNotice] = useState<SubmissionNotice | null>(null);
  const draftKeyRef = useRef<string | undefined>(undefined);
  const valueRef = useRef(value);
  const inputRevisionRef = useRef(0);
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

  const setValue = useCallback((next: SetStateAction<string>) => {
    const pendingMigration = pendingLegacyMigrationRef.current;
    if (
      pendingMigration &&
      pendingMigration.key === draftKeyRef.current &&
      pendingMigration.revision === inputRevisionRef.current
    ) {
      // A deliberate edit supersedes migration. Invalidate the async result and
      // allow the edited text to become the new durable draft instead.
      pendingLegacyMigrationRef.current = null;
      migrationGenerationRef.current += 1;
    }
    const resolved = typeof next === "function" ? next(valueRef.current) : next;
    inputRevisionRef.current += 1;
    valueRef.current = resolved;
    setValueState(resolved);
  }, []);
  valueRef.current = value;

  const clearInput = useCallback(() => {
    setValue("");
    if (draftKey) persistenceRef.current?.clear(draftKey);
    if (draftKeyRef.current && draftKeyRef.current !== draftKey) persistenceRef.current?.clear(draftKeyRef.current);
  }, [draftKey, setValue]);

  const restoreFailedSubmission = useCallback(
    (
      snapshot: ComposerSubmissionSnapshot,
      clearedAtRevision: number,
      kind: "send" | "queue",
      reason: string | null,
    ) => {
      const action = failedComposerSubmissionAction(clearedAtRevision, inputRevisionRef.current);
      if (action === "restore") setValue(failedComposerSubmissionValue(snapshot));
      const template =
        action === "restore"
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
        canResend: action === "restore" && kind === "send",
      });
    },
    [setValue, t],
  );

  const commitCurrentDraft = useCallback(() => {
    const key = draftKeyRef.current;
    if (!key) return;
    const pendingMigration = pendingLegacyMigrationRef.current;
    if (pendingMigration?.key === key && pendingMigration.revision === inputRevisionRef.current) {
      // Keep the original v2 record restartable until every attachment has
      // either been converted or deliberately superseded by a user edit.
      return;
    }
    persistenceRef.current?.commit(key, { value: valueRef.current });
  }, []);

  useEffect(() => {
    if (!draftKey || draftKeyRef.current !== draftKey) return;
    const pendingMigration = pendingLegacyMigrationRef.current;
    if (pendingMigration?.key === draftKey && pendingMigration.revision === inputRevisionRef.current) return;
    persistenceRef.current?.schedule(draftKey, { value });
  }, [draftKey, value]);

  useEffect(() => {
    const previousKey = draftKeyRef.current;
    const previousMigration = pendingLegacyMigrationRef.current;
    if (previousKey && previousKey !== draftKey) {
      const migrationStillOwnsCurrentValue =
        previousMigration?.key === previousKey && previousMigration.revision === inputRevisionRef.current;
      if (!migrationStillOwnsCurrentValue) {
        persistenceRef.current?.commit(previousKey, { value: valueRef.current });
      }
    }
    // A cleanup/replay or key change must not replace a still-pending legacy
    // source with a text-only v3 draft. The source remains in the draft store
    // until this setup either completes migration or a newer edit takes over.
    pendingLegacyMigrationRef.current = null;
    const generation = ++migrationGenerationRef.current;
    const draft = draftKey ? getDraft(draftKey) : null;
    draftKeyRef.current = draftKey;
    setValue(draft?.value ?? "");
    const migrationRevision = inputRevisionRef.current;
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
        try {
          const result = await window.piBridge?.stageClipboardImage?.({
            base64: image.data,
            ext: extensionForImageMime(image.mimeType) ?? "",
          });
          if (result?.ok) {
            registerStagedPreviewUrl(result.staged.path, `data:${image.mimeType};base64,${image.data}`);
            nextValue = insertAttachmentToken(nextValue, null, result.staged.path).value;
          }
        } catch {
          // The migration is best effort; the notice below explains removal.
        }
        if (
          generation !== migrationGenerationRef.current ||
          draftKeyRef.current !== draftKey ||
          inputRevisionRef.current !== migrationRevision
        )
          return;
      }
      for (const file of draft.files ?? []) nextValue = insertAttachmentToken(nextValue, null, file.path).value;
      if (
        generation !== migrationGenerationRef.current ||
        draftKeyRef.current !== draftKey ||
        inputRevisionRef.current !== migrationRevision
      )
        return;
      // Mark the source converted before publishing the migrated value. The
      // value effect may schedule persistence immediately after this call, and
      // cleanup must no longer defer that durable v3 result.
      pendingLegacyMigrationRef.current = null;
      if (nextValue !== draft.value) setValue(nextValue);
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
  }, [draftKey, setValue, t]);

  useEffect(
    () => () => {
      commitCurrentDraft();
      persistenceRef.current?.dispose();
    },
    [commitCurrentDraft],
  );

  return {
    value,
    valueRef,
    draftKeyRef,
    inputRevisionRef,
    setValue,
    clearInput,
    restoreFailedSubmission,
    commitCurrentDraft,
    submissionNotice,
    setSubmissionNotice,
  };
}
