import { useRef, useState, useSyncExternalStore } from "react";
import { useI18n } from "@/i18n";
import { isPendingCard, type InteractiveToolStore, type ToolCardEntry } from "@/lib/interactive-tool-store";
import { OrdinaryForm } from "./ordinary-form";
import { Questionnaire } from "./questionnaire";
import { TerminalContent } from "./terminal-content";

export function ToolCardDock({ store }: { store: InteractiveToolStore }) {
  const { t } = useI18n();
  const state = useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot);
  const pending = state.entries.filter(isPendingCard);
  const entry = pending[0] ?? state.entries.at(-1);
  if (!entry)
    return state.expiredDraft ? (
      <section className="tool-card-dock tool-card" data-state="expired">
        <div className="tool-card-header">
          <span role="status" className="tool-card-status">
            {t("toolExpired", "This request is no longer active")}
          </span>
          <button
            type="button"
            className="tool-pill tool-icon"
            aria-label={t("toolDismiss", "Dismiss status")}
            onClick={() => store.dismissExpiredDraft()}
          >
            ×
          </button>
        </div>
      </section>
    ) : null;
  return (
    <div className="tool-card-dock">
      <ToolCard key={entry.request.id} entry={entry} store={store} count={pending.length} />
      {state.storageFailed && (
        <p role="status" className="tool-subtle">
          {t(
            "toolDraftStorageFailed",
            "Answers remain in this view, but browser storage is unavailable. Avoid reloading until you send them.",
          )}
        </p>
      )}
    </div>
  );
}

function ToolCard({ entry, store, count }: { entry: ToolCardEntry; store: InteractiveToolStore; count: number }) {
  const { t } = useI18n();
  const [abandoning, setAbandoning] = useState(false);
  const card = useRef<HTMLElement>(null);
  const resume = useRef<HTMLButtonElement>(null);
  const { request, status } = entry;
  const pending = isPendingCard(entry);
  const collapsed = entry.draft.collapsed;
  const collapse = () => {
    store.setCollapsed(request.id, true);
    setAbandoning(false);
    requestAnimationFrame(() => resume.current?.focus());
  };
  const title =
    request.method === "questionnaire"
      ? request.questions[entry.draft.questionIndex].question
      : request.method === "custom"
        ? t("toolCustomPanel", "Interactive panel")
        : request.title;
  const statusLabel =
    status === "submitted"
      ? t("toolSubmitted", "Answers sent")
      : status === "cancelled"
        ? t("toolAbandoned", "Answering abandoned")
        : status === "completed"
          ? t("toolCompleted", "Interaction ended")
          : status === "expired"
            ? t("toolExpired", "This request is no longer active")
            : status === "sending"
              ? t("toolSending", "Sending…")
              : status === "checking"
                ? t("toolChecking", "Checking whether this request is still active…")
                : status === "failed"
                  ? t("toolSendFailed", "Delivery failed. Your answers are kept; try again.")
                  : t("toolWaiting", "Waiting for your answer");
  return (
    <section
      ref={card}
      tabIndex={-1}
      className="tool-card"
      aria-label={t("toolInteraction", "Tool interaction")}
      data-state={status}
      onKeyDownCapture={(event) => {
        if (event.key === "Escape") {
          event.preventDefault();
          event.stopPropagation();
          if (!event.nativeEvent.isComposing && event.keyCode !== 229 && pending) collapse();
        }
      }}
    >
      <header className="tool-card-header">
        <span className="tool-card-status" role="status">
          {statusLabel}
        </span>
        <span className="tool-subtle">
          {t("toolPendingCount", "{count} pending").replace("{count}", String(count))}
        </span>
        {pending && !collapsed && (
          <button
            type="button"
            className="tool-pill tool-icon"
            onClick={collapse}
            aria-label={t("toolCollapse", "Collapse and keep answers")}
          >
            −
          </button>
        )}
        {!pending && (
          <button
            type="button"
            className="tool-pill tool-icon"
            onClick={() => store.dismiss(request.id)}
            aria-label={t("toolDismiss", "Dismiss status")}
          >
            ×
          </button>
        )}
      </header>
      {!pending ? (
        <p className="tool-receipt">{title}</p>
      ) : collapsed ? (
        <button
          ref={resume}
          type="button"
          className="tool-resume"
          onClick={() => {
            store.setCollapsed(request.id, false);
            requestAnimationFrame(() => card.current?.focus());
          }}
        >
          <span>{title}</span>
          <strong>{t("toolResume", "Continue answering")} ↗</strong>
        </button>
      ) : (
        <>
          {abandoning ? (
            <div className="tool-abandon-confirm">
              <h3 className="tool-question-title">{t("toolAbandonTitle", "Abandon this answer?")}</h3>
              <p>
                {t(
                  "toolAbandonDescription",
                  "The tool will stop waiting. Draft answers will not be sent to the model.",
                )}
              </p>
              <div className="tool-footer-actions">
                <button type="button" className="tool-pill tool-primary" onClick={() => setAbandoning(false)}>
                  {t("toolKeepAnswering", "Keep answering")}
                </button>
                <button
                  type="button"
                  className="tool-pill"
                  disabled={status === "sending"}
                  onClick={() => void store.respond(request.id, { cancelled: true })}
                >
                  {t("toolConfirmAbandon", "Abandon without sending")}
                </button>
              </div>
            </div>
          ) : (
            <>
              {request.method === "questionnaire" ? (
                <Questionnaire entry={{ ...entry, request }} store={store} />
              ) : request.method === "custom" ? (
                <TerminalContent entry={entry} store={store} />
              ) : (
                <OrdinaryForm entry={entry} store={store} />
              )}
              <div className="tool-abandon-row">
                <button
                  type="button"
                  className="tool-text-button"
                  disabled={status === "sending"}
                  onClick={() => setAbandoning(true)}
                >
                  {t("toolAbandon", "Abandon this answer")}
                </button>
              </div>
            </>
          )}
        </>
      )}
    </section>
  );
}
