import { useEffect, useRef, useState } from "react";
import { useI18n } from "@/i18n";
import { ProviderLogoTile } from "./provider-icon";
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
    gap: 12,
    padding: "var(--space-3)",
    background: "var(--fx-surface-raised)",
    border: "1px solid var(--fx-line-default)",
    borderRadius: "var(--radius-card)",
    boxSizing: "border-box",
    color: "inherit",
    font: "inherit",
    cursor: "pointer",
    minWidth: 0,
    textAlign: "left",
    transition:
      "border-color var(--duration-quick) var(--ease-out), background-color var(--duration-quick) var(--ease-out)",
    width: "100%",
  };
  const cardHover = {
    onMouseEnter: (e: React.MouseEvent<HTMLButtonElement>) => {
      e.currentTarget.style.borderColor = "var(--fx-line-strong)";
      e.currentTarget.style.background = "var(--fx-surface-card)";
    },
    onMouseLeave: (e: React.MouseEvent<HTMLButtonElement>) => {
      e.currentTarget.style.borderColor = "var(--fx-line-default)";
      e.currentTarget.style.background = "var(--fx-surface-raised)";
    },
  };
  const groupLabelStyle: React.CSSProperties = {
    gridColumn: "1 / -1",
    color: "var(--fx-text-secondary)",
  };
  const nameStyle: React.CSSProperties = {
    color: "var(--fx-text-primary)",
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  };

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 1100,
        background: "var(--fx-surface-scrim)",
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
          background: "var(--fx-surface-raised)",
          border: "1px solid var(--fx-line-default)",
          borderRadius: "var(--radius-dialog)",
          display: "flex",
          flexDirection: "column",
          boxShadow: "var(--shadow-dialog)",
          overflow: "hidden",
        }}
      >
        <div
          style={{
            minHeight: 52,
            padding: "0 var(--space-5)",
            borderBottom: "1px solid var(--fx-line-default)",
            flexShrink: 0,
            display: "flex",
            alignItems: "center",
            gap: 10,
          }}
        >
          <svg
            width="16"
            height="16"
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
            className="type-body-large"
            style={{
              flex: 1,
              background: "none",
              border: "none",
              outline: "none",
              color: "var(--fx-text-primary)",
              boxSizing: "border-box",
            }}
          />
        </div>

        <div style={{ flex: 1, overflowY: "auto", padding: "var(--space-4) var(--space-5) var(--space-5)" }}>
          {totalCount === 0 ? (
            <div
              className="type-body-default"
              style={{ padding: "var(--space-5) 0", color: "var(--fx-text-tertiary)", textAlign: "center" }}
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
                <div className="type-body-medium" style={groupLabelStyle}>
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
                  {...cardHover}
                >
                  <span
                    style={{
                      width: 36,
                      height: 36,
                      boxSizing: "border-box",
                      borderRadius: "var(--radius-control)",
                      background: "var(--fx-surface-card)",
                      border: "1px dashed var(--fx-line-strong)",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      flexShrink: 0,
                    }}
                  >
                    <svg
                      width="16"
                      height="16"
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
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div className="type-body-large-medium" style={nameStyle}>
                      {t("modelCompatibleProvider", "OpenAI / Anthropic compatible")}
                    </div>
                    <div className="type-body-default" style={{ color: "var(--fx-text-tertiary)", marginTop: 2 }}>
                      {t("modelCustomEndpointFormat", "Custom endpoint format")}
                    </div>
                  </div>
                </button>
              )}

              {availableOAuth.length > 0 && (
                <div
                  className="type-body-medium"
                  style={{ ...groupLabelStyle, paddingTop: showCustom ? "var(--space-3)" : 0 }}
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
                  {...cardHover}
                >
                  <ProviderLogoTile id={p.id} />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div className="type-body-large-medium" style={nameStyle}>
                      {p.name}
                    </div>
                    <div className="type-body-default" style={{ color: "var(--fx-text-tertiary)", marginTop: 2 }}>
                      OAuth
                    </div>
                  </div>
                </button>
              ))}

              {availableApiKey.length > 0 && (
                <div
                  className="type-body-medium"
                  style={{
                    ...groupLabelStyle,
                    paddingTop: availableOAuth.length > 0 || showCustom ? "var(--space-3)" : 0,
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
                  {...cardHover}
                >
                  <ProviderLogoTile id={p.id} />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div className="type-body-large-medium" style={nameStyle}>
                      {p.displayName}
                    </div>
                    <div className="type-body-default" style={{ color: "var(--fx-text-tertiary)", marginTop: 2 }}>
                      {t("modelCount", "{count} models").replace("{count}", String(p.modelCount))}
                    </div>
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
