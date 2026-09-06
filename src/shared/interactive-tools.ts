import type { ExtensionUiRequest } from "./types";

export interface ToolQuestion {
  question: string;
  header: string;
  options: Array<{ label: string; description: string; preview?: string }>;
  multiSelect?: boolean;
}

export interface QuestionnaireRequest {
  type: "extension_ui_request";
  method: "questionnaire";
  id: string;
  questions: ToolQuestion[];
  timeout?: number;
  expiresAt?: number;
}

export interface QuestionDraft {
  selected: number[];
  text: string;
}

export type InteractiveRequest = Extract<
  ExtensionUiRequest,
  { method: "select" | "confirm" | "input" | "editor" | "custom" | "questionnaire" }
>;

export type InteractiveAnswer =
  { value: string } | { confirmed: boolean } | { cancelled: true } | { answers: QuestionDraft[] };

export type InteractiveStatus = "submitted" | "cancelled" | "completed" | "expired";
export interface InteractiveReceipt {
  id: string;
  status: InteractiveStatus;
  reason?: "timeout" | "aborted" | "stopped" | "closed" | "failed";
}

/** Only this live-host snapshot authorizes restoring a saved draft. */
export interface InteractiveSnapshot {
  runtimeId: string;
  revision: number;
  requests: InteractiveRequest[];
  completed: InteractiveReceipt[];
}

export interface ToolDraft {
  collapsed: boolean;
  questionIndex: number;
  answers: QuestionDraft[];
  value: string;
  selected: number | null;
}

export function createToolDraft(request: InteractiveRequest): ToolDraft {
  return {
    collapsed: false,
    questionIndex: 0,
    answers: request.method === "questionnaire" ? request.questions.map(() => ({ selected: [], text: "" })) : [],
    value: request.method === "editor" ? (request.prefill ?? "") : "",
    selected: null,
  };
}

export function hasQuestionAnswer(answer: QuestionDraft): boolean {
  return answer.selected.length > 0 || answer.text.trim().length > 0;
}
