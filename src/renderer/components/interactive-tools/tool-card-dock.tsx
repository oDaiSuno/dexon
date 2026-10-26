import { useCallback, useEffect, useRef, useState, useSyncExternalStore, type ReactNode } from "react";
import { Button } from "@/components/form-controls";
import { useI18n } from "@/i18n";
import { isPendingCard, type InteractiveToolStore, type ToolCardEntry } from "@/lib/interactive-tool-store";
import { answerSummary } from "./answer-summary";
import { OrdinaryForm } from "./ordinary-form";
import { Questionnaire } from "./questionnaire";
import { TerminalContent } from "./terminal-content";
import { CardFooter } from "./tool-card-footer";
import { CardHeader, Receipt, ResumeRow, StatusLead } from "./tool-card-parts";

export function ToolCardDock({ store, visible = true }: { store: InteractiveToolStore; visible?: boolean }) {
  const { t } = useI18n();
  const state = useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot);
  const pending = state.entries.filter(isPendingCard);
  const entry = pending[0] ?? state.entries.at(-1);
  if (!entry)
    return state.expiredDraft ? (
      <div className="tool-card-dock">
        <section className="tool-card" aria-label={t("toolInteraction", "Tool interaction")} data-state="expired">
          <Receipt
            status="expired"
            detail={t("toolExpiredDetail", "The agent stopped waiting; your draft wasn't sent")}
            onDismiss={() => {
              if (visible) store.dismissExpiredDraft();
            }}
          />
        </section>
      </div>
    ) : null;
  return (
    <div className="tool-card-dock">
      <ToolCard key={entry.request.id} entry={entry} store={store} count={pending.length} visible={visible} />
      {state.storageFailed && (
        <p role="status" className="tool-subtle tool-storage-note type-label-default">
          {t(
            "toolDraftStorageFailed",
            "Answers remain in this view, but browser storage is unavailable. Avoid reloading until you send them.",
          )}
        </p>
      )}
    </div>
  );
}

function ToolCard({
  entry,
  store,
  count,
  visible,
}: {
  entry: ToolCardEntry;
  store: InteractiveToolStore;
  count: number;
  visible: boolean;
}) {
  const { t, language } = useI18n();
  const [abandoning, setAbandoning] = useState(false);
  const card = useRef<HTMLElement>(null);
  const resume = useRef<HTMLButtonElement>(null);
  const focusFrameRef = useRef<number | null>(null);
  const cancelFocusFrame = useCallback(() => {
    if (focusFrameRef.current !== null) globalThis.cancelAnimationFrame?.(focusFrameRef.current);
    focusFrameRef.current = null;
  }, []);
  const focusAfterPaint = useCallback(
    (target: { current: HTMLElement | null }) => {
      if (!visible) return;
      cancelFocusFrame();
      if (typeof globalThis.requestAnimationFrame !== "function") return;
      focusFrameRef.current = globalThis.requestAnimationFrame(() => {
        focusFrameRef.current = null;
        if (visible) target.current?.focus();
      });
    },
    [cancelFocusFrame, visible],
  );
  useEffect(() => {
    if (!visible) cancelFocusFrame();
    return cancelFocusFrame;
  }, [cancelFocusFrame, visible]);
  const { request, status } = entry;
  const pending = isPendingCard(entry);
  const collapsed = entry.draft.collapsed;
  const collapse = () => {
    if (!visible || status === "sending") return;
    store.setCollapsed(request.id, true);
    setAbandoning(false);
    focusAfterPaint(resume);
  };
  const title =
    request.method === "questionnaire"
      ? request.questions[entry.draft.questionIndex].question
      : request.method === "custom"
        ? t("toolCustomPanel", "Interactive panel")
        : request.title;
  const queue =
    count > 1 ? (
      <span className="tool-subtle type-label-default">
        {t("toolPendingCount", "{count} pending").replace("{count}", String(count))}
      </span>
    ) : null;
  const header = (group: ReactNode, nav?: ReactNode) => (
    <CardHeader
      lead={
        <StatusLead status={status}>
          {group}
          {group && queue ? <span className="tool-dot" aria-hidden="true" /> : null}
          {queue}
        </StatusLead>
      }
      nav={nav}
      collapseDisabled={status === "sending"}
      onCollapse={collapse}
    />
  );
  const receiptDetail =
    status === "expired"
      ? t("toolExpiredDetail", "The agent stopped waiting; your draft wasn't sent")
      : (status === "submitted" && answerSummary(request, entry.draft, language, t("toolSummarySeparator", "; "))) ||
        title;
  const startAbandon = () => {
    if (visible) setAbandoning(true);
  };
  const abandonConfirm = (
    <>
      <div className="tool-abandon-confirm">
        <h3 className="tool-question-title type-title-dialog">{t("toolAbandonTitle", "Abandon this answer?")}</h3>
        <p className="tool-subtle type-label-default">
          {t("toolAbandonDescription", "The agent will stop waiting, and nothing you picked will be sent to it.")}
        </p>
      </div>
      <CardFooter status={status}>
        <Button
          variant="danger"
          disabled={status === "sending"}
          onClick={() => {
            if (visible) void store.respond(request.id, { cancelled: true });
          }}
        >
          {t("toolConfirmAbandon", "Abandon, don't send")}
        </Button>
        <Button
          variant="primary"
          onClick={() => {
            if (visible) setAbandoning(false);
          }}
        >
          {t("toolKeepAnswering", "Keep answering")}
        </Button>
      </CardFooter>
    </>
  );
  return (
    <section
      ref={card}
      tabIndex={-1}
      className="tool-card"
      aria-label={t("toolInteraction", "Tool interaction")}
      data-state={status}
      onKeyDownCapture={(event) => {
        if (!visible || event.key !== "Escape") return;
        event.preventDefault();
        event.stopPropagation();
        if (!event.nativeEvent.isComposing && event.keyCode !== 229 && pending) collapse();
      }}
    >
      {!pending ? (
        <Receipt
          status={status}
          detail={receiptDetail}
          onDismiss={() => {
            if (visible) store.dismiss(request.id);
          }}
        />
      ) : collapsed ? (
        <ResumeRow
          ref={resume}
          status={status}
          title={title}
          onResume={() => {
            if (!visible) return;
            store.setCollapsed(request.id, false);
            focusAfterPaint(card);
          }}
        />
      ) : (
        <>
          {request.method === "questionnaire" ? (
            <Questionnaire
              entry={{ ...entry, request }}
              store={store}
              visible={visible}
              header={header}
              replaceBody={abandoning ? abandonConfirm : undefined}
              onAbandon={startAbandon}
            />
          ) : (
            <>
              {header(null)}
              {abandoning ? (
                abandonConfirm
              ) : request.method === "custom" ? (
                <TerminalContent entry={entry} store={store} visible={visible} onAbandon={startAbandon} />
              ) : (
                <OrdinaryForm entry={entry} store={store} visible={visible} onAbandon={startAbandon} />
              )}
            </>
          )}
        </>
      )}
    </section>
  );
}
