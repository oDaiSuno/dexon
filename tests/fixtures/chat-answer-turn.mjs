import { createSessionDetail } from "../../src/renderer/hooks/agent-session/session-hook-fixtures.mjs";

export const QUESTION = "帮我看看这个项目有什么问题。";
export const OPENING = "我先检查项目。";
export const MIDWAY = "已经找到问题所在。";
export const CONCLUSION = "这是最终结论。";
export const FOLLOW_UP_QUESTION = "那第二处问题呢？";
export const SECOND_ANSWER = "第二处问题也修好了。";
export const ANALYSIS = "分析修改方案：\n先复现问题，再修改代码。";
export const REANALYSIS = "再确认一次修改范围：\n只改消息渲染这一处。";
export const TOOL_OUTPUT = "src/app.ts 共 42 行，第 12 行没有空值判断。";
export const SECOND_TOOL_OUTPUT = "src/main.ts 共 18 行，没有发现问题。";
export const FAILURE_DETAIL = "上游返回 401：密钥无效";

export const ANSWER_TEXTS = [OPENING, MIDWAY, CONCLUSION];

export function textBlock(value) {
  return { type: "text", text: value };
}

export function thinkingBlock(value) {
  return { type: "thinking", thinking: value };
}

export function readStep(callId = "call-read-1", path = "src/app.ts") {
  return { type: "toolCall", toolCallId: callId, toolName: "read", input: { path } };
}

export function assistantReply(content, stopReason = "stop", timestamp = 1008) {
  return {
    role: "assistant",
    provider: "fixture-provider",
    model: "fixture-model",
    content,
    stopReason,
    timestamp,
  };
}

export function userTurn() {
  return { role: "user", content: QUESTION, timestamp: 1000 };
}

export function followUpUserTurn() {
  return { role: "user", content: FOLLOW_UP_QUESTION, timestamp: 1001 };
}

export function toolOutput(callId, value, timestamp = 1009) {
  return {
    role: "toolResult",
    toolCallId: callId,
    toolName: "read",
    content: [textBlock(value)],
    isError: false,
    timestamp,
  };
}

export function turnDetail(id, messages) {
  return createSessionDetail(id, {
    messages,
    entryIds: messages.map((_message, index) => `${id}-entry-${index}`),
  });
}

export function interleavedSingleMessageTurn(id = "answer-visibility-one-message") {
  return turnDetail(id, [
    userTurn(),
    assistantReply([
      textBlock(OPENING),
      readStep("call-read-1", "src/app.ts"),
      textBlock(MIDWAY),
      thinkingBlock(ANALYSIS),
      textBlock(CONCLUSION),
    ]),
    toolOutput("call-read-1", TOOL_OUTPUT),
  ]);
}

export function interleavedMultiMessageTurn(id = "answer-visibility-many-messages") {
  return turnDetail(id, [
    userTurn(),
    assistantReply([textBlock(OPENING), readStep("call-read-1", "src/app.ts")], "toolUse", 1004),
    toolOutput("call-read-1", TOOL_OUTPUT, 1005),
    assistantReply([textBlock(MIDWAY), thinkingBlock(ANALYSIS), textBlock(CONCLUSION)], "stop", 1012),
  ]);
}

export function toolEndedTurn(id = "answer-visibility-tool-ended") {
  return turnDetail(id, [
    userTurn(),
    assistantReply([textBlock(OPENING), readStep("call-read-1", "src/app.ts")], "toolUse", 1004),
    toolOutput("call-read-1", TOOL_OUTPUT, 1005),
  ]);
}

export function abortedTurn(id = "answer-visibility-aborted") {
  return turnDetail(id, [
    userTurn(),
    assistantReply([textBlock(OPENING), readStep("call-read-1", "src/app.ts")], "toolUse", 1004),
    toolOutput("call-read-1", TOOL_OUTPUT, 1005),
    assistantReply([textBlock(MIDWAY), readStep("call-read-2", "src/main.ts")], "aborted", 1010),
  ]);
}

export function consecutiveProcessInOneMessageTurn(id = "answer-visibility-process-one-message") {
  return turnDetail(id, [
    userTurn(),
    assistantReply(
      [thinkingBlock(ANALYSIS), readStep("call-read-1", "src/app.ts"), thinkingBlock(REANALYSIS)],
      "toolUse",
      1004,
    ),
    toolOutput("call-read-1", TOOL_OUTPUT, 1005),
  ]);
}

export function consecutiveProcessAcrossMessagesTurn(id = "answer-visibility-process-many-messages") {
  return turnDetail(id, [
    userTurn(),
    assistantReply([thinkingBlock(ANALYSIS), readStep("call-read-1", "src/app.ts")], "toolUse", 1004),
    toolOutput("call-read-1", TOOL_OUTPUT, 1005),
    assistantReply([thinkingBlock(REANALYSIS), readStep("call-read-2", "src/main.ts")], "toolUse", 1008),
    toolOutput("call-read-2", SECOND_TOOL_OUTPUT, 1009),
  ]);
}

export function plainReplyTurn(id = "answer-visibility-plain-reply") {
  return turnDetail(id, [userTurn(), assistantReply([textBlock(CONCLUSION)])]);
}

export function failedTurn(id = "answer-visibility-failed") {
  return turnDetail(id, [
    userTurn(),
    assistantReply([textBlock(OPENING), readStep("call-read-1", "src/app.ts")], "toolUse", 1004),
    toolOutput("call-read-1", TOOL_OUTPUT, 1005),
    { ...assistantReply([], "error", 1006), errorMessage: FAILURE_DETAIL },
    assistantReply([textBlock(CONCLUSION)], "stop", 1012),
  ]);
}

export function twoAnsweredTurns(id = "answer-new-session-two-turns") {
  return turnDetail(id, [
    userTurn(),
    assistantReply([textBlock(OPENING)], "stop", 1004),
    followUpUserTurn(),
    assistantReply([textBlock(SECOND_ANSWER)], "stop", 1008),
  ]);
}

export function toolThenAnswerTurn(id = "answer-new-session-tool-then-answer") {
  return turnDetail(id, [
    userTurn(),
    assistantReply([textBlock(OPENING), readStep("call-read-1", "src/app.ts")], "toolUse", 1004),
    toolOutput("call-read-1", TOOL_OUTPUT, 1005),
    assistantReply([textBlock(CONCLUSION)], "stop", 1012),
  ]);
}

export function failureOnlyTurn(id = "answer-new-session-failure-only") {
  return turnDetail(id, [userTurn(), { ...assistantReply([], "error", 1006), errorMessage: FAILURE_DETAIL }]);
}

export function usageOf(input, output, cacheRead, total) {
  return {
    input,
    output,
    cacheRead,
    cacheWrite: 0,
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total },
  };
}

export const T0 = Date.parse("2026-01-01T09:00:00.000Z");
export const at = (seconds) => T0 + seconds * 1000;

function timedQuestion() {
  return { ...userTurn(), timestamp: at(0) };
}

export function timedInterleavedTurn(id = "answer-footer-timed-interleaved") {
  return turnDetail(id, [
    timedQuestion(),
    {
      ...assistantReply([textBlock(OPENING), readStep("call-read-1")], "toolUse", at(4)),
      usage: usageOf(1000, 200, 300, 0.01),
    },
    toolOutput("call-read-1", TOOL_OUTPUT, at(16)),
    {
      ...assistantReply([textBlock(MIDWAY), thinkingBlock(ANALYSIS), textBlock(CONCLUSION)], "stop", at(56)),
      usage: usageOf(2000, 400, 500, 0.025),
    },
  ]);
}

export function timedSingleGroupTurn(id = "answer-footer-timed-single-group") {
  return turnDetail(id, [
    timedQuestion(),
    assistantReply([textBlock(OPENING), readStep("call-read-1")], "toolUse", at(3)),
    toolOutput("call-read-1", TOOL_OUTPUT, at(12)),
    assistantReply([textBlock(CONCLUSION)], "stop", at(30)),
  ]);
}

export function timedToolEndedTurn(id = "answer-footer-timed-tool-ended") {
  return turnDetail(id, [
    timedQuestion(),
    {
      ...assistantReply([textBlock(OPENING), readStep("call-read-1")], "toolUse", at(5)),
      usage: usageOf(700, 50, 0, 0.002),
    },
    toolOutput("call-read-1", TOOL_OUTPUT, at(9)),
    assistantReply([thinkingBlock(ANALYSIS), readStep("call-read-2", "src/main.ts")], "toolUse", at(14)),
    toolOutput("call-read-2", SECOND_TOOL_OUTPUT, at(20)),
  ]);
}

export function timedFailureThenAnswerTurn(id = "answer-footer-failure-usage") {
  return turnDetail(id, [
    timedQuestion(),
    { ...assistantReply([], "error", at(2)), errorMessage: FAILURE_DETAIL, usage: usageOf(100, 0, 0, 0.001) },
    { ...assistantReply([textBlock(CONCLUSION)], "stop", at(8)), usage: usageOf(900, 80, 0, 0.004) },
  ]);
}

export function failureOnlyWithUsageTurn(id = "answer-footer-failure-only") {
  return turnDetail(id, [
    timedQuestion(),
    { ...assistantReply([], "error", at(2)), errorMessage: FAILURE_DETAIL, usage: usageOf(100, 0, 0, 0.001) },
  ]);
}

export function silentAbortTurn(id = "answer-new-session-silent-abort") {
  return turnDetail(id, [
    userTurn(),
    assistantReply([readStep("call-read-1", "src/app.ts")], "aborted", 1006),
    toolOutput("call-read-1", TOOL_OUTPUT, 1007),
  ]);
}

export function timedBlocksTurn(id = "answer-timing-blocks") {
  return turnDetail(id, [
    timedQuestion(),
    {
      ...assistantReply([thinkingBlock(ANALYSIS), readStep("call-read-1")], "toolUse", at(30)),
      dexonTiming: {
        blocks: [
          { startedAt: at(1), endedAt: at(20) },
          { startedAt: at(20), endedAt: at(30) },
        ],
      },
    },
    toolOutput("call-read-1", TOOL_OUTPUT, at(32)),
    {
      ...assistantReply([thinkingBlock(REANALYSIS), textBlock(CONCLUSION)], "stop", at(65)),
      dexonTiming: {
        blocks: [
          { startedAt: at(33), endedAt: at(40) },
          { startedAt: at(40), endedAt: at(65) },
        ],
      },
    },
  ]);
}

export function untimedBlocksTurn(id = "answer-timing-legacy") {
  return turnDetail(id, [
    timedQuestion(),
    assistantReply([thinkingBlock(ANALYSIS), readStep("call-read-1")], "toolUse", at(30)),
    toolOutput("call-read-1", TOOL_OUTPUT, at(40)),
    assistantReply([thinkingBlock(REANALYSIS), textBlock(CONCLUSION)], "stop", at(65)),
  ]);
}

export function timedToolEndedBlocksTurn(id = "answer-timing-tool-ended") {
  return turnDetail(id, [
    timedQuestion(),
    {
      ...assistantReply([thinkingBlock(ANALYSIS), readStep("call-read-1")], "toolUse", at(25)),
      dexonTiming: {
        blocks: [
          { startedAt: at(1), endedAt: at(20) },
          { startedAt: at(20), endedAt: at(25) },
        ],
      },
    },
    toolOutput("call-read-1", TOOL_OUTPUT, at(32)),
  ]);
}

export function retriedBlocksTurn(id = "answer-timing-retried") {
  return turnDetail(id, [
    timedQuestion(),
    assistantReply([thinkingBlock(ANALYSIS), readStep("call-read-1")], "toolUse", at(10)),
    toolOutput("call-read-1", TOOL_OUTPUT, at(12)),
    { ...assistantReply([], "error", at(13)), errorMessage: FAILURE_DETAIL },
    assistantReply([thinkingBlock(REANALYSIS), readStep("call-read-2", "src/main.ts")], "toolUse", at(30)),
    toolOutput("call-read-2", SECOND_TOOL_OUTPUT, at(31)),
    assistantReply([textBlock(CONCLUSION)], "stop", at(40)),
  ]);
}
