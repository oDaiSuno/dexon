import { useEffect, useRef } from "react";
import { scaledChatFont } from "@/lib/chat-appearance";
import { useI18n } from "@/i18n";
import { ComposerEditable } from "../chat-input/ComposerEditable";
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
  start(entryId: string, text: string, imageBlocks: ImageContent[]): void;
  change(text: string): void;
  removeImage(index: number): void;
  cancel(): void;
  send(): void;
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

const NO_PREVIEWS = new Map<string, string | null>();
const NO_MISSING = new Map<string, boolean>();
const NO_SKILL_DESCRIPTIONS = new Map<string, string>();
const ignoreSelection = () => undefined;

const ignoreReveal = () => undefined;

export function UserMessageEditor({
  text,
  images,
  bubbleStyle,
  onChange,
  onRemoveImage,
  onCancel,
  onSend,
}: {
  text: string;
  images: OutgoingImage[];
  bubbleStyle: { background: string; foreground: string };
  onChange: (text: string) => void;
  onRemoveImage: (index: number) => void;
  onCancel: () => void;
  onSend: () => void;
}) {
  const { t } = useI18n();
  const handleRef = useRef<ComposerEditableHandle | null>(null);
  const compositionRef = useRef<CompositionState>({ composing: false, endedAt: 0 });
  const canSend = text.trim() !== "" || images.length > 0;

  useEffect(() => {
    handleRef.current?.focus();
  }, []);

  const submit = () => {
    if (!canSend) return;
    onSend();
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 6, maxWidth: "68ch", width: "100%" }}>
      <div
        style={{
          minWidth: 0,
          maxWidth: "100%",
          background: bubbleStyle.background,
          borderRadius: "12px 12px 4px 12px",
          padding: "8px 13px",
          fontSize: scaledChatFont(13),
          lineHeight: 1.55,
          color: bubbleStyle.foreground,
          wordBreak: "break-word",
          boxShadow: "var(--bui-shadow-btn)",
        }}
      >
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
                    border: `1px solid color-mix(in srgb, ${bubbleStyle.foreground} 18%, transparent)`,
                  }}
                />
                <button
                  type="button"
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
                    background: "var(--bui-surface)",
                    border: "1px solid color-mix(in srgb, currentColor 22%, transparent)",
                    borderRadius: "50%",
                    color: "var(--bui-ink-2)",
                    cursor: "pointer",
                    fontSize: 11,
                    lineHeight: 1,
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
          onValueChange={onChange}
          onSelectionChange={ignoreSelection}
          onKeyDown={(event) => {
            if (event.key === "Enter" && !event.shiftKey) {
              const action = compositionEnterAction(event.nativeEvent, compositionRef.current, Date.now());
              if (action !== "send") {
                if (action === "prevent") event.preventDefault();
                return;
              }
              event.preventDefault();
              submit();
              return;
            }
            if (event.key === "Escape") {
              event.preventDefault();
              onCancel();
            }
          }}
          onPaste={(event) => {
            const pasted = event.clipboardData?.getData("text/plain") ?? "";
            if (!pasted) return;
            event.preventDefault();
            handleRef.current?.pasteTextAtCaret(pasted);
          }}
          onCompositionStart={() => {
            compositionRef.current.composing = true;
          }}
          onCompositionEnd={() => {
            compositionRef.current.composing = false;
            compositionRef.current.endedAt = Date.now();
          }}
          previewsByPath={NO_PREVIEWS}
          missingByPath={NO_MISSING}
          onRevealToken={ignoreReveal}
          onSkillReveal={ignoreReveal}
          removeLabel={t("remove", "Remove")}
          skillDescriptions={NO_SKILL_DESCRIPTIONS}
          skillRemoveLabel={t("removeSkill", "Remove skill")}
        />
      </div>
      <div style={{ display: "flex", justifyContent: "flex-end", gap: 6 }}>
        <button
          type="button"
          onClick={onCancel}
          style={{
            padding: "3px 10px",
            height: 26,
            background: "none",
            border: "1px solid var(--border)",
            borderRadius: "var(--bui-r-chip)",
            color: "var(--bui-ink-2)",
            cursor: "pointer",
            fontSize: scaledChatFont(12),
          }}
        >
          {t("cancel", "Cancel")}
        </button>
        <button
          type="button"
          onClick={submit}
          disabled={!canSend}
          style={{
            padding: "3px 10px",
            height: 26,
            background: canSend ? "var(--accent)" : "var(--border)",
            border: "none",
            borderRadius: "var(--bui-r-chip)",
            color: canSend ? "#fff" : "var(--bui-ink-3)",
            cursor: canSend ? "pointer" : "not-allowed",
            fontSize: scaledChatFont(12),
          }}
        >
          {t("send", "Send")}
        </button>
      </div>
    </div>
  );
}
