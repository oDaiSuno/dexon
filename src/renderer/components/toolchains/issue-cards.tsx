import type { PublicToolchainState, ToolCapabilityId } from "@shared/toolchains/types";
import { useI18n } from "@/i18n";
import { Button } from "../form-controls";
import { DownloadIcon, RefreshIcon } from "./icons";
import { LogoTile, OperationProgress, SectionHeader, StatusDot } from "./section-parts";
import {
  CAPABILITY_LABELS,
  TOOL_COUNT,
  componentFor,
  formatBytes,
  friendlyErrorCode,
  healthLabel,
  healthTone,
  isCancellable,
  isOperationVisible,
  operationFor,
  severityLabel,
  toneBorderColor,
  toneColor,
  toneTextColor,
  type ToolAction,
  type Translate,
} from "./shared";

export function IssueSection({
  state,
  issues,
  pendingAction,
  disabled,
  isMobile,
  onAction,
}: {
  state: PublicToolchainState;
  issues: readonly ToolCapabilityId[];
  pendingAction: string | null;
  disabled: boolean;
  isMobile: boolean;
  onAction?: ToolAction;
}) {
  const { t } = useI18n();
  return (
    <section style={{ display: "grid", gap: 10 }}>
      <SectionHeader title={t("toolIssues", "Needs attention")}>
        <span className="type-mono-label" style={{ color: "var(--fx-text-tertiary)" }}>
          {issues.length}
        </span>
        <span className="type-label-default" style={{ flex: 1, textAlign: "right", color: "var(--fx-text-tertiary)" }}>
          {t("toolIssuesHint", "All {count} tools will be ready once resolved").replace("{count}", String(TOOL_COUNT))}
        </span>
      </SectionHeader>
      <div
        style={{
          display: "grid",
          gridTemplateColumns: isMobile ? "minmax(0, 1fr)" : "repeat(2, minmax(0, 1fr))",
          gap: "var(--space-3)",
        }}
      >
        {issues.map((capability) => (
          <IssueCard
            key={capability}
            capability={capability}
            state={state}
            pendingAction={pendingAction}
            disabled={disabled}
            onAction={onAction}
            t={t}
          />
        ))}
      </div>
    </section>
  );
}

function IssueCard({
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
  const health = capabilityState?.health ?? "missing";
  const tone = healthTone(health);
  const name = CAPABILITY_LABELS[capability];
  const component = componentFor(state, capability);
  const operation = operationFor(state, capability);
  const componentId = component?.componentId;
  const size = component?.downloadBytes ?? component?.installedBytes;
  return (
    <article
      data-tool-id={capability}
      aria-label={`${name} · ${healthLabel(health, t)}`}
      style={{
        position: "relative",
        overflow: "hidden",
        display: "grid",
        alignContent: "start",
        gap: "var(--space-4)",
        padding: 18,
        border: `1px solid ${toneBorderColor(tone)}`,
        borderRadius: "var(--radius-dialog)",
        background: "var(--fx-surface-raised)",
      }}
    >
      <span
        aria-hidden="true"
        style={{
          position: "absolute",
          left: -70,
          top: -90,
          width: 260,
          height: 200,
          pointerEvents: "none",
          background: `radial-gradient(50% 50% at 50% 50%, color-mix(in srgb, ${toneColor(tone)} 16%, transparent) 0%, transparent 100%)`,
        }}
      />
      <div style={{ position: "relative", display: "flex", alignItems: "center", gap: "var(--space-3)" }}>
        <LogoTile capability={capability} size="large" />
        <span style={{ flex: 1 }} />
        <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
          <StatusDot tone={tone} />
          <span className="type-label-medium" style={{ color: toneTextColor(tone) }}>
            {severityLabel(health, t)}
          </span>
        </span>
      </div>
      <div style={{ position: "relative", display: "grid", gap: 6 }}>
        <h3 className="type-title-dialog" style={{ margin: 0, color: "var(--fx-text-primary)" }}>
          {issueTitle(health, name, t)}
        </h3>
        <p className="type-body-relaxed" style={{ margin: 0, color: "var(--fx-text-secondary)", textWrap: "pretty" }}>
          {issueDescription(capability, state, t)}
        </p>
      </div>
      {isOperationVisible(operation) && operation && (
        <div style={{ position: "relative" }}>
          <OperationProgress operation={operation} t={t} />
        </div>
      )}
      <div
        style={{
          position: "relative",
          display: "flex",
          alignItems: "center",
          flexWrap: "wrap",
          gap: "var(--space-2)",
          paddingTop: "var(--space-3-5)",
          borderTop: "1px solid var(--fx-line-default)",
        }}
      >
        <span
          className="type-mono-label"
          title={component?.sourceName}
          style={{
            flex: 1,
            minWidth: 0,
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
            color: "var(--fx-text-tertiary)",
          }}
        >
          {size !== undefined
            ? t("toolApproxSize", "About {size}").replace("{size}", formatBytes(size, t))
            : (capabilityState?.pathLabel ?? t("toolProviderNone", "Not found"))}
        </span>
        {!component?.canRepair && (
          <Button
            variant="ghost"
            disabled={disabled}
            busy={pendingAction === `custom:${capability}`}
            onClick={() => void onAction?.({ action: "choose-custom-tool", capability })}
          >
            {t("chooseCustomTool", "Choose path")}
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
        {componentId && component.canRepair ? (
          <Button
            disabled={disabled}
            busy={pendingAction === `component:${componentId}:repair`}
            onClick={() => void onAction?.({ action: "repair-component", componentId })}
          >
            <RefreshIcon />
            {t("repairManagedTool", "Reinstall")}
          </Button>
        ) : componentId && component.canInstall ? (
          <Button
            variant="primary"
            disabled={disabled}
            busy={pendingAction === `component:${componentId}:install`}
            onClick={() => void onAction?.({ action: "install-component", componentId })}
          >
            <DownloadIcon />
            {t("installManagedTool", "Install")}
          </Button>
        ) : null}
      </div>
    </article>
  );
}

function issueTitle(health: string, name: string, t: Translate): string {
  if (health === "missing") return t("toolIssueMissingTitle", "{name} is not installed").replace("{name}", name);
  if (health === "modified") return t("toolIssueModifiedTitle", "{name} was modified").replace("{name}", name);
  if (health === "incomplete" || health === "unverified")
    return t("toolIssueCheckTitle", "{name} needs a check").replace("{name}", name);
  return t("toolIssueBrokenTitle", "{name} can't be used").replace("{name}", name);
}

function issueDescription(capability: ToolCapabilityId, state: PublicToolchainState, t: Translate): string {
  const capabilityState = state.capabilities[capability];
  const name = CAPABILITY_LABELS[capability];
  const component = componentFor(state, capability);
  if (capabilityState?.health === "modified" || (component?.health === "modified" && component.canRepair)) {
    const purpose = capability === "search.rg" ? t("toolPurposeSearch", "code search") : t("toolPurposeDefault", "it");
    return t(
      "toolIssueModified",
      "Its files no longer match what was recorded at install, so it is paused for safety. Reinstall to restore {purpose}.",
    ).replace("{purpose}", purpose);
  }
  if (capabilityState?.health === "missing" || !capabilityState) {
    return component?.canInstall
      ? t(
          "toolIssueMissingInstall",
          "Skills that rely on {name} can't run yet. The installed copy stays inside Dexon and leaves your system untouched.",
        ).replaceAll("{name}", name)
      : t(
          "toolIssueMissingChoose",
          "Skills that rely on {name} can't run yet. You can choose an existing {name} on this computer.",
        ).replaceAll("{name}", name);
  }
  if (capabilityState.reasonCode) return friendlyErrorCode(capabilityState.reasonCode, t);
  return t("toolIssueGeneric", "This tool can't be used right now. Rescan, or choose another path.");
}
