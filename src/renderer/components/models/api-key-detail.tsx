import { useCallback, useEffect, useState } from "react";
import { Badge, Button, Field, SecretTextInput, SectionTitle, TextInput } from "../form-controls";
import { useI18n } from "@/i18n";
import { ManagedModelsControl } from "./managed-models-control";
import type { ApiKeyProvider, ModelSelectionControl } from "./types";

export function ApiKeyDetail({
  provider,
  baseUrl,
  onBaseUrlChange,
  onRefresh,
  modelSelection,
}: {
  provider: ApiKeyProvider;
  baseUrl: string;
  onBaseUrlChange: (baseUrl: string) => void;
  onRefresh: () => void;
  modelSelection: ModelSelectionControl;
}) {
  const { t } = useI18n();
  const [apiKey, setApiKey] = useState("");
  const [saving, setSaving] = useState(false);
  const [removing, setRemoving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [warning, setWarning] = useState<string | null>(null);
  const [savedOk, setSavedOk] = useState(false);

  useEffect(() => {
    setApiKey("");
    setError(null);
    setWarning(null);
    setSavedOk(false);
  }, [provider.id]);

  const handleSave = useCallback(async () => {
    if (!apiKey.trim()) return;
    setSaving(true);
    setError(null);
    setWarning(null);
    setSavedOk(false);
    try {
      const res = await fetch(`/api/auth/api-key/${encodeURIComponent(provider.id)}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ apiKey: apiKey.trim() }),
      });
      const d = (await res.json()) as {
        ok?: boolean;
        warning?: { code: "MODEL_SYNC_FAILED"; message: string };
        error?: string;
      };
      if (!res.ok || d.error) {
        setError(d.error ?? `HTTP ${res.status}`);
      } else {
        setApiKey("");
        setSavedOk(true);
        setWarning(d.warning?.message ?? null);
        setTimeout(() => setSavedOk(false), 2000);
        onRefresh();
      }
    } catch (e) {
      setError(String(e));
    } finally {
      setSaving(false);
    }
  }, [apiKey, provider.id, onRefresh]);

  const handleRemove = useCallback(async () => {
    setRemoving(true);
    setError(null);
    setWarning(null);
    try {
      const res = await fetch(`/api/auth/api-key/${encodeURIComponent(provider.id)}`, { method: "DELETE" });
      const d = (await res.json()) as {
        ok?: boolean;
        warning?: { code: "MODEL_SYNC_FAILED"; message: string };
        error?: string;
      };
      if (!res.ok || d.error) setError(d.error ?? `HTTP ${res.status}`);
      else {
        setWarning(d.warning?.message ?? null);
        onRefresh();
      }
    } catch (e) {
      setError(String(e));
    } finally {
      setRemoving(false);
    }
  }, [provider.id, onRefresh]);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <SectionTitle>{t("modelApiKey", "API Key")}</SectionTitle>
        <Badge tone={provider.configured ? "success" : "muted"}>
          {provider.configured ? t("configured", "configured") : t("notConfigured", "not configured")}
        </Badge>
      </div>

      <p className="type-body-relaxed" style={{ margin: 0, color: "var(--fx-text-secondary)" }}>
        {provider.configured
          ? t(
              "modelApiKeyStored",
              "API key is stored. Enter a new key below to replace it, or disconnect to remove it.",
            )
          : t("modelEnterApiKey", "Enter your {provider} API key to enable {count} models.")
              .replace("{provider}", provider.displayName)
              .replace("{count}", String(provider.modelCount))}
      </p>

      <Field labelSize="body" label={t("modelBaseUrl", "Base URL")}>
        <TextInput
          value={baseUrl}
          onChange={onBaseUrlChange}
          placeholder={t("modelBaseUrlPlaceholder", "Leave empty to use the provider default")}
          mono
        />
        <span className="type-label-default" style={{ color: "var(--fx-text-tertiary)", marginTop: 2 }}>
          {t(
            "modelBaseUrlHint",
            "Overrides the endpoint for this provider. Use the Save button below to apply changes.",
          )}
        </span>
      </Field>

      <Field labelSize="body" label={t("modelApiKey", "API Key")}>
        <div style={{ display: "flex", gap: 8 }}>
          <SecretTextInput
            value={apiKey}
            onChange={setApiKey}
            onKeyDown={(e) => {
              if (e.key === "Enter" && apiKey.trim()) void handleSave();
            }}
            placeholder={provider.configured ? t("modelReplaceApiKey", "Enter new key to replace…") : "sk-…"}
            style={{ flex: 1 }}
            autoComplete="off"
            spellCheck={false}
            mono
          />
          <Button
            variant={apiKey.trim() && !savedOk ? "primary" : "secondary"}
            onClick={handleSave}
            disabled={saving || !apiKey.trim() || savedOk}
            style={{
              flexShrink: 0,
              ...(savedOk
                ? {
                    opacity: 1,
                    borderColor: "var(--fx-status-success-border)",
                    background: "var(--fx-status-success-soft)",
                    color: "var(--fx-status-success-text)",
                  }
                : {}),
            }}
          >
            {savedOk && (
              <svg
                width="12"
                height="12"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="3"
                strokeLinecap="round"
                strokeLinejoin="round"
                style={{ color: "currentColor" }}
              >
                <polyline points="20 6 9 17 4 12" />
              </svg>
            )}
            {savedOk ? t("saved", "Saved") : saving ? t("saving", "Saving…") : t("save", "Save")}
          </Button>
        </div>
      </Field>

      {error && (
        <p className="type-body-default" style={{ margin: 0, color: "var(--fx-status-danger)" }}>
          {error}
        </p>
      )}
      {warning && (
        <p className="type-body-default" style={{ margin: 0, color: "var(--fx-status-warning)" }}>
          {warning}
        </p>
      )}

      {provider.configured && <ManagedModelsControl providerId={provider.id} {...modelSelection} />}

      {provider.configured && (
        <Button variant="danger" onClick={handleRemove} disabled={removing} style={{ alignSelf: "flex-start" }}>
          {removing ? t("modelRemoving", "Removing…") : t("modelDisconnect", "Disconnect")}
        </Button>
      )}
    </div>
  );
}
