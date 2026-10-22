import { useEffect, useRef, useState } from "react";
import { useI18n } from "@/i18n";
import { ProviderIcon } from "./provider-icon";
import type { ApiKeyProvider, OAuthProvider } from "./types";

interface AddProviderPickerProps {
  oauthProviders: OAuthProvider[];
  apiKeyProviders: ApiKeyProvider[];
  onSelectOAuth: (id: string) => void;
  onSelectApiKey: (id: string) => void;
  onAddCustom: () => void;
  onClose: () => void;
}

export function AddProviderPicker({
  oauthProviders,
  apiKeyProviders,
  onSelectOAuth,
  onSelectApiKey,
  onAddCustom,
  onClose,
}: AddProviderPickerProps) {
  const { t } = useI18n();
  const [search, setSearch] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setTimeout(() => inputRef.current?.focus(), 30);
  }, []);

  const q = search.trim().toLowerCase();

  const availableOAuth = oauthProviders.filter((p) => !p.loggedIn && (!q || p.name.toLowerCase().includes(q)));
  const availableApiKey = apiKeyProviders.filter(
    (p) => !p.configured && (!q || p.displayName.toLowerCase().includes(q) || p.id.toLowerCase().includes(q)),
  );
  const customSearchTerms = [
    "custom",
    "openai-compatible",
    "anthropic-compatible",
    t("modelCustom", "Custom"),
    t("modelCompatibleProvider", "OpenAI / Anthropic compatible"),
  ]
    .join(" ")
    .toLowerCase();
  const showCustom = !q || customSearchTerms.includes(q);

  const totalCount = availableOAuth.length + availableApiKey.length + (showCustom ? 1 : 0);

  const cardStyle: React.CSSProperties = {
    display: "flex",
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    padding: "12px 12px",
    background: "var(--fx-surface-raised)",
    border: "1px solid var(--fx-line-default)",
    borderRadius: "var(--radius-card)",
    boxSizing: "border-box",
    cursor: "pointer",
    minWidth: 0,
    textAlign: "left",
    transition: "border-color 0.12s, background 0.12s",
    width: "100%",
  };

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 1100,
        background: "rgba(0,0,0,0.4)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        style={{
          width: 820,
          maxWidth: "calc(100vw - 32px)",
          maxHeight: "min(72vh, calc(100vh - 32px))",
          background: "var(--fx-surface-main)",
          border: "1px solid var(--fx-line-default)",
          borderRadius: "var(--radius-card)",
          display: "flex",
          flexDirection: "column",
          boxShadow: "0 8px 32px rgba(0,0,0,0.22)",
          overflow: "hidden",
        }}
      >
        <div
          style={{
            padding: "12px 16px",
            borderBottom: "1px solid var(--fx-line-default)",
            flexShrink: 0,
            display: "flex",
            alignItems: "center",
            gap: 8,
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
            style={{ color: "var(--fx-text-tertiary)", flexShrink: 0 }}
          >
            <circle cx="11" cy="11" r="8" />
            <line x1="21" y1="21" x2="16.65" y2="16.65" />
          </svg>
          <input
            ref={inputRef}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Escape") onClose();
            }}
            placeholder={t("modelSearchProviders", "Search providers…")}
            style={{
              flex: 1,
              background: "none",
              border: "none",
              outline: "none",
              color: "var(--fx-text-primary)",
              fontSize: "var(--text-body)",
              boxSizing: "border-box",
            }}
          />
        </div>

        <div style={{ flex: 1, overflowY: "auto", padding: 16 }}>
          {totalCount === 0 ? (
            <div
              style={{
                padding: "20px 0",
                fontSize: "var(--text-label)",
                color: "var(--fx-text-tertiary)",
                textAlign: "center",
              }}
            >
              {t("modelNoProvidersMatch", "No providers match")}
            </div>
          ) : (
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(auto-fit, minmax(min(240px, 100%), 1fr))",
                gap: 8,
              }}
            >
              {showCustom && (
                <div
                  style={{
                    gridColumn: "1 / -1",
                    fontSize: "var(--text-micro)",
                    fontWeight: 600,
                    color: "var(--fx-text-tertiary)",
                    textTransform: "uppercase",
                    letterSpacing: "0.07em",
                  }}
                >
                  {t("modelCustom", "Custom")}
                </div>
              )}
              {showCustom && (
                <button
                  onClick={() => {
                    onAddCustom();
                    onClose();
                  }}
                  style={cardStyle}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.borderColor = "var(--fx-accent-blue)";
                    e.currentTarget.style.background = "var(--bg-hover)";
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.borderColor = "var(--fx-line-default)";
                    e.currentTarget.style.background = "var(--fx-surface-raised)";
                  }}
                >
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div
                      style={{
                        fontSize: "var(--text-label)",
                        fontWeight: 600,
                        color: "var(--fx-text-primary)",
                        lineHeight: 1.3,
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        whiteSpace: "nowrap",
                      }}
                    >
                      {t("modelCompatibleProvider", "OpenAI / Anthropic compatible")}
                    </div>
                    <div style={{ fontSize: "var(--text-micro)", color: "var(--fx-text-tertiary)", marginTop: 2 }}>
                      {t("modelCustomEndpointFormat", "Custom endpoint format")}
                    </div>
                  </div>
                  <span
                    style={{
                      width: 26,
                      height: 26,
                      borderRadius: "var(--radius-control)",
                      background: "var(--bg-hover)",
                      border: "1px dashed var(--fx-line-default)",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      flexShrink: 0,
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
                      style={{ color: "var(--fx-text-tertiary)" }}
                    >
                      <line x1="12" y1="5" x2="12" y2="19" />
                      <line x1="5" y1="12" x2="19" y2="12" />
                    </svg>
                  </span>
                </button>
              )}

              {availableOAuth.length > 0 && (
                <div
                  style={{
                    gridColumn: "1 / -1",
                    paddingTop: showCustom ? 6 : 0,
                    fontSize: "var(--text-micro)",
                    fontWeight: 600,
                    color: "var(--fx-text-tertiary)",
                    textTransform: "uppercase",
                    letterSpacing: "0.07em",
                  }}
                >
                  {t("modelSubscriptions", "Subscriptions")}
                </div>
              )}
              {availableOAuth.map((p) => (
                <button
                  key={p.id}
                  onClick={() => {
                    onSelectOAuth(p.id);
                    onClose();
                  }}
                  style={cardStyle}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.borderColor = "var(--fx-accent-blue)";
                    e.currentTarget.style.background = "var(--bg-hover)";
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.borderColor = "var(--fx-line-default)";
                    e.currentTarget.style.background = "var(--fx-surface-raised)";
                  }}
                >
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div
                      style={{
                        fontSize: "var(--text-label)",
                        fontWeight: 600,
                        color: "var(--fx-text-primary)",
                        lineHeight: 1.3,
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        whiteSpace: "nowrap",
                      }}
                    >
                      {p.name}
                    </div>
                    <div style={{ fontSize: "var(--text-micro)", color: "var(--fx-text-tertiary)", marginTop: 2 }}>
                      OAuth
                    </div>
                  </div>
                  <ProviderIcon id={p.id} size={28} />
                </button>
              ))}

              {availableApiKey.length > 0 && (
                <div
                  style={{
                    gridColumn: "1 / -1",
                    paddingTop: availableOAuth.length > 0 ? 6 : 0,
                    fontSize: "var(--text-micro)",
                    fontWeight: 600,
                    color: "var(--fx-text-tertiary)",
                    textTransform: "uppercase",
                    letterSpacing: "0.07em",
                  }}
                >
                  {t("modelApiKey", "API Key")}
                </div>
              )}
              {availableApiKey.map((p) => (
                <button
                  key={p.id}
                  onClick={() => {
                    onSelectApiKey(p.id);
                    onClose();
                  }}
                  style={cardStyle}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.borderColor = "var(--fx-accent-blue)";
                    e.currentTarget.style.background = "var(--bg-hover)";
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.borderColor = "var(--fx-line-default)";
                    e.currentTarget.style.background = "var(--fx-surface-raised)";
                  }}
                >
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div
                      style={{
                        fontSize: "var(--text-label)",
                        fontWeight: 600,
                        color: "var(--fx-text-primary)",
                        lineHeight: 1.3,
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        whiteSpace: "nowrap",
                      }}
                    >
                      {p.displayName}
                    </div>
                    <div style={{ fontSize: "var(--text-micro)", color: "var(--fx-text-tertiary)", marginTop: 2 }}>
                      {t("modelCount", "{count} models").replace("{count}", String(p.modelCount))}
                    </div>
                  </div>
                  <ProviderIcon id={p.id} size={28} />
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
