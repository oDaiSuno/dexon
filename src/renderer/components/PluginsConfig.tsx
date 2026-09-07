import { useIsMobile } from "@/hooks/useIsMobile";
import { useI18n } from "@/i18n";
import { CapabilityRequired } from "@/components/CapabilityRequired";
import { formatNumber } from "@/lib/locale-format";
import { AddPluginPanel } from "./plugins/add-plugin-panel";
import { PackageDetail } from "./plugins/package-detail";
import { PluginList } from "./plugins/plugin-list";
import { usePluginLibrary } from "./plugins/use-plugin-library";
import { buttonStyle, packageKey, shortenPath } from "./plugins/plugin-shared";

export function PluginsConfig({
  cwd,
  sessionId,
  onClose,
  onReloaded,
  embedded = false,
}: {
  cwd: string;
  sessionId: string | null;
  onClose: () => void;
  onReloaded?: () => void;
  embedded?: boolean;
}) {
  const isMobile = useIsMobile();
  const { language, t } = useI18n();
  const library = usePluginLibrary({ cwd, sessionId, onReloaded });

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
      style={
        embedded
          ? {
              position: "relative",
              flex: 1,
              minWidth: 0,
              minHeight: 0,
              display: "flex",
            }
          : {
              position: "fixed",
              inset: 0,
              zIndex: 1000,
              background: "rgba(0,0,0,0.35)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
            }
      }
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
          background: "var(--bg)",
          border: embedded ? "none" : "1px solid var(--border)",
          borderRadius: embedded ? 0 : 8,
          display: "flex",
          flexDirection: "column",
          boxShadow: embedded ? "none" : "0 8px 32px rgba(0,0,0,0.18)",
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
              borderBottom: "1px solid var(--border)",
              flexShrink: 0,
            }}
          >
            <div style={{ display: "flex", alignItems: "baseline", gap: 12, minWidth: 0 }}>
              <span style={{ fontSize: "var(--text-title)", fontWeight: 700, color: "var(--text)" }}>
                {t("plugins", "Plugins")}
              </span>
              <code
                style={{
                  fontSize: "var(--text-meta)",
                  color: "var(--text-muted)",
                  fontFamily: "var(--font-mono)",
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
              style={{
                background: "none",
                border: "none",
                color: "var(--text-muted)",
                cursor: "pointer",
                fontSize: "var(--text-display)",
                lineHeight: 1,
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
                style={{
                  height: "100%",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  color: "var(--text-dim)",
                  fontSize: "var(--text-body)",
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
            borderTop: "1px solid var(--border)",
            flexShrink: 0,
          }}
        >
          <div
            style={{ minWidth: 0, flex: 1, fontSize: "var(--text-meta)", color: "var(--text-dim)", overflow: "hidden" }}
          >
            {data?.diagnostics.length ? (
              <span
                title={data.diagnostics
                  .map((d) => `${d.type}: ${d.source ? `${d.source}: ` : ""}${d.message}`)
                  .join("\n")}
                style={{ color: data.diagnostics.some((d) => d.type === "error") ? "var(--danger)" : "var(--warning)" }}
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
