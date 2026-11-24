import { forwardRef, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useIsMobile } from "@/hooks/useIsMobile";
import { useI18n } from "@/i18n";
import { useActiveEnvironment, useEnvironments } from "@/lib/environment-registry";
import { environmentAffordances } from "@/lib/environment-affordances";
import { useSendGate } from "@/lib/space-attribution";
import { sessionClientErrorMessage } from "@/lib/session-error-message";
import { modelSupportsImages } from "@/lib/model-selection";
import { ComposerView } from "./chat-input/composer-view";
import { Button } from "./form-controls";
import { groupModelOptions, type ModelOption } from "./chat-input/model-catalog";
import { buildPromptHistory, localCommandsFor, recordLocalCommand } from "./chat-input/prompt-history";
import { useComposerAttachments } from "./chat-input/use-composer-attachments";
import { useComposerControls } from "./chat-input/use-composer-controls";
import { useComposerDraft } from "./chat-input/use-composer-draft";
import { useComposerKeys } from "./chat-input/use-composer-keys";
import { useComposerSkills } from "./chat-input/use-composer-skills";
import { useSkillCatalog } from "./chat-input/use-skill-catalog";
import { useComposerHandle } from "./chat-input/use-composer-handle";
import { serializeComposerQuotesForSend } from "@shared/quote-tokens";
import { useComposerSuggestions } from "./chat-input/use-composer-suggestions";
import type { ChatInputHandle, ChatInputProps, ComposerChange, ComposerEditableHandle } from "./chat-input/types";

export type { ChatInputHandle } from "./chat-input/types";
export type { ChatInputProps as Props } from "./chat-input/types";

function submissionRejected(result: unknown): boolean {
  return Boolean(result && typeof result === "object" && "ok" in result && result.ok === false);
}

function supportsReasoning(levels?: string[]): boolean {
  return levels?.some((level) => level !== "off") ?? false;
}

export const ChatInput = forwardRef<ChatInputHandle, ChatInputProps>(function ChatInput(
  {
    environmentId: providedEnvironmentId,
    sessionFolderMissing = false,
    missingFolderRecovery,
    onSend,
    onJumpQuote,
    jumpingQuoteKey,
    detachedQuoteKeys,
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
    modelCatalogScope,
    modelLoading,
    modelReconnecting,
    modelLoadError,
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
  const activeEnvironment = useActiveEnvironment();
  const environments = useEnvironments();
  const environmentId = providedEnvironmentId ?? activeEnvironment.id;
  const affordances = environmentAffordances(environments.find((view) => view.id === environmentId));
  const environmentSendGate = useSendGate();
  const missingFolderHint = t(
    "missingSessionFolderReadOnly",
    "The original project folder no longer exists. This historical conversation is protected as read-only.",
  );
  const environmentGate = sessionFolderMissing
    ? { allowed: false, label: missingFolderHint, hint: missingFolderHint }
    : environmentSendGate;
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
  const skillCatalog = useSkillCatalog({ environmentId, cwd, visible });
  const skills = useComposerSkills({ skillCatalog, visible, editableRef });
  const { closePlusMenu, closeTransientMenus } = skills;
  const attachments = useComposerAttachments({
    environmentId,
    draftKey,
    value: draft.shown,
    visible,
    cwd,
    supportsImages: modelSupportsImages(
      model ? { provider: model.provider, id: model.modelId } : null,
      modelList ?? [],
    ),
    editableRef,
    t,
    onImageNotice: setImageAttachNotice,
  });
  const sendGate = environmentGate.allowed ? (attachments.remoteUploadSendGate ?? environmentGate) : environmentGate;

  const handleAbort = useCallback(() => {
    if (visible) onAbort();
  }, [onAbort, visible]);
  const handleRecallQueue = useCallback(() => {
    if (visible) onRecallQueue?.();
  }, [onRecallQueue, visible]);

  const handleSend = useCallback(async () => {
    if (!visible || isStreaming) return;
    if (!sendGate.allowed) return;
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
      const settled = await Promise.resolve(onSend(serializeComposerQuotesForSend(ticket.message)));
      if (submissionRejected(settled)) {
        draft.restoreFailed(ticket, "send", null);
      }
    } catch (error) {
      draft.restoreFailed(ticket, "send", typeof error === "string" ? error : sessionClientErrorMessage(error, t, ""));
    }
  }, [
    attachments.attachmentTokens.length,
    draft,
    isStreaming,
    onAudioUnlock,
    onBuiltinCommand,
    onSend,
    sendGate.allowed,
    t,
    visible,
  ]);

  const sendQueued = useCallback(async () => {
    if (!visible || !sendGate.allowed || !onFollowUp) return;
    const ticket = draft.submit();
    if (!ticket) return;
    const message = serializeComposerQuotesForSend(ticket.message);
    onAudioUnlock?.();
    try {
      const settled =
        message.startsWith("/") && onPromptWithStreamingBehavior
          ? await onPromptWithStreamingBehavior(message, "followUp")
          : await onFollowUp(message);
      if (submissionRejected(settled)) draft.restoreFailed(ticket, "queue", null);
    } catch (error) {
      draft.restoreFailed(ticket, "queue", typeof error === "string" ? error : sessionClientErrorMessage(error, t, ""));
    }
  }, [draft, visible, onAudioUnlock, onFollowUp, onPromptWithStreamingBehavior, sendGate.allowed, t]);

  const suggestions = useComposerSuggestions({
    environmentId,
    skillCatalog,
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
        if (onFollowUp) void sendQueued();
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

  const openPicker = useCallback(() => {
    if (!visible || (!affordances.attachLocalFiles && !affordances.remoteAttachmentUpload)) return;
    closePlusMenu();
    const input = fileInputRef.current;
    if (!input) return;
    input.removeAttribute("accept");
    input.click();
  }, [closePlusMenu, visible, affordances.attachLocalFiles, affordances.remoteAttachmentUpload]);
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

  useComposerHandle(ref, { editableRef, draft, suggestions, attachments, visible });

  return (
    <>
      {visible && attachments.remoteUploads.length > 0 && (
        <div
          role="status"
          aria-live="polite"
          className="type-label-default"
          style={{
            display: "grid",
            gap: "var(--space-1)",
            padding: "var(--space-2) var(--space-3)",
            color: "var(--fx-text-secondary)",
          }}
        >
          {attachments.remoteUploads.map((upload) => (
            <div key={upload.id} style={{ display: "flex", alignItems: "center", gap: "var(--space-2)" }}>
              <span style={{ flex: 1, minWidth: 0, overflowWrap: "anywhere" }}>
                {upload.file.name} ·{" "}
                {(upload.status === "uploading"
                  ? t("remoteAttachmentUploading", "Uploading to {environment}")
                  : t("remoteAttachmentUploadFailed", "Upload to {environment} failed")
                ).replace("{environment}", attachments.remoteUploadDestination)}
                {upload.message && ` · ${upload.message}`}
              </span>
              {upload.status === "failed" && (
                <Button variant="ghost" onClick={() => attachments.retryRemoteUpload(upload.id)}>
                  {t("retry", "Retry")}
                </Button>
              )}
            </div>
          ))}
        </div>
      )}
      <ComposerView
        environmentId={environmentId}
        sendGate={sendGate}
        sessionFolderMissing={sessionFolderMissing}
        missingFolderRecovery={missingFolderRecovery}
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
        onQueue={() => void sendQueued()}
        onChange={handleComposerChange}
        onKeyDown={keys.onKeyDown}
        onPaste={attachments.handlePaste}
        onCompositionStart={keys.onCompositionStart}
        onCompositionEnd={keys.onCompositionEnd}
        tokenPreviewsByPath={attachments.tokenPreviewsByPath}
        missingTokenInspections={attachments.missingTokenInspections}
        onRevealToken={attachments.revealToken}
        onSkillReveal={skills.revealSkill}
        onJumpQuote={onJumpQuote}
        jumpingQuoteKey={jumpingQuoteKey}
        detachedQuoteKeys={detachedQuoteKeys}
        skillsByName={skillCatalog.byName}
        attachmentTokens={attachments.attachmentTokens}
        onOpenPicker={openPicker}
        plusMenuOpen={skills.plusMenuOpen}
        onTogglePlusMenu={() => {
          suggestions.dismiss();
          skills.openPlusMenu();
        }}
        onOpenSkillPicker={skills.openSkillPicker}
        remotePanelOpen={skills.remotePanelOpen}
        onOpenRemotePanel={skills.openRemotePanel}
        onBackToPlusMenu={skills.backToPlusMenu}
        onCloseMenus={skills.closeTransientMenus}
        remote={remote}
        navigation={navigation}
        skills={skillCatalog.skills}
        skillsLoading={skillCatalog.status === "loading"}
        skillsError={skillCatalog.status === "error"}
        onPickSkill={skills.pickSkill}
        onRetrySkills={skillCatalog.refresh}
        skillPickerOpen={skills.skillPickerOpen}
        skillRevealName={skills.skillRevealName}
        onCloseSkillPicker={skills.closeTransientMenus}
        onCloseSkillReveal={() => skills.setSkillRevealName(null)}
        slashMenu={suggestions.slashMenu}
        atMenuOpen={suggestions.atMenuOpen}
        atQuery={suggestions.atQuery}
        atSuggestionState={suggestions.activeSuggestionState}
        atMatches={suggestions.atMatches}
        atActiveIndex={suggestions.atActiveIndex}
        atItemRefs={suggestions.atItemRefs}
        onApplyAt={suggestions.applyAtCompletion}
        onHoverAt={suggestions.setAtActiveIndex}
        imageAttachNotice={attachments.remoteUploadNotice ?? imageAttachNotice}
        onDismissImageNotice={() => {
          attachments.dismissRemoteUploadNotice();
          setImageAttachNotice(null);
        }}
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
        modelCatalogScope={modelCatalogScope}
        modelLoading={modelLoading}
        modelReconnecting={modelReconnecting}
        modelLoadError={modelLoadError}
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
    </>
  );
});
