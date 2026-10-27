import fs from "node:fs";
import path from "node:path";

export const readingPositionScenes = [
  "01-first-open",
  "02-sidebar-return",
  "03-resources-return",
  "04-settings-return",
  "05-deep-link-return",
  "06-earlier-page-return",
  "07-independent",
  "08-child-from-parent-link",
];

export const longReadingTitle = "Long reading A";
export const parentReadingTitle = "Parent reading P";
export const parentReadingQuestion = "Where did the long reading stop?";
export const parentReadingReply = "The child conversation holds the long reading.";
export const shortReadingTitle = "Short reading B";
export const longReadingQuestions = 55;
export const shortReadingQuestions = 12;
export const minimumSessionBytes = 4 * 1024 * 1024;

const pad = (value) => String(value).padStart(2, "0");
const PROSE = [
  "The reader leaves one conversation in the middle and expects to find the same sentence in the same place",
  "Heights change when the window widens, so the position is remembered as a sentence rather than as a number",
  "Every answer below is deliberately tall enough that several of them fill the window many times over",
  "Older pages arrive on demand, which is why a remembered sentence may not be on screen straight away",
  "A reply that grows while the reader is away must not pull the viewport towards the newest line",
  "The way back to the newest content is the arrow at the bottom, not an automatic jump",
  "Scrolling with a real wheel is the input this check uses, because programmatic scrolling hides the policy",
];
const CODE = [
  "const register = (id, position) => positions.set(id, position);",
  "const read = (id) => positions.get(id) ?? null;",
  "for (const [id, record] of positions) offsets.push(record.offsetTop);",
  "if (target.entryId !== record.entryId) return continueOlder();",
  "scrollTop += element.getBoundingClientRect().top - container.getBoundingClientRect().top - offsetTop;",
];

function sentence(turn, index, line) {
  const first = PROSE[(turn + index + line) % PROSE.length];
  const second = PROSE[(turn + index + line + 3) % PROSE.length];
  return `${first}, ${second.charAt(0).toLowerCase()}${second.slice(1)} (${pad(turn)}-${pad(index)}-${pad(line)}).`;
}

function paragraph(turn, index) {
  const lines = [];
  const count = 10 + ((turn + index) % 9);
  for (let line = 1; line <= count; line += 1) lines.push(sentence(turn, index, line));
  return lines.join(" ");
}

function bulletList(turn, index) {
  const items = [];
  for (let item = 1; item <= 6; item += 1) items.push(`- ${sentence(turn, index, item)}`);
  return items.join("\n");
}

function codeBlock(turn, index) {
  const lines = [];
  for (let line = 0; line < 6; line += 1) lines.push(CODE[(turn + index + line) % CODE.length]);
  return ["```ts", ...lines, "```"].join("\n");
}

export function questionLine(title, turn) {
  return `Question ${pad(turn)} of ${title}`;
}

function answerBody(title, turn) {
  const blocks = [`Answer ${pad(turn)} of ${title} — the reply starts here.`];
  for (let index = 1; index <= 26; index += 1) {
    blocks.push(paragraph(turn, index));
    if (index % 3 === 0) blocks.push(bulletList(turn, index));
    if (index % 4 === 0) blocks.push(codeBlock(turn, index));
  }
  return blocks.join("\n\n");
}

function assistantReply(title, turn) {
  return {
    role: "assistant",
    content: [{ type: "text", text: answerBody(title, turn) }],
    api: "openai-responses",
    provider: "reading-position-fixture",
    model: "offline-reading",
    usage: {
      input: 0,
      output: 0,
      cacheRead: 0,
      cacheWrite: 0,
      totalTokens: 0,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
    },
    stopReason: "stop",
    timestamp: turn * 2,
  };
}

function textReply(text, timestamp) {
  return {
    role: "assistant",
    content: [{ type: "text", text }],
    api: "openai-responses",
    provider: "reading-position-fixture",
    model: "offline-reading",
    usage: {
      input: 0,
      output: 0,
      cacheRead: 0,
      cacheWrite: 0,
      totalTokens: 0,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
    },
    stopReason: "stop",
    timestamp,
  };
}

function sessionNewCall() {
  return {
    role: "assistant",
    content: [
      {
        type: "toolCall",
        toolCallId: "parent-session-new-call",
        toolName: "session_new",
        input: { message: parentReadingQuestion },
      },
    ],
    api: "openai-responses",
    provider: "reading-position-fixture",
    model: "offline-reading",
    usage: {
      input: 0,
      output: 0,
      cacheRead: 0,
      cacheWrite: 0,
      totalTokens: 0,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
    },
    stopReason: "toolUse",
    timestamp: 2,
  };
}

function sessionNewResult(childId, title) {
  return {
    role: "toolResult",
    toolCallId: "parent-session-new-call",
    toolName: "session_new",
    content: [{ type: "text", text: `Started ${title}.` }],
    details: { targetSessionId: childId, targetTitle: title },
    isError: false,
    timestamp: 3,
  };
}

function fillConversation(history, title, turns) {
  for (let turn = 1; turn <= turns; turn += 1) {
    history.appendMessage({ role: "user", content: questionLine(title, turn), timestamp: turn * 2 - 1 });
    history.appendMessage(assistantReply(title, turn));
  }
  history.appendSessionInfo(title);
}

export async function seedReadingPositionSessions() {
  const home = process.env.PI_DESKTOP_SMOKE_HOME;
  const agent = process.env.PI_CODING_AGENT_DIR;
  const sessions = process.env.PI_CODING_AGENT_SESSION_DIR;
  if (
    !home ||
    home !== process.env.HOME ||
    !path.isAbsolute(home) ||
    !agent ||
    !path.isAbsolute(agent) ||
    !sessions ||
    !path.isAbsolute(sessions)
  ) {
    throw new Error("Reading position requires disposable smoke home, Agent and session directories");
  }
  const personal = path.join(home, ".dexon");
  const { SessionManager } = await import("@earendil-works/pi-coding-agent");
  const parent = SessionManager.create(personal, sessions);
  parent.appendMessage({ role: "user", content: parentReadingQuestion, timestamp: 1 });
  // The Host derives a child's parent from the session header's `parentSession`
  // path (src/agent-host/session-index.ts), which SessionManager writes here.
  const long = SessionManager.create(personal, sessions, { parentSession: parent.getSessionFile() });
  fillConversation(long, longReadingTitle, longReadingQuestions);
  const longId = long.getSessionId();
  const longFile = long.getSessionFile();
  const longBytes = fs.statSync(longFile).size;
  if (longBytes < minimumSessionBytes)
    throw new Error(`The long conversation must exceed ${minimumSessionBytes} bytes; it is ${longBytes}`);
  parent.appendMessage(sessionNewCall());
  parent.appendMessage(sessionNewResult(longId, longReadingTitle));
  parent.appendMessage(textReply(parentReadingReply, 4));
  parent.appendSessionInfo(parentReadingTitle);
  const short = SessionManager.create(personal, sessions);
  fillConversation(short, shortReadingTitle, shortReadingQuestions);
  return {
    personal,
    longId,
    longFile,
    longBytes,
    parentId: parent.getSessionId(),
    parentFile: parent.getSessionFile(),
    shortId: short.getSessionId(),
    shortFile: short.getSessionFile(),
  };
}
