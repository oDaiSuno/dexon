import { useCopyFeedback } from "@/hooks/useCopyFeedback";
import type { AssistantUsage, TurnFooter } from "../chat-window/turn-layout";
import { NewSessionAction } from "./new-session-action";
import { formatTime } from "./shared";

export function TurnFooterView({
  footer,
  hovered,
  modelNames,
  onFork,
  forking,
}: {
  footer: TurnFooter;
  hovered: boolean;
  modelNames?: Record<string, string>;
  onFork?: (entryId: string) => void;
  forking?: boolean;
}) {
  const { copied, copy } = useCopyFeedback();
  const time = formatTime(footer.timestamp);
  const copyText = footer.copyText;
  const modelLabel = footer.provider && footer.model ? modelName(footer.provider, footer.model, modelNames) : undefined;

  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 4,
        marginTop: 6,
      }}
    >
      {footer.usage && (
        <div
          style={{
            fontSize: 11,
            color: "var(--fx-text-tertiary)",
            fontFamily: "var(--font-mono)",
            fontVariantNumeric: "tabular-nums",
            marginRight: 2,
          }}
        >
          {modelLabel && <span style={{ marginRight: 8 }}>{modelLabel}</span>}
          {formatUsage(footer.usage)}
        </div>
      )}
      {(copyText || time) && (
        <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 4 }}>
          {copyText && (
            <button
              type="button"
              className="message-hover-action"
              onClick={() => void copy(copyText)}
              title="Copy message"
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                width: 24,
                height: 24,
                background: "none",
                border: "none",
                borderRadius: "var(--radius-chip)",
                color: copied ? "var(--fx-status-success-text)" : "var(--fx-text-tertiary)",
                cursor: "pointer",
                opacity: hovered ? 1 : 0,
                pointerEvents: hovered ? "auto" : "none",
                transition:
                  "opacity var(--duration-quick) var(--ease-out), color var(--duration-quick) var(--ease-out)",
              }}
              onMouseEnter={(e) => {
                if (!copied) e.currentTarget.style.color = "var(--fx-text-secondary)";
              }}
              onMouseLeave={(e) => {
                if (!copied) e.currentTarget.style.color = "var(--fx-text-tertiary)";
              }}
            >
              {copied ? (
                <svg
                  width="13"
                  height="13"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="3"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <path d="M20 6L9 17l-5-5" />
                </svg>
              ) : (
                <svg
                  width="15"
                  height="15"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.8"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <rect x="9" y="9" width="12" height="12" rx="2.5" />
                  <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
                </svg>
              )}
            </button>
          )}
          {copyText && onFork && footer.forkEntryId && (
            <NewSessionAction entryId={footer.forkEntryId} onFork={onFork} forking={forking} hovered={hovered} />
          )}
          {time && (
            <span
              style={{
                fontSize: 11,
                color: "var(--fx-text-tertiary)",
                fontFamily: "var(--font-mono)",
              }}
            >
              {time}
            </span>
          )}
        </div>
      )}
    </div>
  );
}

function modelName(provider: string, model: string, modelNames: Record<string, string> | undefined): string {
  return modelNames?.[`${provider}:${model}`] ?? modelNames?.[model] ?? model;
}

function formatUsage(usage: AssistantUsage): string {
  const parts = [];
  if (usage.input) parts.push(`${usage.input.toLocaleString()} in`);
  if (usage.output) parts.push(`${usage.output.toLocaleString()} out`);
  if (usage.cacheRead) parts.push(`${usage.cacheRead.toLocaleString()} cache`);
  if (usage.cost?.total) parts.push(`$${usage.cost.total.toFixed(4)}`);
  return parts.join(" · ");
}
