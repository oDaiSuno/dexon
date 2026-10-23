import { useId } from "react";
import { useI18n } from "@/i18n";
import { Button } from "../form-controls";
import { DownloadIcon, RefreshIcon } from "./about-icons";
import {
  UpdateDownloadProgress,
  UpdateNotes,
  formatUpdateDate,
  getReleaseSummary,
  getUpdateErrorMessage,
  getUpdateStatusTitle,
  updateStatusColor,
} from "./update-presentations";
import type { SoftwareUpdateModel } from "./use-software-update";

export function SoftwareUpdate({ update, onClose }: { update: SoftwareUpdateModel; onClose: () => void }) {
  const { language, t } = useI18n();
  const headingId = useId();
  const descriptionId = useId();
  const { state, pendingAction, actionFailed, isBusy, run } = update;
  const phase = state?.phase;
  const hasRelease = phase === "available" || phase === "downloading" || phase === "downloaded";

  const summary = (() => {
    if (!state) return null;
    if (hasRelease) return getReleaseSummary(state, language, t);
    if (phase === "up-to-date" || phase === "idle") {
      const current = `${t("currentVersion", "Current version")}: ${state.currentVersion}`;
      return state.checkedAt
        ? `${current} · ${t("lastChecked", "Last checked")}: ${formatUpdateDate(state.checkedAt, language)}`
        : current;
    }
    if (phase === "disabled") {
      return t(
        "updatesDisabledDescription",
        "Software updates are available only in installed production builds on supported platforms.",
      );
    }
    return null;
  })();

  const restartNote =
    state && phase === "downloaded"
      ? state.installBlockedByActiveSessions
        ? t(
            "updateInstallBlockedByActiveSessions",
            "Active Agent tasks must finish before restart. Choose Later to install when you next fully quit.",
          )
        : t("updateRestartWarning", "Restart now, or choose Later to install when you next fully quit the app.")
      : null;

  return (
    <section
      aria-labelledby={headingId}
      aria-describedby={descriptionId}
      style={{ width: "100%", display: "flex", flexDirection: "column", gap: "var(--space-2-5)" }}
    >
      <h2 id={headingId} className="type-body-medium" style={{ margin: 0, color: "var(--fx-text-secondary)" }}>
        {t("softwareUpdate", "Software update")}
      </h2>
      <p id={descriptionId} className="sr-only">
        {t("softwareUpdateDescription", "Check stable releases and choose when a downloaded update is installed.")}
      </p>

      <div
        style={{
          display: "flex",
          flexDirection: "column",
          border: "1px solid var(--fx-line-default)",
          borderRadius: "var(--radius-dialog)",
          background: "var(--fx-surface-raised)",
          overflow: "hidden",
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: "var(--space-3-5)",
            padding: "var(--space-4-5) var(--space-5)",
          }}
        >
          <span
            aria-hidden="true"
            style={{
              width: 8,
              height: 8,
              flexShrink: 0,
              borderRadius: "var(--radius-xs)",
              background: updateStatusColor(phase),
            }}
          />
          <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: "var(--space-0-5)" }}>
            <div
              role="status"
              aria-live="polite"
              aria-atomic="true"
              style={{ display: "grid", gap: "var(--space-0-5)" }}
            >
              <p className="type-body-large-medium" style={{ margin: 0, color: "var(--fx-text-primary)" }}>
                {getUpdateStatusTitle(state, t)}
              </p>
              {summary && (
                <p className="type-label-default" style={{ margin: 0, color: "var(--fx-text-tertiary)" }}>
                  {summary}
                </p>
              )}
            </div>
            {state && phase === "downloading" && <UpdateDownloadProgress state={state} language={language} />}
            {restartNote && (
              <p className="type-label-default" style={{ margin: 0, color: "var(--fx-text-secondary)" }}>
                {restartNote}
              </p>
            )}
            {state?.phase === "error" && state.error && (
              <div role="alert" aria-atomic="true" style={{ display: "grid", gap: "var(--space-0-5)" }}>
                <p className="type-label-default" style={{ margin: 0, color: "var(--fx-status-danger)" }}>
                  {getUpdateErrorMessage(state.error, t)}
                </p>
                <code className="type-mono-meta" style={{ color: "var(--fx-text-tertiary)" }}>
                  {state.error.code}
                </code>
              </div>
            )}
            {actionFailed && (
              <p role="alert" className="type-label-default" style={{ margin: 0, color: "var(--fx-status-danger)" }}>
                {t("updateActionFailed", "The update action could not be completed. Try again or open the logs.")}
              </p>
            )}
          </div>

          <div style={{ display: "flex", flexShrink: 0, flexWrap: "wrap", gap: "var(--space-2)" }}>
            {(phase === "idle" || phase === "up-to-date") && (
              <Button
                variant="primary"
                disabled={isBusy}
                busy={pendingAction === "check"}
                onClick={() => run("check", () => window.piBridge.checkForUpdates())}
              >
                <RefreshIcon />
                {t("checkForUpdates", "Check for updates")}
              </Button>
            )}
            {phase === "checking" && (
              <Button variant="primary" disabled busy>
                <RefreshIcon />
                {t("checkingForUpdates", "Checking for updates…")}
              </Button>
            )}
            {phase === "available" && (
              <Button
                variant="primary"
                disabled={isBusy}
                busy={pendingAction === "download"}
                onClick={() => run("download", () => window.piBridge.downloadUpdate())}
              >
                <DownloadIcon />
                {t("downloadUpdate", "Download update")}
              </Button>
            )}
            {state && phase === "downloaded" && (
              <>
                <Button disabled={isBusy} onClick={onClose}>
                  {t("installLater", "Later")}
                </Button>
                <Button
                  variant="primary"
                  disabled={isBusy || state.installBlockedByActiveSessions}
                  busy={pendingAction === "install"}
                  onClick={() => run("install", () => window.piBridge.installUpdate())}
                >
                  <RefreshIcon />
                  {t("restartAndInstall", "Restart and install")}
                </Button>
              </>
            )}
            {(phase === "error" || actionFailed) && (
              <Button
                disabled={isBusy}
                busy={pendingAction === "logs"}
                onClick={() => run("logs", () => window.piBridge.openLogs())}
              >
                {t("openLogs", "Open logs")}
              </Button>
            )}
            {state?.phase === "error" && state.canRetry && (
              <Button
                variant="primary"
                disabled={isBusy}
                busy={pendingAction === "check"}
                onClick={() => run("check", () => window.piBridge.checkForUpdates())}
              >
                <RefreshIcon />
                {t("retryUpdate", "Retry")}
              </Button>
            )}
            {!state && actionFailed && (
              <Button variant="primary" disabled={isBusy} busy={pendingAction === "status"} onClick={update.reload}>
                <RefreshIcon />
                {t("retryUpdate", "Retry")}
              </Button>
            )}
          </div>
        </div>

        {state && hasRelease && <UpdateNotes state={state} />}
      </div>
    </section>
  );
}
