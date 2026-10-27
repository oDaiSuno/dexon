import { buildSessionHistoryPage, decodeHistoryCursor } from "../../src/agent-host/session-history.ts";
import { computeSessionStats } from "../../src/agent-host/session-stats.ts";

const SESSION_ID = "native-long-history";
const HISTORY_REVISION = "native-history";
const HISTORY_WINDOW = { maxTurns: 20, maxBytes: 1024 * 1024 };

export const QUESTION_COUNT = 100;

const FILLER = "The read tool returned the following lines of the parser for this step. ";

export function question(nn) {
  return `Question ${nn}: which part of the transcript does this turn explain?`;
}

export function turnName(index) {
  return `Turn ${index + 1}: ${question(String(index + 1).padStart(2, "0"))}`;
}

function toolOutput(nn, step) {
  return `tool output for Question ${nn} step ${step}: ${FILLER.repeat(380)}`;
}

function answer(nn) {
  return [
    `Answer ${nn} opens with what the turn changed.`,
    `Answer ${nn} then explains how the parser reads the file.`,
    `Answer ${nn} closes with the checks that were run.`,
    `Answer ${nn} is the closing summary for this turn.`,
  ].join("\n\n");
}

function buildEntries() {
  const entries = [];
  let parentId = null;
  const stamp = () => new Date(Date.UTC(2026, 0, 1, 0, 0, entries.length)).toISOString();
  const push = (message) => {
    const id = `entry-${entries.length}`;
    entries.push({ type: "message", id, parentId, timestamp: stamp(), message });
    parentId = id;
  };
  for (let index = 1; index <= QUESTION_COUNT; index += 1) {
    const nn = String(index).padStart(2, "0");
    push({ role: "user", content: question(nn), timestamp: index * 10 + 1 });
    push({
      role: "assistant",
      content: [
        { type: "text", text: `Reading the files for Question ${nn}.` },
        ...[1, 2, 3].map((step) => ({
          type: "toolCall",
          toolCallId: `call-${nn}-${step}`,
          toolName: "read",
          input: { path: `src/part-${nn}-${step}.ts` },
        })),
      ],
      provider: "provider",
      model: "model",
      stopReason: "toolUse",
      timestamp: index * 10 + 2,
    });
    for (const step of [1, 2, 3]) {
      push({
        role: "toolResult",
        toolCallId: `call-${nn}-${step}`,
        toolName: "read",
        content: [{ type: "text", text: toolOutput(nn, step) }],
        isError: false,
        timestamp: index * 10 + 3,
      });
    }
    push({
      role: "assistant",
      content: [{ type: "text", text: answer(nn) }],
      provider: "provider",
      model: "model",
      stopReason: "stop",
      timestamp: index * 10 + 4,
    });
  }
  return entries;
}

// The transcript is paged by the shipped paginator, so a page boundary can cut
// a turn in half exactly as it does in a real long conversation.
export function buildHistory() {
  const entries = buildEntries();
  const leafId = entries.at(-1).id;
  const newest = buildSessionHistoryPage({
    entries,
    leafId,
    historyWindow: HISTORY_WINDOW,
    historyRevision: HISTORY_REVISION,
  });
  const pages = {};
  const pageFirstRoles = [newest.messages[0]?.role ?? null];
  let cursor = newest.previousCursor;
  while (cursor) {
    const older = buildSessionHistoryPage({
      entries,
      leafId,
      historyWindow: HISTORY_WINDOW,
      historyRevision: HISTORY_REVISION,
      cursor: decodeHistoryCursor(cursor),
    });
    pages[cursor] = { context: older, truncated: false };
    pageFirstRoles.push(older.messages[0]?.role ?? null);
    cursor = older.previousCursor;
    if (pageFirstRoles.length > 200) throw new Error("history paging never reached the start of the conversation");
  }
  const detail = {
    sessionId: SESSION_ID,
    filePath: `/fixture/${SESSION_ID}.jsonl`,
    info: {
      id: SESSION_ID,
      path: `/fixture/${SESSION_ID}.jsonl`,
      cwd: "/fixture",
      created: "",
      modified: "",
      messageCount: entries.length,
      firstMessage: question("01"),
    },
    leafId,
    tree: [],
    stats: computeSessionStats(entries),
    context: newest,
    agentState: { running: false },
  };
  return {
    payload: { detail, pages },
    entries: entries.length,
    bytes: entries.reduce((total, entry) => total + Buffer.byteLength(JSON.stringify(entry), "utf8"), 0),
    olderPages: Object.keys(pages).length,
    pageFirstRoles,
  };
}
