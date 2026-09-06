import { useEffect, useLayoutEffect, useRef, type CSSProperties } from "react";
import { useI18n } from "@/i18n";
import type { InteractiveToolStore, ToolCardEntry } from "@/lib/interactive-tool-store";
import { hasQuestionAnswer, type QuestionnaireRequest } from "@shared/interactive-tools";
import { AutoHeight } from "./tool-motion";

export function Questionnaire({
  entry,
  store,
}: {
  entry: ToolCardEntry & { request: QuestionnaireRequest };
  store: InteractiveToolStore;
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
    if (focusOnNavigation.current) root.current?.querySelector<HTMLElement>(".tool-question-title")?.focus();
    focusOnNavigation.current = false;
  }, [index]);
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
  const navigate = (next: number) => {
    cancelAdvance();
    focusOnNavigation.current = true;
    direction.current = next >= index ? 1 : -1;
    store.updateDraft(request.id, (d) => ({
      ...d,
      questionIndex: Math.max(0, Math.min(request.questions.length - 1, next)),
    }));
  };
  const choose = (optionIndex: number) => {
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
  return (
    <div ref={root} className="tool-questionnaire">
      <nav className="tool-question-nav" aria-label={t("toolQuestionNavigation", "Question navigation")}>
        <div className="tool-question-count" aria-label={`${index + 1} / ${request.questions.length}`}>
          <span className="tool-number-window" aria-hidden="true">
            <span className="tool-number-strip" style={{ transform: `translateY(-${index}em)` }}>
              {request.questions.map((_, i) => (
                <span key={i}>{i + 1}</span>
              ))}
            </span>
          </span>
          <span aria-hidden="true"> / {request.questions.length}</span>
        </div>
        <span className="tool-subtle">{question.header}</span>
        <div className="tool-nav-actions">
          <button
            type="button"
            className="tool-pill"
            disabled={busy || index === 0}
            onClick={() => navigate(index - 1)}
            aria-label={t("toolPreviousQuestion", "Previous question")}
          >
            ↑
          </button>
          <button
            type="button"
            className="tool-pill"
            disabled={busy || index === request.questions.length - 1}
            onClick={() => navigate(index + 1)}
            aria-label={t("toolNextQuestion", "Next question")}
          >
            ↓
          </button>
        </div>
      </nav>
      <AutoHeight>
        <div
          className="tool-question-page"
          key={index}
          style={{ "--tool-direction": direction.current } as CSSProperties}
        >
          <h3 tabIndex={-1} className="tool-question-title">
            {question.question}
          </h3>
          <p className="tool-subtle">
            {question.multiSelect
              ? t("toolMultiHint", "Choose any options and add a note, or write your own answer.")
              : t("toolSingleHint", "Choose one option or write your own answer.")}
          </p>
          <fieldset className="tool-options" disabled={busy} aria-label={question.question}>
            {question.options.map((option, optionIndex) => (
              <div key={optionIndex} className="tool-option-group">
                <label className="tool-option" data-selected={answer.selected.includes(optionIndex)}>
                  <input
                    type={question.multiSelect ? "checkbox" : "radio"}
                    name={`${request.id}-${index}`}
                    checked={answer.selected.includes(optionIndex)}
                    onChange={() => choose(optionIndex)}
                  />
                  <span>
                    <strong>{option.label}</strong>
                    <span className="tool-option-description">{option.description}</span>
                  </span>
                </label>
                {option.preview && (
                  <details className="tool-preview" onToggle={cancelAdvance}>
                    <summary>{t("toolViewPreview", "View full preview")}</summary>
                    <pre>{option.preview}</pre>
                  </details>
                )}
              </div>
            ))}
          </fieldset>
          <label className="tool-custom-answer">
            <span className="tool-subtle">
              {question.multiSelect
                ? t("toolAdditionalAnswer", "Additional text or your own answer")
                : t("toolOwnAnswer", "Your own answer")}
            </span>
            <textarea
              value={answer.text}
              disabled={busy}
              rows={2}
              onChange={(event) => {
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
          </label>
        </div>
      </AutoHeight>
      <footer className="tool-question-footer">
        <span className="tool-subtle">
          {t("toolAnsweredCount", "{answered} of {total} answered")
            .replace("{answered}", String(answered))
            .replace("{total}", String(request.questions.length))}
        </span>
        <div className="tool-footer-actions">
          {index < request.questions.length - 1 && (
            <button type="button" className="tool-pill" disabled={busy} onClick={() => navigate(index + 1)}>
              {hasQuestionAnswer(answer) ? t("toolContinue", "Continue") : t("toolSkip", "Skip for now")}
            </button>
          )}
          <button
            type="button"
            className="tool-pill tool-primary"
            disabled={busy || answered === 0}
            onClick={() => {
              cancelAdvance();
              void store.respond(request.id, { answers: draft.answers });
            }}
          >
            {busy
              ? t("toolSending", "Sending…")
              : answered < request.questions.length
                ? t("toolSendPartial", "Send answered questions")
                : t("toolSendAnswers", "Send answers")}
          </button>
        </div>
      </footer>
    </div>
  );
}
