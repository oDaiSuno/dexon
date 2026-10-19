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

export interface TurnAnswerPiece {
  kind: "answer";
  key: string;
  refIndex?: number;
  index: number;
  entryId?: string;
  body: AssistantMessage;
  footerBody: AssistantMessage;
  hasFooter: boolean;
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
}

interface CachedAnswerPiece {
  kind: "answer";
  firstIndex: number;
  body: AssistantMessage;
  footerBody: AssistantMessage;
}

interface CachedProcessPiece {
  kind: "process";
  firstIndex: number;
  blockItems: AssistantBlockItem[];
}

type CachedMessagePiece = CachedAnswerPiece | CachedProcessPiece;

function answerBody(message: AssistantMessage, blocks: AssistantContentBlock[], keepUsage: boolean): AssistantMessage {
  return {
    ...message,
    content: blocks,
    usage: keepUsage ? message.usage : undefined,
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
      const blocks = run.blockItems.map((item) => item.block);
      return {
        kind: "answer",
        firstIndex,
        body: answerBody(message, blocks, false),
        footerBody: answerBody(message, blocks, true),
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
}

function timestampOf(message: AgentMessage | undefined): number | undefined {
  return (message as (AgentMessage & { timestamp?: number }) | undefined)?.timestamp;
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
  if (lastAssistantIndex === -1) return { pieces: [], lastAssistantIndex };

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
    if (!group) group = { key, sources: [] };
    if (group.refIndex === undefined) group.refIndex = claimRef(messageIndex);
    group.sources.push(source);
  };

  const flushGroup = () => {
    if (!group) return;
    const flow = buildProcessFlowItems(group.sources, (message, entryId) => input.keyFor(message, entryId, "process"));
    pieces.push({ kind: "process", key: group.key, refIndex: group.refIndex, flow });
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
          footerBody: piece.footerBody,
          hasFooter: false,
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

  const turnDuration = computeTurnDurationSeconds(
    timestampOf(messages[userIdx]),
    timestampOf(messages[lastAssistantIndex]),
  );
  const groups = pieces.filter((piece): piece is TurnProcessPiece => piece.kind === "process");
  if (groups.length === 1) groups[0].durationSeconds = turnDuration;

  const footerCandidates = pieces.filter(
    (piece): piece is TurnAnswerPiece => piece.kind === "answer" && piece.index === lastAssistantIndex,
  );
  const footer = footerCandidates[footerCandidates.length - 1];
  if (footer) footer.hasFooter = true;

  return { pieces, lastAssistantIndex };
}
