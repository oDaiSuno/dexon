import { Fragment } from "react";
import type { PublicToolchainState, ToolCapabilityId } from "@shared/toolchains/types";
import { useI18n } from "@/i18n";
import { ChevronIcon } from "./icons";
import { categoryTitle } from "./overview-section";
import { SectionHeader, hoverFill } from "./section-parts";
import { ToolDetail, detailId } from "./tool-detail";
import {
  CAPABILITY_LABELS,
  TOOL_CATEGORIES,
  followedLeader,
  isNotNeeded,
  isReady,
  platformName,
  providerLabel,
  type ToolAction,
  type Translate,
} from "./shared";

export function ReadySection({
  state,
  expanded,
  pendingAction,
  disabled,
  onToggle,
  onAction,
}: {
  state: PublicToolchainState;
  expanded: ToolCapabilityId | null;
  pendingAction: string | null;
  disabled: boolean;
  onToggle: (capability: ToolCapabilityId) => void;
  onAction?: ToolAction;
}) {
  const { t } = useI18n();
  const groups = TOOL_CATEGORIES.map((category) => ({
    ...category,
    ready: category.capabilities.filter((capability) => isReady(capability, state)),
  })).filter((category) => category.ready.length > 0);
  return (
    <section style={{ display: "grid", gap: 10 }}>
      <SectionHeader title={t("toolReady", "Ready")}>
        <span className="type-label-default" style={{ flex: 1, textAlign: "right", color: "var(--fx-text-tertiary)" }}>
          {t("toolDetailDescription", "Click a row to switch source")}
        </span>
      </SectionHeader>
      <div
        aria-label={t("toolList", "Developer tool list")}
        role="list"
        style={{
          overflow: "hidden",
          border: "1px solid var(--fx-line-default)",
          borderRadius: "var(--radius-dialog)",
          background: "var(--fx-surface-raised)",
          paddingBottom: 6,
        }}
      >
        {groups.map((group, index) => (
          <Fragment key={group.id}>
            <div
              className="type-meta-caps"
              style={{
                padding: "var(--space-3-5) var(--space-5) 6px",
                borderTop: index === 0 ? "none" : "1px solid var(--fx-line-default)",
                color: "var(--fx-text-tertiary)",
                textTransform: "uppercase",
              }}
            >
              {categoryTitle(group.id, t, true)}
            </div>
            {group.ready.map((capability) => (
              <ReadyRow
                key={capability}
                capability={capability}
                state={state}
                open={expanded === capability}
                pendingAction={pendingAction}
                disabled={disabled}
                onToggle={() => onToggle(capability)}
                onAction={onAction}
                t={t}
              />
            ))}
          </Fragment>
        ))}
      </div>
    </section>
  );
}

function ReadyRow({
  capability,
  state,
  open,
  pendingAction,
  disabled,
  onToggle,
  onAction,
  t,
}: {
  capability: ToolCapabilityId;
  state: PublicToolchainState;
  open: boolean;
  pendingAction: string | null;
  disabled: boolean;
  onToggle: () => void;
  onAction?: ToolAction;
  t: Translate;
}) {
  const capabilityState = state.capabilities[capability];
  const name = CAPABILITY_LABELS[capability];
  const notNeeded = isNotNeeded(capability, state);
  const leader = followedLeader(capability, state);
  const source = notNeeded
    ? t("toolNotNeeded", "Not needed on {platform}").replace("{platform}", platformName(state.platform))
    : leader
      ? t("toolFollows", "Follows {name}").replace("{name}", CAPABILITY_LABELS[leader])
      : capabilityState?.provider
        ? providerLabel(capabilityState.provider, t)
        : "";
  const rowStyle = {
    display: "flex",
    alignItems: "center",
    gap: 10,
    width: "100%",
    height: 40,
    padding: "0 var(--space-5)",
    border: "none",
    textAlign: "left",
  } as const;
  const content = (
    <>
      <span style={{ flex: 1, minWidth: 0, display: "flex", alignItems: "center", gap: "var(--space-2)" }}>
        <span
          className="type-body-large-medium"
          style={{ color: notNeeded ? "var(--fx-text-tertiary)" : "var(--fx-text-primary)" }}
        >
          {name}
        </span>
        {!notNeeded && capabilityState?.version && (
          <span className="type-mono-label" style={{ color: "var(--fx-text-tertiary)" }}>
            {capabilityState.version}
          </span>
        )}
      </span>
      <span
        className="type-body-default"
        style={{ color: notNeeded ? "var(--fx-text-tertiary)" : "var(--fx-text-secondary)" }}
      >
        {source}
      </span>
    </>
  );
  if (notNeeded) {
    return (
      <div role="listitem" data-tool-id={capability} style={rowStyle}>
        {content}
      </div>
    );
  }
  const rest = open ? "var(--fx-surface-card)" : "var(--fx-surface-hover-clear)";
  return (
    <div role="listitem">
      <button
        type="button"
        data-tool-id={capability}
        aria-expanded={open}
        aria-controls={open ? detailId(capability) : undefined}
        aria-label={`${name} · ${source}`}
        title={`${t("toolCandidatesLabel", "Detected candidates")}: ${capabilityState?.candidates.length ?? 0}`}
        onClick={onToggle}
        {...(open ? {} : hoverFill(rest))}
        style={{
          ...rowStyle,
          background: rest,
          color: "var(--fx-text-primary)",
          cursor: "pointer",
          transition: "background-color var(--duration-quick) var(--ease-smooth-out)",
        }}
      >
        {content}
        <span style={{ display: "inline-flex", color: "var(--fx-text-tertiary)" }}>
          <ChevronIcon open={open} />
        </span>
      </button>
      {open && (
        <ToolDetail
          capability={capability}
          state={state}
          pendingAction={pendingAction}
          disabled={disabled}
          onAction={onAction}
          t={t}
        />
      )}
    </div>
  );
}
