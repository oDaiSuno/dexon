import { useI18n } from "@/i18n";
import { formatNumber, formatRelativeDateTime } from "@/lib/locale-format";
import { useId, useState, type CSSProperties } from "react";
import { ChevronDownIcon } from "../chat-input/icons";
import { SessionIdentity } from "./session-identity";
import { ContextSection, ROW, SWATCH } from "./usage-context-section";
import { formatUsageCost, formatUsedTokens } from "./usage-format";
import type { SessionCopyField, SessionCopyFeedback, ContextUsageState, UsageCompaction } from "./use-session-info";
import type { SessionStatsInfo } from "@/lib/pi-types";
import type { SessionInfo } from "@/lib/types";

const DIVIDER: CSSProperties = { borderTop: "1px solid var(--fx-line-default)" };
const SECTION: CSSProperties = { padding: "14px 16px 16px" };
const FOOTER: CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 6,
  padding: "10px 16px",
  background: "var(--fx-surface-main)",
  ...DIVIDER,
};
const DETAILS_TOGGLE: CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 4,
  padding: 0,
  border: "none",
  background: "none",
  color: "var(--fx-text-tertiary)",
  cursor: "pointer",
};
const ROW_TOKENS: CSSProperties = {
  width: 52,
  flexShrink: 0,
  textAlign: "right",
  color: "var(--fx-text-tertiary)",
  whiteSpace: "nowrap",
};
const ROW_COST: CSSProperties = {
  width: 44,
  flexShrink: 0,
  textAlign: "right",
  color: "var(--fx-text-primary)",
  whiteSpace: "nowrap",
};

const COST_SEGMENTS = ["input", "output", "cacheRead", "cacheWrite"] as const;

const COST_SWATCH: Record<(typeof COST_SEGMENTS)[number], string> = {
  input: "var(--fx-text-body)",
  output: "var(--fx-text-secondary)",
  cacheRead: "var(--fx-text-tertiary)",
  cacheWrite: "var(--fx-text-faint)",
};

export function UsageCard({
  sessionStats,
  contextUsage,
  modelId,
  selectedSession,
  copyFeedback,
  onCopyField,
  compaction,
}: {
  sessionStats: SessionStatsInfo | null;
  contextUsage: ContextUsageState | null;
  modelId: string | null;
  selectedSession: SessionInfo | null;
  copyFeedback: SessionCopyFeedback | null;
  onCopyField: (field: SessionCopyField, value: string) => void;
  compaction: UsageCompaction | null;
}) {
  const { language, t } = useI18n();
  const ctx = contextUsage ?? sessionStats?.contextUsage ?? null;
  const [detailsOpen, setDetailsOpen] = useState(false);
  const detailsId = useId();
  const lastCompactionAt = sessionStats?.lastCompactionAt ?? null;

  return (
    <section
      aria-label={t("usageCardLabel", "Context and cost")}
      className="composer-pop-in"
      style={{
        position: "absolute",
        top: "calc(100% + 8px)",
        right: 0,
        zIndex: 50,
        display: "flex",
        flexDirection: "column",
        width: 388,
        maxWidth: "calc(100vw - 32px)",
        maxHeight: "calc(100dvh - 72px)",
        overflowY: "auto",
        boxSizing: "border-box",
        background: "var(--fx-surface-raised)",
        border: "1px solid var(--fx-line-default)",
        borderRadius: "var(--radius-dialog)",
        boxShadow: "var(--shadow-overlay)",
        transformOrigin: "top right",
      }}
    >
      {sessionStats || selectedSession ? (
        <>
          <ContextSection ctx={ctx} modelId={modelId} compaction={compaction} />
          {sessionStats && <BillingSection sessionStats={sessionStats} />}
          <div style={FOOTER}>
            <button
              type="button"
              aria-expanded={detailsOpen}
              aria-controls={detailsId}
              onClick={() => setDetailsOpen(!detailsOpen)}
              className="type-mono-meta"
              style={DETAILS_TOGGLE}
            >
              {t("usageDetails", "Details")}
              <span
                className="flex"
                style={{ transform: detailsOpen ? "rotate(180deg)" : undefined, transition: "transform 0.12s" }}
              >
                <ChevronDownIcon size={12} />
              </span>
            </button>
            {lastCompactionAt && (
              <span className="type-mono-meta" style={{ marginLeft: "auto", color: "var(--fx-text-tertiary)" }}>
                {t("usageLastCompaction", "Last compacted {time}").replace(
                  "{time}",
                  formatRelativeDateTime(lastCompactionAt, language),
                )}
              </span>
            )}
          </div>
          {detailsOpen && (
            <div id={detailsId}>
              <SessionInfoPopover
                sessionStats={sessionStats}
                selectedSession={selectedSession}
                copyFeedback={copyFeedback}
                onCopyField={onCopyField}
              />
            </div>
          )}
        </>
      ) : (
        <div className="type-label-default" style={{ padding: 16, color: "var(--fx-text-secondary)" }}>
          {t("loadSessionInfoHint", "Send a message or run /session to load session info")}
        </div>
      )}
    </section>
  );
}

export function SessionInfoPopover({
  sessionStats,
  selectedSession,
  copyFeedback,
  onCopyField,
}: {
  sessionStats: SessionStatsInfo | null;
  selectedSession?: SessionInfo | null;
  copyFeedback: SessionCopyFeedback | null;
  onCopyField: (field: SessionCopyField, value: string) => void;
}) {
  const { language, t } = useI18n();

  return (
    <>
      <IdentitySection
        name={selectedSession ? selectedSession.name : sessionStats?.sessionName}
        file={sessionStats?.sessionFile ?? selectedSession?.path}
        id={sessionStats?.sessionId ?? selectedSession?.id ?? ""}
        copyFeedback={copyFeedback}
        onCopyField={onCopyField}
      />
      {sessionStats && (
        <div style={FOOTER}>
          <span className="type-mono-meta" style={{ flex: "1 1 0", minWidth: 0, color: "var(--fx-text-tertiary)" }}>
            {t("usageMessageSummary", "{messages} messages · {toolCalls} tool calls")
              .replace("{messages}", formatNumber(sessionStats.totalMessages, language))
              .replace("{toolCalls}", formatNumber(sessionStats.toolCalls, language))}
          </span>
        </div>
      )}
    </>
  );
}

function BillingSection({ sessionStats }: { sessionStats: SessionStatsInfo }) {
  const { t } = useI18n();
  const costs = sessionStats.costs;

  const rows = [
    { key: "input", label: t("usageInput", "Input"), value: sessionStats.tokens.input },
    { key: "output", label: t("usageOutput", "Output"), value: sessionStats.tokens.output },
    { key: "cacheRead", label: t("cacheRead", "Cache read"), value: sessionStats.tokens.cacheRead },
    { key: "cacheWrite", label: t("cacheWrite", "Cache write"), value: sessionStats.tokens.cacheWrite },
  ] as const;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10, ...SECTION, ...DIVIDER }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <span className="type-label-medium" style={{ flex: "1 1 0", minWidth: 0, color: "var(--fx-text-tertiary)" }}>
          {t("sessionCostTitle", "Session cost")}
        </span>
        <span className="type-mono-number-strong" style={{ color: "var(--fx-text-primary)" }}>
          {formatUsageCost(sessionStats.cost)}
        </span>
      </div>
      {costs && sessionStats.cost > 0 && (
        <div
          aria-hidden="true"
          style={{
            display: "flex",
            gap: 2,
            height: 6,
            borderRadius: "var(--radius-skeleton)",
            overflow: "hidden",
          }}
        >
          {COST_SEGMENTS.map((segment) => (
            <span key={segment} style={{ flexGrow: costs[segment], flexBasis: 0, background: COST_SWATCH[segment] }} />
          ))}
        </div>
      )}
      <div style={{ display: "flex", flexDirection: "column", gap: 6, paddingTop: 2 }}>
        {rows.map((row) => (
          <div key={row.key} style={ROW}>
            <span aria-hidden="true" style={{ ...SWATCH, background: COST_SWATCH[row.key] }} />
            <span
              className="type-body-default"
              style={{ flex: "1 1 0", minWidth: 0, color: "var(--fx-text-secondary)" }}
            >
              {row.label}
            </span>
            <span className="type-mono-label" style={ROW_TOKENS}>
              {formatUsedTokens(row.value)}
            </span>
            {costs && (
              <span className="type-mono-label" style={ROW_COST}>
                {formatUsageCost(costs[row.key])}
              </span>
            )}
          </div>
        ))}
      </div>
      <div className="type-label-default" style={{ color: "var(--fx-text-tertiary)" }}>
        {t("costEstimateNote", "Estimated from providers' published prices; your bill is final.")}
      </div>
    </div>
  );
}

function IdentitySection({
  name,
  file,
  id,
  copyFeedback,
  onCopyField,
}: {
  name?: string;
  file?: string;
  id: string;
  copyFeedback: SessionCopyFeedback | null;
  onCopyField: (field: SessionCopyField, value: string) => void;
}) {
  return (
    <div className="type-mono-label" style={{ ...SECTION, ...DIVIDER, color: "var(--fx-text-secondary)" }}>
      <SessionIdentity
        sessionName={name}
        sessionFile={file}
        sessionId={id}
        copyFeedback={copyFeedback}
        onCopyField={onCopyField}
      />
    </div>
  );
}
