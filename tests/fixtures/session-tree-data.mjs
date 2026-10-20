import { createSessionDetail } from "../../src/renderer/hooks/agent-session/session-hook-fixtures.mjs";
import { navigationPaths } from "./app-navigation-data.mjs";

// Hand-authored session details for the orchestrated-session tree: the answer
// a Host gives when it lists or reads these sessions. Timestamps are relative
// to the moment the test runs, so date-group membership stays meaningful.

export function minutesAgo(minutes) {
  return new Date(Date.now() - minutes * 60_000).toISOString();
}

export function daysAgo(days) {
  return minutesAgo(days * 24 * 60);
}

function withInfo(detail, info) {
  Object.assign(detail.info, info);
  detail.context.totalMessages = detail.context.messages.length;
  detail.context.loadedMessages = detail.context.messages.length;
  return detail;
}

// A conversation as the sidebar lists it. Only the fields the tree, grouping
// and status rules speak about are given distinct values.
export function treeSession(id, options = {}) {
  const cwd = options.cwd ?? navigationPaths.personal;
  const marker = `${id} marker`;
  const messages = [
    { role: "user", content: marker, timestamp: 1 },
    {
      role: "assistant",
      content: [{ type: "text", text: `${id} reply` }],
      provider: "fixture",
      model: "fixture-model",
      stopReason: "stop",
      timestamp: 2,
    },
  ];
  const detail = createSessionDetail(id, {
    cwd,
    messages,
    entryIds: [`${id}-user`, `${id}-assistant`],
  });
  return withInfo(detail, {
    projectRoot: cwd,
    ...(options.name ? { name: options.name } : {}),
    created: options.created ?? daysAgo(10),
    modified: options.modified ?? daysAgo(10),
    firstMessage: marker,
    messageCount: messages.length,
    ...(options.parentSessionId ? { parentSessionId: options.parentSessionId } : {}),
    ...(options.relation ? { relation: options.relation } : {}),
    ...(options.createdBySessionId ? { createdBySessionId: options.createdBySessionId } : {}),
  });
}

// A conversation whose user bubble came from another session.
export function sourceConversation(id, options) {
  const messages = [
    {
      role: "user",
      content: options.text,
      sessionSource: { sessionId: options.from, title: options.fromTitle },
      timestamp: 1,
    },
    {
      role: "assistant",
      content: [{ type: "text", text: options.reply }],
      provider: "fixture",
      model: "fixture-model",
      stopReason: "stop",
      timestamp: 2,
    },
  ];
  const detail = createSessionDetail(id, {
    cwd: navigationPaths.personal,
    messages,
    entryIds: [`${id}-user`, `${id}-assistant`],
  });
  return withInfo(detail, {
    projectRoot: navigationPaths.personal,
    name: options.name,
    created: daysAgo(1),
    modified: minutesAgo(5),
    firstMessage: options.text,
    messageCount: messages.length,
  });
}

// A finished turn that created another session: the tool result carries the
// target session in `details`, exactly as the session tools report it.
export function delegateToolConversation(id, options) {
  const messages = [
    { role: "user", content: options.text, timestamp: 1 },
    {
      role: "assistant",
      content: [
        {
          type: "toolCall",
          toolCallId: `${id}-call`,
          toolName: "session_new",
          input: { message: "Start the migration" },
        },
      ],
      provider: "fixture",
      model: "fixture-model",
      stopReason: "toolUse",
      timestamp: 2,
    },
    {
      role: "toolResult",
      toolCallId: `${id}-call`,
      toolName: "session_new",
      content: [{ type: "text", text: "Started the migration in another session" }],
      details: { targetSessionId: options.target, targetTitle: options.targetTitle },
      isError: false,
      timestamp: 3,
    },
    {
      role: "assistant",
      content: [{ type: "text", text: options.reply }],
      provider: "fixture",
      model: "fixture-model",
      stopReason: "stop",
      timestamp: 4,
    },
  ];
  const detail = createSessionDetail(id, {
    cwd: navigationPaths.personal,
    messages,
    entryIds: [`${id}-user`, `${id}-call`, `${id}-call-result`, `${id}-answer`],
  });
  return withInfo(detail, {
    projectRoot: navigationPaths.personal,
    name: options.name,
    created: daysAgo(1),
    modified: minutesAgo(5),
    firstMessage: options.text,
    messageCount: messages.length,
  });
}
