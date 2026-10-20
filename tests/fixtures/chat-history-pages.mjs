import { createSessionDetail } from "../../src/renderer/hooks/agent-session/session-hook-fixtures.mjs";

export const FIRST_QUESTION = "The first question.";
export const FIRST_ANSWER = "The first answer.";
export const SECOND_QUESTION = "The second question.";
export const SECOND_ANSWER = "The second answer.";
export const THIRD_QUESTION = "The third question.";
export const THIRD_ANSWER = "The third answer.";

export const HISTORY_TEXTS = [
  FIRST_QUESTION,
  FIRST_ANSWER,
  SECOND_QUESTION,
  SECOND_ANSWER,
  THIRD_QUESTION,
  THIRD_ANSWER,
];

export function userMessage(content, timestamp) {
  return { role: "user", content, timestamp };
}

export function assistantMessage(content, timestamp = 1000) {
  return {
    role: "assistant",
    provider: "fixture-provider",
    model: "fixture-model",
    content: [{ type: "text", text: content }],
    stopReason: "stop",
    timestamp,
  };
}

export function toolResultMessage(callId, content, timestamp = 1001) {
  return {
    role: "toolResult",
    toolCallId: callId,
    toolName: "read",
    content: [{ type: "text", text: content }],
    isError: false,
    timestamp,
  };
}

function page(messages, entryIds, previousCursor) {
  return {
    context: { messages, entryIds, historyRevision: "history-revision", previousCursor },
    truncated: false,
  };
}

const MESSAGES = [
  userMessage(FIRST_QUESTION, 1),
  assistantMessage(FIRST_ANSWER, 2),
  userMessage(SECOND_QUESTION, 3),
  assistantMessage(SECOND_ANSWER, 4),
  userMessage(THIRD_QUESTION, 5),
  assistantMessage(THIRD_ANSWER, 6),
];

const ENTRY_IDS = MESSAGES.map((_message, index) => `entry-${index + 1}`);

export function fivePageHistory(id = "five-page-history") {
  const detail = createSessionDetail(id, {
    messages: MESSAGES.slice(4),
    entryIds: ENTRY_IDS.slice(4),
    previousCursor: "page-4",
    historyRevision: "history-revision",
    stats: {
      userMessages: 3,
      assistantMessages: 3,
      toolCalls: 0,
      toolResults: 0,
      totalMessages: 6,
      tokens: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
      cost: 0,
    },
  });
  const pages = {
    "page-4": page([MESSAGES[3]], [ENTRY_IDS[3]], "page-3"),
    "page-3": page([MESSAGES[2]], [ENTRY_IDS[2]], "page-2"),
    "page-2": page([MESSAGES[1]], [ENTRY_IDS[1]], "page-1"),
    "page-1": page([MESSAGES[0]], [ENTRY_IDS[0]], null),
  };
  return { detail, pages };
}

export const MID_TURN_QUESTION = "Please check the parser.";
export const MID_TURN_PREAMBLE = "I will read the parser first.";
export const MID_TURN_ANSWER = "The parser drops empty lines.";
export const MID_TURN_TOOL_OUTPUT = "parser.ts has 42 lines.";
export const MID_TURN_CALL_ID = "call-read-parser";

// The newest page begins inside one turn: its tool result arrives before the
// reply that made the call, and the older page holds the rest of that turn.
export function splitTurnHistory(id = "split-turn-history") {
  const detail = createSessionDetail(id, {
    messages: [toolResultMessage(MID_TURN_CALL_ID, MID_TURN_TOOL_OUTPUT, 3), assistantMessage(MID_TURN_ANSWER, 4)],
    entryIds: ["entry-3", "entry-4"],
    previousCursor: "page-1",
    historyRevision: "history-revision",
  });
  const pages = {
    "page-1": page(
      [
        userMessage(MID_TURN_QUESTION, 1),
        {
          role: "assistant",
          provider: "fixture-provider",
          model: "fixture-model",
          content: [
            { type: "text", text: MID_TURN_PREAMBLE },
            { type: "toolCall", toolCallId: MID_TURN_CALL_ID, toolName: "read", input: { path: "parser.ts" } },
          ],
          stopReason: "toolUse",
          timestamp: 2,
        },
      ],
      ["entry-1", "entry-2"],
      null,
    ),
  };
  return { detail, pages };
}

export function pagesHost(pages) {
  return {
    getSessionContextPage: async (_sid, cursor) => {
      const reply = pages[cursor];
      if (!reply) throw new Error(`No fixture page for cursor ${cursor}`);
      return reply;
    },
  };
}
