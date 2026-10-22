import type { ReactNode } from "react";
import { Badge, Button } from "../form-controls";
import { useI18n } from "@/i18n";
import type { ProviderEntry } from "@/lib/models-config-state";
import type { ModelPreferencesResult } from "@contract/types";
import { ProviderLogoTile } from "./provider-icon";
import type { ApiKeyProvider, OAuthProvider, Selection } from "./types";

export type ProviderRowTone = "success" | "warning" | "muted";

const rowTransition = "background-color var(--duration-quick) var(--ease-smooth-out)";

function hoverHandlers(active: boolean, rest: string) {
  return {
    onMouseEnter: (e: React.MouseEvent<HTMLElement>) => {
      if (!active) e.currentTarget.style.background = "var(--fx-surface-card)";
    },
    onMouseLeave: (e: React.MouseEvent<HTMLElement>) => {
      if (!active) e.currentTarget.style.background = rest;
    },
  };
}

function StatusDot({ tone }: { tone: ProviderRowTone }) {
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
        boxShadow: tone === "warning" ? "0 0 0 3px var(--fx-status-warning-soft)" : undefined,
      }}
    />
  );
}

function Chevron({ open }: { open: boolean }) {
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
      style={{
        flexShrink: 0,
        color: "var(--fx-text-tertiary)",
        transform: open ? "rotate(90deg)" : undefined,
        transition: "transform var(--duration-quick) var(--ease-smooth-out)",
      }}
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
  selected = false,
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
  selected?: boolean;
  divider?: boolean;
  onSelect: () => void;
}) {
  const rest = selected ? "var(--fx-surface-card)" : "var(--fx-surface-raised)";
  return (
    <div
      onClick={onSelect}
      {...hoverHandlers(selected, rest)}
      style={{
        display: "flex",
        alignItems: "center",
        gap: 14,
        padding: "14px var(--space-4) 14px var(--space-5)",
        borderTop: divider ? "1px solid var(--fx-line-default)" : undefined,
        background: rest,
        cursor: "pointer",
        transition: rowTransition,
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
      {action ?? <Chevron open={selected} />}
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

function SubRow({
  selected,
  muted,
  onClick,
  children,
}: {
  selected?: boolean;
  muted?: boolean;
  onClick: (e: React.MouseEvent<HTMLDivElement>) => void;
  children: ReactNode;
}) {
  const rest = selected ? "var(--fx-surface-selected)" : "transparent";
  return (
    <div
      onClick={onClick}
      {...hoverHandlers(Boolean(selected), rest)}
      style={{
        display: "flex",
        alignItems: "center",
        gap: 8,
        minHeight: 30,
        margin: "0 var(--space-3) 0 58px",
        padding: "0 var(--space-2)",
        borderRadius: "var(--radius-control)",
        background: rest,
        color: muted ? "var(--fx-text-tertiary)" : "var(--fx-text-secondary)",
        cursor: "pointer",
        transition: rowTransition,
      }}
    >
      {children}
    </div>
  );
}

function hostOf(baseUrl: string | undefined): string | null {
  if (!baseUrl) return null;
  try {
    return new URL(baseUrl).host || baseUrl;
  } catch {
    return baseUrl;
  }
}

function DetailSlot({ children }: { children: ReactNode }) {
  return <div style={{ borderTop: "1px solid var(--fx-line-default)" }}>{children}</div>;
}

export function ProviderTree({
  loading,
  providers,
  oauthProviders,
  apiKeyProviders,
  activeOAuth,
  activeApiKey,
  modelPreferences,
  selection,
  setSelection,
  addModel,
  setPickerOpen,
  detail,
}: {
  loading: boolean;
  providers: [string, ProviderEntry][];
  oauthProviders: OAuthProvider[];
  apiKeyProviders: ApiKeyProvider[];
  activeOAuth: OAuthProvider[];
  activeApiKey: ApiKeyProvider[];
  modelPreferences: ModelPreferencesResult | null;
  selection: Selection | null;
  setSelection: (selection: Selection | null) => void;
  addModel: (providerName: string) => void;
  setPickerOpen: (open: boolean) => void;
  detail: ReactNode;
}) {
  const { t } = useI18n();
  const countLabel = (count: number) => t("modelCount", "{count} models").replace("{count}", String(count));
  const oauthMeta = (id: string) => {
    if (!modelPreferences) return "OAuth";
    return `OAuth · ${countLabel(modelPreferences.models.filter((model) => model.provider === id).length)}`;
  };

  const pendingOAuth =
    selection?.type === "oauth" && !activeOAuth.some((p) => p.id === selection.providerId)
      ? oauthProviders.find((p) => p.id === selection.providerId)
      : undefined;
  const pendingApiKey =
    selection?.type === "apikey" && !activeApiKey.some((p) => p.id === selection.providerId)
      ? apiKeyProviders.find((p) => p.id === selection.providerId)
      : undefined;
  const oauthRows = pendingOAuth ? [...activeOAuth, pendingOAuth] : activeOAuth;
  const apiKeyRows = pendingApiKey ? [...activeApiKey, pendingApiKey] : activeApiKey;

  return (
    <div style={{ display: "grid", gap: 28 }}>
      {oauthRows.length > 0 && (
        <ProviderGroup title={t("modelSubscription", "Subscription")}>
          {oauthRows.map((p, index) => {
            const isSelected = selection?.type === "oauth" && selection.providerId === p.id;
            return (
              <div key={p.id}>
                <ProviderRow
                  iconId={p.id}
                  name={p.name}
                  meta={oauthMeta(p.id)}
                  status={p.loggedIn ? t("modelConnected", "connected") : undefined}
                  action={
                    p.loggedIn ? undefined : (
                      <span aria-hidden="true" className="ui-button">
                        {t("modelLogin", "Login")}
                      </span>
                    )
                  }
                  selected={isSelected}
                  divider={index > 0}
                  onSelect={() => setSelection({ type: "oauth", providerId: p.id })}
                />
                {isSelected && <DetailSlot>{detail}</DetailSlot>}
              </div>
            );
          })}
        </ProviderGroup>
      )}

      {apiKeyRows.length > 0 && (
        <ProviderGroup title={t("modelApiKey", "API Key")}>
          {apiKeyRows.map((p, index) => {
            const isSelected = selection?.type === "apikey" && selection.providerId === p.id;
            return (
              <div key={p.id}>
                <ProviderRow
                  iconId={p.id}
                  name={p.displayName}
                  meta={`${t("modelApiKey", "API Key")} · ${countLabel(p.modelCount)}`}
                  status={p.configured ? t("configured", "configured") : t("notConfigured", "not configured")}
                  tone={p.configured ? "success" : "muted"}
                  selected={isSelected}
                  divider={index > 0}
                  onSelect={() => setSelection({ type: "apikey", providerId: p.id })}
                />
                {isSelected && <DetailSlot>{detail}</DetailSlot>}
              </div>
            );
          })}
        </ProviderGroup>
      )}

      <ProviderGroup
        title={t("modelCustom", "Custom")}
        action={
          <Button onClick={() => setPickerOpen(true)}>
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
            {t("addProvider", "Add provider")}
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
        ) : providers.length > 0 ? (
          providers.map(([pName, pData], index) => {
            const isProviderSelected = selection?.type === "provider" && selection.name === pName;
            const ownsSelection =
              isProviderSelected || (selection?.type === "model" && selection.providerName === pName);
            const models = pData.models ?? [];
            const host = hostOf(pData.baseUrl);
            return (
              <div key={pName} style={{ borderTop: index > 0 ? "1px solid var(--fx-line-default)" : undefined }}>
                <ProviderRow
                  iconId={pName}
                  name={pName}
                  meta={host ? `${host} · ${countLabel(models.length)}` : countLabel(models.length)}
                  selected={ownsSelection}
                  onSelect={() => setSelection({ type: "provider", name: pName })}
                />
                <div style={{ display: "grid", gap: 2, paddingBottom: "var(--space-2)" }}>
                  {models.map((m, i) => {
                    const isModelSelected =
                      selection?.type === "model" && selection.providerName === pName && selection.index === i;
                    return (
                      <SubRow
                        key={i}
                        selected={isModelSelected}
                        muted={!m.id}
                        onClick={() => setSelection({ type: "model", providerName: pName, index: i })}
                      >
                        <span
                          className="type-mono-label"
                          style={{
                            flex: 1,
                            minWidth: 0,
                            color: isModelSelected ? "var(--fx-text-primary)" : undefined,
                            overflow: "hidden",
                            textOverflow: "ellipsis",
                            whiteSpace: "nowrap",
                          }}
                        >
                          {m.id || t("modelNewModel", "new model")}
                        </span>
                        {m.reasoning && <Badge tone="accent">T</Badge>}
                      </SubRow>
                    );
                  })}
                  <SubRow
                    muted
                    onClick={(e) => {
                      e.stopPropagation();
                      addModel(pName);
                    }}
                  >
                    <span className="type-label-default">+ {t("modelAddModel", "model")}</span>
                  </SubRow>
                </div>
                {ownsSelection && <DetailSlot>{detail}</DetailSlot>}
              </div>
            );
          })
        ) : null}
      </ProviderGroup>
    </div>
  );
}
