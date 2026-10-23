import type { InteractiveRequest, ToolDraft } from "@shared/interactive-tools";

const oneLine = (text: string) => text.replace(/\s+/g, " ").trim();

export function answerSummary(
  request: InteractiveRequest,
  draft: ToolDraft,
  language: string,
  separator: string,
): string {
  const list = new Intl.ListFormat(language, { style: "narrow", type: "conjunction" });
  const pair = (topic: string, answer: string) => (answer ? `${oneLine(topic)} · ${answer}` : "");
  if (request.method === "questionnaire")
    return request.questions
      .map((question, index) => {
        const answer = draft.answers[index];
        if (!answer) return "";
        const parts = [
          ...answer.selected.map((option) => question.options[option]?.label ?? ""),
          oneLine(answer.text),
        ].filter(Boolean);
        return parts.length ? pair(question.header, list.format(parts)) : "";
      })
      .filter(Boolean)
      .join(separator);
  if (request.method === "select")
    return draft.selected === null ? "" : pair(request.title, request.options[draft.selected] ?? "");
  if (request.method === "input" || request.method === "editor") return pair(request.title, oneLine(draft.value));
  return "";
}
