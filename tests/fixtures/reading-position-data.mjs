import { createSessionDetail } from "../../src/renderer/hooks/agent-session/session-hook-fixtures.mjs";
import { navigationPaths } from "./app-navigation-data.mjs";

const pad = (turn) => String(turn).padStart(2, "0");

export function questionMarker(id, turn) {
  return `Question ${pad(turn)} of ${id}`;
}

export function answerMarker(id, turn) {
  return `Answer ${pad(turn)} of ${id}`;
}

function userTurn(id, turn, prefix) {
  return {
    role: "user",
    content: prefix ? `${prefix} question ${pad(turn)} of ${id}` : questionMarker(id, turn),
    timestamp: turn * 10,
  };
}

function assistantTurn(id, turn, prefix) {
  return {
    role: "assistant",
    content: [{ type: "text", text: prefix ? `${prefix} answer ${pad(turn)} of ${id}` : answerMarker(id, turn) }],
    provider: "fixture",
    model: "fixture-model",
    stopReason: "stop",
    timestamp: turn * 10 + 1,
  };
}

export function messageText(message) {
  if (typeof message.content === "string") return message.content;
  return (message.content ?? [])
    .filter((block) => block.type === "text")
    .map((block) => block.text)
    .join("\n");
}

const conversationMarkers = new WeakMap();

/**
 * One conversation whose turns are split into pages of `pageTurns`, so a
 * reader can leave it in the middle of an earlier page. The newest page is the
 * session detail itself; `detail.pages` answers `sessions.contextPage` for the
 * cursors named by `previousCursor`.
 */
export function readingConversation(
  id,
  { name, turns, pageTurns, cwd = navigationPaths.personal, parentSessionId, extraMessages = [], wording = "" } = {},
) {
  const key = wording ? `${id}-${wording.toLowerCase()}` : id;
  const bounds = [];
  for (let end = turns; end >= 1; end -= pageTurns) bounds.push([Math.max(1, end - pageTurns + 1), end]);
  const page = ([from, to]) => {
    const messages = [];
    const entryIds = [];
    for (let turn = from; turn <= to; turn += 1) {
      messages.push(userTurn(id, turn, wording), assistantTurn(id, turn, wording));
      entryIds.push(`${key}-q-${pad(turn)}`, `${key}-a-${pad(turn)}`);
    }
    return { messages, entryIds };
  };
  const newest = page(bounds[0]);
  newest.messages.push(...structuredClone(extraMessages));
  newest.entryIds.push(...extraMessages.map((_, index) => `${id}-extra-${index}`));
  const revision = `${key}-revision`;
  const pages = {};
  for (let index = 1; index < bounds.length; index += 1) {
    const older = page(bounds[index]);
    pages[`${key}-page-${index}`] = {
      context: {
        messages: older.messages,
        entryIds: older.entryIds,
        historyRevision: revision,
        previousCursor: index + 1 < bounds.length ? `${key}-page-${index + 1}` : null,
      },
      truncated: false,
    };
  }
  const markers = bounds
    .slice()
    .reverse()
    .flatMap((bound) => page(bound).messages)
    .concat(structuredClone(extraMessages))
    .map(messageText);
  const detail = createSessionDetail(id, {
    cwd,
    messages: newest.messages,
    entryIds: newest.entryIds,
    historyRevision: revision,
    previousCursor: bounds.length > 1 ? `${key}-page-1` : null,
    totalMessages: markers.length,
    ...(name ? { name } : {}),
  });
  Object.assign(detail.info, {
    projectRoot: cwd,
    ...(parentSessionId ? { parentSessionId } : {}),
    created: "2026-08-02T08:00:00.000Z",
    modified: "2026-09-07T10:00:00.000Z",
    firstMessage: markers[0],
    messageCount: markers.length,
  });
  detail.context.loadedMessages = newest.messages.length;
  detail.pages = pages;
  conversationMarkers.set(detail, markers);
  return detail;
}

export function markersOf(...details) {
  return details.flatMap((detail) => conversationMarkers.get(detail) ?? detail.context.messages.map(messageText));
}
