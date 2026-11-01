import { createHash } from "node:crypto";
import { statSync } from "node:fs";
import type { HistoryWindow, PagedContextInfo, TurnOutlineItem } from "../contract/types";
import type { ImageContent, SessionEntry, TextContent, ThinkingContent, ToolCallContent } from "../shared/types";
import { turnTitleOf } from "../shared/turn-title";
import { buildSessionContext, entryToUiMessage } from "./session-reader";
import type { ChosenSessionModel } from "./session-model";
import { branchAt, type SessionBranch } from "./session-branch";
import { deferNewestMessage, fitUnitToBudget, measureItems } from "./session-history-budget";
import {
  attachRetryOutcomes,
  projectDisplayMessages,
  withoutModelOnlyBlock,
  type ProjectedMessage,
} from "./session-display-projection";
import { versionsByEntryId } from "./session-versions";

const DEFAULT_MAX_TURNS = 20;
const DEFAULT_MAX_BYTES = 1024 * 1024;
const RESPONSE_OVERHEAD_BYTES = 2048;

interface HistoryCursorPayload {
  version: 1;
  historyRevision: string;
  anchorLeafId: string;
  beforeEntryId: string;
  anchorPathLength: number;
}

interface MessageUnit {
  turnIndex: number;
  items: ProjectedMessage[];
}

export class StaleHistoryCursorError extends Error {
  constructor(message = "Session history changed; reload the latest page") {
    super(message);
    this.name = "StaleHistoryCursorError";
  }
}

export function buildHistoryRevision(filePath: string, sessionId: string): string {
  const stat = statSync(filePath);
  const identity = `${sessionId}:${stat.dev}:${stat.ino}:${stat.birthtimeMs}`;
  return createHash("sha256").update(identity).digest("base64url").slice(0, 18);
}

export function buildUnsavedHistoryRevision(sessionId: string): string {
  return createHash("sha256").update(`${sessionId}:unsaved`).digest("base64url").slice(0, 18);
}

export function encodeHistoryCursor(payload: HistoryCursorPayload): string {
  return Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
}

export function decodeHistoryCursor(cursor: string): HistoryCursorPayload {
  try {
    const value = JSON.parse(Buffer.from(cursor, "base64url").toString("utf8")) as Partial<HistoryCursorPayload>;
    if (
      value.version !== 1 ||
      typeof value.historyRevision !== "string" ||
      typeof value.anchorLeafId !== "string" ||
      typeof value.beforeEntryId !== "string" ||
      !Number.isSafeInteger(value.anchorPathLength) ||
      (value.anchorPathLength ?? 0) < 1
    ) {
      throw new Error("invalid shape");
    }
    return value as HistoryCursorPayload;
  } catch {
    throw new Error("Invalid session history cursor");
  }
}

function groupTurns(messages: ProjectedMessage[]): ProjectedMessage[][] {
  const turns: ProjectedMessage[][] = [];
  let current: ProjectedMessage[] = [];
  for (const item of messages) {
    if (item.message.role === "user" && current.some((candidate) => candidate.message.role === "user")) {
      turns.push(current);
      current = [];
    }
    current.push(item);
  }
  if (current.length > 0) turns.push(current);
  return turns;
}

function buildUnits(turns: ProjectedMessage[][]): MessageUnit[] {
  const units: MessageUnit[] = [];
  turns.forEach((turn, turnIndex) => {
    for (const item of turn) {
      const previous = units.at(-1);
      if (previous && item.message.role === "toolResult") {
        previous.items.push(item);
        continue;
      }
      units.push({ turnIndex, items: [item] });
    }
  });
  return units;
}

function turnOutlineOf(messages: ProjectedMessage[]): TurnOutlineItem[] {
  return messages.flatMap((item) =>
    item.message.role === "user" ? [{ entryId: item.entryId, title: turnTitleOf(item.message.content) }] : [],
  );
}

function packPage(units: MessageUnit[], maxTurns: number, maxBytes: number): ProjectedMessage[] {
  const newestTurn = units.at(-1)?.turnIndex ?? 0;
  const selected: ProjectedMessage[] = [];
  let selectedBytes = 0;
  for (let index = units.length - 1; index >= 0; index -= 1) {
    const unit = units[index];
    if (newestTurn - unit.turnIndex + 1 > maxTurns) break;
    const remaining = maxBytes - RESPONSE_OVERHEAD_BYTES - selectedBytes;
    if (remaining <= 0) break;
    const fitted = fitUnitToBudget(unit.items, remaining);
    if (!fitted) {
      if (selected.length === 0) selected.push(deferNewestMessage(unit.items));
      break;
    }
    if (!fitted.complete && selected.length > 0) break;
    selectedBytes += measureItems(fitted.items);
    for (let itemIndex = fitted.items.length - 1; itemIndex >= 0; itemIndex -= 1) {
      selected.push(fitted.items[itemIndex]);
    }
    if (!fitted.complete) break;
  }
  return selected.reverse();
}

export function buildSessionHistoryPage(options: {
  branch?: SessionBranch;
  entries?: SessionEntry[];
  leafId?: string | null;
  modelChoice?: ChosenSessionModel;
  historyWindow?: HistoryWindow;
  historyRevision: string;
  cursor?: HistoryCursorPayload;
}): PagedContextInfo {
  const { historyWindow, historyRevision, cursor, modelChoice } = options;
  const allEntries = options.branch ? options.branch.allEntries : (options.entries ?? []);
  const baseBranch = options.branch ?? branchAt(allEntries, options.leafId);
  const branch =
    cursor && baseBranch.leafId !== cursor.anchorLeafId ? branchAt(allEntries, cursor.anchorLeafId) : baseBranch;
  const { path, leafId: anchorLeafId } = branch;
  if (cursor) {
    if (cursor.historyRevision !== historyRevision) throw new StaleHistoryCursorError();
    if (branch.leafId !== cursor.anchorLeafId) throw new StaleHistoryCursorError();
    if (path.length < cursor.anchorPathLength) throw new StaleHistoryCursorError();
    if (!path.some((entry) => entry.id === cursor.beforeEntryId)) throw new StaleHistoryCursorError();
  }
  const settings = {
    model: modelChoice ? modelChoice.model : branch.model,
    thinkingLevel: (modelChoice ? modelChoice.thinkingLevel : branch.thinkingLevel) ?? "off",
  };

  if (!historyWindow && !cursor) {
    const context = buildSessionContext(branch);
    return {
      ...context,
      ...settings,
      messages: attachRetryOutcomes(context.messages, context.entryIds, path),
      totalMessages: context.messages.length,
      loadedMessages: context.messages.length,
      truncatedBefore: false,
      historyRevision,
      outline: turnOutlineOf(projectDisplayMessages(path)),
    };
  }

  const allMessages = projectDisplayMessages(path);
  const beforePathIndex = cursor ? path.findIndex((entry) => entry.id === cursor.beforeEntryId) : path.length;
  if (beforePathIndex < 0) throw new StaleHistoryCursorError();
  const available = allMessages.filter((item) => item.pathIndex < beforePathIndex);
  const units = buildUnits(groupTurns(available));
  const maxTurns = Math.max(1, Math.floor(historyWindow?.maxTurns ?? DEFAULT_MAX_TURNS));
  const maxBytes = Math.max(32 * 1024, Math.floor(historyWindow?.maxBytes ?? DEFAULT_MAX_BYTES));
  const selected = packPage(units, maxTurns, maxBytes);

  const firstSelected = selected[0];
  const hasOlder = Boolean(firstSelected && allMessages.some((item) => item.pathIndex < firstSelected.pathIndex));
  const previousCursor =
    hasOlder && anchorLeafId && firstSelected
      ? encodeHistoryCursor({
          version: 1,
          historyRevision,
          anchorLeafId,
          beforeEntryId: firstSelected.entryId,
          anchorPathLength: path.length,
        })
      : undefined;

  return {
    messages: withVersions(branch.allEntries, selected),
    entryIds: selected.map((item) => item.entryId),
    ...settings,
    totalMessages: allMessages.length,
    loadedMessages: selected.length,
    truncatedBefore: hasOlder,
    ...(previousCursor ? { previousCursor } : {}),
    historyRevision,
    ...(cursor ? {} : { outline: turnOutlineOf(allMessages) }),
  };
}

function withVersions(entries: readonly SessionEntry[], selected: ProjectedMessage[]): PagedContextInfo["messages"] {
  const versions = versionsByEntryId(entries);
  if (versions.size === 0) return selected.map((item) => item.message);
  return selected.map((item) => {
    const version = versions.get(item.entryId);
    return version && item.message.role === "user" ? { ...item.message, versions: version } : item.message;
  });
}

export function readSessionEntryContent(
  entries: SessionEntry[],
  entryId: string,
  blockIndex = 0,
): TextContent | ImageContent | ThinkingContent | ToolCallContent | null {
  const entry = entries.find((candidate) => candidate.id === entryId);
  if (!entry) return null;
  const message = entryToUiMessage(entry);
  if (!message) return null;
  if (typeof message.content === "string") return blockIndex === 0 ? { type: "text", text: message.content } : null;
  const block = message.content[blockIndex];
  if (block?.type !== "text" && block?.type !== "image" && block?.type !== "thinking" && block?.type !== "toolCall") {
    return null;
  }
  return withoutModelOnlyBlock(block);
}
