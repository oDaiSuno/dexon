import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useIsMobile } from "@/hooks/useIsMobile";
import { useI18n } from "@/i18n";
import { captureComposerSubmission, type ComposerSubmissionSnapshot } from "@/lib/composer-submission";
import { ComposerView } from "./chat-input/composer-view";
import { compareModelOptions, type ModelOption } from "./chat-input/ModelPicker";
import { useComposerAttachments } from "./chat-input/use-composer-attachments";
import { useComposerControls } from "./chat-input/use-composer-controls";
import { useComposerDraft } from "./chat-input/use-composer-draft";
import { useComposerSkills } from "./chat-input/use-composer-skills";
import { useComposerSuggestions } from "./chat-input/use-composer-suggestions";
import type { ChatInputHandle, ChatInputProps, ComposerEditableHandle } from "./chat-input/types";

export type { ChatInputHandle } from "./chat-input/types";
export type { ChatInputProps as Props } from "./chat-input/types";

export const ChatInput = forwardRef<ChatInputHandle, ChatInputProps>(function ChatInput(
  {
    onSend,
    onAbort,
    onSteer,
    onFollowUp,
    isStreaming,
    model,
    isAutoModelSelection,
    modelNames,
    modelList,
    modelCatalog,
    modelRefreshing,
    onModelChange,
    onModelsRefresh,
    onModelsRefreshCancel,
    onCompact,
    onAbortCompaction,
    isCompacting,
    compactError,
    compactResult,
    contextUsage,
    thinkingLevel,
    onThinkingLevelChange,
    availableThinkingLevels,
    thinkingLevelMap,
    queuedMessages,
    onRecallQueue,
    slashCommands,
    slashCommandsLoading,
    onLoadSlashCommands,
    onBuiltinCommand,
    soundEnabled,
    onSoundToggle,
    onAudioUnlock,
    onPromptWithStreamingBehavior,
    draftKey,
    cwd,
    visible = true,
  },
  ref,
) {
  const isMobile = useIsMobile(visible);
  const { t } = useI18n();
  const editableRef = useRef<ComposerEditableHandle | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const inputRootRef = useRef<HTMLDivElement>(null);
  const clearAtQueryRef = useRef<() => void>(() => {});
  const [imageAttachNotice, setImageAttachNotice] = useState<string | null>(null);

  const draft = useComposerDraft({
    draftKey,
    t,
    onImageNotice: setImageAttachNotice,
  });
  const {
    value: draftValue,
    valueRef: draftValueRef,
    inputRevisionRef,
    setValue,
    clearInput,
    restoreFailedSubmission: restoreDraft,
    commitCurrentDraft,
    submissionNotice,
    setSubmissionNotice,
  } = draft;
  const skills = useComposerSkills({ cwd, visible, editableRef });
  const { closePlusMenu, closeTransientMenus } = skills;
  const attachments = useComposerAttachments({
    value: draftValue,
    visible,
    cwd,
    model,
    modelList,
    editableRef,
    t,
    onImageNotice: setImageAttachNotice,
  });

  const clearCurrentInput = useCallback(() => {
    clearInput();
    clearAtQueryRef.current();
  }, [clearInput]);
  const handleAbort = useCallback(() => {
    if (visible) onAbort();
  }, [onAbort, visible]);
  const handleRecallQueue = useCallback(() => {
    if (visible) onRecallQueue?.();
  }, [onRecallQueue, visible]);

  const restoreFailedSubmission = useCallback(
    (snapshot: ComposerSubmissionSnapshot, clearedAtRevision: number, kind: "send" | "queue") => {
      restoreDraft(snapshot, clearedAtRevision, kind);
    },
    [restoreDraft],
  );

  const handleSend = useCallback(async () => {
    if (!visible) return;
    const message = draftValue.trim();
    if (!message || isStreaming) return;
    onAudioUnlock?.();
    const snapshot = captureComposerSubmission(draftValue);
    setSubmissionNotice(null);
    commitCurrentDraft();
    clearCurrentInput();
    const clearedAtRevision = inputRevisionRef.current;
    try {
      if (!attachments.attachmentTokens.length && message.startsWith("/") && onBuiltinCommand) {
        const result = await onBuiltinCommand(message);
        if (result.handled) {
          if (result.error) restoreFailedSubmission(snapshot, clearedAtRevision, "send");
          return;
        }
      }
      const result = onSend(message) as void | Promise<unknown> | { ok?: boolean };
      const settled = await Promise.resolve(result);
      if (settled && typeof settled === "object" && "ok" in settled && settled.ok === false) {
        restoreFailedSubmission(snapshot, clearedAtRevision, "send");
      }
    } catch {
      restoreFailedSubmission(snapshot, clearedAtRevision, "send");
    }
  }, [
    attachments.attachmentTokens.length,
    visible,
    clearCurrentInput,
    commitCurrentDraft,
    draftValue,
    inputRevisionRef,
    isStreaming,
    onAudioUnlock,
    onBuiltinCommand,
    onSend,
    restoreFailedSubmission,
    setSubmissionNotice,
  ]);

  const sendQueued = useCallback(
    async (mode: "steer" | "followup") => {
      if (!visible) return;
      const message = draftValue.trim();
      if (!message) return;
      onAudioUnlock?.();
      const snapshot = captureComposerSubmission(draftValue);
      const behavior = mode === "steer" ? "steer" : "followUp";
      setSubmissionNotice(null);
      commitCurrentDraft();
      clearCurrentInput();
      const clearedAtRevision = inputRevisionRef.current;
      try {
        if (message.startsWith("/") && onPromptWithStreamingBehavior) {
          await Promise.resolve(onPromptWithStreamingBehavior(message, behavior));
          return;
        }
        if (mode === "steer" && onSteer) await Promise.resolve(onSteer(message));
        else if (mode === "followup" && onFollowUp) await Promise.resolve(onFollowUp(message));
      } catch {
        restoreFailedSubmission(snapshot, clearedAtRevision, "queue");
      }
    },
    [
      clearCurrentInput,
      commitCurrentDraft,
      visible,
      draftValue,
      inputRevisionRef,
      onAudioUnlock,
      onFollowUp,
      onPromptWithStreamingBehavior,
      onSteer,
      restoreFailedSubmission,
      setSubmissionNotice,
    ],
  );

  const suggestions = useComposerSuggestions({
    value: draftValue,
    cwd,
    isStreaming,
    visible,
    slashCommands,
    slashCommandsLoading,
    onLoadSlashCommands,
    onFollowUp,
    handleSend,
    sendQueued,
    editableRef,
    onAtEscape: closeTransientMenus,
  });
  clearAtQueryRef.current = suggestions.clearAtQuery;
  const clearAtQueryOnKeyChange = suggestions.clearAtQuery;
  const closeMenusOnKeyChange = suggestions.closeMenus;

  useEffect(() => {
    clearAtQueryOnKeyChange();
    closeMenusOnKeyChange();
  }, [clearAtQueryOnKeyChange, closeMenusOnKeyChange, draftKey]);

  const controls = useComposerControls({
    visible,
    isMobile,
    isStreaming,
    modelRefreshing,
    onModelsRefreshCancel,
  });
  const {
    setModelDropdownOpen,
    modelDropdownOpen,
    modelDropdownRect,
    dropdownRef,
    modelButtonRef,
    modelDropdownPanelRef,
    thinkingDropdownOpen,
    thinkingDropdownRef,
    thinkingButtonRef,
    closeControlDropdowns,
    toggleModelDropdown,
    toggleThinkingDropdown,
  } = controls;

  useLayoutEffect(() => {
    if (visible) return;
    commitCurrentDraft();
    const active = document.activeElement;
    if (active instanceof HTMLElement && inputRootRef.current?.contains(active)) active.blur();
  }, [commitCurrentDraft, visible]);
  const modelOptions = useMemo<ModelOption[]>(() => {
    if (modelList && modelList.length > 0) {
      return modelList
        .map((entry) => ({ provider: entry.provider, modelId: entry.id, name: entry.name }))
        .sort(compareModelOptions);
    }
    return Object.entries(modelNames ?? {})
      .map(([modelId, name]) => ({ provider: model?.provider ?? "unknown", modelId, name }))
      .sort(compareModelOptions);
  }, [model, modelList, modelNames]);

  const modelOptionsByProvider = useMemo(() => {
    const groups: { provider: string; options: ModelOption[] }[] = [];
    for (const option of modelOptions) {
      const group = groups.find((candidate) => candidate.provider === option.provider);
      if (group) group.options.push(option);
      else groups.push({ provider: option.provider, options: [option] });
    }
    return groups;
  }, [modelOptions]);

  const currentModelName = model
    ? (modelOptions.find((option) => option.modelId === model.modelId && option.provider === model.provider)?.name ??
      model.modelId)
    : null;

  const skillDescriptions = useMemo(
    () => new Map(skills.skillsState.skills.map((skill) => [skill.name, skill.description ?? ""])),
    [skills.skillsState.skills],
  );

  const handleValueChange = useCallback(
    (nextValue: string) => {
      setValue(nextValue);
      closePlusMenu();
    },
    [closePlusMenu, setValue],
  );

  const openPicker = useCallback(() => {
    if (!visible) return;
    closePlusMenu();
    const input = fileInputRef.current;
    if (!input) return;
    input.removeAttribute("accept");
    input.click();
  }, [closePlusMenu, visible]);
  const handleModelPick = useCallback(
    (provider: string, modelId: string, isActive: boolean) => {
      if (!visible) return;
      setModelDropdownOpen(false);
      if (!isActive || isAutoModelSelection) onModelChange?.(provider, modelId);
    },
    [isAutoModelSelection, onModelChange, setModelDropdownOpen, visible],
  );

  useImperativeHandle(
    ref,
    () => ({
      prependText(text: string) {
        if (!text.trim()) return;
        const combined = [text, draftValueRef.current].filter((item) => item.trim()).join("\n\n");
        if (visible) editableRef.current?.focus();
        editableRef.current?.replaceAll(combined);
        suggestions.clearAtQuery();
      },
      insertText(text: string) {
        editableRef.current?.insertTextAtCaret(text);
        suggestions.clearAtQuery();
      },
      addFiles(files: File[]) {
        void attachments.processFiles(files);
      },
      insertToken(path: string) {
        attachments.insertAttachmentPath(path);
      },
      insertSkill(name: string) {
        if (visible) editableRef.current?.focus();
        editableRef.current?.insertSkillAtStart(name);
      },
    }),
    [attachments, draftValueRef, suggestions, visible],
  );

  return (
    <ComposerView
      rootRef={inputRootRef}
      visible={visible}
      isMobile={isMobile}
      isStreaming={isStreaming}
      hasSteering={Boolean(onSteer)}
      onFollowUp={onFollowUp}
      value={draftValue}
      editableRef={editableRef}
      fileInputRef={fileInputRef}
      processFiles={attachments.processFiles}
      onSend={() => void handleSend()}
      onAbort={handleAbort}
      onQueue={() => void sendQueued("followup")}
      onValueChange={handleValueChange}
      onSelectionChange={suggestions.updateAtQuery}
      onKeyDown={suggestions.handleKeyDown}
      onPaste={attachments.handlePaste}
      onCompositionStart={suggestions.onCompositionStart}
      onCompositionEnd={suggestions.onCompositionEnd}
      tokenPreviewsByPath={attachments.tokenPreviewsByPath}
      missingTokenInspections={attachments.missingTokenInspections}
      onRevealToken={(path) => void window.piBridge?.showItemInFolder?.(path)}
      onSkillReveal={skills.revealSkill}
      skillDescriptions={skillDescriptions}
      attachmentTokens={attachments.attachmentTokens}
      onOpenPicker={openPicker}
      plusMenuOpen={skills.plusMenuOpen}
      onTogglePlusMenu={skills.openPlusMenu}
      onOpenSkillPicker={skills.openSkillPicker}
      skills={skills.skillsState.skills}
      skillsLoading={skills.skillsState.loading}
      skillsError={skills.skillsState.error}
      onPickSkill={skills.pickSkill}
      skillPickerOpen={skills.skillPickerOpen}
      skillRevealName={skills.skillRevealName}
      skillRecordsRef={skills.skillRecordsRef}
      onCloseSkillPicker={skills.closeTransientMenus}
      onCloseSkillReveal={() => skills.setSkillRevealName(null)}
      slashMenuOpen={suggestions.slashMenuOpen}
      slashGroups={suggestions.groupedSlashCommands}
      slashLoading={suggestions.slashCommandsLoading}
      slashCountLabel={suggestions.slashCommandCountLabel}
      slashActiveIndex={suggestions.slashActiveIndex}
      slashItemRefs={suggestions.slashItemRefs}
      onApplySlash={suggestions.applySlashCommand}
      onHoverSlash={suggestions.setSlashActiveIndex}
      atMenuOpen={suggestions.atMenuOpen}
      atQuery={suggestions.atQuery}
      atSuggestionState={suggestions.activeSuggestionState}
      atMatches={suggestions.atMatches}
      atActiveIndex={suggestions.atActiveIndex}
      atItemRefs={suggestions.atItemRefs}
      onApplyAt={suggestions.applyAtCompletion}
      onHoverAt={suggestions.setAtActiveIndex}
      imageAttachNotice={imageAttachNotice}
      onDismissImageNotice={() => setImageAttachNotice(null)}
      submissionNotice={submissionNotice}
      onDismissSubmissionNotice={() => setSubmissionNotice(null)}
      queuedMessages={queuedMessages}
      onRecallQueue={onRecallQueue ? handleRecallQueue : undefined}
      compactResult={compactResult}
      model={model}
      modelOptionsByProvider={modelOptionsByProvider}
      currentModelName={currentModelName}
      modelCatalog={modelCatalog}
      modelRefreshing={modelRefreshing}
      modelDropdownOpen={modelDropdownOpen}
      onToggleModelDropdown={toggleModelDropdown}
      modelButtonRef={modelButtonRef}
      modelContainerRef={dropdownRef}
      modelPanelRef={modelDropdownPanelRef}
      modelDropdownRect={modelDropdownRect}
      onModelChange={onModelChange}
      onModelsRefresh={onModelsRefresh}
      onModelPick={handleModelPick}
      isAutoModelSelection={isAutoModelSelection}
      onCompact={onCompact}
      onAbortCompaction={onAbortCompaction}
      isCompacting={isCompacting}
      compactError={compactError}
      contextUsage={contextUsage}
      thinkingLevel={thinkingLevel}
      onThinkingLevelChange={onThinkingLevelChange}
      availableThinkingLevels={availableThinkingLevels}
      thinkingLevelMap={thinkingLevelMap}
      thinkingDropdownOpen={thinkingDropdownOpen}
      onToggleThinkingDropdown={toggleThinkingDropdown}
      thinkingContainerRef={thinkingDropdownRef}
      thinkingButtonRef={thinkingButtonRef}
      closeControlDropdowns={closeControlDropdowns}
      soundEnabled={soundEnabled}
      onSoundToggle={onSoundToggle}
    />
  );
});
