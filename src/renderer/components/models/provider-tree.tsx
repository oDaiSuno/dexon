import { useI18n } from "@/i18n";
import type { ProviderEntry } from "@/lib/models-config-state";
import { ProviderIcon } from "./provider-icon";
import type { ApiKeyProvider, OAuthProvider, Selection } from "./types";

export function ProviderTree({
  isMobile,
  loading,
  providers,
  activeOAuth,
  activeApiKey,
  selection,
  setSelection,
  addModel,
  setPickerOpen,
}: {
  isMobile: boolean;
  loading: boolean;
  providers: [string, ProviderEntry][];
  activeOAuth: OAuthProvider[];
  activeApiKey: ApiKeyProvider[];
  selection: Selection | null;
  setSelection: (selection: Selection | null) => void;
  addModel: (providerName: string) => void;
  setPickerOpen: (open: boolean) => void;
}) {
  const { t } = useI18n();
  return (
    <div
      style={{
        width: isMobile ? "100%" : 210,
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
        {activeOAuth.map((p) => {
          const isSelected = selection?.type === "oauth" && selection.providerId === p.id;
          return (
            <div
              key={p.id}
              onClick={() => setSelection({ type: "oauth", providerId: p.id })}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 8,
                padding: "4px 8px",
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
              <ProviderIcon id={p.id} size={16} />
              <span
                style={{
                  fontSize: "var(--text-label)",
                  color: "var(--fx-text-primary)",
                  flex: 1,
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap",
                }}
              >
                {p.name}
              </span>
            </div>
          );
        })}

        {activeApiKey.map((p) => {
          const isSelected = selection?.type === "apikey" && selection.providerId === p.id;
          return (
            <div
              key={p.id}
              onClick={() => setSelection({ type: "apikey", providerId: p.id })}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 8,
                padding: "4px 8px",
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
              <ProviderIcon id={p.id} size={16} />
              <span
                style={{
                  fontSize: "var(--text-label)",
                  color: "var(--fx-text-primary)",
                  flex: 1,
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap",
                }}
              >
                {p.displayName}
              </span>
            </div>
          );
        })}

        {(activeOAuth.length > 0 || activeApiKey.length > 0) && providers.length > 0 && (
          <div style={{ margin: "4px 8px", borderTop: "1px solid var(--fx-line-default)" }} />
        )}

        {loading ? (
          <div style={{ padding: "12px 8px", fontSize: "var(--text-label)", color: "var(--fx-text-secondary)" }}>
            {t("loading", "Loading…")}
          </div>
        ) : (
          providers.map(([pName, pData]) => {
            const isProviderSelected = selection?.type === "provider" && selection.name === pName;
            const models = pData.models ?? [];
            return (
              <div key={pName} style={{ marginBottom: 2 }}>
                <div
                  onClick={() => setSelection({ type: "provider", name: pName })}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 8,
                    padding: "8px 8px",
                    borderRadius: "var(--radius-control)",
                    cursor: "pointer",
                    background: isProviderSelected ? "var(--bg-selected)" : "none",
                  }}
                  onMouseEnter={(e) => {
                    if (!isProviderSelected) e.currentTarget.style.background = "var(--bg-hover)";
                  }}
                  onMouseLeave={(e) => {
                    if (!isProviderSelected) e.currentTarget.style.background = "none";
                  }}
                >
                  <svg
                    width="11"
                    height="11"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    style={{ color: "var(--fx-text-tertiary)", flexShrink: 0 }}
                  >
                    <rect x="4" y="4" width="16" height="16" rx="2" />
                    <rect x="9" y="9" width="6" height="6" />
                    <line x1="9" y1="1" x2="9" y2="4" />
                    <line x1="15" y1="1" x2="15" y2="4" />
                    <line x1="9" y1="20" x2="9" y2="23" />
                    <line x1="15" y1="20" x2="15" y2="23" />
                    <line x1="20" y1="9" x2="23" y2="9" />
                    <line x1="20" y1="14" x2="23" y2="14" />
                    <line x1="1" y1="9" x2="4" y2="9" />
                    <line x1="1" y1="14" x2="4" y2="14" />
                  </svg>
                  <span
                    style={{
                      fontSize: "var(--text-label)",
                      fontWeight: isProviderSelected ? 600 : 400,
                      color: "var(--fx-text-primary)",
                      fontFamily: "var(--font-mono)",
                      flex: 1,
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      whiteSpace: "nowrap",
                    }}
                  >
                    {pName}
                  </span>
                </div>

                {models.map((m, i) => {
                  const isModelSelected =
                    selection?.type === "model" && selection.providerName === pName && selection.index === i;
                  return (
                    <div
                      key={i}
                      onClick={() => setSelection({ type: "model", providerName: pName, index: i })}
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: 8,
                        padding: "4px 8px 4px 28px",
                        borderRadius: "var(--radius-control)",
                        cursor: "pointer",
                        background: isModelSelected ? "var(--bg-selected)" : "none",
                      }}
                      onMouseEnter={(e) => {
                        if (!isModelSelected) e.currentTarget.style.background = "var(--bg-hover)";
                      }}
                      onMouseLeave={(e) => {
                        if (!isModelSelected) e.currentTarget.style.background = "none";
                      }}
                    >
                      <span
                        style={{
                          fontSize: "var(--text-meta)",
                          fontFamily: "var(--font-mono)",
                          color: m.id ? "var(--fx-text-secondary)" : "var(--fx-text-tertiary)",
                          flex: 1,
                          overflow: "hidden",
                          textOverflow: "ellipsis",
                          whiteSpace: "nowrap",
                        }}
                      >
                        {m.id || t("modelNewModel", "new model")}
                      </span>
                      {m.reasoning && (
                        <span
                          style={{
                            fontSize: "var(--text-micro)",
                            padding: "1px 4px",
                            background: "rgba(99,102,241,0.12)",
                            color: "rgba(99,102,241,0.8)",
                            borderRadius: "var(--radius-chip)",
                            flexShrink: 0,
                          }}
                        >
                          T
                        </span>
                      )}
                    </div>
                  );
                })}

                <div
                  onClick={(e) => {
                    e.stopPropagation();
                    addModel(pName);
                  }}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 4,
                    padding: "4px 8px 4px 28px",
                    borderRadius: "var(--radius-control)",
                    cursor: "pointer",
                    color: "var(--fx-text-tertiary)",
                  }}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.color = "var(--fx-accent-blue)";
                    e.currentTarget.style.background = "var(--bg-hover)";
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.color = "var(--fx-text-tertiary)";
                    e.currentTarget.style.background = "none";
                  }}
                >
                  <span style={{ fontSize: "var(--text-meta)" }}>+ {t("modelAddModel", "model")}</span>
                </div>
              </div>
            );
          })
        )}
      </div>

      <div style={{ borderTop: "1px solid var(--fx-line-default)", padding: "8px 8px" }}>
        <button
          onClick={() => setPickerOpen(true)}
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            gap: 4,
            width: "100%",
            padding: "8px 0",
            background: "none",
            border: "1px dashed var(--fx-line-default)",
            borderRadius: "var(--radius-control)",
            color: "var(--fx-text-secondary)",
            cursor: "pointer",
            fontSize: "var(--text-label)",
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.borderColor = "var(--fx-accent-blue)";
            e.currentTarget.style.color = "var(--fx-accent-blue)";
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.borderColor = "var(--fx-line-default)";
            e.currentTarget.style.color = "var(--fx-text-secondary)";
          }}
        >
          + {t("addProvider", "Add provider")}
        </button>
      </div>
    </div>
  );
}
