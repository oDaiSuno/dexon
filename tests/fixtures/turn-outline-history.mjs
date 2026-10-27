import { createSessionDetail } from "../../src/renderer/hooks/agent-session/session-hook-fixtures.mjs";

export const QUESTIONS = [
  "Which color tokens does the design use?",
  "Check the diff of the parser",
  "Show relative times in the session list",
  "Explain the retry policy",
  "Summarize the open bugs",
];

export const QUESTION_TITLES = [
  "Which color tokens does the design use?",
  "Check the diff of the parser",
  "Show relative times in the session list",
  "Explain the retry policy",
  "Summarize the open bugs",
];

export const ANSWERS = [
  "The design uses eight color tokens.",
  "The parser drops empty lines.",
  "Relative times read as minutes and hours.",
  "The retry policy backs off after each failure.",
  "Three bugs are still open.",
];

export const HISTORY_REVISION = "turn-outline-revision";
export const VIEW_HEIGHT = 600;
export const CONTENT_HEIGHT = 5000;

export const QUESTION_TOPS = [
  [QUESTIONS[0], 0],
  [QUESTIONS[1], 1000],
  [QUESTIONS[2], 2000],
  [QUESTIONS[3], 3000],
  [QUESTIONS[4], 4000],
];

export const FULL_READING_ORDER = QUESTIONS.flatMap((question, index) => [question, ANSWERS[index]]);

export const TURN_NAMES = QUESTION_TITLES.map((title, index) => `Turn ${index + 1}: ${title}`);

export function userMessage(content, timestamp) {
  return { role: "user", content, timestamp };
}

export function assistantMessage(content, timestamp) {
  return {
    role: "assistant",
    provider: "fixture-provider",
    model: "fixture-model",
    content: [{ type: "text", text: content }],
    stopReason: "stop",
    timestamp,
  };
}

function page(messages, entryIds, previousCursor) {
  return {
    context: { messages, entryIds, historyRevision: HISTORY_REVISION, previousCursor },
    truncated: false,
  };
}

export function outlineOf(titles = QUESTION_TITLES) {
  return titles.map((title, index) => ({ entryId: `entry-q${index + 1}`, title }));
}

export function fiveQuestionHistory(id = "turn-outline-history") {
  const messages = [];
  const entryIds = [];
  QUESTIONS.forEach((question, index) => {
    messages.push(userMessage(question, index * 2 + 1));
    entryIds.push(`entry-q${index + 1}`);
    messages.push(assistantMessage(ANSWERS[index], index * 2 + 2));
    entryIds.push(`entry-a${index + 1}`);
  });
  const detail = createSessionDetail(id, {
    messages: messages.slice(8),
    entryIds: entryIds.slice(8),
    previousCursor: "page-4",
    historyRevision: HISTORY_REVISION,
    outline: outlineOf(),
  });
  const pages = {
    "page-4": page(messages.slice(6, 8), entryIds.slice(6, 8), "page-3"),
    "page-3": page(messages.slice(4, 6), entryIds.slice(4, 6), "page-2"),
    "page-2": page(messages.slice(2, 4), entryIds.slice(2, 4), "page-1"),
    "page-1": page(messages.slice(0, 2), entryIds.slice(0, 2), null),
  };
  return { detail, pages };
}

export const VERSION_BRANCH_QUESTIONS = [
  "Why does the sidebar flicker?",
  "Where is the retry delay set?",
  "Which test covers the empty session?",
];

export function versionedQuestionHistory(id = "turn-outline-versions") {
  const versions = { entryIds: ["entry-q3", "entry-q3-other"], index: 0 };
  const messages = [{ ...userMessage(QUESTIONS[2], 5), versions }, assistantMessage(ANSWERS[2], 6)];
  const detail = createSessionDetail(id, {
    messages,
    entryIds: ["entry-q3", "entry-a3"],
    previousCursor: "page-2",
    historyRevision: HISTORY_REVISION,
    outline: outlineOf(QUESTION_TITLES.slice(0, 3)),
  });
  const otherBranch = {
    messages: [userMessage(VERSION_BRANCH_QUESTIONS[2], 15), assistantMessage("The empty-session test does.", 16)],
    entryIds: ["entry-b3", "entry-b3-answer"],
    historyRevision: HISTORY_REVISION,
    previousCursor: "other-page-2",
    outline: VERSION_BRANCH_QUESTIONS.map((title, index) => ({ entryId: `entry-b${index + 1}`, title })),
  };
  return { detail, otherBranch };
}

export const VERSION_BRANCH_NAMES = VERSION_BRANCH_QUESTIONS.map((title, index) => `Turn ${index + 1}: ${title}`);
