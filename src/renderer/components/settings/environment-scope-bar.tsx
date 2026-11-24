import { PRIMARY_ENVIRONMENT_ID, type EnvironmentId } from "@contract/environment";
import { createContext, useEffect, useState } from "react";
import { getEnvironmentApiClient } from "@/lib/api-client";
import { useEnvironments } from "@/lib/environment-registry";
import { useI18n } from "@/i18n";
import { Button } from "../form-controls";
import { BrowserIcon } from "../browser/browser-icons";
import { ServerGlyph } from "../app-nav/project-host-capsule";

export const EnvironmentScopeContext = createContext<EnvironmentId>(PRIMARY_ENVIRONMENT_ID);

export function usePageEnvironmentScope(environmentId: EnvironmentId, onScopeChange?: (id: EnvironmentId) => void) {
  const [selection, setSelection] = useState({ source: environmentId, id: environmentId });
  if (selection.source !== environmentId) setSelection({ source: environmentId, id: environmentId });
  const scope = onScopeChange || selection.source !== environmentId ? environmentId : selection.id;
  const selectScope = (id: EnvironmentId) => {
    if (onScopeChange) onScopeChange(id);
    else setSelection({ source: environmentId, id });
  };
  return [scope, selectScope] as const;
}

type EnvironmentHomeResolver = (environmentId: EnvironmentId) => Promise<{ home: string }>;

const defaultEnvironmentHomeResolver: EnvironmentHomeResolver = (environmentId) =>
  getEnvironmentApiClient(environmentId).getHome();

export function useEnvironmentHome(
  environmentId: EnvironmentId,
  requestedCwd: string | null | undefined,
  resolveHome: EnvironmentHomeResolver = defaultEnvironmentHomeResolver,
) {
  const environments = useEnvironments();
  const descriptorHome = environments.find((view) => view.id === environmentId)?.descriptor?.platform.home;
  const knownCwd = requestedCwd || descriptorHome || null;
  const [resolution, setResolution] = useState<{ home: string | null; failed: boolean; attempt: number }>({
    home: null,
    failed: false,
    attempt: 0,
  });

  useEffect(() => {
    if (knownCwd) return;
    let disposed = false;
    void resolveHome(environmentId)
      .then(({ home }) => {
        if (!home?.trim()) throw new Error("Missing environment home");
        if (!disposed) setResolution((current) => ({ ...current, home, failed: false }));
      })
      .catch(() => {
        if (!disposed) setResolution((current) => ({ ...current, failed: true }));
      });
    return () => {
      disposed = true;
    };
  }, [environmentId, knownCwd, resolveHome, resolution.attempt]);

  return {
    cwd: knownCwd || resolution.home,
    failed: resolution.failed,
    retry: () => setResolution((current) => ({ home: null, failed: false, attempt: current.attempt + 1 })),
  };
}

type EnvironmentScopeBarProps =
  | {
      mode: "selector";
      selectedEnvironmentId: EnvironmentId;
      onSelect: (id: EnvironmentId) => void;
      purpose?: "settings" | "resources";
    }
  | {
      mode: "local-only";
      focusedEnvironmentId: EnvironmentId;
      onViewLocal: () => void;
    };

export function EnvironmentScopeBar(props: EnvironmentScopeBarProps) {
  const environments = useEnvironments();
  const { t } = useI18n();
  if (props.mode === "local-only") {
    if (props.focusedEnvironmentId === PRIMARY_ENVIRONMENT_ID) return null;
    const server =
      environments.find((view) => view.id === props.focusedEnvironmentId)?.label ?? props.focusedEnvironmentId;
    return (
      <section
        aria-label={t("schemeCLocalOnly", "Only on this computer")}
        className="environment-scope-bar"
        data-mode="local-only"
      >
        <span
          className="environment-scope-icon"
          aria-hidden="true"
          style={{ color: "var(--fx-text-secondary)", flexShrink: 0 }}
        >
          <BrowserIcon name="laptop" size={18} />
        </span>
        <div
          className="environment-scope-copy"
          style={{ flex: 1, minWidth: 0, display: "grid", gap: "var(--space-1)" }}
        >
          <h2 className="type-body-medium" style={{ margin: 0, color: "var(--fx-text-primary)" }}>
            {t("schemeCLocalOnly", "Only on this computer")}
          </h2>
          <p className="type-body-default" style={{ margin: 0, color: "var(--fx-text-secondary)" }}>
            {t(
              "schemeCLocalOnlyDescription",
              "These settings are only available on this computer, not on {server}.",
            ).replace("{server}", server)}
          </p>
        </div>
        <Button onClick={props.onViewLocal} style={{ flexShrink: 0 }}>
          {t("schemeCViewLocalSettings", "View local settings")}
        </Button>
      </section>
    );
  }
  const { selectedEnvironmentId, onSelect, purpose = "settings" } = props;
  const remoteScope = selectedEnvironmentId !== PRIMARY_ENVIRONMENT_ID;
  if (
    !environments.some((view) => view.id !== PRIMARY_ENVIRONMENT_ID) &&
    selectedEnvironmentId === PRIMARY_ENVIRONMENT_ID
  )
    return null;
  const label =
    purpose === "resources" ? t("schemeCResourcesFrom", "Resources from") : t("schemeCSettingsApplyTo", "Applies to");
  const choices = [
    { id: PRIMARY_ENVIRONMENT_ID, label: t("schemeCThisComputer", "This computer"), unavailable: false },
    ...environments
      .filter(
        (view) =>
          view.id !== PRIMARY_ENVIRONMENT_ID &&
          (view.status.phase === "connected" || view.id === selectedEnvironmentId),
      )
      .map((view) => ({ ...view, unavailable: view.status.phase !== "connected" })),
    ...(!environments.some((view) => view.id === selectedEnvironmentId) &&
    selectedEnvironmentId !== PRIMARY_ENVIRONMENT_ID
      ? [{ id: selectedEnvironmentId, label: selectedEnvironmentId, unavailable: true }]
      : []),
  ];

  return (
    <section aria-label={label} className="environment-scope-bar" data-mode="selector" data-remote={remoteScope}>
      <span className="environment-scope-icon" aria-hidden="true">
        {remoteScope ? <ServerGlyph /> : <BrowserIcon name="laptop" size={18} />}
      </span>
      <span className="environment-scope-label type-label-default">{label}</span>
      <div role="group" aria-label={label} className="environment-scope-machines">
        {choices.map((view) => (
          <button
            key={view.id}
            type="button"
            aria-pressed={selectedEnvironmentId === view.id}
            disabled={view.unavailable}
            onClick={() => onSelect(view.id)}
            className="environment-scope-machine type-label-medium"
            style={{
              padding: "var(--space-1-5) var(--space-3)",
              border: `1px solid ${selectedEnvironmentId === view.id && remoteScope ? "var(--fx-accent-blue-border)" : "var(--fx-line-default)"}`,
              borderRadius: "var(--radius-chip)",
              background:
                selectedEnvironmentId === view.id
                  ? remoteScope
                    ? "var(--fx-accent-blue-selection)"
                    : "var(--fx-surface-selected)"
                  : "var(--fx-surface-main)",
              color:
                selectedEnvironmentId === view.id
                  ? remoteScope
                    ? "var(--fx-accent-blue-text)"
                    : "var(--fx-text-primary)"
                  : "var(--fx-text-secondary)",
              cursor: view.unavailable ? "not-allowed" : "pointer",
            }}
          >
            {view.label}
            {view.unavailable && (
              <span
                className="type-label-default"
                style={{ marginLeft: "var(--space-2)", color: "var(--fx-text-tertiary)" }}
              >
                {t("schemeCScopeNotConnected", "Not connected")}
              </span>
            )}
          </button>
        ))}
      </div>
    </section>
  );
}
