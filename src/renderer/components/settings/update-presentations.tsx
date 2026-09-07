import type { DesktopUpdateState } from "../../../contract/desktop";
import type { AppLanguage } from "@/i18n";
import { useI18n } from "@/i18n";

export function UpdateReleaseDetails({ state, language }: { state: DesktopUpdateState; language: AppLanguage }) {
  const { t } = useI18n();
  return (
    <div style={{ marginTop: 12, fontSize: "var(--text-label)", lineHeight: 1.55, color: "var(--text-muted)" }}>
      {state.availableVersion && (
        <div>
          {t("availableVersion", "Available version")}: {displayVersion(state.availableVersion)}
        </div>
      )}
      {state.releaseName && <div>{state.releaseName}</div>}
      {state.releaseDate && (
        <div>
          {t("releaseDate", "Released")}: {formatUpdateDate(state.releaseDate, language)}
        </div>
      )}
      {state.releaseNotes && (
        <div style={{ marginTop: 12 }}>
          <div style={{ marginBottom: 4, fontWeight: 650, color: "var(--text)" }}>
            {t("releaseNotes", "Release notes")}
          </div>
          <pre
            tabIndex={0}
            aria-label={t("releaseNotes", "Release notes")}
            style={{
              margin: 0,
              maxHeight: 180,
              overflowY: "auto",
              padding: 12,
              border: "1px solid var(--border)",
              borderRadius: "var(--radius-control)",
              background: "var(--bg)",
              color: "var(--text-muted)",
              fontFamily: "inherit",
              fontSize: "var(--text-meta)",
              lineHeight: 1.55,
              whiteSpace: "pre-wrap",
              overflowWrap: "anywhere",
            }}
          >
            {state.releaseNotes}
          </pre>
        </div>
      )}
    </div>
  );
}

export function UpdateDownloadProgress({ state, language }: { state: DesktopUpdateState; language: AppLanguage }) {
  const { t } = useI18n();
  const percent = Number.isFinite(state.percent) ? Math.max(0, Math.min(100, state.percent ?? 0)) : 0;
  const progressText = `${percent.toFixed(1)}%`;
  return (
    <div style={{ marginTop: 16 }}>
      <progress
        max={100}
        value={percent}
        aria-label={t("updateDownloadProgress", "Update download progress")}
        aria-valuetext={progressText}
        style={{ width: "100%", height: 8, accentColor: "var(--accent)" }}
      />
      <div
        style={{
          marginTop: 4,
          display: "flex",
          flexWrap: "wrap",
          justifyContent: "space-between",
          gap: 8,
          fontSize: "var(--text-micro)",
          color: "var(--text-dim)",
        }}
      >
        <span>{progressText}</span>
        <span>
          {state.transferred !== undefined && state.total !== undefined
            ? `${formatBytes(state.transferred, language)} / ${formatBytes(state.total, language)}`
            : t("calculatingDownloadSize", "Calculating size…")}
          {state.bytesPerSecond !== undefined && state.bytesPerSecond > 0
            ? ` · ${formatBytes(state.bytesPerSecond, language)}/${t("secondShort", "s")}`
            : ""}
        </span>
      </div>
    </div>
  );
}

export function getUpdateStatusTitle(
  state: DesktopUpdateState | null,
  t: (key: string, fallback: string) => string,
): string {
  if (!state) return t("loadingUpdateStatus", "Loading update status…");
  switch (state.phase) {
    case "disabled":
      return t("updatesDisabled", "Updates are unavailable in this build");
    case "idle":
      return t("readyToCheckForUpdates", "Ready to check for updates");
    case "checking":
      return t("checkingForUpdates", "Checking for updates…");
    case "up-to-date":
      return t("appIsUpToDate", "You are using the latest version");
    case "available":
      return t("updateAvailable", "An update is available");
    case "downloading":
      return t("downloadingUpdate", "Downloading update…");
    case "downloaded":
      return t("updateReadyToInstall", "Update ready to install");
    case "installing":
      return t("installingUpdate", "Restarting to install the update…");
    case "error":
      return t("updateFailed", "Update failed");
  }
}

export function getUpdateErrorMessage(
  error: NonNullable<DesktopUpdateState["error"]>,
  t: (key: string, fallback: string) => string,
): string {
  switch (error.code) {
    case "UPDATE_OFFLINE":
      return t("updateErrorOffline", "Unable to reach the update service. Check your network and try again.");
    case "UPDATE_NOT_PUBLISHED":
      return t("updateErrorNotPublished", "The update is not available yet and may still be under release review.");
    case "UPDATE_METADATA_INVALID":
      return t(
        "updateErrorMetadataInvalid",
        "The update information is invalid or incomplete. This version was not changed.",
      );
    case "UPDATE_SIGNATURE_INVALID":
      return t("updateErrorSignatureInvalid", "Update signature verification failed. Installation was stopped.");
    case "UPDATE_DOWNLOAD_FAILED":
      return t("updateErrorDownloadFailed", "The download failed. You can continue using this version and try again.");
    case "UPDATE_BUSY":
      return t("updateErrorBusy", "Another update task is already in progress.");
    case "UPDATE_INVALID_STATE":
      return t("updateErrorInvalidState", "This update action is not available in the current state.");
    case "UPDATE_UNSUPPORTED":
      return t("updateErrorUnsupported", "This build or platform does not support automatic updates.");
    case "UPDATE_UNKNOWN":
      return t("updateErrorUnknown", "An unexpected update error occurred. This version was not changed.");
  }
}

export function updateStatusColor(phase: DesktopUpdateState["phase"] | undefined): string {
  if (phase === "error") return "var(--danger)";
  if (phase === "available" || phase === "downloaded") return "var(--accent)";
  if (phase === "up-to-date") return "var(--success)";
  return "var(--text-dim)";
}

export function displayVersion(version: string): string {
  return version.startsWith("v") ? version : `v${version}`;
}

export function formatUpdateDate(value: string, language: AppLanguage): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat(language, { dateStyle: "medium", timeStyle: "short" }).format(date);
}

export function formatBytes(value: number, language: AppLanguage): string {
  if (!Number.isFinite(value) || value <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB"];
  const unitIndex = Math.max(0, Math.min(Math.floor(Math.log(value) / Math.log(1024)), units.length - 1));
  const amount = value / 1024 ** unitIndex;
  return `${new Intl.NumberFormat(language, { maximumFractionDigits: unitIndex === 0 ? 0 : 1 }).format(amount)} ${units[unitIndex]}`;
}

export const updateDetailStyle: React.CSSProperties = {
  margin: "12px 0 0",
  fontSize: "var(--text-label)",
  lineHeight: 1.55,
  color: "var(--text-muted)",
};
