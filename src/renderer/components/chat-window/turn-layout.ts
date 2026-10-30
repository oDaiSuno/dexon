import { type MessageRenderRole } from "@/lib/message-render-key";
import { isAssistantFailure, splitAssistantBlockRuns, type AssistantBlockItem } from "@/lib/message-display";
import {
  blockEndedAt,
  blockStartedAt,
  buildProcessFlowItems,
  computeTurnDurationSeconds,
  elapsedSeconds,
  recordedBlocks,
  type ProcessFlow,
  type ProcessFlowSource,
} from "@/lib/process-flow";
import type { ToolMessageData } from "@/lib/tool-message-index";
import type { AgentMessage, AssistantContentBlock, AssistantMessage, CustomMessage } from "@/lib/types";

export type AssistantUsage = NonNullable<AssistantMessage["usage"]>;

export interface TurnFooter {
  copyText: string;
  forkEntryId?: string;
  timestamp?: number;
  usage?: AssistantUsage;
  provider?: string;
  model?: string;
}

export interface TurnAnswerPiece {
  kind: "answer";
  key: string;
  anchor: string;
  refIndex?: number;
  index: number;
  entryId?: string;
  body: AssistantMessage;
  prevTimestamp?: number;
}

export interface TurnProcessPiece {
  kind: "process";
  key: string;
  anchor: string;
  refIndex?: number;
  flow: ProcessFlow;
  durationSeconds?: number;
  startedAt?: number;
  liveStartedAt?: number;
  open: boolean;
}

export interface TurnFailurePiece {
  kind: "failure";
  key: string;
  anchor: string;
  refIndex?: number;
  index: number;
  message: AssistantMessage;
  retried: boolean;
}

export type TurnPiece = TurnAnswerPiece | TurnProcessPiece | TurnFailurePiece;

export interface TurnLayout {
  pieces: TurnPiece[];
  lastAssistantIndex: number;
  footer: TurnFooter | null;
}

interface CachedAnswerPiece {
  kind: "answer";
  firstIndex: number;
  body: AssistantMessage;
}

interface CachedProcessPiece {
  kind: "process";
  firstIndex: number;
  blockItems: AssistantBlockItem[];
}

type CachedMessagePiece = CachedAnswerPiece | CachedProcessPiece;

function answerBody(message: AssistantMessage, blocks: AssistantContentBlock[]): AssistantMessage {
  return {
    ...message,
    content: blocks,
    usage: undefined,
    stopReason: undefined,
    errorMessage: undefined,
  };
}

const failureOnlyMessages = new WeakMap<AssistantMessage, AssistantMessage>();

function failureOnlyMessage(message: AssistantMessage): AssistantMessage {
  const cached = failureOnlyMessages.get(message);
  if (cached) return cached;
  const created: AssistantMessage = { ...message, content: [], usage: undefined };
  failureOnlyMessages.set(message, created);
  return created;
}

export class AssistantBlockCache {
  private readonly byMessage = new WeakMap<AssistantMessage, CachedMessagePiece[]>();

  piecesFor(message: AssistantMessage): CachedMessagePiece[] {
    const cached = this.byMessage.get(message);
    if (cached) return cached;
    const created = splitAssistantBlockRuns(message).map((run): CachedMessagePiece => {
      const firstIndex = run.blockItems[0].index;
      if (run.kind === "process") return { kind: "process", firstIndex, blockItems: run.blockItems };
      return {
        kind: "answer",
        firstIndex,
        body: answerBody(
          message,
          run.blockItems.map((item) => item.block),
        ),
      };
    });
    this.byMessage.set(message, created);
    return created;
  }
}

export interface TurnLayoutInput {
  messages: AgentMessage[];
  userIdx: number;
  endIdx: number;
  entryIds: string[];
  toolData: ReadonlyMap<AgentMessage, ToolMessageData>;
  refIndexFor: (messageIndex: number) => number | undefined;
  keyFor: (message: object, entryId: string | undefined, role: MessageRenderRole) => string;
  retriedIndices: ReadonlySet<number>;
  resolvedIndices: ReadonlySet<number>;
  cache: AssistantBlockCache;
  live?: boolean;
  streamingMessage?: AssistantMessage;
}

interface OpenGroup {
  key: string;
  anchor: string;
  refIndex?: number;
  sources: ProcessFlowSource[];
  startTimestamp?: number;
  recordedEnd?: number;
  answerStartedAt?: number;
  nextBlockStarted: boolean;
}

function timestampOf(message: AgentMessage | undefined): number | undefined {
  return (message as (AgentMessage & { timestamp?: number }) | undefined)?.timestamp;
}

function laterOf(current: number | undefined, candidate: number | undefined): number | undefined {
  if (candidate === undefined) return current;
  if (current === undefined) return candidate;
  return candidate > current ? candidate : current;
}

function lastProcessingTimestamp(sources: ProcessFlowSource[], flow: ProcessFlow): number | undefined {
  let latest: number | undefined;
  for (const source of sources) latest = laterOf(latest, source.message.timestamp);
  for (const item of flow.items) {
    if (item.kind === "toolCall") latest = laterOf(latest, item.result?.timestamp);
  }
  return latest;
}

function lastToolResultTimestamp(flow: ProcessFlow): number | undefined {
  let latest: number | undefined;
  for (const item of flow.items) {
    if (item.kind === "toolCall") latest = laterOf(latest, item.result?.timestamp);
  }
  return latest;
}

function sourceBlockItems(source: ProcessFlowSource): AssistantBlockItem[] {
  const message = source.message as AssistantMessage;
  return source.blockItems ?? (message.content ?? []).map((block, index) => ({ block, index }));
}

interface SourceTail {
  end?: number;
  nextBlockStarted: boolean;
  answerStartedAt?: number;
}

const NO_TAIL: SourceTail = { nextBlockStarted: false };

function isAnswerBlock(block: AssistantContentBlock | undefined): boolean {
  return block?.type === "text" || block?.type === "image";
}

function tailOf(source: ProcessFlowSource): SourceTail {
  if (source.message.role !== "assistant") return NO_TAIL;
  const message = source.message as AssistantMessage;
  const blocks = recordedBlocks(message);
  const items = sourceBlockItems(source);
  const last = items[items.length - 1];
  if (!blocks || !last) return NO_TAIL;
  let end: number | undefined;
  for (const item of items) end = laterOf(end, blockEndedAt(blocks, item.index));
  const content = message.content ?? [];
  let answerStartedAt: number | undefined;
  for (let index = last.index + 1; index < content.length; index += 1) {
    if (!isAnswerBlock(content[index])) continue;
    answerStartedAt = blockStartedAt(blocks, index);
    break;
  }
  return { end, nextBlockStarted: blockStartedAt(blocks, last.index + 1) !== undefined, answerStartedAt };
}

function leadingAnswerStart(message: AssistantMessage): number | undefined {
  if (!isAnswerBlock((message.content ?? [])[0])) return undefined;
  return blockStartedAt(recordedBlocks(message), 0);
}

function recordedBlockStart(source: ProcessFlowSource, blockIndex: number | undefined): number | undefined {
  if (blockIndex === undefined || source.message.role !== "assistant") return undefined;
  return blockStartedAt(recordedBlocks(source.message as AssistantMessage), blockIndex);
}

function groupStartTimestamp(
  source: ProcessFlowSource,
  firstBlockIndex: number | undefined,
  hasPriorContent: boolean,
): number | undefined {
  if (!hasPriorContent) return source.prevTimestamp;
  return recordedBlockStart(source, firstBlockIndex) ?? source.prevTimestamp;
}

function groupDurationSeconds(
  startedAt: number | undefined,
  timedEnd: number | undefined,
  legacyEnd: number | undefined,
): number | undefined {
  if (startedAt === undefined) return undefined;
  if (timedEnd !== undefined) return elapsedSeconds(timedEnd - startedAt);
  return computeTurnDurationSeconds(startedAt, legacyEnd);
}

function sumUsage(messages: AgentMessage[], userIdx: number, endIdx: number): AssistantUsage | undefined {
  let total: AssistantUsage | undefined;
  for (let index = userIdx + 1; index < endIdx; index += 1) {
    const message = messages[index];
    if (message?.role !== "assistant" || !message.usage) continue;
    const usage = message.usage;
    total ??= {
      input: 0,
      output: 0,
      cacheRead: 0,
      cacheWrite: 0,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
    };
    total.input += usage.input ?? 0;
    total.output += usage.output ?? 0;
    total.cacheRead += usage.cacheRead ?? 0;
    total.cacheWrite += usage.cacheWrite ?? 0;
    total.cost.input += usage.cost?.input ?? 0;
    total.cost.output += usage.cost?.output ?? 0;
    total.cost.cacheRead += usage.cost?.cacheRead ?? 0;
    total.cost.cacheWrite += usage.cost?.cacheWrite ?? 0;
    total.cost.total += usage.cost?.total ?? 0;
  }
  return total;
}

function copyTextOf(pieces: TurnPiece[]): string {
  const paragraphs: string[] = [];
  for (const piece of pieces) {
    if (piece.kind !== "answer") continue;
    for (const block of piece.body.content) {
      if (block.type === "text" && block.text) paragraphs.push(block.text);
    }
  }
  return paragraphs.join("\n\n");
}

function footerFor(input: TurnLayoutInput, pieces: TurnPiece[], lastAssistantIndex: number): TurnFooter | null {
  if (!pieces.some((piece) => piece.kind === "answer")) return null;
  const last = input.messages[lastAssistantIndex] as AssistantMessage;
  return {
    copyText: copyTextOf(pieces),
    forkEntryId: input.entryIds[input.endIdx - 1],
    timestamp: last.timestamp,
    usage: sumUsage(input.messages, input.userIdx, input.endIdx),
    provider: last.provider,
    model: last.model,
  };
}

export function buildTurnLayout(input: TurnLayoutInput): TurnLayout {
  const { messages, userIdx, endIdx, entryIds, retriedIndices, resolvedIndices, cache } = input;
  let lastAssistantIndex = -1;
  for (let index = endIdx - 1; index > userIdx; index -= 1) {
    if (messages[index]?.role === "assistant") {
      lastAssistantIndex = index;
      break;
    }
  }
  if (lastAssistantIndex === -1) return { pieces: [], lastAssistantIndex, footer: null };

  const pieces: TurnPiece[] = [];
  const claimedRefs = new Set<number>();
  const startedMessages = new Set<number>();
  let group: OpenGroup | null = null;
  let hasPriorContent = false;

  const pieceAnchor = (messageIndex: number, message: object, entryId: string | undefined, key: string): string => {
    if (startedMessages.has(messageIndex)) return key;
    startedMessages.add(messageIndex);
    return input.keyFor(message, entryId, "message");
  };

  const claimRef = (messageIndex: number): number | undefined => {
    const refIndex = input.refIndexFor(messageIndex);
    if (refIndex === undefined || claimedRefs.has(refIndex)) return undefined;
    claimedRefs.add(refIndex);
    return refIndex;
  };

  const joinGroup = (
    messageIndex: number,
    key: string,
    source: ProcessFlowSource,
    firstBlockIndex: number | undefined,
  ) => {
    if (!group) {
      group = {
        key,
        anchor: pieceAnchor(messageIndex, source.message, source.entryId, key),
        sources: [],
        startTimestamp: groupStartTimestamp(source, firstBlockIndex, hasPriorContent),
        recordedEnd: undefined,
        nextBlockStarted: false,
      };
    }
    startedMessages.add(messageIndex);
    if (group.refIndex === undefined) group.refIndex = claimRef(messageIndex);
    const tail = tailOf(source);
    group.recordedEnd = laterOf(group.recordedEnd, tail.end);
    group.nextBlockStarted = tail.nextBlockStarted;
    group.answerStartedAt ??= tail.answerStartedAt;
    group.sources.push(source);
  };

  const flushGroup = (answerStartedAt?: number) => {
    if (!group) return;
    const closingAt = answerStartedAt ?? group.answerStartedAt;
    const flow = buildProcessFlowItems(group.sources, (message, entryId) => input.keyFor(message, entryId, "process"));
    const timedEnd =
      closingAt ??
      (group.recordedEnd === undefined ? undefined : laterOf(group.recordedEnd, lastToolResultTimestamp(flow)));
    const durationSeconds = groupDurationSeconds(
      group.startTimestamp,
      timedEnd,
      lastProcessingTimestamp(group.sources, flow),
    );
    pieces.push({
      kind: "process",
      key: group.key,
      anchor: group.anchor,
      refIndex: group.refIndex,
      flow,
      durationSeconds,
      startedAt: group.startTimestamp,
      open: !group.nextBlockStarted && closingAt === undefined,
    });
    hasPriorContent = true;
    group = null;
  };

  for (let index = userIdx + 1; index <= lastAssistantIndex; index += 1) {
    const message = messages[index];
    const entryId = entryIds[index];
    const prevTimestamp = timestampOf(messages[index - 1]);
    if (message.role === "custom") {
      joinGroup(
        index,
        input.keyFor(message, entryId, "process"),
        { message: message as CustomMessage, entryId, prevTimestamp },
        undefined,
      );
      continue;
    }
    if (message.role !== "assistant") continue;
    const assistant = message as AssistantMessage;
    const toolData = input.toolData.get(assistant);
    const live = input.live === true;
    const leadingAnswerStartedAt = leadingAnswerStart(assistant);
    if (leadingAnswerStartedAt !== undefined) flushGroup(leadingAnswerStartedAt);
    for (const piece of cache.piecesFor(assistant)) {
      if (piece.kind === "answer") {
        flushGroup(blockStartedAt(recordedBlocks(assistant), piece.firstIndex));
        hasPriorContent = true;
        const key = `${input.keyFor(assistant, entryId, "answer")}:${piece.firstIndex}`;
        pieces.push({
          kind: "answer",
          key,
          anchor: pieceAnchor(index, assistant, entryId, key),
          refIndex: claimRef(index),
          index,
          entryId,
          body: piece.body,
          prevTimestamp,
        });
        continue;
      }
      joinGroup(
        index,
        `${input.keyFor(assistant, entryId, "process")}:${piece.firstIndex}`,
        {
          message: assistant,
          blockItems: piece.blockItems,
          entryId,
          prevTimestamp,
          toolData,
          live,
          streaming: assistant === input.streamingMessage,
        },
        piece.firstIndex,
      );
    }
    if (isAssistantFailure(assistant)) {
      flushGroup();
      if (!resolvedIndices.has(index)) {
        const key = input.keyFor(assistant, entryId, "failure");
        pieces.push({
          kind: "failure",
          key,
          anchor: pieceAnchor(index, assistant, entryId, key),
          refIndex: claimRef(index),
          index,
          message: failureOnlyMessage(assistant),
          retried: retriedIndices.has(index),
        });
      }
    }
  }
  flushGroup();

  markOpenBlock(pieces, input.live === true);

  return { pieces, lastAssistantIndex, footer: footerFor(input, pieces, lastAssistantIndex) };
}

function markOpenBlock(pieces: TurnPiece[], live: boolean): void {
  if (!live) return;
  const newest = pieces[pieces.length - 1];
  if (newest?.kind !== "process" || !newest.open || newest.startedAt === undefined) return;
  newest.liveStartedAt = newest.startedAt;
}
