import { useI18n } from "@/i18n";
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
        borderRight: isMobile ? "none" : "1px solid var(--border)",
        borderBottom: isMobile ? "1px solid var(--border)" : "none",
        display: "flex",
        flexDirection: "column",
        flexShrink: 0,
        background: "var(--bg-panel)",
      }}
    >
      <div style={{ flex: 1, overflowY: "auto", padding: "8px 8px" }}>
        {loading ? (
          <div style={{ padding: "12px 8px", fontSize: "var(--text-label)", color: "var(--text-muted)" }}>
            {t("loading", "Loading…")}
          </div>
        ) : error ? (
          <div style={{ padding: "12px 8px", fontSize: "var(--text-meta)", color: "var(--danger)" }}>{error}</div>
        ) : groupedPackages.length === 0 ? (
          <div style={{ padding: "12px 8px", fontSize: "var(--text-meta)", color: "var(--text-dim)" }}>
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
                  color: "var(--text-dim)",
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
                          color: "var(--text)",
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
                          color: "var(--text-dim)",
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
                            color: "var(--text-dim)",
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
      <div style={{ padding: "8px 8px", borderTop: "1px solid var(--border)", flexShrink: 0 }}>
        <button
          type="button"
          onClick={onAddPlugin}
          style={{
            display: "flex",
            alignItems: "center",
            gap: 8,
            padding: "8px 8px",
            borderRadius: "var(--radius-control)",
            border: "none",
            width: "100%",
            cursor: "pointer",
            background: addMode ? "var(--bg-selected)" : "none",
            color: addMode ? "var(--accent)" : "var(--text-dim)",
            fontSize: "var(--text-label)",
          }}
          onMouseEnter={(e) => {
            if (!addMode) e.currentTarget.style.background = "var(--bg-hover)";
          }}
          onMouseLeave={(e) => {
            if (!addMode) e.currentTarget.style.background = "none";
          }}
        >
          <svg
            width="13"
            height="13"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <line x1="12" y1="5" x2="12" y2="19" />
            <line x1="5" y1="12" x2="19" y2="12" />
          </svg>
          {t("addPlugin", "Add plugin")}
        </button>
      </div>
    </div>
  );
}
