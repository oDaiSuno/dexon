import { memo, useId } from "react";
import { Ban, Check, ChevronRight, CodeXml, LoaderCircle, X } from "lucide-react";
import type { EnvironmentId } from "@contract/environment";
import { useI18n } from "@/i18n";
import { SyntaxHighlighter } from "@/lib/syntax-highlight";
import { useExpansion, type ThinkingExpansionStore } from "@/lib/thinking-expansion-store";
import type { ToolCallBlockProps } from "./ToolCallBlock";
import type { codemodeToolDetail } from "./codemode-tool-detail";
import { CodemodeCopyButton, CodemodeOutput } from "./codemode-output";
import { useDelayedUnmount } from "./shared";
import { formatToolDuration } from "./tool-elapsed";

type Presentation = ReturnType<typeof codemodeToolDetail>;

export const CodemodeWorkbench = memo(function CodemodeWorkbench({
  detail,
  stateKey,
  expansionStore,
  environmentId,
  onOpenFile,
}: {
  detail: Presentation;
  stateKey: string;
  expansionStore?: ThinkingExpansionStore;
  environmentId?: EnvironmentId;
  onOpenFile?: ToolCallBlockProps["onOpenFile"];
}) {
  const { t, language } = useI18n();
  const running = detail.lifecycle === "starting" || detail.lifecycle === "running";
  const outcome = t("codemodeStepsOutcome", "{ok} succeeded · {error} failed · {cancelled} cancelled")
    .replace("{ok}", String(detail.counts.ok))
    .replace("{error}", String(detail.counts.error))
    .replace("{cancelled}", String(detail.counts.cancelled));
  const cost = detail.totalCost > 0 ? formatCost(detail.totalCost, language) : "";
  const error = detail.lifecycle === "error" && Boolean(detail.errorTitle || detail.errorDetail);
  const stepsTitle = running
    ? t("codemodeStepsRunning", "Execution steps · Running")
    : `${t("codemodeSteps", "Execution steps")} · ${detail.counts.error || detail.counts.cancelled ? outcome : detail.steps.length}`;
  const errorAfter = detail.steps.findIndex((step) => step.call.id === detail.errorStepId);
  const callout = error ? (
    <div className="chat-codemode-error-wrap">
      <div className="chat-codemode-error" role="status">
        <div className="min-w-0 flex flex-col gap-[var(--space-0-5)]">
          {detail.errorTitle && <p className="type-label-medium m-0">{detail.errorTitle}</p>}
          {detail.errorDetail && (
            <pre className="type-mono-meta m-0 max-h-[180px] overflow-auto whitespace-pre-wrap break-words">
              {detail.errorDetail}
            </pre>
          )}
        </div>
      </div>
    </div>
  ) : null;

  return (
    <div className="chat-codemode-workbench">
      <section aria-label={t("codemodeSteps", "Execution steps")}>
        <header className="chat-codemode-header">
          <h3 className="chat-codemode-secondary type-label-medium m-0 min-w-0 flex-1">{stepsTitle}</h3>
          {cost ? (
            <span className="chat-codemode-secondary type-mono-meta shrink-0">
              {t("codemodeModelCost", "Includes model calls {cost}").replace("{cost}", cost)}
            </span>
          ) : running ? (
            <span className="chat-codemode-secondary type-meta-default">
              {t("codemodeStopHint", "Click the stop button below to stop at any time.")}
            </span>
          ) : null}
        </header>
        <ol className="chat-codemode-step-list m-0 list-none p-0">
          {detail.steps.map((step, index) => (
            <li key={`${step.call.id}:${index}`}>
              <CodemodeStep step={step} environmentId={environmentId} onOpenFile={onOpenFile} />
              {errorAfter === index && callout}
            </li>
          ))}
        </ol>
        {errorAfter < 0 && callout}
      </section>
      <CodemodeOutput detail={detail} environmentId={environmentId} onOpenFile={onOpenFile} />
      <CodemodeSource
        code={detail.code}
        lineCount={detail.lineCount}
        stateKey={stateKey}
        expansionStore={expansionStore}
      />
    </div>
  );
});

function CodemodeStep({
  step,
  environmentId,
  onOpenFile,
}: {
  step: Presentation["steps"][number];
  environmentId?: EnvironmentId;
  onOpenFile?: ToolCallBlockProps["onOpenFile"];
}) {
  const { t, language } = useI18n();
  const status = step.call.status;
  const label =
    status === "error"
      ? t("codemodeFailed", "Failed")
      : status === "cancelled"
        ? t("codemodeCancelled", "Cancelled")
        : status === "running"
          ? t("toolRunning", "running")
          : t("codemodeDoneSummary", "{count} steps").replace("{count}", "1");
  const actionable = Boolean((step.filePath && onOpenFile && environmentId) || step.tabId);
  const target = actionable ? (
    <button
      type="button"
      className="chat-codemode-target is-link type-mono-label p-0 text-left hover:underline"
      title={step.filePath ?? step.target}
      onClick={() => {
        if (step.filePath && onOpenFile && environmentId) onOpenFile(step.filePath, environmentId);
        else if (step.tabId)
          window.dispatchEvent(new CustomEvent("dexon:open-browser-tab", { detail: { tabId: step.tabId } }));
      }}
    >
      {step.target}
    </button>
  ) : (
    <span className="chat-codemode-target type-mono-label" title={step.target}>
      {step.target}
    </span>
  );

  return (
    <div
      className="chat-codemode-step"
      data-status={status}
      data-model={step.call.name.startsWith("models.") || undefined}
    >
      <span
        className="chat-codemode-step-icon inline-flex w-[14px] shrink-0 items-center justify-center"
        aria-hidden="true"
      >
        {status === "running" ? (
          <LoaderCircle size={13} className="chat-codemode-spinner" />
        ) : status === "error" ? (
          <X size={13} />
        ) : status === "cancelled" ? (
          <Ban size={13} />
        ) : (
          <Check size={13} />
        )}
      </span>
      <span className="sr-only">{label}: </span>
      <span
        className={`chat-codemode-verb type-label-medium shrink-0${status === "error" ? " text-[var(--fx-status-danger-text)]" : status === "cancelled" ? " text-[var(--fx-text-tertiary)]" : ""}`}
      >
        {step.verb}
      </span>
      {target}
      {step.tabId && (
        <button
          type="button"
          className="chat-codemode-action chat-codemode-link type-label-medium"
          onClick={() =>
            window.dispatchEvent(new CustomEvent("dexon:open-browser-tab", { detail: { tabId: step.tabId } }))
          }
        >
          {t("openInBrowser", "Open in Browser")} →
        </button>
      )}
      {step.call.cost !== undefined && (
        <span className="chat-codemode-secondary type-mono-meta shrink-0">{formatCost(step.call.cost, language)}</span>
      )}
      <span className="chat-codemode-timing ml-auto flex shrink-0 items-center gap-[var(--space-2)] type-mono-meta">
        <span className="chat-codemode-bar" aria-hidden="true">
          <span style={{ width: `${Math.max(0, Math.min(1, step.widthRatio)) * 100}%` }} />
        </span>
        <span className="w-[38px] text-right tabular-nums">
          {status === "cancelled"
            ? t("codemodeCancelled", "Cancelled")
            : step.call.durationMs === undefined
              ? "—"
              : formatToolDuration(step.call.durationMs)}
        </span>
      </span>
    </div>
  );
}

function CodemodeSource({
  code,
  lineCount,
  stateKey,
  expansionStore,
}: {
  code: string;
  lineCount: number;
  stateKey: string;
  expansionStore?: ThinkingExpansionStore;
}) {
  const { t } = useI18n();
  const [remembered, toggle] = useExpansion(expansionStore, `${stateKey}:source`);
  const expanded = remembered ?? false;
  const mounted = useDelayedUnmount(expanded);
  const panelId = useId();
  return (
    <div className="chat-acc chat-codemode-source" data-open={expanded ? "true" : "false"}>
      <div className="chat-codemode-source-header">
        <button
          type="button"
          className="chat-codemode-source-toggle type-label-medium"
          aria-expanded={expanded}
          aria-controls={panelId}
          onClick={() => toggle(expanded)}
        >
          <CodeXml size={14} aria-hidden="true" className="shrink-0" />
          <span>{expanded ? t("codemodeSource", "Script source") : t("codemodeViewSource", "View script source")}</span>
          <span className="chat-codemode-secondary type-mono-meta ml-auto truncate">
            {t("codemodeSourceMeta", "JavaScript · {count} lines").replace("{count}", String(lineCount))}
          </span>
        </button>
        <CodemodeCopyButton text={code} label={t("codemodeCopyCode", "Copy code")} iconOnly={!expanded} />
        <ChevronRight
          size={14}
          aria-hidden="true"
          className="pointer-events-none shrink-0"
          style={{ transform: expanded ? "rotate(-90deg)" : undefined }}
        />
      </div>
      <div id={panelId} className="chat-acc-panel" aria-hidden={!expanded} inert={!expanded}>
        <div className="chat-acc-panel-clip">
          {mounted && (
            <SyntaxHighlighter
              language="javascript"
              className="chat-codemode-code type-mono-code"
              showLineNumbers
              useInlineStyles={false}
              codeTagProps={{ className: "type-mono-code" }}
            >
              {code}
            </SyntaxHighlighter>
          )}
        </div>
      </div>
    </div>
  );
}

function formatCost(cost: number, language: string): string {
  return new Intl.NumberFormat(language, {
    style: "currency",
    currency: "USD",
    currencyDisplay: "narrowSymbol",
    maximumFractionDigits: 4,
  }).format(cost);
}
