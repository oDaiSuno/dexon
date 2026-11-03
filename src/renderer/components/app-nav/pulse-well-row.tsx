import { useI18n } from "@/i18n";
import { getSessionDisplayTitle } from "@/lib/session-list";
import type { PulseRow } from "@/lib/sidebar-activity";
import type { PulseActivity } from "@/lib/session-tree-status";
import type { SessionInfo } from "@/lib/types";
import {
  ACTIVITY_TONE,
  activityCountsPhrase,
  AlertGlyph,
  LoaderGlyph,
  QuestionGlyph,
} from "../session-sidebar/session-status-indicators";
import { BranchCountGlyph } from "../session-sidebar/session-relation-glyphs";

export function ActivityGlyph({ status, size }: { status: PulseActivity; size: number }) {
  return (
    <span
      aria-hidden="true"
      className={
        status === "running" ? "session-status-spin" : status === "awaiting_input" ? "session-status-pulse" : undefined
      }
      style={{
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        width: size,
        height: size,
        flexShrink: 0,
        color: ACTIVITY_TONE[status].icon,
      }}
    >
      {status === "running" ? (
        <LoaderGlyph size={size} />
      ) : status === "awaiting_input" ? (
        <QuestionGlyph size={size} />
      ) : status === "unread" ? (
        <span
          data-activity="unread"
          style={{ width: 6, height: 6, borderRadius: "var(--radius-pill)", background: ACTIVITY_TONE.unread.dot }}
        />
      ) : (
        <AlertGlyph size={size} />
      )}
    </span>
  );
}

export function PulseWellRow({
  row,
  selected,
  now,
  onOpen,
}: {
  row: PulseRow;
  selected: boolean;
  now: number;
  onOpen: (session: SessionInfo) => void;
}) {
  const { t, language } = useI18n();
  const title = getSessionDisplayTitle(row.root);
  const status = activityCountsPhrase({ awaiting_input: 0, error: 0, running: 0, unread: 0, [row.status]: 1 }, t);
  const since =
    row.runAge.kind === "observed"
      ? row.runAge.since
      : row.runAge.kind === "unknown"
        ? row.runAge.fallbackModifiedMs
        : null;
  const seconds = Math.max(0, Math.floor((now - (since ?? now)) / 1000));
  const unit = seconds < 60 ? "second" : seconds < 3600 ? "minute" : "hour";
  const elapsed = new Intl.NumberFormat(language, { style: "unit", unit, unitDisplay: "narrow" }).format(
    Math.floor(seconds / (unit === "hour" ? 3600 : unit === "minute" ? 60 : 1)),
  );
  const ageLabel =
    since === null ? t("pulseRunning", "Running") : `${row.runAge.kind === "unknown" ? "≈" : ""}${elapsed}`;
  const ageHint =
    row.runAge.kind === "observed"
      ? t("pulseObservedAge", "Time since this app observed the session start running")
      : since === null
        ? t("pulseRunStartUnknown", "Actual run start is unknown.")
        : t("pulseUnknownAge", "Last activity; actual run start is unknown.");
  const subagentsLabel = t("pulseSubagents", "{count} active sub-sessions").replace("{count}", String(row.subagents));
  const description = [
    row.subagents > 0 ? subagentsLabel : null,
    row.status === "running" ? `${ageLabel} · ${ageHint}` : null,
  ]
    .filter(Boolean)
    .join(" · ");
  return (
    <button
      type="button"
      aria-label={`${row.projectName} / ${title} · ${status}`}
      aria-description={description || undefined}
      title={`${row.projectName} / ${title}`}
      aria-current={selected ? "page" : undefined}
      onClick={() => onOpen(row.target)}
      style={{
        display: "flex",
        alignItems: "center",
        width: "100%",
        minWidth: 0,
        height: 28,
        flexShrink: 0,
        padding: "0 8px",
        gap: 6,
        border: 0,
        borderRadius: "var(--radius-row)",
        background: selected ? "var(--fx-surface-selected)" : "transparent",
        textAlign: "left",
        cursor: "pointer",
      }}
    >
      <ActivityGlyph status={row.status} size={13} />
      <span
        className="type-mono-meta"
        title={row.projectName}
        style={{
          display: "inline-flex",
          flexShrink: 1,
          maxWidth: "32%",
          minWidth: 0,
          color: "var(--fx-text-tertiary)",
        }}
      >
        <span style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          {row.projectName}
        </span>
        <span style={{ flexShrink: 0, whiteSpace: "pre" }}>{" /"}</span>
      </span>
      <span
        className="type-body-medium"
        title={title}
        style={{
          flex: 1,
          minWidth: 56,
          overflow: "hidden",
          textOverflow: "ellipsis",
          whiteSpace: "nowrap",
          color: "var(--fx-text-primary)",
        }}
      >
        {title}
      </span>
      {row.subagents > 0 && (
        <span
          aria-label={subagentsLabel}
          className="type-mono-meta"
          style={{
            display: "inline-flex",
            alignItems: "center",
            flexShrink: 0,
            padding: "0 5px",
            gap: 3,
            borderRadius: 8,
            background: "var(--fx-surface-card)",
            border: "1px solid var(--fx-line-default)",
            color: "var(--fx-text-secondary)",
          }}
        >
          <BranchCountGlyph size={10} />
          {row.subagents}
        </span>
      )}
      <span
        title={row.status === "running" ? ageHint : undefined}
        className="type-label-default"
        style={{
          flexShrink: 0,
          color: row.status === "running" ? "var(--fx-text-tertiary)" : ACTIVITY_TONE[row.status].text,
        }}
      >
        {row.status === "awaiting_input"
          ? t("pulseWaiting", "Waiting")
          : row.status === "error"
            ? t("sessionStatusError", "Failed")
            : row.status === "unread"
              ? t("newSessionActivity", "New activity")
              : ageLabel}
      </span>
    </button>
  );
}
