import { useI18n } from "@/i18n";
import { formatCompactNumber } from "@/lib/locale-format";
import { SessionIdentity } from "./session-identity";
import type { SessionCopyField } from "./use-session-info";
import type { ContextUsageState } from "./use-session-info";
import type { SessionCopyFeedback } from "./use-session-info";
import type { SessionStatsInfo } from "@/lib/pi-types";

// Split from AppShell.tsx in Phase 2: the top-bar session info popover. Pure
// rendering of the stats the session-info hook owns; copy actions delegate back
// through the hook's handler.

export function SessionInfoPopover({
  sessionStats,
  contextUsage,
  copyFeedback,
  onCopyField,
  isMobile,
}: {
  sessionStats: SessionStatsInfo;
  contextUsage: ContextUsageState | null;
  copyFeedback: SessionCopyFeedback | null;
  onCopyField: (field: SessionCopyField, value: string) => void;
  isMobile: boolean;
}) {
  const { language, t } = useI18n();

  const messageRows = [
    [t("user", "User"), sessionStats.userMessages.toLocaleString(language)],
    [t("assistant", "Assistant"), sessionStats.assistantMessages.toLocaleString(language)],
    [t("toolCalls", "Tool Calls"), sessionStats.toolCalls.toLocaleString(language)],
    [t("toolResults", "Tool Results"), sessionStats.toolResults.toLocaleString(language)],
    [t("total", "Total"), sessionStats.totalMessages.toLocaleString(language)],
  ];
  const tokenRows = [
    [t("usageInput", "Input"), sessionStats.tokens.input.toLocaleString(language)],
    [t("usageOutput", "Output"), sessionStats.tokens.output.toLocaleString(language)],
    ...(sessionStats.tokens.cacheRead > 0
      ? [[t("cacheRead", "Cache read"), sessionStats.tokens.cacheRead.toLocaleString(language)]]
      : []),
    ...(sessionStats.tokens.cacheWrite > 0
      ? [[t("cacheWrite", "Cache write"), sessionStats.tokens.cacheWrite.toLocaleString(language)]]
      : []),
    [t("total", "Total"), sessionStats.tokens.total.toLocaleString(language)],
  ];
  const ctx = contextUsage ?? sessionStats.contextUsage;
  const extraTokenRows = [
    ...(sessionStats.cost > 0 ? [[t("usageCost", "Cost"), `$${sessionStats.cost.toFixed(4)}`]] : []),
    ...(ctx?.contextWindow
      ? [
          [
            t("usageContext", "Context"),
            `${ctx.percent !== null ? `${ctx.percent.toFixed(1)}%` : "?"} / ${formatCompactNumber(ctx.contextWindow, language)}`,
          ],
        ]
      : []),
  ];
  const section = (title: string, sectionRows: string[][], valueAlign: "left" | "right" = "left", compact = false) => (
    <div style={{ minWidth: 0 }}>
      <div
        style={{
          fontSize: "var(--text-label)",
          fontWeight: 700,
          color: "var(--fx-text-primary)",
          marginBottom: 8,
        }}
      >
        {title}
      </div>
      <div
        style={{
          display: "grid",
          gridTemplateColumns: compact ? "max-content max-content" : "auto minmax(0, 1fr)",
          columnGap: compact ? 14 : 12,
          rowGap: 4,
          justifyContent: compact ? "start" : undefined,
        }}
      >
        {sectionRows.map(([label, value]) => (
          <div key={`${title}:${label}`} style={{ display: "contents" }}>
            <div style={{ color: "var(--fx-text-tertiary)", whiteSpace: "nowrap" }}>{label}</div>
            <div
              style={{
                color: "var(--fx-text-secondary)",
                minWidth: 0,
                overflowWrap: compact ? "normal" : "anywhere",
                textAlign: valueAlign,
                whiteSpace: valueAlign === "right" ? "nowrap" : "normal",
              }}
            >
              {value}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
  const sessionInfoSection = (
    <SessionIdentity
      sessionName={sessionStats.sessionName}
      sessionFile={sessionStats.sessionFile}
      sessionId={sessionStats.sessionId}
      copyFeedback={copyFeedback}
      onCopyField={onCopyField}
    />
  );

  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: isMobile ? "1fr" : "minmax(360px, 1.7fr) minmax(140px, 0.55fr) minmax(190px, 0.75fr)",
        gap: isMobile ? 16 : 24,
        fontSize: "var(--text-label)",
        lineHeight: 1.5,
        fontFamily: "var(--font-mono)",
      }}
    >
      {sessionInfoSection}
      {section(t("messages", "Messages"), messageRows)}
      {section(t("tokenStatistics", "Tokens"), [...tokenRows, ...extraTokenRows], "right", true)}
    </div>
  );
}
