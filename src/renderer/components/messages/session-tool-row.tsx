import { useI18n } from "@/i18n";
import { useSessionActivity } from "@/lib/session-catalog";
import { useExpansion, type ThinkingExpansionStore } from "@/lib/thinking-expansion-store";
import { readSessionToolTarget, readSessionUnavailableModel } from "@shared/session-orchestration";
import { SessionTargetLink, type SessionCardTarget } from "./session-links";
import { DeferredContentActions, useDelayedUnmount } from "./shared";
import { sessionLaunchMeta, sessionToolDetail } from "./session-tool-detail";
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
  stateKey,
  expansionStore,
  onLoadDeferredContent,
}: {
  block: ToolCallContent;
  result?: ToolResultMessage;
  duration?: number;
  startedAt?: number;
  stateKey: string;
  expansionStore?: ThinkingExpansionStore;
  onLoadDeferredContent?: (entryId: string, blockIndex?: number) => Promise<void>;
}) {
  const [remembered, toggle] = useExpansion(expansionStore, stateKey);
  const expanded = remembered ?? false;
  const { t } = useI18n();
  const detailMounted = useDelayedUnmount(expanded);
  const isRunning = !result;
  const isError = result?.isError ?? false;
  const resultText = result ? textOf(result) : null;
  const target = sessionCardTarget(block, result);
  const activity = useSessionActivity(target?.sessionId ?? null);
  const unavailableModel = readSessionUnavailableModel(result?.details);
  const outcome = resolveSessionOutcome({
    toolName: block.toolName,
    isRunning,
    isError,
    activity,
    reported: reportedSessionStatus(resultText),
    failed: unavailableModel !== null,
  });
  const elapsed = useElapsedSince(isRunning ? startedAt : undefined);
  const meta = isRunning ? elapsed : duration;
  const failure = isError ? (resultText ?? "").trim() : "";
  const detail = failure
    ? firstLine(failure)
    : unavailableModel
      ? unavailableDetail(unavailableModel.modelId, t)
      : sessionToolDetail(block, resultText, t, result?.details);
  const launchMeta = block.toolName === "session_new" ? sessionLaunchMeta(block, result?.details, t) : "";

  return (
    <div className="chat-acc" data-open={expanded ? "true" : "false"}>
      <div className={`chat-session-tool is-${outcome}`} data-tone={sessionOutcomeTone(outcome)}>
        <button
          type="button"
          className="chat-session-tool-toggle"
          aria-expanded={expanded}
          onClick={() => toggle(expanded)}
        >
          <span className={`chat-tool-icon${isError ? " is-error" : ""}`} aria-hidden="true">
            {isRunning ? <span className="chat-tool-spinner" /> : <SessionToolGlyph toolName={block.toolName} />}
          </span>
          <span className="chat-session-tool-verb type-body-medium">{sessionToolVerb(block.toolName, t)}</span>
        </button>
        {target && <SessionTargetLink target={target} />}
        <span className="chat-session-tool-detail type-label-default" title={failure || detail || undefined}>
          {detail}
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
              meta={launchMeta}
              raw={handsOffTask(block.toolName) ? "" : (resultText ?? "")}
            />
          )}
        </div>
      </div>
      {result && <DeferredContentActions content={result.content} onLoad={onLoadDeferredContent} />}
    </div>
  );
}

function SessionBrief({ brief, failure, raw, meta }: { brief: string; failure: string; raw: string; meta: string }) {
  const { t } = useI18n();
  if (!brief && !failure && !raw) return null;
  return (
    <div className="chat-session-brief">
      <div className="chat-session-brief-box">
        {brief && (
          <>
            <div className="chat-session-brief-header">
              <span className="chat-session-brief-label type-label-medium">
                {t("sessionBriefLabel", "Task handed to it")}
              </span>
              {meta && (
                <span className="chat-session-brief-meta type-mono-meta" title={meta}>
                  {meta}
                </span>
              )}
            </div>
            <p className="chat-session-brief-body type-body-relaxed">{brief}</p>
          </>
        )}
        {failure && <p className="chat-session-brief-error type-body-relaxed">{failure}</p>}
        {!failure && raw && <pre className="chat-session-brief-raw type-mono-code">{raw}</pre>}
      </div>
    </div>
  );
}

function unavailableDetail(modelId: string, t: (key: string, fallback: string) => string): string {
  return t("sessionModelUnavailable", "Model {model} is unavailable").replace("{model}", modelId);
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

function sessionCardTarget(block: ToolCallContent, result: ToolResultMessage | undefined): SessionCardTarget | null {
  const reported = readSessionToolTarget(result?.details);
  if (reported) return { sessionId: reported.targetSessionId, title: reported.targetTitle };
  const sessionId = stringInput(block, "sessionId");
  if (sessionId) return { sessionId };
  const title = block.toolName === "session_new" ? stringInput(block, "name") : "";
  return title ? { title } : null;
}
