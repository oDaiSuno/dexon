import { useI18n } from "@/i18n";
import { WorktreeSwitcher } from "../session-sidebar/worktree-switcher";
import { NavSpacePicker, type SpaceChoice } from "../app-nav/nav-space-picker";
import type { useProjectWorkspace } from "../session-sidebar/project-workspace";

export interface SpaceNotice {
  message: string;
  reason?: string;
  onRetry?: () => void;
}

export function NavSpacePanel({
  workspace,
  homeDir,
  deferFocus,
  notice,
  pickerOpen,
  spaces,
  onSelectSpace,
  onClosePicker,
}: {
  workspace: ReturnType<typeof useProjectWorkspace>;
  homeDir: string;
  deferFocus: (focus: () => void) => void;
  notice: SpaceNotice | null;
  pickerOpen: boolean;
  spaces: SpaceChoice[];
  onSelectSpace: (path: string) => void;
  onClosePicker: () => void;
}) {
  const { t } = useI18n();
  const showSwitcher = workspace.showWorktreeSwitcher && workspace.worktreeState;
  if (!showSwitcher && !notice && !pickerOpen) return null;

  return (
    <div style={{ position: "relative", padding: "0 10px 8px", flexShrink: 0 }}>
      <NavSpacePicker open={pickerOpen} spaces={spaces} onSelect={onSelectSpace} onClose={onClosePicker} />
      {notice && (
        <div
          role="alert"
          style={{
            display: "flex",
            flexDirection: "column",
            gap: 6,
            padding: "8px 10px",
            border: "1px solid color-mix(in srgb, var(--fx-status-danger) 40%, transparent)",
            borderRadius: "var(--radius-card)",
            background: "color-mix(in srgb, var(--fx-status-danger) 8%, transparent)",
            fontSize: "var(--text-label)",
            color: "var(--fx-text-primary)",
          }}
        >
          <span>{notice.message}</span>
          {notice.reason && (
            <span style={{ color: "var(--fx-text-secondary)", fontSize: "var(--text-meta)", overflowWrap: "anywhere" }}>
              {notice.reason}
            </span>
          )}
          {notice.onRetry && (
            <button
              type="button"
              onClick={notice.onRetry}
              style={{
                alignSelf: "flex-start",
                height: 24,
                padding: "0 10px",
                background: "var(--fx-surface-raised)",
                border: "1px solid var(--fx-line-default)",
                borderRadius: "var(--radius-control)",
                color: "var(--fx-text-primary)",
                cursor: "pointer",
                fontSize: "var(--text-label)",
              }}
            >
              {t("retry", "Retry")}
            </button>
          )}
        </div>
      )}
      {showSwitcher && workspace.worktreeState && (
        <WorktreeSwitcher
          worktreeState={workspace.worktreeState}
          selectedCwd={workspace.selectedCwd}
          homeDir={homeDir}
          dropdownOpen={workspace.wtDropdownOpen}
          onToggleDropdown={workspace.toggleWorktreeDropdown}
          onOutsideClickClose={workspace.resetWorktreeDropdownForOutsideClick}
          newOpen={workspace.wtNewOpen}
          onOpenNewEntry={workspace.openNewWorktreeEntry}
          onCloseNewEntry={workspace.closeNewWorktreeEntry}
          newBranch={workspace.wtNewBranch}
          onNewBranchChange={workspace.setNewWorktreeBranch}
          busy={workspace.wtBusy}
          error={workspace.wtError}
          confirmRemovePath={workspace.wtConfirmRemove}
          onCancelRemove={workspace.cancelWorktreeRemove}
          onCreateWorktree={workspace.handleCreateWorktree}
          onRemoveWorktree={workspace.handleRemoveWorktree}
          onSelectWorktree={workspace.handleSelectWorktree}
          deferFocus={deferFocus}
        />
      )}
    </div>
  );
}
