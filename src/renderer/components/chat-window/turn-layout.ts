import { type MessageRenderRole } from "@/lib/message-render-key";
import { isAssistantFailure, splitAssistantBlockRuns, type AssistantBlockItem } from "@/lib/message-display";
import {
  buildProcessFlowItems,
  computeTurnDurationSeconds,
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
  refIndex?: number;
  index: number;
  entryId?: string;
  body: AssistantMessage;
  prevTimestamp?: number;
}

export interface TurnProcessPiece {
  kind: "process";
  key: string;
  refIndex?: number;
  flow: ProcessFlow;
  durationSeconds?: number;
}

export interface TurnFailurePiece {
  kind: "failure";
  key: string;
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
  cache: AssistantBlockCache;
}

interface OpenGroup {
  key: string;
  refIndex?: number;
  sources: ProcessFlowSource[];
  startTimestamp?: number;
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
  const { messages, userIdx, endIdx, entryIds, retriedIndices, cache } = input;
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
  let group: OpenGroup | null = null;

  const claimRef = (messageIndex: number): number | undefined => {
    const refIndex = input.refIndexFor(messageIndex);
    if (refIndex === undefined || claimedRefs.has(refIndex)) return undefined;
    claimedRefs.add(refIndex);
    return refIndex;
  };

  const joinGroup = (messageIndex: number, key: string, source: ProcessFlowSource) => {
    if (!group) group = { key, sources: [], startTimestamp: source.prevTimestamp };
    if (group.refIndex === undefined) group.refIndex = claimRef(messageIndex);
    group.sources.push(source);
  };

  const flushGroup = () => {
    if (!group) return;
    const flow = buildProcessFlowItems(group.sources, (message, entryId) => input.keyFor(message, entryId, "process"));
    const end = lastProcessingTimestamp(group.sources, flow);
    pieces.push({
      kind: "process",
      key: group.key,
      refIndex: group.refIndex,
      flow,
      durationSeconds: computeTurnDurationSeconds(group.startTimestamp, end),
    });
    group = null;
  };

  for (let index = userIdx + 1; index <= lastAssistantIndex; index += 1) {
    const message = messages[index];
    const entryId = entryIds[index];
    const prevTimestamp = timestampOf(messages[index - 1]);
    if (message.role === "custom") {
      joinGroup(index, input.keyFor(message, entryId, "process"), {
        message: message as CustomMessage,
        entryId,
        prevTimestamp,
      });
      continue;
    }
    if (message.role !== "assistant") continue;
    const assistant = message as AssistantMessage;
    const toolData = input.toolData.get(assistant);
    for (const piece of cache.piecesFor(assistant)) {
      if (piece.kind === "answer") {
        flushGroup();
        pieces.push({
          kind: "answer",
          key: `${input.keyFor(assistant, entryId, "answer")}:${piece.firstIndex}`,
          refIndex: claimRef(index),
          index,
          entryId,
          body: piece.body,
          prevTimestamp,
        });
        continue;
      }
      joinGroup(index, `${input.keyFor(assistant, entryId, "process")}:${piece.firstIndex}`, {
        message: assistant,
        blockItems: piece.blockItems,
        entryId,
        prevTimestamp,
        toolData,
      });
    }
    if (isAssistantFailure(assistant)) {
      flushGroup();
      pieces.push({
        kind: "failure",
        key: input.keyFor(assistant, entryId, "failure"),
        refIndex: claimRef(index),
        index,
        message: failureOnlyMessage(assistant),
        retried: retriedIndices.has(index),
      });
    }
  }
  flushGroup();

  return { pieces, lastAssistantIndex, footer: footerFor(input, pieces, lastAssistantIndex) };
}
