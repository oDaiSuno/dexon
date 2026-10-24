import { useI18n } from "@/i18n";
import { Button } from "../form-controls";
import { PlusIcon } from "../resources/overview-icons";
import type { PluginPackageInfo } from "@/lib/api-types";
import { pluginResourceSummary, pluginVersionSummary } from "@/lib/plugin-presentation";
import { packageKey, pluginScopeLabel, statusColor, type PluginScope } from "./plugin-shared";

export function PluginList({
  groupedPackages,
  loading,
  error,
  selected,
  addMode,
  isMobile,
  onSelectPackage,
  onAddPlugin,
}: {
  groupedPackages: { scope: PluginScope; packages: PluginPackageInfo[] }[];
  loading: boolean;
  error: string | null;
  selected: string | null;
  addMode: boolean;
  isMobile: boolean;
  onSelectPackage: (key: string) => void;
  onAddPlugin: () => void;
}) {
  const { language, t } = useI18n();
  return (
    <div
      style={{
        width: isMobile ? "100%" : 245,
        maxHeight: isMobile ? "40vh" : undefined,
        borderRight: isMobile ? "none" : "1px solid var(--fx-line-default)",
        borderBottom: isMobile ? "1px solid var(--fx-line-default)" : "none",
        display: "flex",
        flexDirection: "column",
        flexShrink: 0,
        background: "var(--fx-surface-raised)",
      }}
    >
      <div style={{ flex: 1, overflowY: "auto", padding: "8px 8px" }}>
        {loading ? (
          <div style={{ padding: "12px 8px", fontSize: "var(--text-label)", color: "var(--fx-text-secondary)" }}>
            {t("loading", "Loading…")}
          </div>
        ) : error ? (
          <div style={{ padding: "12px 8px", fontSize: "var(--text-meta)", color: "var(--fx-status-danger)" }}>
            {error}
          </div>
        ) : groupedPackages.length === 0 ? (
          <div style={{ padding: "12px 8px", fontSize: "var(--text-meta)", color: "var(--fx-text-tertiary)" }}>
            {t("pluginNoPackagesConfigured", "No plugins configured")}
          </div>
        ) : (
          groupedPackages.map((group) => (
            <div key={group.scope} style={{ marginBottom: 8 }}>
              <div
                style={{
                  padding: "4px 8px 4px",
                  fontSize: "var(--text-micro)",
                  fontWeight: 600,
                  color: "var(--fx-text-tertiary)",
                  textTransform: "uppercase",
                }}
              >
                {pluginScopeLabel(group.scope, t)}
              </div>
              {group.packages.map((pkg) => {
                const key = packageKey(pkg);
                const isSelected = !addMode && selected === key;
                return (
                  <div
                    key={key}
                    onClick={() => {
                      onSelectPackage(key);
                    }}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 8,
                      padding: "8px 8px",
                      borderRadius: "var(--radius-control)",
                      cursor: "pointer",
                      background: isSelected ? "var(--bg-selected)" : "none",
                    }}
                    onMouseEnter={(e) => {
                      if (!isSelected) e.currentTarget.style.background = "var(--bg-hover)";
                    }}
                    onMouseLeave={(e) => {
                      if (!isSelected) e.currentTarget.style.background = "none";
                    }}
                  >
                    <span
                      style={{
                        flexShrink: 0,
                        width: 7,
                        height: 7,
                        borderRadius: "50%",
                        background: statusColor(pkg.status),
                      }}
                    />
                    <div style={{ minWidth: 0, flex: 1 }}>
                      <div
                        style={{
                          fontSize: "var(--text-label)",
                          fontWeight: isSelected ? 600 : 400,
                          color: "var(--fx-text-primary)",
                          fontFamily: "var(--font-mono)",
                          overflow: "hidden",
                          textOverflow: "ellipsis",
                          whiteSpace: "nowrap",
                        }}
                      >
                        {pkg.source}
                      </div>
                      <div
                        style={{
                          fontSize: "var(--text-micro)",
                          color: "var(--fx-text-tertiary)",
                          overflow: "hidden",
                          textOverflow: "ellipsis",
                          whiteSpace: "nowrap",
                          marginTop: 2,
                        }}
                      >
                        {pluginResourceSummary(pkg, language, t)}
                      </div>
                      {(pkg.version || pkg.configuredVersion) && (
                        <div
                          style={{
                            fontSize: "var(--text-micro)",
                            color: "var(--fx-text-tertiary)",
                            overflow: "hidden",
                            textOverflow: "ellipsis",
                            whiteSpace: "nowrap",
                            marginTop: 2,
                          }}
                        >
                          {pluginVersionSummary(pkg, t)}
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          ))
        )}
      </div>
      <div style={{ padding: "8px 8px", borderTop: "1px solid var(--fx-line-default)", flexShrink: 0 }}>
        <Button
          variant={addMode ? "secondary" : "ghost"}
          aria-pressed={addMode}
          onClick={onAddPlugin}
          className="w-full justify-start"
        >
          <PlusIcon size={14} />
          {t("addPlugin", "Add plugin")}
        </Button>
      </div>
    </div>
  );
}
