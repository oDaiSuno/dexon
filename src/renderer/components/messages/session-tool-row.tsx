import { useState } from "react";
import { useI18n } from "@/i18n";
import { useSessionActivity } from "@/lib/session-catalog";
import { readSessionToolTarget } from "@shared/session-orchestration";
import { SessionTargetLink, type SessionCardTarget } from "./session-links";
import { DeferredContentActions, useDelayedUnmount } from "./shared";
import { formatToolDuration, useElapsedSince } from "./tool-elapsed";
import {
  reportedSessionStatus,
  resolveSessionOutcome,
  SessionToolGlyph,
  sessionOutcomeLabel,
  sessionOutcomeTone,
  sessionToolVerb,
} from "./session-tool-labels";
import type { ToolCallContent, ToolResultMessage } from "@/lib/types";

export function SessionToolRow({
  block,
  result,
  duration,
  startedAt,
  onLoadDeferredContent,
}: {
  block: ToolCallContent;
  result?: ToolResultMessage;
  duration?: number;
  startedAt?: number;
  onLoadDeferredContent?: (entryId: string, blockIndex?: number) => Promise<void>;
}) {
  const [expanded, setExpanded] = useState(false);
  const { t } = useI18n();
  const detailMounted = useDelayedUnmount(expanded);
  const isRunning = !result;
  const isError = result?.isError ?? false;
  const resultText = result ? textOf(result) : null;
  const target = sessionCardTarget(block, result, isError);
  const activity = useSessionActivity(target?.sessionId ?? null);
  const outcome = resolveSessionOutcome({
    toolName: block.toolName,
    isRunning,
    isError,
    activity,
    reported: reportedSessionStatus(resultText),
  });
  const elapsed = useElapsedSince(isRunning ? startedAt : undefined);
  const meta = isRunning ? elapsed : duration;
  const failure = isError ? (resultText ?? "").trim() : "";

  return (
    <div className="chat-acc" data-open={expanded ? "true" : "false"}>
      <div className={`chat-session-tool is-${outcome}`} data-tone={sessionOutcomeTone(outcome)}>
        <button
          type="button"
          className="chat-session-tool-toggle"
          aria-expanded={expanded}
          onClick={() => setExpanded((open) => !open)}
        >
          <span className={`chat-tool-icon${isError ? " is-error" : ""}`} aria-hidden="true">
            {isRunning ? <span className="chat-tool-spinner" /> : <SessionToolGlyph toolName={block.toolName} />}
          </span>
          <span className="chat-session-tool-verb type-body-medium">{sessionToolVerb(block.toolName, t)}</span>
        </button>
        {target && <SessionTargetLink target={target} />}
        <span className="chat-session-tool-detail type-label-default" title={failure || undefined}>
          {firstLine(failure)}
        </span>
        <span className="chat-session-tool-outcome">
          <span className="chat-session-tool-dot" aria-hidden="true" />
          <span className="chat-session-tool-outcome-text type-label-medium">{sessionOutcomeLabel(outcome, t)}</span>
        </span>
        {meta !== undefined && (
          <span className="chat-session-tool-meta type-mono-label">{formatToolDuration(meta)}</span>
        )}
      </div>
      <div className="chat-acc-panel">
        <div className="chat-acc-panel-clip">
          {detailMounted && (
            <SessionBrief
              brief={handsOffTask(block.toolName) ? stringInput(block, "message") : ""}
              failure={failure}
              raw={handsOffTask(block.toolName) ? "" : (resultText ?? "")}
            />
          )}
        </div>
      </div>
      {result && <DeferredContentActions content={result.content} onLoad={onLoadDeferredContent} />}
    </div>
  );
}

function SessionBrief({ brief, failure, raw }: { brief: string; failure: string; raw: string }) {
  const { t } = useI18n();
  if (!brief && !failure && !raw) return null;
  return (
    <div className="chat-session-brief">
      <div className="chat-session-brief-box">
        {brief && (
          <>
            <span className="chat-session-brief-label type-label-medium">
              {t("sessionBriefLabel", "Task handed to it")}
            </span>
            <p className="chat-session-brief-body type-body-relaxed">{brief}</p>
          </>
        )}
        {failure && <p className="chat-session-brief-error type-body-relaxed">{failure}</p>}
        {!failure && raw && <pre className="chat-session-brief-raw type-mono-code">{raw}</pre>}
      </div>
    </div>
  );
}

function handsOffTask(toolName: string): boolean {
  return toolName === "session_new" || toolName === "session_prompt";
}

function textOf(result: ToolResultMessage): string {
  return result.content
    .filter((part): part is { type: "text"; text: string } => part.type === "text")
    .map((part) => part.text)
    .join("\n");
}

function stringInput(block: ToolCallContent, key: string): string {
  const value = block.input?.[key];
  return typeof value === "string" ? value.trim() : "";
}

function firstLine(text: string): string {
  const end = text.indexOf("\n");
  return end < 0 ? text : text.slice(0, end);
}

function sessionCardTarget(
  block: ToolCallContent,
  result: ToolResultMessage | undefined,
  isError: boolean,
): SessionCardTarget | null {
  const reported = readSessionToolTarget(result?.details);
  if (reported) return { sessionId: reported.targetSessionId, title: reported.targetTitle };
  const sessionId = stringInput(block, "sessionId");
  if (sessionId) return { sessionId };
  const title = block.toolName === "session_new" && !isError ? stringInput(block, "name") : "";
  return title ? { title } : null;
}
