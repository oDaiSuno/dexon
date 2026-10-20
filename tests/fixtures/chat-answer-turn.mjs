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

export function silentAbortTurn(id = "answer-new-session-silent-abort") {
  return turnDetail(id, [
    userTurn(),
    assistantReply([readStep("call-read-1", "src/app.ts")], "aborted", 1006),
    toolOutput("call-read-1", TOOL_OUTPUT, 1007),
  ]);
}
