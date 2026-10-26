import { useEffect, useLayoutEffect, useRef, type CSSProperties, type ReactNode } from "react";
import { useI18n } from "@/i18n";
import type { InteractiveToolStore, ToolCardEntry } from "@/lib/interactive-tool-store";
import { hasQuestionAnswer, type QuestionnaireRequest } from "@shared/interactive-tools";
import { ChevronDownIcon, ChevronUpIcon } from "./tool-card-icons";
import { Button } from "@/components/form-controls";
import { CardFooter, FailureBar } from "./tool-card-footer";
import { IconButton } from "./tool-card-parts";
import { OwnAnswer, QuestionChoice } from "./question-fields";
import { AutoHeight } from "./tool-motion";

export function Questionnaire({
  entry,
  store,
  visible = true,
  header,
  replaceBody,
  onAbandon,
}: {
  entry: ToolCardEntry & { request: QuestionnaireRequest };
  store: InteractiveToolStore;
  visible?: boolean;
  header: (group: ReactNode, nav: ReactNode) => ReactNode;
  replaceBody?: ReactNode;
  onAbandon: () => void;
}) {
  const { t } = useI18n();
  const { request, draft } = entry;
  const index = draft.questionIndex;
  const question = request.questions[index];
  const answer = draft.answers[index];
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const direction = useRef(1);
  const root = useRef<HTMLDivElement>(null);
  const focusOnNavigation = useRef(false);
  useLayoutEffect(() => {
    if (visible && focusOnNavigation.current) root.current?.querySelector<HTMLElement>(".tool-question-title")?.focus();
    focusOnNavigation.current = false;
  }, [index, visible]);
  const cancelAdvance = () => {
    if (timer.current !== null) clearTimeout(timer.current);
    timer.current = null;
  };
  useEffect(
    () => () => {
      if (timer.current !== null) clearTimeout(timer.current);
    },
    [],
  );
  const replaced = replaceBody !== undefined;
  useEffect(() => {
    if (visible && !replaced) return;
    cancelAdvance();
    focusOnNavigation.current = false;
  }, [visible, replaced]);
  const navigate = (next: number) => {
    if (!visible) return;
    cancelAdvance();
    focusOnNavigation.current = true;
    direction.current = next >= index ? 1 : -1;
    store.updateDraft(request.id, (d) => ({
      ...d,
      questionIndex: Math.max(0, Math.min(request.questions.length - 1, next)),
    }));
  };
  const choose = (optionIndex: number) => {
    if (!visible) return;
    cancelAdvance();
    store.updateDraft(request.id, (d) => ({
      ...d,
      answers: d.answers.map((a, i) =>
        i !== index
          ? a
          : {
              selected: question.multiSelect
                ? a.selected.includes(optionIndex)
                  ? a.selected.filter((n) => n !== optionIndex)
                  : [...a.selected, optionIndex]
                : [optionIndex],
              text: question.multiSelect ? a.text : "",
            },
      ),
    }));
    if (!question.multiSelect && index < request.questions.length - 1) {
      const reduced = typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;
      const duration = root.current
        ? getComputedStyle(root.current).getPropertyValue("--duration-quick").trim()
        : "150ms";
      const ms = duration.endsWith("ms") ? parseFloat(duration) : parseFloat(duration) * 1000;
      timer.current = setTimeout(
        () => {
          focusOnNavigation.current = !!root.current?.contains(document.activeElement);
          direction.current = 1;
          store.updateDraft(request.id, (d) =>
            d.collapsed || d.questionIndex !== index ? d : { ...d, questionIndex: index + 1 },
          );
        },
        reduced ? 0 : Number.isFinite(ms) ? ms : 150,
      );
    }
  };
  const answered = draft.answers.filter(hasQuestionAnswer).length;
  const busy = entry.status === "sending";
  const total = request.questions.length;
  const previewLabels = { show: t("toolViewPreview", "Preview"), hide: t("toolHidePreview", "Hide preview") };
  const navigation = (
    <nav className="tool-question-nav" aria-label={t("toolQuestionNavigation", "Question navigation")}>
      <span className="tool-progress" aria-hidden="true">
        {request.questions.map((_, i) => (
          <span
            key={i}
            className="tool-progress-step"
            data-step={i < index ? "done" : i === index ? "current" : "todo"}
          />
        ))}
      </span>
      <span className="tool-question-count type-mono-meta" aria-label={`${index + 1} / ${total}`}>
        <span className="tool-number-window" aria-hidden="true">
          <span className="tool-number-strip" style={{ "--tool-index": index } as CSSProperties}>
            {request.questions.map((_, i) => (
              <span key={i}>{i + 1}</span>
            ))}
          </span>
        </span>
        <span aria-hidden="true"> / {total}</span>
      </span>
      <span className="tool-nav-actions">
        <IconButton
          label={t("toolPreviousQuestion", "Previous question")}
          disabled={busy || index === 0}
          onClick={() => navigate(index - 1)}
        >
          <ChevronUpIcon size={14} />
        </IconButton>
        <IconButton
          label={t("toolNextQuestion", "Next question")}
          disabled={busy || index === total - 1}
          onClick={() => navigate(index + 1)}
        >
          <ChevronDownIcon size={14} />
        </IconButton>
      </span>
    </nav>
  );
  return (
    <div ref={root} className="tool-questionnaire">
      {header(<span className="tool-subtle type-label-default">{question.header}</span>, navigation)}
      {replaceBody ?? (
        <>
          <AutoHeight visible={visible}>
            <div
              className="tool-question-page"
              key={index}
              style={{ "--tool-direction": direction.current } as CSSProperties}
            >
              <div className="tool-question-head">
                <h3 tabIndex={-1} className="tool-question-title type-title-dialog">
                  {question.question}
                </h3>
                <p className="tool-subtle type-label-default">
                  {question.multiSelect
                    ? t("toolMultiHint", "Pick as many as you like, and add a note below if needed.")
                    : t("toolSingleHint", "Pick one, or write your own answer.")}
                </p>
              </div>
              <fieldset className="tool-choices" aria-label={question.question}>
                {question.options.map((option, optionIndex) => (
                  <QuestionChoice
                    key={optionIndex}
                    position={optionIndex + 1}
                    label={option.label}
                    description={option.description}
                    preview={option.preview}
                    multiSelect={!!question.multiSelect}
                    name={`${request.id}-${index}`}
                    checked={answer.selected.includes(optionIndex)}
                    disabled={busy}
                    onChoose={() => choose(optionIndex)}
                    previewLabels={previewLabels}
                    onPreviewToggle={() => visible && cancelAdvance()}
                  />
                ))}
              </fieldset>
              <OwnAnswer
                value={answer.text}
                disabled={busy}
                placeholder={
                  question.multiSelect
                    ? t("toolAdditionalAnswer", "Add a note (optional)")
                    : t("toolOwnAnswer", "Or write your own answer…")
                }
                onChange={(event) => {
                  if (!visible) return;
                  cancelAdvance();
                  const text = event.target.value;
                  store.updateDraft(request.id, (d) => ({
                    ...d,
                    answers: d.answers.map((a, i) =>
                      i !== index
                        ? a
                        : {
                            selected: !question.multiSelect && text.trim() ? [] : a.selected,
                            text,
                          },
                    ),
                  }));
                }}
              />
            </div>
          </AutoHeight>
          {entry.status === "failed" && <FailureBar />}
          <CardFooter
            status={entry.status}
            meta={t("toolAnsweredCount", "Answered {answered} / {total}")
              .replace("{answered}", String(answered))
              .replace("{total}", String(total))}
            onAbandon={onAbandon}
          >
            {index < total - 1 && (
              <Button disabled={busy} onClick={() => navigate(index + 1)}>
                {hasQuestionAnswer(answer) ? t("toolContinue", "Continue") : t("toolSkip", "Skip for now")}
              </Button>
            )}
            <Button
              variant="primary"
              busy={busy}
              disabled={busy || answered === 0}
              onClick={() => {
                if (!visible) return;
                cancelAdvance();
                void store.respond(request.id, { answers: draft.answers });
              }}
            >
              {entry.status === "failed"
                ? t("toolResend", "Resend")
                : answered < total
                  ? t("toolSendPartial", "Send what's answered")
                  : t("toolSendAnswers", "Send answers")}
            </Button>
          </CardFooter>
        </>
      )}
    </div>
  );
}
