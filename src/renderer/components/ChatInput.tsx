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
import { sessionClientErrorMessage } from "@/lib/session-error-message";
import { ComposerView } from "./chat-input/composer-view";
import { groupModelOptions, type ModelOption } from "./chat-input/model-catalog";
import { buildPromptHistory, localCommandsFor, recordLocalCommand } from "./chat-input/prompt-history";
import { useComposerAttachments } from "./chat-input/use-composer-attachments";
import { useComposerControls } from "./chat-input/use-composer-controls";
import { useComposerDraft } from "./chat-input/use-composer-draft";
import { useComposerKeys } from "./chat-input/use-composer-keys";
import { useComposerSkills } from "./chat-input/use-composer-skills";
import { toSkillName } from "./chat-input/command-slot";
import { useComposerSuggestions } from "./chat-input/use-composer-suggestions";
import type { ChatInputHandle, ChatInputProps, ComposerChange, ComposerEditableHandle } from "./chat-input/types";

export type { ChatInputHandle } from "./chat-input/types";
export type { ChatInputProps as Props } from "./chat-input/types";

function supportsReasoning(levels?: string[]): boolean {
  return levels?.some((level) => level !== "off") ?? false;
}

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
    modelThinkingLevels,
    modelCatalog,
    modelRefreshing,
    onModelChange,
    onModelsRefresh,
    onModelsRefreshCancel,
    onOpenUsage,
    isCompacting,
    compactError,
    compactResult,
    onDismissCompactResult,
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
    promptHistory,
    draftKey,
    cwd,
    visible = true,
    remote,
    navigation,
    workspace,
  },
  ref,
) {
  const isMobile = useIsMobile(visible);
  const { t } = useI18n();
  const editableRef = useRef<ComposerEditableHandle | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const inputRootRef = useRef<HTMLDivElement>(null);
  const [imageAttachNotice, setImageAttachNotice] = useState<string | null>(null);

  const draft = useComposerDraft({
    draftKey,
    t,
    onImageNotice: setImageAttachNotice,
  });
  const { commit, returnToDraft } = draft;
  const skills = useComposerSkills({ cwd, visible, editableRef });
  const { closePlusMenu, closeTransientMenus } = skills;
  const attachments = useComposerAttachments({
    value: draft.shown,
    visible,
    cwd,
    model,
    modelList,
    editableRef,
    t,
    onImageNotice: setImageAttachNotice,
  });

  const handleAbort = useCallback(() => {
    if (visible) onAbort();
  }, [onAbort, visible]);
  const handleRecallQueue = useCallback(() => {
    if (visible) onRecallQueue?.();
  }, [onRecallQueue, visible]);

  const handleSend = useCallback(async () => {
    if (!visible || isStreaming) return;
    const ticket = draft.submit();
    if (!ticket) return;
    onAudioUnlock?.();
    try {
      if (!attachments.attachmentTokens.length && ticket.message.startsWith("/") && onBuiltinCommand) {
        const result = await onBuiltinCommand(ticket.message);
        if (result.handled) {
          if (ticket.scopeKey) recordLocalCommand(ticket.scopeKey, ticket.message, Date.now());
          if (result.error) draft.restoreFailed(ticket, "send", result.error);
          return;
        }
      }
      const settled = await Promise.resolve(onSend(ticket.message));
      if (settled && typeof settled === "object" && "ok" in settled && settled.ok === false) {
        draft.restoreFailed(ticket, "send", null);
      }
    } catch (error) {
      draft.restoreFailed(ticket, "send", typeof error === "string" ? error : sessionClientErrorMessage(error, t, ""));
    }
  }, [attachments.attachmentTokens.length, draft, isStreaming, onAudioUnlock, onBuiltinCommand, onSend, t, visible]);

  const sendQueued = useCallback(
    async (mode: "steer" | "followup") => {
      if (!visible) return;
      const ticket = draft.submit();
      if (!ticket) return;
      const message = ticket.message;
      onAudioUnlock?.();
      const behavior = mode === "steer" ? "steer" : "followUp";
      try {
        if (message.startsWith("/") && onPromptWithStreamingBehavior) {
          await Promise.resolve(onPromptWithStreamingBehavior(message, behavior));
          return;
        }
        if (mode === "steer" && onSteer) await Promise.resolve(onSteer(message));
        else if (mode === "followup" && onFollowUp) await Promise.resolve(onFollowUp(message));
      } catch (error) {
        draft.restoreFailed(
          ticket,
          "queue",
          typeof error === "string" ? error : sessionClientErrorMessage(error, t, ""),
        );
      }
    },
    [draft, visible, onAudioUnlock, onFollowUp, onPromptWithStreamingBehavior, onSteer, t],
  );

  const suggestions = useComposerSuggestions({
    cwd,
    isStreaming,
    visible,
    slashCommands,
    slashCommandsLoading,
    onLoadSlashCommands,
    editableRef,
    onAtEscape: closeTransientMenus,
  });
  const { dismiss: dismissSuggestions, observe: observeComposerChange } = suggestions;

  useEffect(() => {
    dismissSuggestions();
  }, [dismissSuggestions, draftKey]);

  const historySource = useCallback(
    () => buildPromptHistory(promptHistory ?? [], draftKey ? localCommandsFor(draftKey) : []),
    [draftKey, promptHistory],
  );
  const keys = useComposerKeys({
    menus: {
      handleMenuKey(event) {
        if (
          event.key === "Escape" &&
          (skills.plusMenuOpen || skills.skillPickerOpen || skills.remotePanelOpen || skills.skillRevealName)
        ) {
          event.preventDefault();
          closeTransientMenus();
          return true;
        }
        return suggestions.handleMenuKey(event);
      },
    },
    recall: {
      recalling: draft.recalling,
      browse: (direction) => draft.browse(direction, historySource),
      returnToDraft,
    },
    editableRef,
    onEnter: () => {
      if (isStreaming) {
        if (onFollowUp) void sendQueued("followup");
      } else {
        void handleSend();
      }
    },
  });

  const handleComposerChange = useCallback(
    (change: ComposerChange) => {
      if (change.cause === "edit") {
        draft.edit(change.snapshot.text);
        closePlusMenu();
      }
      observeComposerChange(change);
    },
    [closePlusMenu, draft, observeComposerChange],
  );

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
    returnToDraft();
    commit();
    const active = document.activeElement;
    if (active instanceof HTMLElement && inputRootRef.current?.contains(active)) active.blur();
  }, [commit, returnToDraft, visible]);
  const modelOptions = useMemo<ModelOption[]>(() => {
    if (modelList && modelList.length > 0) {
      return modelList.map((entry) => ({
        provider: entry.provider,
        modelId: entry.id,
        name: entry.name,
        image: entry.input?.includes("image") ?? false,
        reasoning: supportsReasoning(modelThinkingLevels?.[`${entry.provider}:${entry.id}`]),
      }));
    }
    return Object.entries(modelNames ?? {}).map(([modelId, name]) => ({
      provider: model?.provider ?? "unknown",
      modelId,
      name,
      image: false,
      reasoning: supportsReasoning(modelThinkingLevels?.[`${model?.provider ?? "unknown"}:${modelId}`]),
    }));
  }, [model, modelList, modelNames, modelThinkingLevels]);

  const modelOptionsByProvider = useMemo(() => groupModelOptions(modelOptions), [modelOptions]);

  const currentModelName = model
    ? (modelOptions.find((option) => option.modelId === model.modelId && option.provider === model.provider)?.name ??
      model.modelId)
    : null;

  const skillDescriptions = useMemo(
    () => new Map(skills.skillsState.skills.map((skill) => [skill.name, skill.description ?? ""])),
    [skills.skillsState.skills],
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

  const closeModelDropdown = useCallback(() => setModelDropdownOpen(false), [setModelDropdownOpen]);

  const openModelSettings = navigation?.openModelSettings;
  const handleManageModels = useMemo(
    () =>
      openModelSettings
        ? () => {
            setModelDropdownOpen(false);
            openModelSettings();
          }
        : undefined,
    [openModelSettings, setModelDropdownOpen],
  );

  useImperativeHandle(
    ref,
    () => ({
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
    [attachments, draft, suggestions, visible],
  );

  return (
    <ComposerView
      rootRef={inputRootRef}
      visible={visible}
      isMobile={isMobile}
      isStreaming={isStreaming}
      hasSteering={Boolean(onSteer)}
      onFollowUp={onFollowUp}
      value={draft.shown}
      restoreCaret={draft.restoreCaret}
      editableRef={editableRef}
      fileInputRef={fileInputRef}
      processFiles={attachments.processFiles}
      onSend={() => void handleSend()}
      onAbort={handleAbort}
      onQueue={() => void sendQueued("followup")}
      onChange={handleComposerChange}
      onKeyDown={keys.onKeyDown}
      onPaste={attachments.handlePaste}
      onCompositionStart={keys.onCompositionStart}
      onCompositionEnd={keys.onCompositionEnd}
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
      remotePanelOpen={skills.remotePanelOpen}
      onOpenRemotePanel={skills.openRemotePanel}
      onBackToPlusMenu={skills.backToPlusMenu}
      onCloseMenus={skills.closeTransientMenus}
      remote={remote}
      navigation={navigation}
      skills={skills.skillsState.skills}
      skillsLoading={skills.skillsState.loading}
      skillsError={skills.skillsState.error}
      onPickSkill={skills.pickSkill}
      onRetrySkills={skills.loadSkills}
      skillPickerOpen={skills.skillPickerOpen}
      skillRevealName={skills.skillRevealName}
      skillRecordsRef={skills.skillRecordsRef}
      onCloseSkillPicker={skills.closeTransientMenus}
      onCloseSkillReveal={() => skills.setSkillRevealName(null)}
      slashMenuOpen={suggestions.slashMenuOpen}
      slashCommands={suggestions.filteredSlashCommands}
      slashQuery={suggestions.slashQuery ?? ""}
      slashLoading={suggestions.slashCommandsLoading}
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
      submissionNotice={draft.submissionNotice}
      onDismissSubmissionNotice={draft.dismissSubmissionNotice}
      onResendSubmission={() => void handleSend()}
      queuedMessages={queuedMessages}
      onRecallQueue={onRecallQueue ? handleRecallQueue : undefined}
      compactResult={compactResult}
      onDismissCompactResult={() => onDismissCompactResult?.()}
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
      onCloseModelDropdown={closeModelDropdown}
      onManageModels={handleManageModels}
      isAutoModelSelection={isAutoModelSelection}
      onOpenUsage={onOpenUsage}
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
      workspace={workspace}
    />
  );
});
