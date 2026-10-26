import { useI18n } from "@/i18n";
import { useMemo, type CSSProperties } from "react";
import { Icon } from "../chat-input/icons";
import { Button } from "../form-controls";
import { formatTokenCount } from "../chat-input/SessionControls";
import { allocateGridCells, formatUsagePercent, formatUsageShare, formatUsedTokens } from "./usage-format";
import type { ContextUsageBreakdown } from "@contract/types";
import type { ContextUsageState, UsageCompaction } from "./use-session-info";

const GRID_CELLS = 100;
const FREE_COLOR = "var(--fx-surface-selected)";

export const ROW: CSSProperties = { display: "flex", alignItems: "center", gap: 10 };
export const SWATCH: CSSProperties = { width: 8, height: 8, flexShrink: 0, borderRadius: "var(--radius-bar)" };
const ROW_LABEL: CSSProperties = { flex: "1 1 0", minWidth: 0, color: "var(--fx-text-secondary)" };
const ROW_TOKENS: CSSProperties = {
  width: 52,
  flexShrink: 0,
  textAlign: "right",
  color: "var(--fx-text-primary)",
  whiteSpace: "nowrap",
};
const ROW_SHARE: CSSProperties = {
  width: 44,
  flexShrink: 0,
  textAlign: "right",
  color: "var(--fx-text-tertiary)",
  whiteSpace: "nowrap",
};
const COMPACTION_BAR: CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 10,
  padding: "8px 8px 8px 12px",
  background: "var(--fx-surface-inset)",
  border: "1px solid var(--fx-line-default)",
  borderRadius: "var(--radius-card)",
};

const FOLD_VERTICAL_PATHS = [
  "M12 22v-6",
  "M12 8V2",
  "M4 12H2",
  "M10 12H8",
  "M16 12h-2",
  "M22 12h-2",
  "m15 19-3-3-3 3",
  "m15 5-3 3-3-3",
];

interface LegendRow {
  key: string;
  label: string;
  tokens: number;
  share: string;
  color?: string;
  dashed?: boolean;
  separated?: boolean;
}

interface GridCell {
  background: string;
  dashed: boolean;
}

export function ContextSection({
  ctx,
  modelId,
  compaction,
}: {
  ctx: ContextUsageState | null;
  modelId: string | null;
  compaction: UsageCompaction | null;
}) {
  const { t } = useI18n();
  const windowKnown = ctx !== null && ctx.contextWindow > 0;
  const contextWindow = ctx?.contextWindow ?? 0;
  const usedTokens = ctx?.tokens ?? null;
  const reserveTokens = ctx?.reserveTokens;
  const breakdown = ctx?.breakdown ?? null;
  const percent = ctx?.percent ?? null;
  const pending = ctx === null || ctx.percent === null;
  const showsSplit = windowKnown && usedTokens !== null;

  const rows = useMemo<LegendRow[]>(() => {
    if (usedTokens === null || !(contextWindow > 0)) return [];
    const free = Math.max(0, contextWindow - usedTokens - (reserveTokens ?? 0));
    const share = (tokens: number) => formatUsageShare(tokens, contextWindow);
    const categories: Array<[keyof ContextUsageBreakdown, string, string]> = [
      ["systemPrompt", t("usageSystemPrompt", "System prompt"), "var(--fx-text-secondary)"],
      ["tools", t("usageTools", "Tool definitions"), "var(--fx-data-blue)"],
      ["agentsAndSkills", t("usageAgentsSkills", "AGENTS.md and skills"), "var(--fx-data-violet)"],
      ["conversation", t("usageConversation", "Conversation"), "var(--fx-data-green)"],
      ["toolResults", t("usageToolResults", "Tool results"), "var(--fx-data-pink)"],
    ];
    const parts: LegendRow[] = breakdown
      ? categories.map(([key, label, color]) => ({
          key,
          label,
          tokens: breakdown[key],
          share: share(breakdown[key]),
          color,
        }))
      : [
          {
            key: "used",
            label: t("usageUsed", "Used"),
            tokens: usedTokens,
            share: percent !== null ? formatUsagePercent(percent) : share(usedTokens),
            color: "var(--fx-text-tertiary)",
          },
        ];
    const legend = [
      ...parts,
      {
        key: "free",
        label: t("usageFree", "Free space"),
        tokens: free,
        share: share(free),
        color: FREE_COLOR,
        separated: true,
      },
    ];
    if (reserveTokens !== undefined)
      legend.push({
        key: "reserve",
        label: t("usageReserve", "Compaction reserve"),
        tokens: reserveTokens,
        share: share(reserveTokens),
        dashed: true,
      });
    return legend;
  }, [breakdown, contextWindow, percent, reserveTokens, t, usedTokens]);

  const cells = useMemo<GridCell[]>(() => {
    if (rows.length === 0) return [];
    const counts = allocateGridCells(
      rows.map((row) => row.tokens),
      contextWindow,
      GRID_CELLS,
    );
    const painted: GridCell[] = [];
    counts.forEach((count, index) => {
      const row = rows[index];
      for (let cell = 0; cell < count; cell += 1)
        painted.push({
          background: row.dashed ? "transparent" : (row.color ?? FREE_COLOR),
          dashed: row.dashed === true,
        });
    });
    while (painted.length < GRID_CELLS) painted.push({ background: FREE_COLOR, dashed: false });
    return painted.slice(0, GRID_CELLS);
  }, [contextWindow, rows]);

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
                {`${usedTokens !== null ? formatUsedTokens(usedTokens) : "?"} / ${formatTokenCount(contextWindow)}`}
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
      {showsSplit && (
        <>
          <div
            aria-hidden="true"
            style={{
              display: "grid",
              gridTemplateColumns: `repeat(20, minmax(4px, 1fr))`,
              gridAutoRows: 14,
              gap: 4,
            }}
          >
            {cells.map((cell, index) => (
              <span
                key={index}
                style={{
                  boxSizing: "border-box",
                  borderRadius: "var(--radius-skeleton)",
                  background: cell.background,
                  border: cell.dashed ? "1px dashed var(--fx-line-heavy)" : undefined,
                }}
              />
            ))}
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 7 }}>
            {rows.map((row) => (
              <div
                key={row.key}
                style={row.separated ? { ...ROW, borderTop: "1px solid var(--fx-line-default)", paddingTop: 7 } : ROW}
              >
                <span
                  aria-hidden="true"
                  style={{
                    ...SWATCH,
                    boxSizing: "border-box",
                    background: row.dashed ? "transparent" : row.color,
                    border: row.dashed ? "1px dashed var(--fx-line-heavy)" : undefined,
                  }}
                />
                <span className="type-body-default" style={ROW_LABEL}>
                  {row.label}
                </span>
                <span className="type-mono-label" style={ROW_TOKENS}>
                  {formatUsedTokens(row.tokens)}
                </span>
                <span className="type-mono-label" style={ROW_SHARE}>
                  {row.share}
                </span>
              </div>
            ))}
          </div>
        </>
      )}
      {compaction && (
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          <div style={COMPACTION_BAR}>
            <span className="flex" style={{ color: "var(--fx-text-secondary)" }}>
              <Icon size={14} strokeWidth={1.75}>
                {FOLD_VERTICAL_PATHS.map((path) => (
                  <path key={path} d={path} />
                ))}
              </Icon>
            </span>
            <span
              className="type-label-default"
              style={{ flex: "1 1 0", minWidth: 0, color: "var(--fx-text-secondary)" }}
            >
              {compaction.isCompacting
                ? t("compacting", "Compacting…")
                : reserveTokens !== undefined && usedTokens !== null
                  ? t("usageCompactIn", "Auto-compacts after about {tokens} more").replace(
                      "{tokens}",
                      formatUsedTokens(Math.max(0, contextWindow - usedTokens - reserveTokens)),
                    )
                  : t("compact", "Compact context")}
            </span>
            <Button
              variant="ghost"
              onClick={compaction.isCompacting ? compaction.abort : compaction.compact}
              disabled={compaction.isCompacting ? false : compaction.disabled}
            >
              {compaction.isCompacting ? t("stopCompaction", "Stop compaction") : t("usageCompactNow", "Compact now")}
            </Button>
          </div>
          {compaction.error && (
            <span role="alert" className="type-label-default" style={{ color: "var(--fx-status-danger-text)" }}>
              {compaction.error}
            </span>
          )}
        </div>
      )}
    </div>
  );
}
