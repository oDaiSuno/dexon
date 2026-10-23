import type { PublicCapabilityState, PublicToolchainState, ToolCapabilityId } from "@shared/toolchains/types";
import { Button } from "../form-controls";
import { CheckIcon, DownloadIcon } from "./icons";
import { OperationProgress, hoverFill } from "./section-parts";
import {
  CAPABILITY_CACHES,
  CAPABILITY_LABELS,
  COMPONENT_LABELS,
  componentFor,
  formatBytes,
  healthLabel,
  isCancellable,
  isOperationVisible,
  isPreference,
  isSelectedCandidate,
  operationFor,
  preferenceLabel,
  providerLabel,
  type ToolAction,
  type Translate,
} from "./shared";

export function ToolDetail({
  capability,
  state,
  pendingAction,
  disabled,
  onAction,
  t,
}: {
  capability: ToolCapabilityId;
  state: PublicToolchainState;
  pendingAction: string | null;
  disabled: boolean;
  onAction?: ToolAction;
  t: Translate;
}) {
  const capabilityState = state.capabilities[capability];
  const name = CAPABILITY_LABELS[capability];
  const candidates = capabilityState?.candidates ?? [];
  return (
    <div
      id={detailId(capability)}
      role="region"
      aria-label={`${name} · ${t("toolResolution", "Tool resolution")}`}
      style={{
        display: "grid",
        gap: 2,
        padding: "2px var(--space-3) var(--space-3)",
        background: "var(--fx-surface-card)",
      }}
    >
      <div
        role="radiogroup"
        aria-label={`${name} · ${t("toolPreference", "Preference")}`}
        title={`${t("toolCandidatesTitle", "Detected providers")} · ${candidates.length}`}
      >
        {candidates.length === 0 && (
          <div
            className="type-label-default"
            style={{
              display: "flex",
              alignItems: "center",
              height: 32,
              padding: "0 var(--space-2)",
              color: "var(--fx-text-tertiary)",
            }}
          >
            {t("toolExecutableMissing", "No executable selected")}
          </div>
        )}
        {candidates.map((candidate) => (
          <SourceOption
            key={candidate.id}
            candidate={candidate}
            selected={isSelectedCandidate(capabilityState, candidate)}
            disabled={disabled || !isPreference(candidate.provider) || candidate.health !== "healthy"}
            onSelect={() =>
              isPreference(candidate.provider) &&
              void onAction?.({ action: "set-preference", capability, preference: candidate.provider })
            }
            t={t}
          />
        ))}
      </div>
      <DetailFooter
        capability={capability}
        capabilityState={capabilityState}
        state={state}
        pendingAction={pendingAction}
        disabled={disabled}
        onAction={onAction}
        t={t}
      />
    </div>
  );
}

export function detailId(capability: ToolCapabilityId): string {
  return `tool-detail-${capability.replace(".", "-")}`;
}

function SourceOption({
  candidate,
  selected,
  disabled,
  onSelect,
  t,
}: {
  candidate: PublicCapabilityState["candidates"][number];
  selected: boolean;
  disabled: boolean;
  onSelect: () => void;
  t: Translate;
}) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={selected}
      disabled={disabled && !selected}
      title={[
        `${t("toolProvider", "Provider")}: ${providerLabel(candidate.provider, t)}`,
        `${t("toolHealth", "Status")}: ${healthLabel(candidate.health, t)}`,
        `${t("toolVersion", "Version")}: ${candidate.version ?? "—"}`,
      ].join(" · ")}
      onClick={selected ? undefined : onSelect}
      data-selected={selected || undefined}
      {...(selected ? {} : hoverFill("var(--fx-surface-hover-clear)"))}
      style={{
        display: "flex",
        alignItems: "center",
        gap: 10,
        width: "100%",
        height: 32,
        padding: "0 var(--space-2)",
        border: "none",
        borderRadius: "var(--radius-row)",
        background: selected ? "var(--fx-surface-selected)" : "var(--fx-surface-hover-clear)",
        color: "var(--fx-text-primary)",
        textAlign: "left",
        cursor: selected ? "default" : disabled ? "not-allowed" : "pointer",
        opacity: disabled && !selected ? 0.5 : 1,
        transition: "background-color var(--duration-quick) var(--ease-smooth-out)",
      }}
    >
      <span style={{ display: "inline-flex", alignItems: "center", justifyContent: "center", width: 16, height: 16 }}>
        {selected && <CheckIcon />}
      </span>
      <span
        className="type-mono-label"
        title={candidate.pathLabel}
        style={{
          flex: 1,
          minWidth: 0,
          overflow: "hidden",
          textOverflow: "ellipsis",
          whiteSpace: "nowrap",
          color: selected ? "var(--fx-text-primary)" : "var(--fx-text-secondary)",
        }}
      >
        {candidate.pathLabel}
      </span>
      <span className="type-label-default" style={{ color: "var(--fx-text-tertiary)" }}>
        {providerLabel(candidate.provider, t)}
      </span>
      <span className="type-mono-label" style={{ color: "var(--fx-text-tertiary)" }}>
        {candidate.health === "healthy" ? (candidate.version ?? "") : healthLabel(candidate.health, t)}
      </span>
    </button>
  );
}

function DetailFooter({
  capability,
  capabilityState,
  state,
  pendingAction,
  disabled,
  onAction,
  t,
}: {
  capability: ToolCapabilityId;
  capabilityState?: PublicCapabilityState;
  state: PublicToolchainState;
  pendingAction: string | null;
  disabled: boolean;
  onAction?: ToolAction;
  t: Translate;
}) {
  const component = componentFor(state, capability);
  const operation = operationFor(state, capability);
  const componentId = component?.componentId;
  const cacheId = CAPABILITY_CACHES[capability];
  const cache = cacheId ? state.caches?.[cacheId] : undefined;
  const managedVisible = Boolean(component && (component.installed || component.canInstall || component.canRemove));
  const updateAvailable = Boolean(
    component?.installed && component.canInstall && component.activeVersion !== component.availableVersion,
  );
  const meta = component
    ? [
        COMPONENT_LABELS[component.componentId],
        component.activeVersion ?? component.availableVersion,
        component.installed ? formatBytes(component.diskBytes, t) : formatBytes(component.downloadBytes, t),
        component.sourceName,
      ].filter(Boolean)
    : [];
  const metaDetail = component
    ? [
        t("managedRuntime", "Managed runtime"),
        `${t("managedComponents", "Component")}: ${COMPONENT_LABELS[component.componentId]}`,
        `${t("toolVersion", "Version")}: ${component.activeVersion ?? "—"}`,
        `${t("toolAvailableVersion", "Available version")}: ${component.availableVersion ?? "—"}`,
        `${t("toolPlatform", "Platform")}: ${component.platformArch ?? "—"}`,
        `${t("toolDownloadSize", "Download size")}: ${formatBytes(component.downloadBytes, t)}`,
        `${t("toolDiskUsage", "Disk usage")}: ${formatBytes(component.diskBytes, t)}`,
        `${t("toolSource", "Source")}: ${component.sourceName ?? t("toolSourceUnknown", "Official source")}`,
      ].join("\n")
    : undefined;
  return (
    <div style={{ display: "grid", gap: "var(--space-2)", padding: "var(--space-2) var(--space-2) 0" }}>
      {isOperationVisible(operation) && operation && <OperationProgress operation={operation} t={t} />}
      <div style={{ display: "flex", alignItems: "center", flexWrap: "wrap", gap: "var(--space-2)" }}>
        <span
          className="type-mono-label"
          title={managedVisible ? metaDetail : undefined}
          style={{
            flex: 1,
            minWidth: 0,
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
            color: "var(--fx-text-tertiary)",
          }}
        >
          {managedVisible ? meta.join(" · ") : ""}
        </span>
        {capabilityState && capabilityState.preference !== "auto" && (
          <Button
            variant="ghost"
            disabled={disabled}
            onClick={() => void onAction?.({ action: "set-preference", capability, preference: "auto" })}
          >
            {preferenceLabel("auto", t)}
          </Button>
        )}
        <Button
          variant="ghost"
          disabled={disabled}
          busy={pendingAction === `custom:${capability}`}
          onClick={() => void onAction?.({ action: "choose-custom-tool", capability })}
        >
          {t("chooseCustomTool", "Choose path")}
        </Button>
        {cacheId && cache && (
          <Button
            variant="ghost"
            disabled={disabled || !cache.canClear}
            busy={pendingAction === `cache:${cacheId}`}
            onClick={() => void onAction?.({ action: "clear-cache", cacheId })}
          >
            {t("clearToolCache", "Clear cache")} · {formatBytes(cache.diskBytes, t)}
          </Button>
        )}
        {componentId && component.licenseUrl && (
          <Button variant="ghost" onClick={() => void window.piBridge.openExternal(component.licenseUrl!)}>
            {t("viewToolLicense", "License")}
          </Button>
        )}
        {componentId && component.canRemove && (
          <Button
            variant="ghost"
            disabled={disabled}
            busy={pendingAction === `component:${componentId}:remove`}
            onClick={() => void onAction?.({ action: "remove-component", componentId })}
          >
            {t("removeManagedTool", "Remove")}
          </Button>
        )}
        {componentId && isCancellable(operation) && (
          <Button onClick={() => void onAction?.({ action: "cancel-component-install", componentId })}>
            {t("cancel", "Cancel")}
          </Button>
        )}
        {componentId && component.canInstall && (
          <Button
            disabled={disabled}
            busy={pendingAction === `component:${componentId}:install`}
            onClick={() => void onAction?.({ action: "install-component", componentId })}
          >
            <DownloadIcon />
            {updateAvailable ? t("updateManagedTool", "Update") : t("installManagedTool", "Install")}
          </Button>
        )}
      </div>
    </div>
  );
}
