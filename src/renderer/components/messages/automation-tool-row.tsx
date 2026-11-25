import { useI18n } from "@/i18n";
import { useExpansion, type ThinkingExpansionStore } from "@/lib/thinking-expansion-store";
import type { ToolCallContent, ToolResultMessage } from "@/lib/types";
import { readAutomationToolDetails } from "@shared/automation/chat-tools";
import { DeferredContentActions, useDelayedUnmount } from "./shared";
import { formatToolDuration, useElapsedSince } from "./tool-elapsed";

function automationToolVerb(toolName: string, t: (key: string, fallback: string) => string): string {
  switch (toolName) {
    case "automation_inspect":
      return t("automationToolInspect", "Inspect automation");
    case "automation_guide":
      return t("automationToolGuide", "Automation guide");
    case "automation_validate":
      return t("automationToolValidate", "Validate automation");
    case "automation_save_draft":
      return t("automationToolSaveDraft", "Save draft");
    case "automation_stop":
      return t("automationToolStop", "Stop automation");
    case "automation_request_user_action":
      return t("automationToolRequestAction", "Request confirmation");
    default:
      return toolName;
  }
}

function AutomationGlyph() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.75"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7v5l3 2" />
    </svg>
  );
}

function textOf(result: ToolResultMessage): string {
  return result.content
    .filter((part): part is { type: "text"; text: string } => part.type === "text")
    .map((part) => part.text)
    .join("\n");
}

function previewChip(block: ToolCallContent, result?: ToolResultMessage): string {
  const details = readAutomationToolDetails(result?.details);
  if (details?.targetTaskName) return details.targetTaskName;
  if (details?.targetTaskId) return details.targetTaskId;
  if (details?.targetRunId) return details.targetRunId;
  if (details?.summary) return details.summary;
  const input = block.input;
  if (input && typeof input === "object") {
    if (typeof input.taskId === "string" && input.taskId) return input.taskId;
    if (typeof input.action === "string" && input.action) return input.action;
    if (typeof input.view === "string" && input.view) return input.view;
  }
  return "";
}

export function AutomationToolRow({
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
  const chip = previewChip(block, result);
  const elapsed = useElapsedSince(isRunning ? startedAt : undefined);
  const metaDuration = isRunning ? elapsed : duration;
  const inputStr = JSON.stringify(block.input, null, 2);

  return (
    <div className="chat-acc" data-open={expanded ? "true" : "false"}>
      <div className="chat-tool-row-wrap">
        <button
          type="button"
          className={`chat-tool-row chat-quiet-head${isRunning ? " is-running" : ""}${isError ? " is-error" : ""}`}
          aria-expanded={expanded}
          onClick={() => toggle(expanded)}
        >
          <span className={`chat-tool-icon${isError ? " is-error" : ""}`} aria-hidden="true">
            {isRunning ? <span className="chat-tool-spinner" /> : <AutomationGlyph />}
          </span>
          <span className="chat-tool-name type-body-medium">{automationToolVerb(block.toolName, t)}</span>
          {chip && (
            <span className="chat-tool-chip type-mono-label">
              <span className="chat-tool-chip-text">{chip}</span>
            </span>
          )}
          <span className="chat-tool-meta type-mono-label">
            {isRunning && (
              <span className={elapsed === undefined ? "chat-tool-meta-running" : "sr-only"}>
                {t("toolRunning", "running")}
              </span>
            )}
            {isError && (
              <span className={metaDuration === undefined ? "chat-tool-meta-failed" : "sr-only"}>
                {t("toolFailed", "failed")}
              </span>
            )}
            {metaDuration !== undefined && (
              <span className={isRunning ? "chat-tool-meta-running" : isError ? "chat-tool-meta-failed" : undefined}>
                {formatToolDuration(metaDuration)}
              </span>
            )}
          </span>
        </button>
      </div>
      <div className="chat-acc-panel">
        <div className="chat-acc-panel-clip">
          {detailMounted && (
            <div className="chat-tool-detail type-mono-code">
              <pre className="chat-tool-input">{inputStr}</pre>
              {result && <pre className={`chat-tool-result${isError ? " is-error" : ""}`}>{resultText ?? ""}</pre>}
            </div>
          )}
        </div>
      </div>
      {result && <DeferredContentActions content={result.content} onLoad={onLoadDeferredContent} />}
    </div>
  );
}
