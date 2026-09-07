import { useI18n } from "@/i18n";
import type { PluginPackageInfo } from "@/lib/api-types";
import { pluginResourceSummary, pluginStatusLabel, pluginVersionSummary } from "@/lib/plugin-presentation";
import { packageKey, shortenPath, statusColor, buttonStyle, type PluginAction } from "./plugin-shared";
import { PluginToggle, ScopeTag } from "./plugin-controls";
import { ResourceList } from "./resource-list";

export function PackageDetail({
  pkg,
  cwd,
  busyKey,
  actionError,
  actionMessage,
  sessionId,
  onAction,
  onReloadSession,
}: {
  pkg: PluginPackageInfo;
  cwd: string;
  busyKey: string | null;
  actionError: string | null;
  actionMessage: string | null;
  sessionId: string | null;
  onAction: (action: PluginAction, pkg: PluginPackageInfo) => void;
  onReloadSession: () => void;
}) {
  const { language, t } = useI18n();
  const key = packageKey(pkg);
  const busy = busyKey?.endsWith(key) ?? false;
  const reloadBusy = busyKey === "reload";
  const enabled = !pkg.disabled;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20, maxWidth: 680 }}>
      <div
        style={{
          display: "flex",
          alignItems: "flex-start",
          justifyContent: "space-between",
          gap: 12,
          minWidth: 0,
          flexWrap: "wrap",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 8, minWidth: 180, flex: 1 }}>
          <PluginToggle
            enabled={enabled}
            loading={busy || reloadBusy}
            onToggle={() => onAction(pkg.disabled ? "enable" : "disable", pkg)}
            label={
              pkg.disabled ? t("pluginEnablePackage", "Enable package") : t("pluginDisablePackage", "Disable package")
            }
          />
          <ScopeTag scope={pkg.scope} />
          {pkg.disabled ? (
            <span
              style={{
                fontSize: "var(--text-micro)",
                padding: "1px 4px",
                borderRadius: "var(--radius-chip)",
                background: "rgba(120,120,120,0.12)",
                color: "var(--text-dim)",
              }}
            >
              {t("pluginStatusDisabled", "Disabled")}
            </span>
          ) : (
            pkg.filtered && (
              <span
                style={{
                  fontSize: "var(--text-micro)",
                  padding: "1px 4px",
                  borderRadius: "var(--radius-chip)",
                  background: "rgba(245,158,11,0.12)",
                  color: "var(--warning)",
                }}
              >
                {t("pluginFiltered", "filtered")}
              </span>
            )
          )}
          <span
            style={{
              fontFamily: "var(--font-mono)",
              fontSize: "var(--text-label)",
              color: "var(--text)",
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
            }}
          >
            {pkg.source}
          </span>
        </div>

        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <button
            onClick={() => onAction("update", pkg)}
            disabled={busy || reloadBusy}
            style={buttonStyle(busy || reloadBusy)}
          >
            {busyKey === `update:${key}` ? t("pluginUpdating", "Updating…") : t("pluginUpdate", "Update")}
          </button>
          <button
            onClick={onReloadSession}
            disabled={!sessionId || reloadBusy || busy}
            style={buttonStyle(!sessionId || reloadBusy || busy)}
            title={
              sessionId
                ? t("pluginReloadCurrentSession", "Reload current session")
                : t("pluginOpenSessionToReload", "Open a session to reload")
            }
          >
            {reloadBusy ? t("pluginReloading", "Reloading…") : t("pluginReloadSession", "Reload session")}
          </button>
          <button
            onClick={() => onAction("remove", pkg)}
            disabled={busy || reloadBusy}
            style={buttonStyle(busy || reloadBusy, true)}
          >
            {busyKey === `remove:${key}` ? t("pluginRemoving", "Removing…") : t("pluginRemove", "Remove")}
          </button>
        </div>
      </div>

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "minmax(96px, 130px) minmax(0, 1fr)",
          gap: "8px 16px",
          fontSize: "var(--text-label)",
          lineHeight: 1.45,
        }}
      >
        <div style={{ color: "var(--text-dim)" }}>{t("pluginStatus", "Status")}</div>
        <div style={{ color: statusColor(pkg.status) }}>{pluginStatusLabel(pkg.status, t)}</div>
        <div style={{ color: "var(--text-dim)" }}>{t("pluginVersion", "Version")}</div>
        <div style={{ color: "var(--text-muted)", fontFamily: "var(--font-mono)" }}>{pluginVersionSummary(pkg, t)}</div>
        <div style={{ color: "var(--text-dim)" }}>{t("pluginPackage", "Package")}</div>
        <div style={{ color: "var(--text-muted)", fontFamily: "var(--font-mono)", overflowWrap: "anywhere" }}>
          {pkg.packageName ?? t("unknown", "unknown")}
        </div>
        <div style={{ color: "var(--text-dim)" }}>{t("pluginResources", "Resources")}</div>
        <div style={{ color: "var(--text-muted)" }}>{pluginResourceSummary(pkg, language, t)}</div>
        <div style={{ color: "var(--text-dim)" }}>{t("pluginInstalledPath", "Installed path")}</div>
        <div
          style={{
            color: pkg.installedPath ? "var(--text-muted)" : "var(--danger)",
            fontFamily: "var(--font-mono)",
            overflowWrap: "anywhere",
          }}
        >
          {pkg.installedPath ? shortenPath(pkg.installedPath) : t("pluginNotFound", "Not found")}
        </div>
        <div style={{ color: "var(--text-dim)" }}>{t("pluginCwd", "Cwd")}</div>
        <div style={{ color: "var(--text-dim)", fontFamily: "var(--font-mono)", overflowWrap: "anywhere" }}>
          {shortenPath(cwd)}
        </div>
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        <div style={{ fontSize: "var(--text-label)", fontWeight: 700, color: "var(--text)" }}>
          {t("pluginResolvedResources", "Resolved resources")}
        </div>
        <ResourceList pkg={pkg} />
      </div>

      {actionMessage && <div style={{ fontSize: "var(--text-label)", color: "var(--success)" }}>{actionMessage}</div>}
      {actionError && (
        <div style={{ fontSize: "var(--text-label)", color: "var(--danger)", whiteSpace: "pre-wrap" }}>
          {actionError}
        </div>
      )}
    </div>
  );
}
