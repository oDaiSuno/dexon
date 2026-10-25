import type { CSSProperties } from "react";
import { useI18n } from "@/i18n";
import { channelLabel } from "../channels/channels-config/channel-labels";
import { BrowserIcon, type BrowserIconName } from "./browser-icons";
import type { BrowserAgentAuthorizationRequest } from "../../../contract/browser";
import type { ChannelId } from "../../../shared/channel-types";

type BrowserPermission = BrowserAgentAuthorizationRequest["minimumPermission"];

const LEVELS: BrowserPermission[] = ["read", "interact", "advanced"];

const LEVEL_ICONS: Record<BrowserPermission, BrowserIconName> = {
  read: "eye",
  interact: "mouse-pointer-click",
  advanced: "code",
};

export function BrowserAuthorizationFacts({
  sessionTitle,
  source,
  channel,
}: {
  sessionTitle: string;
  source: BrowserAgentAuthorizationRequest["source"];
  channel?: ChannelId;
}) {
  const { t } = useI18n();
  const sourceLabel =
    source === "channel"
      ? [
          t("browserAuthorizationSourceChannel", "Approved messaging channel"),
          ...(channel ? [channelLabel(channel, t)] : []),
        ].join(" · ")
      : t("browserAuthorizationSourceLocal", "Local desktop session");
  return (
    <div style={{ padding: "var(--space-4) var(--space-5) 0" }}>
      <dl
        style={{
          margin: 0,
          overflow: "hidden",
          border: "1px solid var(--fx-line-default)",
          borderRadius: "var(--radius-card)",
        }}
      >
        <div style={factRowStyle}>
          <dt className="type-label-default" style={factLabelStyle}>
            {t("browserAuthorizationSession", "Session")}
          </dt>
          <dd className="type-label-medium" title={sessionTitle} style={factValueStyle}>
            <span style={factIconStyle}>
              <BrowserIcon name="message-square" size={13} />
            </span>
            <span style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
              {sessionTitle}
            </span>
          </dd>
        </div>
        <div style={{ ...factRowStyle, borderTop: "1px solid var(--fx-line-subtle)" }}>
          <dt className="type-label-default" style={factLabelStyle}>
            {t("browserAuthorizationSource", "Source")}
          </dt>
          <dd className="type-label-default" style={factValueStyle}>
            <span style={factIconStyle}>
              <BrowserIcon name={source === "channel" ? "send" : "laptop"} size={13} />
            </span>
            {sourceLabel}
          </dd>
        </div>
      </dl>
    </div>
  );
}

export function BrowserAuthorizationLadder({ permission }: { permission: BrowserPermission }) {
  const { t } = useI18n();
  const names: Record<BrowserPermission, string> = {
    read: t("browserAuthorizationRead", "Read pages"),
    interact: t("browserAuthorizationInteract", "Interact with pages"),
    advanced: t("browserAuthorizationAdvanced", "Advanced Browser Mode"),
  };
  const summaries: Record<BrowserPermission, string> = {
    read: t("browserAuthorizationReadSummary", "Open and navigate pages, read page snapshots, take screenshots"),
    interact: t(
      "browserAuthorizationInteractSummary",
      "Also click, type, press keys, and scroll, only in this session's tabs",
    ),
    advanced: t(
      "browserAuthorizationAdvancedSummary",
      "Also run JavaScript, inspect and replay network requests, and use CDP",
    ),
  };
  const currentIndex = LEVELS.indexOf(permission);
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        gap: "var(--space-2)",
        padding: "var(--space-4) var(--space-5) 0",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: "var(--space-2)" }}>
        <span
          id="browser-agent-authorization-levels"
          className="type-label-medium"
          style={{ flex: 1, minWidth: 0, color: "var(--fx-text-secondary)" }}
        >
          {t("browserAuthorizationPermission", "Requested permission")}
        </span>
        <span className="type-meta-default" style={{ color: "var(--fx-text-tertiary)" }}>
          {t("browserAuthorizationLevelHint", "One of three levels")}
        </span>
      </div>
      <ol
        aria-labelledby="browser-agent-authorization-levels"
        style={{
          margin: 0,
          padding: 0,
          listStyle: "none",
          overflow: "hidden",
          border: "1px solid var(--fx-line-default)",
          borderRadius: "var(--radius-card)",
        }}
      >
        {LEVELS.map((level, index) => (
          <LadderStep
            key={level}
            level={level}
            name={names[level]}
            summary={summaries[level]}
            state={index === currentIndex ? "current" : index < currentIndex ? "included" : "excluded"}
            divided={index > 0}
          />
        ))}
      </ol>
    </div>
  );
}

function LadderStep({
  level,
  name,
  summary,
  state,
  divided,
}: {
  level: BrowserPermission;
  name: string;
  summary: string;
  state: "current" | "included" | "excluded";
  divided: boolean;
}) {
  const current = state === "current";
  const danger = level === "advanced";
  const accent = danger ? "var(--fx-status-danger-text)" : "var(--fx-accent-blue-text)";
  return (
    <li
      aria-current={current || undefined}
      style={{
        display: "flex",
        alignItems: "flex-start",
        gap: "var(--space-3)",
        padding: "var(--space-2-5) var(--space-3)",
        borderTop: divided ? "1px solid var(--fx-line-subtle)" : undefined,
        background: current ? (danger ? "var(--fx-status-danger-soft)" : "var(--fx-accent-blue-soft)") : undefined,
      }}
    >
      <span
        style={{
          display: "flex",
          flexShrink: 0,
          alignItems: "center",
          justifyContent: "center",
          width: 24,
          height: 24,
          borderRadius: "var(--radius-chip)",
          background: current ? "var(--fx-surface-raised)" : "var(--fx-surface-inset)",
          color: current ? accent : state === "included" ? "var(--fx-text-secondary)" : "var(--fx-text-tertiary)",
        }}
      >
        <BrowserIcon name={LEVEL_ICONS[level]} size={13} />
      </span>
      <span style={{ display: "flex", flex: 1, flexDirection: "column", gap: "var(--space-0-5)", minWidth: 0 }}>
        <span
          className="type-label-medium"
          style={{
            color:
              current && danger
                ? "var(--fx-status-danger-text)"
                : state === "excluded"
                  ? "var(--fx-text-secondary)"
                  : "var(--fx-text-primary)",
          }}
        >
          {name}
        </span>
        <span
          className="type-meta-default"
          style={{
            color: current ? "var(--fx-text-secondary)" : "var(--fx-text-tertiary)",
            textWrap: "pretty",
          }}
        >
          {summary}
        </span>
      </span>
      {current && (
        <span
          style={{
            display: "flex",
            flexShrink: 0,
            alignItems: "center",
            justifyContent: "center",
            width: 18,
            height: 24,
            color: accent,
          }}
        >
          <BrowserIcon name="check" size={14} strokeWidth={2.25} />
        </span>
      )}
    </li>
  );
}

const factRowStyle: CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: "var(--space-3)",
  height: 36,
  padding: "0 var(--space-3)",
};

const factLabelStyle: CSSProperties = {
  flexShrink: 0,
  width: 56,
  color: "var(--fx-text-tertiary)",
};

const factValueStyle: CSSProperties = {
  display: "flex",
  flex: 1,
  alignItems: "center",
  gap: "var(--space-3)",
  minWidth: 0,
  margin: 0,
  color: "var(--fx-text-primary)",
};

const factIconStyle: CSSProperties = {
  display: "flex",
  flexShrink: 0,
  color: "var(--fx-text-secondary)",
};
