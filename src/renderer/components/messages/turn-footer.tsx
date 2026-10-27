import { useI18n } from "@/i18n";
import type { AssistantUsage, TurnFooter } from "../chat-window/turn-layout";
import { ForkSessionGlyph } from "../session-sidebar/session-relation-glyphs";
import { MessageActionButton, MessageCopyButton } from "./message-action-button";
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
  const { t } = useI18n();
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
        <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 8 }}>
          {copyText && <MessageCopyButton text={copyText} className="message-hover-action" revealed={hovered} />}
          {copyText && onFork && footer.forkEntryId && (
            <MessageActionButton
              className="message-hover-action"
              label={
                forking ? t("creatingNewSession", "Creating new session…") : t("branchFromHere", "Branch from here")
              }
              disabled={forking}
              busy={forking}
              revealed={hovered || forking}
              onClick={() => {
                if (footer.forkEntryId) onFork?.(footer.forkEntryId);
              }}
            >
              <ForkSessionGlyph size={14} />
            </MessageActionButton>
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
