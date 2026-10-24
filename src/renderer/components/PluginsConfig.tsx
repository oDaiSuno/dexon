import type { CSSProperties } from "react";
import { useIsMobile } from "@/hooks/useIsMobile";
import { useI18n } from "@/i18n";
import { CapabilityRequired } from "@/components/CapabilityRequired";
import { formatNumber } from "@/lib/locale-format";
import { AddPluginPanel } from "./plugins/add-plugin-panel";
import { PackageDetail } from "./plugins/package-detail";
import { PluginList } from "./plugins/plugin-list";
import { usePluginLibrary, type PluginLibrary } from "./plugins/use-plugin-library";
import { buttonStyle, packageKey, shortenPath } from "./plugins/plugin-shared";

const embeddedFrame: CSSProperties = { position: "relative", flex: 1, minWidth: 0, minHeight: 0, display: "flex" };
const dialogFrame: CSSProperties = {
  position: "fixed",
  inset: 0,
  zIndex: 1000,
  background: "var(--fx-surface-scrim)",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
};

interface PluginsConfigProps {
  cwd: string;
  sessionId: string | null;
  onClose: () => void;
  onReloaded?: () => void;
  embedded?: boolean;
}

export function PluginsConfig({ onReloaded, ...props }: PluginsConfigProps) {
  const library = usePluginLibrary({ cwd: props.cwd, sessionId: props.sessionId, onReloaded });
  return <PluginsManager {...props} library={library} />;
}

export function PluginsManager({
  cwd,
  sessionId,
  onClose,
  embedded = false,
  library,
}: Omit<PluginsConfigProps, "onReloaded"> & { library: PluginLibrary }) {
  const isMobile = useIsMobile();
  const { language, t } = useI18n();

  const {
    data,
    loading,
    error,
    selectedPackage,
    groupedPackages,
    selected,
    addMode,
    installSource,
    busyKey,
    actionError,
    actionMessage,
    capabilityIssue,
    hasPendingCapabilityOperation,
    addBusy,
    setInstallSource,
    setInstallScope,
    selectPackage,
    openAddMode,
    clearCapabilityPending,
    loadPlugins,
    runAction,
    installPlugin,
    retryCapabilityOperation,
    reloadSession,
  } = library;

  return (
    <div
      style={embedded ? embeddedFrame : dialogFrame}
      onClick={(e) => {
        if (!embedded && e.target === e.currentTarget) onClose();
      }}
    >
      <div
        style={{
          width: embedded ? "100%" : isMobile ? "calc(100vw - 16px)" : 860,
          maxWidth: embedded ? undefined : "calc(100vw - 16px)",
          height: embedded ? "100%" : isMobile ? "calc(100dvh - 16px)" : "76vh",
          maxHeight: embedded ? undefined : "calc(100dvh - 16px)",
          background: "var(--fx-surface-main)",
          border: embedded ? "none" : "1px solid var(--fx-line-default)",
          borderRadius: embedded ? 0 : "var(--radius-control)",
          display: "flex",
          flexDirection: "column",
          boxShadow: embedded ? "none" : "var(--shadow-dialog)",
          overflow: "hidden",
        }}
      >
        {!embedded && (
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              padding: "12px 20px",
              borderBottom: "1px solid var(--fx-line-default)",
              flexShrink: 0,
            }}
          >
            <div style={{ display: "flex", alignItems: "baseline", gap: 12, minWidth: 0 }}>
              <span className="type-title-dialog" style={{ color: "var(--fx-text-primary)" }}>
                {t("plugins", "Plugins")}
              </span>
              <code
                className="type-mono-meta"
                style={{
                  color: "var(--fx-text-secondary)",
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap",
                }}
              >
                {shortenPath(cwd)}
              </code>
            </div>
            <button
              onClick={onClose}
              className="type-title-page"
              style={{
                background: "none",
                border: "none",
                color: "var(--fx-text-secondary)",
                cursor: "pointer",
                padding: "2px 8px",
              }}
            >
              ×
            </button>
          </div>
        )}

        <div style={{ flex: 1, display: "flex", flexDirection: isMobile ? "column" : "row", overflow: "hidden" }}>
          <PluginList
            groupedPackages={groupedPackages}
            loading={loading}
            error={error}
            selected={selected}
            addMode={addMode}
            isMobile={isMobile}
            onSelectPackage={selectPackage}
            onAddPlugin={openAddMode}
          />

          <div style={{ flex: 1, overflowY: "auto", padding: 20 }}>
            {capabilityIssue && hasPendingCapabilityOperation && (
              <div style={{ marginBottom: 16 }}>
                <CapabilityRequired
                  issue={capabilityIssue}
                  cwd={cwd}
                  onContinue={retryCapabilityOperation}
                  onCancel={clearCapabilityPending}
                />
              </div>
            )}
            {addMode ? (
              <AddPluginPanel
                cwd={cwd}
                source={installSource}
                scope={library.installScope}
                busy={addBusy}
                actionError={actionError}
                onSourceChange={setInstallSource}
                onScopeChange={setInstallScope}
                onInstall={installPlugin}
              />
            ) : loading ? null : selectedPackage ? (
              <PackageDetail
                key={packageKey(selectedPackage)}
                pkg={selectedPackage}
                cwd={cwd}
                busyKey={busyKey}
                actionError={actionError}
                actionMessage={actionMessage}
                sessionId={sessionId}
                onAction={runAction}
                onReloadSession={reloadSession}
              />
            ) : (
              <div
                className="type-body-default"
                style={{
                  height: "100%",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  color: "var(--fx-text-tertiary)",
                }}
              >
                {t("selectPackage", "Select a package")}
              </div>
            )}
          </div>
        </div>

        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: 12,
            padding: "12px 20px",
            borderTop: "1px solid var(--fx-line-default)",
            flexShrink: 0,
          }}
        >
          <div
            className="type-meta-default"
            style={{ minWidth: 0, flex: 1, color: "var(--fx-text-tertiary)", overflow: "hidden" }}
          >
            {data?.diagnostics.length ? (
              <span
                title={data.diagnostics
                  .map((d) => `${d.type}: ${d.source ? `${d.source}: ` : ""}${d.message}`)
                  .join("\n")}
                style={{
                  color: data.diagnostics.some((d) => d.type === "error")
                    ? "var(--fx-status-danger)"
                    : "var(--fx-status-warning)",
                }}
              >
                {t("pluginDiagnosticCount", "{count} diagnostics").replace(
                  "{count}",
                  formatNumber(data.diagnostics.length, language),
                )}
              </span>
            ) : (
              <span>
                {data
                  ? [
                      t("pluginExtensionCount", "{count} ext").replace(
                        "{count}",
                        formatNumber(data.totals.extensions, language),
                      ),
                      t("pluginSkillCount", "{count} skills").replace(
                        "{count}",
                        formatNumber(data.totals.skills, language),
                      ),
                      t("pluginPromptCount", "{count} prompts").replace(
                        "{count}",
                        formatNumber(data.totals.prompts, language),
                      ),
                      t("pluginThemeCount", "{count} themes").replace(
                        "{count}",
                        formatNumber(data.totals.themes, language),
                      ),
                    ].join(" · ")
                  : ""}
              </span>
            )}
          </div>
          <button
            onClick={() => void loadPlugins()}
            disabled={loading || busyKey !== null}
            style={buttonStyle(loading || busyKey !== null)}
          >
            {t("refresh", "Refresh")}
          </button>
          {!embedded && (
            <button onClick={onClose} style={buttonStyle(false)}>
              {t("close", "Close")}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
