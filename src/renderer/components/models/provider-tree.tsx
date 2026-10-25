import type { ReactNode } from "react";
import { Button } from "../form-controls";
import { useI18n } from "@/i18n";
import type { ProviderEntry } from "@/lib/models-config-state";
import type { ModelPreferencesResult } from "@contract/types";
import framerTokens from "../../styles/framer-tokens.json";
import { ProviderLogoTile } from "./provider-icon";
import type { ApiKeyProvider, DialogTarget, OAuthProvider } from "./types";

export type ProviderRowTone = "success" | "warning" | "muted";

const WARNING_HALO = `0 0 0 3px color-mix(in srgb, ${framerTokens.colors["/Status/Warning"].dark} 16%, transparent)`;

export function StatusDot({ tone }: { tone: ProviderRowTone }) {
  const fill =
    tone === "success"
      ? "var(--fx-status-success)"
      : tone === "warning"
        ? "var(--fx-status-warning)"
        : "var(--fx-text-faint)";
  return (
    <span
      aria-hidden="true"
      style={{
        width: 6,
        height: 6,
        borderRadius: 3,
        flexShrink: 0,
        background: fill,
        boxShadow: tone === "warning" ? WARNING_HALO : undefined,
      }}
    />
  );
}

function Chevron() {
  return (
    <svg
      aria-hidden="true"
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      style={{ flexShrink: 0, color: "var(--fx-text-tertiary)" }}
    >
      <path d="m9 18 6-6-6-6" />
    </svg>
  );
}

export function ProviderRow({
  iconId,
  name,
  meta,
  status,
  tone = "success",
  disabled = false,
  action,
  divider = false,
  onSelect,
}: {
  iconId: string;
  name: string;
  meta?: string;
  status?: string;
  tone?: ProviderRowTone;
  disabled?: boolean;
  action?: ReactNode;
  divider?: boolean;
  onSelect: () => void;
}) {
  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onSelect}
      onKeyDown={(e) => {
        if (e.target !== e.currentTarget || (e.key !== "Enter" && e.key !== " ")) return;
        e.preventDefault();
        onSelect();
      }}
      onMouseEnter={(e) => {
        e.currentTarget.style.background = "var(--fx-surface-card)";
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.background = "var(--fx-surface-raised)";
      }}
      style={{
        display: "flex",
        alignItems: "center",
        gap: 14,
        padding: "14px var(--space-4) 14px var(--space-5)",
        borderTop: divider ? "1px solid var(--fx-line-default)" : undefined,
        background: "var(--fx-surface-raised)",
        cursor: "pointer",
        transition: "background-color var(--duration-quick) var(--ease-smooth-out)",
      }}
    >
      <ProviderLogoTile id={iconId} dimmed={disabled} />
      <div style={{ flex: 1, minWidth: 0, display: "grid", gap: 2 }}>
        <span
          className="type-body-large-medium"
          style={{
            color: disabled ? "var(--fx-text-secondary)" : "var(--fx-text-primary)",
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}
        >
          {name}
        </span>
        {meta && (
          <span
            className="type-body-default"
            style={{
              color: "var(--fx-text-tertiary)",
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
            }}
          >
            {meta}
          </span>
        )}
      </div>
      {status && (
        <div style={{ width: 96, flexShrink: 0, display: "flex", alignItems: "center", gap: 8 }}>
          <StatusDot tone={disabled ? "muted" : tone} />
          <span
            className="type-body-default"
            style={{
              minWidth: 0,
              color: "var(--fx-text-secondary)",
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
            }}
          >
            {status}
          </span>
        </div>
      )}
      {action ?? <Chevron />}
    </div>
  );
}

function ProviderGroup({ title, action, children }: { title: string; action?: ReactNode; children?: ReactNode }) {
  return (
    <section style={{ display: "grid", gap: 10 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, minHeight: 20 }}>
        <h2 className="type-body-medium" style={{ flex: 1, margin: 0, color: "var(--fx-text-secondary)" }}>
          {title}
        </h2>
        {action}
      </div>
      {children && (
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            border: "1px solid var(--fx-line-default)",
            borderRadius: "var(--radius-dialog)",
            background: "var(--fx-surface-raised)",
            overflow: "hidden",
          }}
        >
          {children}
        </div>
      )}
    </section>
  );
}

export function hostOf(baseUrl: string | undefined): string | null {
  if (!baseUrl) return null;
  try {
    return new URL(baseUrl).host || baseUrl;
  } catch {
    return baseUrl;
  }
}

const OAUTH_VENDORS: Record<string, string> = {
  anthropic: "Anthropic",
  "github-copilot": "GitHub",
  "google-antigravity": "Google",
  "google-gemini-cli": "Google",
  "openai-codex": "OpenAI",
};

const ENV_VARIABLE_LIST = /^[A-Z][A-Z0-9_]*(?:, [A-Z][A-Z0-9_]*)*$/;

export function useProviderLabels(modelPreferences: ModelPreferencesResult | null) {
  const { t } = useI18n();
  const countLabel = (count: number) => t("modelCount", "{count} models").replace("{count}", String(count));
  const apiKeySource = (source: string | undefined) =>
    source && ENV_VARIABLE_LIST.test(source)
      ? t("modelEnvSource", "Reads environment variable {name}").replace("{name}", source)
      : t("modelApiKey", "API Key");
  return {
    oauthMeta: (p: OAuthProvider) => {
      if (!p.loggedIn) {
        return t("modelSignInWith", "Sign in with your {vendor} account").replace(
          "{vendor}",
          OAUTH_VENDORS[p.id] ?? p.name,
        );
      }
      const signedIn = t("modelSignedIn", "Signed in");
      return modelPreferences
        ? `${signedIn} · ${countLabel(modelPreferences.models.filter((model) => model.provider === p.id).length)}`
        : signedIn;
    },
    apiKeyMeta: (p: ApiKeyProvider) => `${apiKeySource(p.source)} · ${countLabel(p.modelCount)}`,
    apiKeyStatus: (p: ApiKeyProvider) =>
      p.configured ? t("configured", "Active") : t("notConfigured", "not configured"),
    oauthStatus: (p: OAuthProvider) => (p.loggedIn ? t("configured", "Active") : undefined),
    customMeta: (provider: ProviderEntry) => {
      const host = hostOf(provider.baseUrl);
      const count = countLabel(provider.models?.length ?? 0);
      return host ? `${host} · ${count}` : count;
    },
  };
}

export function ProviderTree({
  loading,
  loadError,
  onRetry,
  providers,
  oauthProviders,
  activeApiKey,
  modelPreferences,
  onOpen,
  onAddProvider,
}: {
  loading: boolean;
  loadError: string | null;
  onRetry: () => void;
  providers: [string, ProviderEntry][];
  oauthProviders: OAuthProvider[];
  activeApiKey: ApiKeyProvider[];
  modelPreferences: ModelPreferencesResult | null;
  onOpen: (target: DialogTarget) => void;
  onAddProvider: () => void;
}) {
  const { t } = useI18n();
  const labels = useProviderLabels(modelPreferences);
  const subscriptions = [...oauthProviders].sort((a, b) => Number(b.loggedIn) - Number(a.loggedIn));

  return (
    <div
      role="group"
      aria-label={t("selectProviderOrModel", "Select a provider or model")}
      style={{ display: "grid", gap: 28 }}
    >
      {subscriptions.length > 0 && (
        <ProviderGroup title={t("modelSubscription", "Subscription")}>
          {subscriptions.map((p, index) => (
            <ProviderRow
              key={p.id}
              iconId={p.id}
              name={p.name}
              meta={labels.oauthMeta(p)}
              status={labels.oauthStatus(p)}
              action={
                p.loggedIn ? undefined : (
                  <Button
                    aria-label={t("modelLoginTo", "Log in to {name}").replace("{name}", p.name)}
                    onClick={(event) => {
                      event.stopPropagation();
                      onOpen({ type: "oauth", providerId: p.id, startLogin: true });
                    }}
                  >
                    {t("modelLogin", "Login")}
                  </Button>
                )
              }
              divider={index > 0}
              onSelect={() => onOpen({ type: "oauth", providerId: p.id })}
            />
          ))}
        </ProviderGroup>
      )}

      {activeApiKey.length > 0 && (
        <ProviderGroup title={t("modelApiProviders", "API providers")}>
          {activeApiKey.map((p, index) => (
            <ProviderRow
              key={p.id}
              iconId={p.id}
              name={p.displayName}
              meta={labels.apiKeyMeta(p)}
              status={labels.apiKeyStatus(p)}
              tone={p.configured ? "success" : "muted"}
              divider={index > 0}
              onSelect={() => onOpen({ type: "apikey", providerId: p.id })}
            />
          ))}
        </ProviderGroup>
      )}

      <ProviderGroup
        title={t("modelCustomChannels", "Custom channels")}
        action={
          <Button onClick={onAddProvider}>
            <svg
              aria-hidden="true"
              width="14"
              height="14"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M12 5v14M5 12h14" />
            </svg>
            {t("addProvider", "Add channel")}
          </Button>
        }
      >
        {loading ? (
          <div
            className="type-body-default"
            style={{ padding: "var(--space-4) var(--space-5)", color: "var(--fx-text-secondary)" }}
          >
            {t("loading", "Loading…")}
          </div>
        ) : loadError ? (
          <div
            role="alert"
            style={{ display: "flex", alignItems: "center", gap: 12, padding: "var(--space-4) var(--space-5)" }}
          >
            <span className="type-body-default" style={{ flex: 1, minWidth: 0, color: "var(--fx-status-danger)" }}>
              {loadError}
            </span>
            <Button onClick={onRetry}>{t("retry", "Retry")}</Button>
          </div>
        ) : providers.length > 0 ? (
          providers.map(([pName, pData], index) => (
            <ProviderRow
              key={pName}
              iconId={pName}
              name={pName}
              meta={labels.customMeta(pData)}
              divider={index > 0}
              onSelect={() => onOpen({ type: "provider", name: pName })}
            />
          ))
        ) : null}
      </ProviderGroup>
    </div>
  );
}
