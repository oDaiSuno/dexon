import { useEffect, useState } from "react";
import type {
  PublicToolchainState,
  ToolCapabilityId,
  ToolchainActionRequest,
  ToolchainCacheId,
} from "@shared/toolchains/types";
import { useIsMobile } from "@/hooks/useIsMobile";
import { useI18n } from "@/i18n";
import { IssueSection } from "./toolchains/issue-cards";
import { OverviewSection } from "./toolchains/overview-section";
import { ReadySection } from "./toolchains/ready-list";
import { StorageSection } from "./toolchains/storage-section";
import { actionKey, friendlyToolchainError, issueCapabilities, type ToolAction } from "./toolchains/shared";

export function ToolchainsConfig({ cwd }: { cwd?: string | null }) {
  const { t } = useI18n();
  const [state, setState] = useState<PublicToolchainState | null>(null);
  const [pendingAction, setPendingAction] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let disposed = false;
    const unsubscribe = window.piBridge.onToolchainState((nextState) => {
      if (disposed) return;
      if (!cwd) {
        setState(nextState);
        setFailed(false);
        return;
      }
      void window.piBridge
        .getToolchainState(cwd)
        .then((projectState) => {
          if (!disposed) {
            setState(projectState);
            setFailed(false);
          }
        })
        .catch(() => {
          if (!disposed) setFailed(true);
        });
    });
    void window.piBridge
      .rescanToolchains(cwd ?? undefined)
      .then((nextState) => {
        if (!disposed) setState(nextState);
      })
      .catch(() => {
        if (!disposed) setFailed(true);
      });
    return () => {
      disposed = true;
      unsubscribe();
    };
  }, [cwd]);

  const performAction = async (request: ToolchainActionRequest): Promise<void> => {
    setPendingAction(actionKey(request));
    setActionError(null);
    setFailed(false);
    try {
      const actionState =
        request.action === "rescan"
          ? await window.piBridge.rescanToolchains(cwd ?? undefined)
          : await window.piBridge.performToolchainAction(request);
      const nextState = cwd && request.action !== "rescan" ? await window.piBridge.getToolchainState(cwd) : actionState;
      setState(nextState);
    } catch (error) {
      if (!String(error).includes("TOOLCHAIN_CANCELLED")) setActionError(friendlyToolchainError(error, t));
    } finally {
      setPendingAction(null);
    }
  };

  const openManagedFolder = async (): Promise<void> => {
    setActionError(null);
    try {
      await window.piBridge.openManagedToolsFolder();
    } catch {
      setActionError(t("toolOpenManagedFolderFailed", "Couldn't open the managed tools folder."));
    }
  };

  return (
    <ToolchainStateView
      state={state}
      failed={failed}
      rescanPending={pendingAction === "rescan"}
      pendingAction={pendingAction}
      actionError={actionError}
      onRescan={() => void performAction({ action: "rescan" })}
      onAction={performAction}
      onOpenManagedFolder={() => void openManagedFolder()}
    />
  );
}

export function ToolchainStateView({
  state,
  failed,
  rescanPending,
  pendingAction = null,
  actionError = null,
  onRescan,
  onAction,
  onOpenManagedFolder,
}: {
  state: PublicToolchainState | null;
  failed: boolean;
  rescanPending: boolean;
  pendingAction?: string | null;
  actionError?: string | null;
  onRescan: () => void;
  onAction?: ToolAction;
  onOpenManagedFolder?: () => void;
}) {
  const isMobile = useIsMobile();
  const { language, t } = useI18n();
  const [expanded, setExpanded] = useState<ToolCapabilityId | null>("js.node");
  const disabled = !state || Boolean(pendingAction) || state.stateReadOnly === true;
  const issues = issueCapabilities(state);

  const clearCaches = async (cacheIds: ToolchainCacheId[]): Promise<void> => {
    for (const cacheId of cacheIds) await onAction?.({ action: "clear-cache", cacheId });
  };

  return (
    <div
      aria-label={t("developerTools", "Developer Tools")}
      style={{ flex: 1, width: "100%", minWidth: 0, minHeight: 0, overflowY: "auto" }}
    >
      <div
        style={{
          maxWidth: 760,
          margin: "0 auto",
          padding: isMobile ? "var(--space-4)" : "var(--space-6) var(--space-6) var(--space-10)",
          display: "grid",
          gap: "var(--space-8)",
        }}
      >
        <OverviewSection
          state={state}
          failed={failed}
          actionError={actionError}
          rescanPending={rescanPending}
          isMobile={isMobile}
          onRescan={onRescan}
        />
        {state && issues.length > 0 && (
          <IssueSection
            state={state}
            issues={issues}
            pendingAction={pendingAction}
            disabled={disabled}
            isMobile={isMobile}
            onAction={onAction}
          />
        )}
        {state && (
          <ReadySection
            state={state}
            expanded={expanded}
            pendingAction={pendingAction}
            disabled={disabled}
            onToggle={(capability) => setExpanded((current) => (current === capability ? null : capability))}
            onAction={onAction}
          />
        )}
        {state && (
          <StorageSection
            state={state}
            pendingAction={pendingAction}
            disabled={disabled}
            onClearAll={(cacheIds) => void clearCaches(cacheIds)}
            onOpenManagedFolder={onOpenManagedFolder}
          />
        )}
        <p className="type-label-default" style={{ margin: 0, color: "var(--fx-text-tertiary)", textWrap: "pretty" }}>
          {t("toolDiscoveryPrivacy", "Scanning only reads files and never runs shell profiles or goes online.")}
          {language === "zh-CN" ? "" : " "}
          {t(
            "toolDownloadPrivacy",
            "Managed installs download from the official source and are enabled only after verification.",
          )}
        </p>
      </div>
    </div>
  );
}
