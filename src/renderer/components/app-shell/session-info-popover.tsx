import { useI18n } from "@/i18n";
import { formatNumber } from "@/lib/locale-format";
import { formatTokenCount } from "../chat-input/SessionControls";
import { SessionIdentity } from "./session-identity";
import { formatUsageCost, formatUsagePercent, formatUsedTokens } from "./usage-format";
import type { SessionCopyField, SessionCopyFeedback, ContextUsageState } from "./use-session-info";
import type { SessionStatsInfo } from "@/lib/pi-types";
import type { SessionInfo } from "@/lib/types";
import type { CSSProperties } from "react";

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
const ROW: CSSProperties = { display: "flex", alignItems: "center", gap: 10 };
const SWATCH: CSSProperties = { width: 8, height: 8, flexShrink: 0, borderRadius: "var(--radius-bar)" };
const ROW_LABEL: CSSProperties = { flex: "1 1 0", minWidth: 0, color: "var(--fx-text-secondary)" };
const ROW_VALUE: CSSProperties = { width: 52, flexShrink: 0, textAlign: "right", color: "var(--fx-text-tertiary)" };

export function UsageCard({
  sessionStats,
  contextUsage,
  modelId,
  selectedSession,
  copyFeedback,
  onCopyField,
}: {
  sessionStats: SessionStatsInfo | null;
  contextUsage: ContextUsageState | null;
  modelId: string | null;
  selectedSession: SessionInfo | null;
  copyFeedback: SessionCopyFeedback | null;
  onCopyField: (field: SessionCopyField, value: string) => void;
}) {
  const { t } = useI18n();
  const ctx = contextUsage ?? sessionStats?.contextUsage ?? null;

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
      }}
    >
      {sessionStats ? (
        <>
          <ContextSection ctx={ctx} modelId={modelId} />
          <SessionInfoPopover sessionStats={sessionStats} copyFeedback={copyFeedback} onCopyField={onCopyField} />
        </>
      ) : selectedSession ? (
        <>
          <ContextSection ctx={ctx} modelId={modelId} />
          <IdentitySection
            name={selectedSession.name}
            file={selectedSession.path}
            id={selectedSession.id}
            copyFeedback={copyFeedback}
            onCopyField={onCopyField}
          />
        </>
      ) : (
        <div className="type-label-default" style={{ padding: 16, color: "var(--fx-text-secondary)" }}>
          {t("loadSessionInfoHint", "Send a message or run /session to load session info")}
        </div>
      )}
    </section>
  );
}

function ContextSection({ ctx, modelId }: { ctx: ContextUsageState | null; modelId: string | null }) {
  const { t } = useI18n();
  const windowKnown = ctx !== null && ctx.contextWindow > 0;
  const pending = ctx === null || ctx.percent === null;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14, padding: 16 }}>
      <div style={{ display: "flex", alignItems: "flex-end", gap: 8 }}>
        <div style={{ display: "flex", flexDirection: "column", gap: 2, flex: "1 1 0", minWidth: 0 }}>
          <div className="type-label-medium" style={{ color: "var(--fx-text-tertiary)" }}>
            {t("usageContext", "Context")}
          </div>
          {windowKnown && (
            <div style={{ display: "flex", alignItems: "flex-end", gap: 8 }}>
              <span className="type-title-section" style={{ color: "var(--fx-text-primary)" }}>
                {ctx.percent !== null ? formatUsagePercent(ctx.percent) : "?"}
              </span>
              <span className="type-mono-label" style={{ color: "var(--fx-text-secondary)", whiteSpace: "nowrap" }}>
                {`${ctx.tokens !== null ? formatUsedTokens(ctx.tokens) : "?"} / ${formatTokenCount(ctx.contextWindow)}`}
              </span>
            </div>
          )}
        </div>
        {modelId && (
          <span
            className="type-mono-meta"
            title={modelId}
            style={{
              color: "var(--fx-text-tertiary)",
              minWidth: 0,
              maxWidth: 180,
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
            }}
          >
            {modelId}
          </span>
        )}
      </div>
      {pending && (
        <div className="type-label-default" style={{ color: "var(--fx-text-tertiary)" }}>
          {t(
            "contextUsagePendingHint",
            "Context usage updates after the next model response (e.g. right after compaction)",
          )}
        </div>
      )}
    </div>
  );
}

export function SessionInfoPopover({
  sessionStats,
  copyFeedback,
  onCopyField,
}: {
  sessionStats: SessionStatsInfo;
  copyFeedback: SessionCopyFeedback | null;
  onCopyField: (field: SessionCopyField, value: string) => void;
}) {
  const { language, t } = useI18n();

  return (
    <>
      <BillingSection sessionStats={sessionStats} />
      <IdentitySection
        name={sessionStats.sessionName}
        file={sessionStats.sessionFile}
        id={sessionStats.sessionId}
        copyFeedback={copyFeedback}
        onCopyField={onCopyField}
      />
      <div style={FOOTER}>
        <span className="type-mono-meta" style={{ flex: "1 1 0", minWidth: 0, color: "var(--fx-text-tertiary)" }}>
          {t("usageMessageSummary", "{messages} messages · {toolCalls} tool calls")
            .replace("{messages}", formatNumber(sessionStats.totalMessages, language))
            .replace("{toolCalls}", formatNumber(sessionStats.toolCalls, language))}
        </span>
      </div>
    </>
  );
}

function BillingSection({ sessionStats }: { sessionStats: SessionStatsInfo }) {
  const { t } = useI18n();

  const rows = [
    { key: "input", label: t("usageInput", "Input"), value: sessionStats.tokens.input, swatch: "var(--fx-text-body)" },
    {
      key: "output",
      label: t("usageOutput", "Output"),
      value: sessionStats.tokens.output,
      swatch: "var(--fx-text-secondary)",
    },
    {
      key: "cacheRead",
      label: t("cacheRead", "Cache read"),
      value: sessionStats.tokens.cacheRead,
      swatch: "var(--fx-text-tertiary)",
    },
    {
      key: "cacheWrite",
      label: t("cacheWrite", "Cache write"),
      value: sessionStats.tokens.cacheWrite,
      swatch: "var(--fx-text-faint)",
    },
  ];

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
      <div style={{ display: "flex", flexDirection: "column", gap: 6, paddingTop: 2 }}>
        {rows.map((row) => (
          <div key={row.key} style={ROW}>
            <span aria-hidden="true" style={{ ...SWATCH, background: row.swatch }} />
            <span className="type-body-default" style={ROW_LABEL}>
              {row.label}
            </span>
            <span className="type-mono-label" style={{ ...ROW_VALUE, whiteSpace: "nowrap" }}>
              {formatUsedTokens(row.value)}
            </span>
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
