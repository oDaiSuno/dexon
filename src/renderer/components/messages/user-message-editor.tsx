import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { EnvironmentId } from "@contract/environment";
import { useFileEnvironment } from "@/lib/use-file-environment";
import { getSessionEnvironmentId } from "@/lib/environment-registry";
import { useComposerAttachments } from "../chat-input/use-composer-attachments";
import { useAtSuggestions } from "../chat-input/use-at-suggestions";
import { initialTriggerGate, nextTriggerGate, openTrigger } from "../chat-input/composer-trigger";
import { AtMenu } from "../chat-input/AtMenu";
import { ComposerBanner } from "../chat-input/StatusBanners";
import { useI18n } from "@/i18n";
import { ComposerEditable } from "../chat-input/ComposerEditable";
import { Button } from "../form-controls";
import { compositionEnterAction, type CompositionState } from "../chat-input/composition-guard";
import type { ComposerEditableHandle } from "../chat-input/types";
import type { ImageContent } from "@/lib/types";

export interface OutgoingImage {
  type: "image";
  data: string;
  mimeType: string;
}

export interface EditDraft {
  entryId: string;
  text: string;
  images: OutgoingImage[];
}

export interface EditDraftHandlers {
  environmentId?: EnvironmentId;
  supportsImages?: boolean | null;
  registerFiles?(processFiles: (files: File[]) => Promise<void>): () => void;
  start(entryId: string, text: string, imageBlocks: ImageContent[]): void;
  change(text: string): void;
  removeImage(index: number): void;
  cancel(): void;
  send(): void | Promise<void>;
}

export function flatImageOf(block: ImageContent): OutgoingImage | null {
  if (block.deferredContent) return null;
  const flat = block as unknown as { data?: unknown; mimeType?: unknown };
  if (typeof flat.data === "string" && typeof flat.mimeType === "string") {
    return { type: "image", data: flat.data, mimeType: flat.mimeType };
  }
  const source = block.source;
  if (source?.type === "base64" && typeof source.data === "string" && source.data) {
    return { type: "image", data: source.data, mimeType: source.media_type ?? "image/png" };
  }
  return null;
}

export function useMessageEdit({
  sessionId,
  environmentId,
  supportsImages,
  sendMessage,
}: {
  sessionId?: string;
  environmentId: EnvironmentId;
  supportsImages?: boolean | null;
  sendMessage: (entryId: string, text: string, images: OutgoingImage[]) => Promise<void>;
}) {
  const [editDraft, setEditDraft] = useState<EditDraft | null>(null);
  const editDraftRef = useRef<EditDraft | null>(null);
  const editFilesRef = useRef<((files: File[]) => Promise<void>) | null>(null);
  editDraftRef.current = editDraft;

  const registerEditFiles = useCallback((processFiles: (files: File[]) => Promise<void>) => {
    editFilesRef.current = processFiles;
    return () => {
      if (editFilesRef.current === processFiles) editFilesRef.current = null;
    };
  }, []);
  const cancelEdit = useCallback(() => {
    editFilesRef.current = null;
    editDraftRef.current = null;
    setEditDraft(null);
  }, []);
  const editHandlers = useMemo<EditDraftHandlers>(
    () => ({
      environmentId,
      supportsImages,
      registerFiles: registerEditFiles,
      start(entryId, text, imageBlocks) {
        const draft = {
          entryId,
          text,
          images: imageBlocks.map(flatImageOf).filter((image): image is OutgoingImage => image !== null),
        };
        editFilesRef.current = null;
        editDraftRef.current = draft;
        setEditDraft(draft);
      },
      change(text) {
        setEditDraft((current) => (current ? { ...current, text } : current));
      },
      removeImage(index) {
        setEditDraft((current) =>
          current ? { ...current, images: current.images.filter((_image, position) => position !== index) } : current,
        );
      },
      cancel: cancelEdit,
      async send() {
        const draft = editDraftRef.current;
        if (!draft) return;
        const accepted = await sendMessage(draft.entryId, draft.text, draft.images).then(
          () => true,
          () => false,
        );
        if (accepted && editDraftRef.current === draft) cancelEdit();
      },
    }),
    [cancelEdit, environmentId, registerEditFiles, sendMessage, supportsImages],
  );

  useLayoutEffect(() => {
    cancelEdit();
  }, [cancelEdit, sessionId]);

  const dropEditFiles = useCallback((files: File[]) => {
    if (!editDraftRef.current) return false;
    void editFilesRef.current?.(files);
    return true;
  }, []);
  return { editDraft, editHandlers, dropEditFiles };
}

const NO_SKILLS = new Map<string, { readonly description: string }>();

const ignoreReveal = () => undefined;

export function UserMessageEditor({
  environmentId: requestedEnvironmentId,
  sessionId,
  cwd,
  registerFiles,
  supportsImages,
  text,
  images,
  bubbleStyle,
  onChange,
  onRemoveImage,
  onCancel,
  onSend,
}: {
  environmentId?: EnvironmentId;
  sessionId?: string | null;
  cwd?: string;
  registerFiles?: EditDraftHandlers["registerFiles"];
  supportsImages?: boolean | null;
  text: string;
  images: OutgoingImage[];
  bubbleStyle: { background: string; foreground: string };
  onChange: (text: string) => void;
  onRemoveImage: (index: number) => void;
  onCancel: () => void;
  onSend: () => void | Promise<void>;
}) {
  const { t } = useI18n();
  const environmentId = useFileEnvironment(
    requestedEnvironmentId ?? (sessionId ? getSessionEnvironmentId(sessionId) : undefined),
  );
  const handleRef = useRef<ComposerEditableHandle | null>(null);
  const compositionRef = useRef<CompositionState>({ composing: false, endedAt: 0 });
  const [isPending, setIsPending] = useState(false);
  const [imageAttachNotice, setImageAttachNotice] = useState<string | null>(null);
  const attachments = useComposerAttachments({
    environmentId,
    sessionId,
    value: text,
    visible: true,
    cwd,
    supportsImages,
    editableRef: handleRef,
    t,
    onImageNotice: setImageAttachNotice,
  });
  const [gate, setGate] = useState(initialTriggerGate);
  const trigger = openTrigger(gate, true);
  const suggestions = useAtSuggestions({
    cwd,
    atTrigger: trigger?.kind === "at" ? trigger : null,
    editableRef: handleRef,
    onDismiss: () => setGate((current) => nextTriggerGate(current, { type: "dismissed" }, Boolean(cwd))),
  });
  const canSend = !isPending && !attachments.isProcessingImages && (text.trim() !== "" || images.length > 0);

  useEffect(() => {
    handleRef.current?.focus();
  }, []);

  useEffect(() => registerFiles?.(attachments.processFiles), [attachments.processFiles, registerFiles]);

  const submit = async () => {
    if (!canSend) return;
    setIsPending(true);
    try {
      await onSend();
    } finally {
      setIsPending(false);
    }
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 6, maxWidth: "68ch", width: "100%" }}>
      {imageAttachNotice && (
        <ComposerBanner
          tone="error"
          message={imageAttachNotice}
          onDismiss={() => setImageAttachNotice(null)}
          dismissLabel={t("dismissImageAttachError", "Dismiss image attachment error")}
        />
      )}
      <div
        className="chat-reading type-chat-body"
        style={{
          position: "relative",
          minWidth: 0,
          maxWidth: "100%",
          background: bubbleStyle.background,
          border: "1px solid var(--fx-line-default)",
          borderRadius: "var(--radius-composer)",
          padding: "var(--space-3) var(--space-4)",
          color: bubbleStyle.foreground,
          wordBreak: "break-word",
        }}
      >
        {suggestions.atMenuOpen && suggestions.atQuery && (
          <AtMenu
            placement="below"
            suggestionState={suggestions.activeSuggestionState}
            matches={suggestions.atMatches}
            activeIndex={suggestions.atActiveIndex}
            itemRefs={suggestions.atItemRefs}
            onApply={suggestions.applyAtCompletion}
            onHover={suggestions.setAtActiveIndex}
          />
        )}
        {images.length > 0 && (
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: text.trim() ? 8 : 0 }}>
            {images.map((image, index) => (
              <div key={`${image.mimeType}-${index}`} style={{ position: "relative" }}>
                <img
                  src={`data:${image.mimeType};base64,${image.data}`}
                  alt=""
                  style={{
                    maxWidth: 160,
                    maxHeight: 160,
                    borderRadius: "var(--radius-control)",
                    objectFit: "contain",
                    display: "block",
                    border: "1px solid var(--fx-line-translucent)",
                  }}
                />
                <button
                  type="button"
                  className="type-meta-default"
                  aria-label={t("removeImage", "Remove image")}
                  title={t("removeImage", "Remove image")}
                  onClick={() => onRemoveImage(index)}
                  style={{
                    position: "absolute",
                    top: 2,
                    right: 2,
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    width: 18,
                    height: 18,
                    background: "var(--fx-surface-raised)",
                    border: "1px solid var(--fx-line-default)",
                    borderRadius: "50%",
                    color: "var(--fx-text-secondary)",
                    cursor: "pointer",
                  }}
                >
                  ×
                </button>
              </div>
            ))}
          </div>
        )}
        <ComposerEditable
          value={text}
          handleRef={handleRef}
          ariaLabel={t("editMessageField", "Edit message")}
          placeholder=""
          onChange={(change) => {
            setGate((current) => nextTriggerGate(current, { type: "changed", change }, Boolean(cwd)));
            if (change.cause === "edit") onChange(change.snapshot.text);
          }}
          onKeyDown={(event) => {
            if (event.key === "Enter" && !event.shiftKey) {
              const action = compositionEnterAction(event.nativeEvent, compositionRef.current, Date.now());
              if (action !== "send") {
                if (action === "prevent") event.preventDefault();
                return;
              }
            }
            if (
              compositionRef.current.composing ||
              event.nativeEvent.isComposing === true ||
              event.nativeEvent.keyCode === 229
            )
              return;
            if (suggestions.handleMenuKey(event)) return;
            if (event.key === "Enter" && !event.shiftKey) {
              event.preventDefault();
              void submit();
              return;
            }
            if (event.key === "Escape") {
              event.preventDefault();
              onCancel();
            }
          }}
          onPaste={attachments.handlePaste}
          onCompositionStart={() => {
            compositionRef.current.composing = true;
          }}
          onCompositionEnd={() => {
            compositionRef.current.composing = false;
            compositionRef.current.endedAt = Date.now();
          }}
          previewsByPath={attachments.tokenPreviewsByPath}
          missingByPath={attachments.missingTokenInspections}
          onRevealToken={attachments.revealToken}
          onSkillReveal={ignoreReveal}
          removeLabel={t("remove", "Remove")}
          skillsByName={NO_SKILLS}
          skillRemoveLabel={t("removeSkill", "Remove skill")}
        />
      </div>
      <div style={{ display: "flex", justifyContent: "flex-end", gap: "var(--space-2)" }}>
        <Button onClick={onCancel}>{t("cancel", "Cancel")}</Button>
        <Button variant="primary" onClick={submit} disabled={!canSend}>
          {t("send", "Send")}
        </Button>
      </div>
    </div>
  );
}
