import type { MutableRefObject, RefObject } from "react";
import { useI18n } from "@/i18n";
import type { CompactResultInfo, QueuedMessages } from "@/hooks/useAgentSession";
import type { ModelCatalogStatus } from "@contract/types";
import type { SkillRecord } from "@/lib/api-types";
import { ComposerEditable } from "./ComposerEditable";
import type { ComposerEditableHandle, ComposerNavigation, ComposerRemote } from "./types";
import { AtMenu, type AtSuggestionState } from "./AtMenu";
import { ModelPicker, type ModelOption } from "./ModelPicker";
import { PlusMenuLayer } from "./plus-menu-layer";
import { SkillPickerPanel, SkillRevealCard } from "./SkillPickerPanel";
import { SendSquare, StopSquare } from "./SendControls";
import { SessionControls } from "./SessionControls";
import { SlashMenu } from "./SlashMenu";
import { ComposerBanner, CompactResultBanner, QueuedMessagesPanel } from "./StatusBanners";
import type { SubmissionNotice } from "./use-composer-draft";
import type { SlashCommandPaletteItem } from "./slash-commands";
import { PlusIcon } from "./icons";
import type { FileIndexEntry } from "@/lib/file-fuzzy";

export interface ComposerViewProps {
  rootRef: RefObject<HTMLDivElement | null>;
  visible: boolean;
  isMobile: boolean;
  isStreaming: boolean;
  hasSteering: boolean;
  onFollowUp?: (message: string) => Promise<void> | void;
  value: string;
  editableRef: MutableRefObject<ComposerEditableHandle | null>;
  fileInputRef: RefObject<HTMLInputElement | null>;
  processFiles: (files: File[]) => Promise<void>;
  onSend: () => void;
  onAbort: () => void;
  onQueue: () => void;
  onValueChange: (value: string) => void;
  onSelectionChange: (textBeforeCaret: string) => void;
  onKeyDown: (event: React.KeyboardEvent<HTMLDivElement>) => void;
  onPaste: (event: React.ClipboardEvent<HTMLDivElement>) => void;
  onCompositionStart: () => void;
  onCompositionEnd: () => void;
  tokenPreviewsByPath: ReadonlyMap<string, string | null>;
  missingTokenInspections: ReadonlyMap<string, boolean>;
  onRevealToken: (path: string) => void;
  onSkillReveal: (name: string) => void;
  skillDescriptions: ReadonlyMap<string, string>;
  attachmentTokens: { path: string }[];
  onOpenPicker: () => void;
  plusMenuOpen: boolean;
  onTogglePlusMenu: () => void;
  onOpenSkillPicker: () => void;
  remotePanelOpen: boolean;
  onOpenRemotePanel: () => void;
  onBackToPlusMenu: () => void;
  onCloseMenus: () => void;
  remote?: ComposerRemote | null;
  navigation?: ComposerNavigation;
  skills: SkillRecord[];
  skillsLoading: boolean;
  skillsError: boolean;
  onPickSkill: (skill: SkillRecord) => void;
  skillPickerOpen: boolean;
  skillRevealName: string | null;
  skillRecordsRef: MutableRefObject<Map<string, SkillRecord>>;
  onCloseSkillPicker: () => void;
  onCloseSkillReveal: () => void;
  slashMenuOpen: boolean;
  slashCommands: SlashCommandPaletteItem[];
  slashQuery: string;
  slashLoading?: boolean;
  slashActiveIndex: number;
  slashItemRefs: MutableRefObject<(HTMLButtonElement | null)[]>;
  onApplySlash: (command: SlashCommandPaletteItem) => void;
  onHoverSlash: (index: number) => void;
  atMenuOpen: boolean;
  atQuery: { start: number; query: string; quoted: boolean } | null;
  atSuggestionState: AtSuggestionState | null;
  atMatches: FileIndexEntry[];
  atActiveIndex: number;
  atItemRefs: MutableRefObject<(HTMLButtonElement | null)[]>;
  onApplyAt: (entry: FileIndexEntry) => void;
  onHoverAt: (index: number) => void;
  imageAttachNotice: string | null;
  onDismissImageNotice: () => void;
  submissionNotice: SubmissionNotice | null;
  onDismissSubmissionNotice: () => void;
  onResendSubmission: () => void;
  queuedMessages?: QueuedMessages | null;
  onRecallQueue?: () => void;
  compactResult?: CompactResultInfo | null;
  onDismissCompactResult: () => void;
  model?: { provider: string; modelId: string } | null;
  modelOptionsByProvider: { provider: string; options: ModelOption[] }[];
  currentModelName: string | null;
  modelCatalog?: ModelCatalogStatus;
  modelRefreshing?: boolean;
  modelDropdownOpen: boolean;
  onToggleModelDropdown: () => void;
  modelButtonRef: RefObject<HTMLButtonElement | null>;
  modelContainerRef: RefObject<HTMLDivElement | null>;
  modelPanelRef: RefObject<HTMLDivElement | null>;
  modelDropdownRect: { top: number; left: number; width: number } | null;
  onModelChange?: (provider: string, modelId: string) => void;
  onModelsRefresh?: () => Promise<void> | void;
  onModelPick: (provider: string, modelId: string, isActive: boolean) => void;
  isAutoModelSelection?: boolean;
  onCompact?: () => void;
  onAbortCompaction?: () => void;
  isCompacting?: boolean;
  compactError?: string | null;
  contextUsage?: { percent: number | null; contextWindow: number; tokens: number | null } | null;
  thinkingLevel?: "auto" | "off" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max";
  onThinkingLevelChange?: (level: "auto" | "off" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max") => void;
  availableThinkingLevels?: string[] | null;
  thinkingLevelMap?: Record<string, string | null> | null;
  thinkingDropdownOpen: boolean;
  onToggleThinkingDropdown: () => void;
  thinkingContainerRef: RefObject<HTMLDivElement | null>;
  thinkingButtonRef: RefObject<HTMLButtonElement | null>;
  closeControlDropdowns: () => void;
  soundEnabled?: boolean;
  onSoundToggle?: () => void;
  onAudioUnlock?: () => void;
}

export function ComposerView(props: ComposerViewProps) {
  const { t } = useI18n();
  const {
    rootRef,
    visible,
    isMobile,
    isStreaming,
    onFollowUp,
    value,
    editableRef,
    fileInputRef,
    processFiles,
    onSend,
    onAbort,
    onQueue,
    onValueChange,
    onSelectionChange,
    onKeyDown,
    onPaste,
    onCompositionStart,
    onCompositionEnd,
    tokenPreviewsByPath,
    missingTokenInspections,
    onRevealToken,
    onSkillReveal,
    skillDescriptions,
    attachmentTokens,
    onOpenPicker,
    plusMenuOpen,
    onTogglePlusMenu,
    onOpenSkillPicker,
    remotePanelOpen,
    onOpenRemotePanel,
    onBackToPlusMenu,
    onCloseMenus,
    remote,
    navigation,
    skills,
    skillsLoading,
    skillsError,
    onPickSkill,
    skillPickerOpen,
    skillRevealName,
    skillRecordsRef,
    onCloseSkillPicker,
    onCloseSkillReveal,
    slashMenuOpen,
    slashCommands,
    slashQuery,
    slashLoading,
    slashActiveIndex,
    slashItemRefs,
    onApplySlash,
    onHoverSlash,
    atMenuOpen,
    atQuery,
    atSuggestionState,
    atMatches,
    atActiveIndex,
    atItemRefs,
    onApplyAt,
    onHoverAt,
    imageAttachNotice,
    onDismissImageNotice,
    submissionNotice,
    onDismissSubmissionNotice,
    onResendSubmission,
    queuedMessages,
    onRecallQueue,
    compactResult,
    onDismissCompactResult,
    model,
    modelOptionsByProvider,
    currentModelName,
    modelCatalog,
    modelRefreshing,
    modelDropdownOpen,
    onToggleModelDropdown,
    modelButtonRef,
    modelContainerRef,
    modelPanelRef,
    modelDropdownRect,
    onModelChange,
    onModelsRefresh,
    onModelPick,
    onCompact,
    onAbortCompaction,
    isCompacting,
    compactError,
    contextUsage,
    thinkingLevel,
    onThinkingLevelChange,
    availableThinkingLevels,
    thinkingLevelMap,
    thinkingDropdownOpen,
    onToggleThinkingDropdown,
    thinkingContainerRef,
    thinkingButtonRef,
    closeControlDropdowns,
    onSoundToggle,
  } = props;

  return (
    <div
      ref={rootRef}
      data-chat-input
      hidden={!visible}
      aria-hidden={!visible}
      inert={!visible ? true : undefined}
      style={{ flexShrink: 0, background: "transparent", padding: "12px 16px", paddingRight: isMobile ? 16 : 52 }}
    >
      <input
        ref={fileInputRef}
        type="file"
        multiple
        style={{ display: "none" }}
        onChange={(event) => {
          void processFiles(Array.from(event.target.files ?? []));
          event.target.value = "";
        }}
      />
      <div className="chat-content-column">
        {queuedMessages && queuedMessages.steering.length + queuedMessages.followUp.length > 0 && (
          <QueuedMessagesPanel queuedMessages={queuedMessages} onRecallQueue={onRecallQueue} />
        )}
        {imageAttachNotice && (
          <ComposerBanner
            tone="error"
            message={imageAttachNotice}
            onDismiss={onDismissImageNotice}
            dismissLabel={t("dismissImageAttachError", "Dismiss image attachment error")}
          />
        )}
        {submissionNotice && (
          <ComposerBanner
            testId="composer-submission-error"
            tone={submissionNotice.tone}
            message={submissionNotice.message}
            onDismiss={onDismissSubmissionNotice}
            dismissLabel={t("dismissSubmissionError", "Dismiss submission error")}
            action={
              submissionNotice.canResend ? { label: t("resendMessage", "Resend"), onClick: onResendSubmission } : null
            }
          />
        )}
        {compactResult && <CompactResultBanner result={compactResult} onDismiss={onDismissCompactResult} />}

        <div data-composer-anchor style={{ position: "relative" }}>
          <PlusMenuLayer
            plusMenuOpen={plusMenuOpen}
            remotePanelOpen={remotePanelOpen}
            skillCount={skills.length}
            remote={remote}
            navigation={navigation}
            onOpenPicker={onOpenPicker}
            onOpenSkillPicker={onOpenSkillPicker}
            onOpenRemotePanel={onOpenRemotePanel}
            onBackToPlusMenu={onBackToPlusMenu}
            onCloseMenus={onCloseMenus}
          />
          {skillPickerOpen && (
            <SkillPickerPanel
              skills={skills}
              loading={skillsLoading}
              error={skillsError ? "load-failed" : null}
              onPick={onPickSkill}
              onClose={onCloseSkillPicker}
            />
          )}
          {skillRevealName && (
            <SkillRevealCard
              name={skillRevealName}
              description={skillRecordsRef.current.get(skillRevealName)?.description ?? null}
              filePath={skillRecordsRef.current.get(skillRevealName)?.filePath ?? null}
              onClose={onCloseSkillReveal}
            />
          )}
          {slashMenuOpen && (
            <SlashMenu
              commands={slashCommands}
              query={slashQuery}
              loading={slashLoading}
              activeIndex={slashActiveIndex}
              itemRefs={slashItemRefs}
              onApply={onApplySlash}
              onHover={onHoverSlash}
            />
          )}
          {atMenuOpen && atQuery && (
            <AtMenu
              suggestionState={atSuggestionState}
              matches={atMatches}
              activeIndex={atActiveIndex}
              itemRefs={atItemRefs}
              onApply={onApplyAt}
              onHover={onHoverAt}
            />
          )}

          <div role="group" aria-label={t("messageComposer", "Message input")} className="chat-composer-shell">
            <div className="chat-composer-row">
              <button
                type="button"
                aria-haspopup="menu"
                aria-expanded={plusMenuOpen || remotePanelOpen}
                onClick={onTogglePlusMenu}
                title={t(
                  "attachLocalFilesDescription",
                  "Add images or local file references. The agent reads absolute paths on this computer; moved files, remote agents, or sandboxes may not be able to access them.",
                )}
                aria-label={t("attachLocalFiles", "Add images or local file references")}
                style={{
                  flexShrink: 0,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  width: 30,
                  height: 30,
                  marginBottom: 1,
                  padding: 0,
                  background:
                    attachmentTokens.length > 0 ? "var(--fx-accent-blue-soft)" : "var(--fx-surface-hover-clear)",
                  border: "none",
                  borderRadius: "var(--radius-control)",
                  color: attachmentTokens.length > 0 ? "var(--fx-accent-blue)" : "var(--fx-text-secondary)",
                  cursor: "pointer",
                  transition:
                    "background var(--duration-quick) var(--ease-smooth-out), color var(--duration-quick) var(--ease-smooth-out), transform var(--duration-micro)",
                }}
                onMouseEnter={(event) => {
                  event.currentTarget.style.background =
                    attachmentTokens.length > 0 ? "var(--fx-accent-blue-selection)" : "var(--fx-surface-hover-overlay)";
                }}
                onMouseLeave={(event) => {
                  event.currentTarget.style.background =
                    attachmentTokens.length > 0 ? "var(--fx-accent-blue-soft)" : "var(--fx-surface-hover-clear)";
                }}
                className="tap-scale"
              >
                <PlusIcon size={17} />
              </button>
              <div style={{ flex: 1, minWidth: 0, display: "flex" }}>
                <ComposerEditable
                  visible={visible}
                  value={value}
                  handleRef={editableRef}
                  placeholder={
                    isStreaming
                      ? t("queuePlaceholder", "Agent is running… sending queues a follow-up")
                      : t("messagePlaceholder", "Message… Type / for commands, @ for files")
                  }
                  onValueChange={onValueChange}
                  onSelectionChange={onSelectionChange}
                  onKeyDown={onKeyDown}
                  onPaste={onPaste}
                  onCompositionStart={onCompositionStart}
                  onCompositionEnd={onCompositionEnd}
                  previewsByPath={tokenPreviewsByPath}
                  missingByPath={missingTokenInspections}
                  onRevealToken={onRevealToken}
                  onSkillReveal={onSkillReveal}
                  removeLabel={t("remove", "Remove")}
                  skillDescriptions={skillDescriptions}
                  skillRemoveLabel={t("removeSkill", "Remove skill")}
                />
              </div>
              {isStreaming ? (
                value.trim() && onFollowUp ? (
                  <SendSquare armed onSend={onQueue} />
                ) : (
                  <StopSquare onAbort={onAbort} />
                )
              ) : (
                <SendSquare armed={Boolean(value.trim())} onSend={onSend} />
              )}
            </div>
          </div>
        </div>

        <div
          style={{
            marginTop: 10,
            display: "flex",
            alignItems: "center",
            gap: isMobile ? 2 : "var(--space-3)",
            padding: isMobile ? 0 : "0 6px",
          }}
        >
          {!isMobile && <div style={{ flex: "1 1 0", minWidth: 0 }} />}
          <div style={{ flex: isMobile ? "1 1 auto" : "0 0 auto", minWidth: 0, display: "flex" }}>
            <ModelPicker
              model={model}
              modelsByProvider={modelOptionsByProvider}
              currentName={currentModelName}
              isMobile={isMobile}
              isStreaming={isStreaming}
              dropdownOpen={modelDropdownOpen}
              onToggle={onToggleModelDropdown}
              buttonRef={modelButtonRef}
              containerRef={modelContainerRef}
              panelRef={modelPanelRef}
              dropdownRect={modelDropdownRect}
              modelCatalog={modelCatalog}
              modelRefreshing={modelRefreshing}
              onModelChange={onModelChange}
              onModelsRefresh={onModelsRefresh}
              onModelPick={onModelPick}
            />
          </div>
          <SessionControls
            visible={visible}
            isMobile={isMobile}
            isStreaming={isStreaming}
            closeDropdowns={closeControlDropdowns}
            thinkingLevel={thinkingLevel}
            onThinkingLevelChange={onThinkingLevelChange}
            availableThinkingLevels={availableThinkingLevels}
            thinkingLevelMap={thinkingLevelMap}
            thinkingDropdownOpen={thinkingDropdownOpen}
            onThinkingToggle={onToggleThinkingDropdown}
            thinkingContainerRef={thinkingContainerRef}
            thinkingButtonRef={thinkingButtonRef}
            onCompact={onCompact}
            onAbortCompaction={onAbortCompaction}
            isCompacting={isCompacting}
            compactError={compactError}
            contextUsage={contextUsage}
            soundEnabled={props.soundEnabled}
            onSoundToggle={onSoundToggle}
          />
        </div>
      </div>
    </div>
  );
}
