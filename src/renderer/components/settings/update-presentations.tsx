import type { DesktopUpdateState } from "../../../contract/desktop";
import type { AppLanguage } from "@/i18n";
import { useI18n } from "@/i18n";
import { APP_DISPLAY_NAME } from "@/lib/app-version";
import { appReleaseUrl } from "@shared/app-links";
import { ArrowUpRightIcon } from "./about-icons";

type Translate = (key: string, fallback: string) => string;

export function UpdateNotes({ state }: { state: DesktopUpdateState }) {
  const { t } = useI18n();
  const releaseUrl = state.availableVersion ? appReleaseUrl(state.availableVersion) : null;
  if (!state.releaseNotes && !releaseUrl) return null;
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        gap: "var(--space-3)",
        padding: "var(--space-4) var(--space-5) var(--space-4-5)",
        borderTop: "1px solid var(--fx-line-default)",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: "var(--space-2)" }}>
        <h3 className="type-label-medium" style={{ flex: 1, margin: 0, color: "var(--fx-text-tertiary)" }}>
          {t("releaseNotes", "What's new")}
        </h3>
        {releaseUrl && (
          <button
            type="button"
            className="ui-link-button type-label-default"
            onClick={() => void window.piBridge.openExternal(releaseUrl)}
            style={{
              gap: "var(--space-1)",
              padding: "var(--space-0-5) var(--space-1-5)",
              borderRadius: "var(--radius-chip)",
              color: "var(--fx-text-tertiary)",
            }}
          >
            {t("fullChangelog", "Full changelog")}
            <ArrowUpRightIcon />
          </button>
        )}
      </div>
      {state.releaseNotes && (
        <p
          tabIndex={0}
          aria-label={t("releaseNotes", "What's new")}
          className="type-body-large"
          style={{
            margin: 0,
            maxHeight: 180,
            overflowY: "auto",
            paddingLeft: "var(--space-0-5)",
            color: "var(--fx-text-primary)",
            whiteSpace: "pre-wrap",
            overflowWrap: "anywhere",
          }}
        >
          {state.releaseNotes}
        </p>
      )}
    </div>
  );
}

export function UpdateDownloadProgress({ state, language }: { state: DesktopUpdateState; language: AppLanguage }) {
  const { t } = useI18n();
  const percent = Number.isFinite(state.percent) ? Math.max(0, Math.min(100, state.percent ?? 0)) : 0;
  const progressText = `${percent.toFixed(1)}%`;
  return (
    <div style={{ marginTop: "var(--space-2)", display: "grid", gap: "var(--space-1)" }}>
      <div
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={percent}
        aria-valuetext={progressText}
        aria-label={t("updateDownloadProgress", "Update download progress")}
        style={{
          width: "100%",
          height: 6,
          borderRadius: "var(--radius-pill)",
          background: "var(--fx-surface-track)",
          overflow: "hidden",
        }}
      >
        <div
          style={{
            width: `${percent}%`,
            height: "100%",
            borderRadius: "inherit",
            background: "var(--fx-accent-blue-fill)",
            transition: "width var(--duration-quick) var(--ease-out)",
          }}
        />
      </div>
      <div
        className="type-label-default"
        style={{
          display: "flex",
          flexWrap: "wrap",
          justifyContent: "space-between",
          gap: "var(--space-2)",
          color: "var(--fx-text-tertiary)",
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

export function getUpdateStatusTitle(state: DesktopUpdateState | null, t: Translate): string {
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
      return state.availableVersion
        ? t("availableVersion", "{app} {version} is ready to download")
            .replace("{app}", APP_DISPLAY_NAME)
            .replace("{version}", plainVersion(state.availableVersion))
        : t("updateAvailable", "An update is available");
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

export function getReleaseSummary(state: DesktopUpdateState, language: AppLanguage, t: Translate): string | null {
  const parts: string[] = [];
  if (state.releaseDate) {
    parts.push(t("releaseDate", "Released {date}").replace("{date}", formatReleaseDay(state.releaseDate, language)));
  }
  if (state.total !== undefined && state.total > 0) {
    parts.push(t("updateApproxSize", "About {size}").replace("{size}", formatBytes(state.total, language)));
  }
  return parts.length > 0 ? parts.join(" · ") : null;
}

export function getUpdateErrorMessage(error: NonNullable<DesktopUpdateState["error"]>, t: Translate): string {
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
  if (phase === "error") return "var(--fx-status-danger)";
  if (phase === "available" || phase === "downloaded") return "var(--fx-accent-blue)";
  if (phase === "up-to-date") return "var(--fx-status-success)";
  return "var(--fx-text-tertiary)";
}

function plainVersion(version: string): string {
  return version.startsWith("v") ? version.slice(1) : version;
}

function formatReleaseDay(value: string, language: AppLanguage): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  if (language === "zh-CN") return `${date.getFullYear()} 年 ${date.getMonth() + 1} 月 ${date.getDate()} 日`;
  return new Intl.DateTimeFormat(language, { dateStyle: "long" }).format(date);
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
