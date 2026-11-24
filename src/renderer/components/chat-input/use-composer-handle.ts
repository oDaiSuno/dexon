import { useImperativeHandle, type Ref, type RefObject } from "react";
import { toSkillName } from "./command-slot";
import type { ChatInputHandle, ComposerEditableHandle } from "./types";
import type { useComposerAttachments } from "./use-composer-attachments";
import type { useComposerDraft } from "./use-composer-draft";
import type { useComposerSuggestions } from "./use-composer-suggestions";

export function useComposerHandle(
  ref: Ref<ChatInputHandle>,
  {
    editableRef,
    draft,
    suggestions,
    attachments,
    visible,
  }: {
    editableRef: RefObject<ComposerEditableHandle | null>;
    draft: ReturnType<typeof useComposerDraft>;
    suggestions: ReturnType<typeof useComposerSuggestions>;
    attachments: ReturnType<typeof useComposerAttachments>;
    visible: boolean;
  },
) {
  useImperativeHandle(
    ref,
    () => ({
      focus() {
        if (visible) editableRef.current?.focus();
      },
      prependText(text: string) {
        if (!text.trim()) return;
        const current = editableRef.current?.getValue() ?? draft.shown;
        const combined = [text, current].filter((item) => item.trim()).join("\n\n");
        if (visible) editableRef.current?.focus();
        editableRef.current?.replaceAll(combined);
        suggestions.dismiss();
      },
      takeDraft() {
        const text = draft.takeDraft();
        suggestions.dismiss();
        return text;
      },
      insertQuoteAtCaret(quote) {
        editableRef.current?.insertQuoteAtCaret(quote);
        suggestions.dismiss();
      },
      insertText(text: string) {
        editableRef.current?.insertTextAtCaret(text);
        suggestions.dismiss();
      },
      addFiles(files: File[]) {
        void attachments.processFiles(files);
      },
      insertToken(path: string) {
        attachments.insertAttachmentPath(path);
      },
      insertSkill(raw: string) {
        const name = toSkillName(raw);
        if (!name) return;
        if (visible) editableRef.current?.focus();
        editableRef.current?.fillCommandSlot({ kind: "skill", name });
      },
    }),
    [attachments, draft, editableRef, suggestions, visible],
  );
}
