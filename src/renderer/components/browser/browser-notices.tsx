import { useI18n } from "@/i18n";
import { BrowserIcon, type BrowserIconName } from "./browser-icons";
import type { BrowserDownloadInfo, BrowserPermissionRequest } from "../../../contract/browser";

type Translate = ReturnType<typeof useI18n>["t"];

export function BrowserPermissionBar({
  request,
  onRespond,
}: {
  request: BrowserPermissionRequest;
  onRespond: () => Promise<void>;
}) {
  const { t } = useI18n();
  const respond = (decision: "allow-once" | "allow-session" | "deny") =>
    void window.piBridge.browserRespondPermission(request.id, decision).then(onRespond);
  const permission = permissionPresentation(t, request.permission);
  return (
    <div
      role="group"
      data-browser-permission={request.permission}
      style={{
        display: "flex",
        flexShrink: 0,
        alignItems: "center",
        gap: 10,
        padding: "10px 12px",
        borderBottom: "1px solid var(--fx-line-default)",
        background: "var(--fx-surface-raised)",
      }}
    >
      <span style={{ color: "var(--fx-text-secondary)" }}>
        <BrowserIcon name={permission.icon} size={16} strokeWidth={1.75} />
      </span>
      <div style={{ display: "flex", flex: 1, flexDirection: "column", gap: 2, minWidth: 0 }}>
        <div className="type-label-default" style={{ color: "var(--fx-text-secondary)", overflowWrap: "anywhere" }}>
          {renderRequestText(
            t("browserPermissionRequest", "{origin} wants to use {permission}"),
            hostOf(request.origin),
            permission.label,
          )}
        </div>
        <div className="type-meta-default" style={{ color: "var(--fx-text-tertiary)" }}>
          {t("browserPermissionScope", "Only affects this tab")}
        </div>
      </div>
      <div style={{ display: "flex", flexShrink: 0, alignItems: "center", gap: 4 }}>
        <button
          type="button"
          className={`${permissionButtonClass} ${secondaryPermissionButtonClass}`}
          onClick={() => respond("deny")}
        >
          {t("browserDeny", "Deny")}
        </button>
        <button
          type="button"
          className={`${permissionButtonClass} ${secondaryPermissionButtonClass}`}
          onClick={() => respond("allow-once")}
        >
          {t("browserAllowOnce", "Once")}
        </button>
        <button
          type="button"
          className={`${permissionButtonClass} ${primaryPermissionButtonClass}`}
          onClick={() => respond("allow-session")}
        >
          {t("browserAllowSession", "Session")}
        </button>
      </div>
    </div>
  );
}

export function BrowserNotice({ error, download }: { error: string; download: BrowserDownloadInfo | undefined }) {
  if (!error && !download) return null;
  return (
    <div
      role="status"
      style={{
        display: "flex",
        flexShrink: 0,
        flexDirection: "column",
        gap: 4,
        padding: "8px 12px",
        borderBottom: "1px solid var(--fx-line-default)",
        background: "var(--fx-surface-raised)",
      }}
    >
      {error ? (
        <NoticeLine icon="triangle-alert" color="var(--fx-status-danger-text)">
          {error}
        </NoticeLine>
      ) : null}
      {download ? <DownloadLine download={download} /> : null}
    </div>
  );
}

function DownloadLine({ download }: { download: BrowserDownloadInfo }) {
  const { t } = useI18n();
  const percent = download.totalBytes > 0 ? Math.round((download.receivedBytes / download.totalBytes) * 100) : null;
  const interrupted = download.state === "interrupted";
  return (
    <NoticeLine
      icon={interrupted ? "triangle-alert" : "loader"}
      spinning={!interrupted}
      color={interrupted ? "var(--fx-status-danger-text)" : "var(--fx-text-secondary)"}
    >
      {formatMessage(t("browserDownloadStatus", "Download {filename}: {state}{percent}"), {
        filename: download.filename,
        state: downloadStateLabel(t, download.state),
        percent: percent === null ? "" : ` ${percent}%`,
      })}
    </NoticeLine>
  );
}

function NoticeLine({
  icon,
  color,
  spinning,
  children,
}: {
  icon: BrowserIconName;
  color: string;
  spinning?: boolean;
  children: string;
}) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8, minWidth: 0, color }}>
      <BrowserIcon name={icon} size={14} strokeWidth={1.75} className={spinning ? "browser-spin" : undefined} />
      <span className="type-label-default" style={{ minWidth: 0, overflowWrap: "anywhere" }}>
        {children}
      </span>
    </div>
  );
}

export function activeDownload(downloads: BrowserDownloadInfo[]): BrowserDownloadInfo | undefined {
  return [...downloads]
    .reverse()
    .find(
      (download) =>
        download.state === "pending" || download.state === "progressing" || download.state === "interrupted",
    );
}

function permissionPresentation(t: Translate, permission: string): { icon: BrowserIconName; label: string } {
  switch (permission) {
    case "media":
      return { icon: "camera", label: t("browserPermissionMedia", "your camera") };
    case "fullscreen":
      return { icon: "maximize", label: t("browserPermissionFullscreen", "full screen") };
    case "pointerLock":
      return { icon: "mouse-pointer", label: t("browserPermissionPointerLock", "pointer lock") };
    case "clipboard-sanitized-write":
      return { icon: "clipboard", label: t("browserPermissionClipboardWrite", "the clipboard") };
    default:
      return { icon: "shield-alert", label: permission };
  }
}

function renderRequestText(template: string, host: string, permission: string) {
  const [before, after = ""] = template.split("{origin}");
  return (
    <>
      {before}
      <span style={{ color: "var(--fx-text-primary)" }}>{host}</span>
      {formatMessage(after, { permission })}
    </>
  );
}

function hostOf(origin: string): string {
  try {
    return new URL(origin).host || origin;
  } catch {
    return origin;
  }
}

function formatMessage(template: string, values: Record<string, string | number>): string {
  return Object.entries(values).reduce(
    (message, [key, value]) => message.replaceAll(`{${key}}`, String(value)),
    template,
  );
}

function downloadStateLabel(t: Translate, state: BrowserDownloadInfo["state"]): string {
  switch (state) {
    case "pending":
      return t("browserDownloadPending", "pending");
    case "progressing":
      return t("browserDownloadProgressing", "progressing");
    case "completed":
      return t("browserDownloadCompleted", "completed");
    case "cancelled":
      return t("browserDownloadCancelled", "cancelled");
    default:
      return t("browserDownloadInterrupted", "interrupted");
  }
}

const permissionButtonClass =
  "type-label-medium inline-flex h-[26px] cursor-pointer items-center whitespace-nowrap rounded-[var(--radius-chip)] border border-solid px-[10px] transition-colors duration-[var(--duration-quick)] ease-[var(--ease-smooth-out)] motion-reduce:transition-none";
const secondaryPermissionButtonClass =
  "border-[var(--fx-line-default)] bg-[var(--fx-surface-card)] text-[var(--fx-text-primary)] hover:bg-[var(--fx-surface-hover)]";
const primaryPermissionButtonClass =
  "border-transparent bg-[var(--fx-surface-inverse)] text-[var(--fx-text-inverse)] hover:bg-[var(--fx-surface-inverse-hover)]";
