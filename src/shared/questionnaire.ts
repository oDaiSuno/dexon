import { hasQuestionAnswer, type QuestionDraft, type ToolQuestion } from "./interactive-tools.ts";

/** The supported plugin's published schema and semantic guards, not display-text guessing. */
export function readQuestionnaire(params: unknown): ToolQuestion[] | null {
  if (!params || typeof params !== "object" || !("questions" in params)) return null;
  const questions = params.questions;
  if (!Array.isArray(questions) || questions.length < 1 || questions.length > 4) return null;
  const seen = new Set<string>();
  for (const q of questions) {
    if (!q || typeof q !== "object" || typeof q.question !== "string" || typeof q.header !== "string") return null;
    if (q.header.length > 16 || seen.has(q.question)) return null;
    seen.add(q.question);
    if (q.multiSelect !== undefined && typeof q.multiSelect !== "boolean") return null;
    if (!Array.isArray(q.options) || q.options.length < 2 || q.options.length > 4) return null;
    const labels = new Set<string>();
    for (const option of q.options) {
      if (
        !option ||
        typeof option !== "object" ||
        typeof option.label !== "string" ||
        typeof option.description !== "string"
      )
        return null;
      if (
        option.label.length > 60 ||
        ["Other", "Type something.", "Next"].includes(option.label) ||
        labels.has(option.label)
      )
        return null;
      if (option.preview !== undefined && typeof option.preview !== "string") return null;
      labels.add(option.label);
    }
  }
  return questions as ToolQuestion[];
}

/** Validate before settling the backend wait; malformed submissions remain retryable. */
export function parseQuestionAnswers(questions: ToolQuestion[], value: unknown): QuestionDraft[] {
  if (!Array.isArray(value) || value.length !== questions.length) throw new Error("Invalid questionnaire response");
  const answers = value.map((answer: unknown, index) => {
    if (!answer || typeof answer !== "object" || !("selected" in answer) || !("text" in answer))
      throw new Error("Invalid answer");
    if (typeof answer.text !== "string" || !Array.isArray(answer.selected)) throw new Error("Invalid answer fields");
    const q = questions[index];
    const selected: number[] = answer.selected;
    if (
      selected.some((n) => !Number.isInteger(n) || n < 0 || n >= q.options.length) ||
      new Set(selected).size !== selected.length
    )
      throw new Error("Invalid option selection");
    if (!q.multiSelect && (selected.length > 1 || (selected.length > 0 && answer.text.trim())))
      throw new Error("Single choice and custom text are exclusive");
    return { selected: [...selected].sort((a, b) => a - b), text: answer.text };
  });
  if (!answers.some(hasQuestionAnswer)) throw new Error("Use explicit abandonment for an unanswered questionnaire");
  return answers;
}

export interface QuestionnaireAnswer {
  questionIndex: number;
  question: string;
  kind: "option" | "custom" | "multi";
  answer: string | null;
  selected?: string[];
  notes?: string;
  preview?: string;
}

export function buildQuestionnaireResult(questions: ToolQuestion[], drafts: QuestionDraft[] | undefined) {
  if (!drafts)
    return {
      content: [{ type: "text" as const, text: "User declined to answer questions" }],
      details: { answers: [] as QuestionnaireAnswer[], cancelled: true },
    };
  const answers: QuestionnaireAnswer[] = [];
  const unanswered: Array<{ questionIndex: number; question: string }> = [];
  const segments: string[] = [];
  for (const [questionIndex, q] of questions.entries()) {
    const draft = drafts[questionIndex];
    if (!hasQuestionAnswer(draft)) {
      unanswered.push({ questionIndex, question: q.question });
      continue;
    }
    const selected = draft.selected.map((n) => q.options[n]);
    const base = { questionIndex, question: q.question };
    let answer: QuestionnaireAnswer;
    if (selected.length === 0) answer = { ...base, kind: "custom", answer: draft.text };
    else if (q.multiSelect)
      answer = {
        ...base,
        kind: "multi",
        answer: null,
        selected: selected.map((o) => o.label),
        ...(draft.text.trim() ? { notes: draft.text } : {}),
      };
    else
      answer = {
        ...base,
        kind: "option",
        answer: selected[0].label,
        ...(selected[0].preview ? { preview: selected[0].preview } : {}),
      };
    answers.push(answer);
    segments.push(
      `${JSON.stringify(q.question)}=${JSON.stringify(answer.kind === "multi" ? answer.selected!.join(", ") : answer.answer)}.`,
    );
    if (answer.preview) segments.push(`selected preview: ${answer.preview}.`);
    if (answer.notes) segments.push(`user notes: ${answer.notes}.`);
  }
  if (unanswered.length)
    segments.push(
      `Unanswered questions (do not infer answers): ${unanswered.map((q) => JSON.stringify(q.question)).join(", ")}.`,
    );
  return {
    content: [
      {
        type: "text" as const,
        text: `User has answered your questions: ${segments.join(" ")} You can now continue with the user's answers in mind.`,
      },
    ],
    details: { answers, cancelled: false, ...(unanswered.length ? { unanswered } : {}) },
  };
}
