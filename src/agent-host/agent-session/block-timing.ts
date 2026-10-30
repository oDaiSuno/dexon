import type { BlockTiming, DexonTiming } from "../../shared/types";
import type { AgentEvent } from "./types";

interface StreamBlockEvent {
  type?: unknown;
  contentIndex?: unknown;
}

interface TimedMessage {
  role?: unknown;
  content?: unknown;
  dexonTiming?: DexonTiming;
}

export class BlockTimingRecorder {
  private blocks: BlockTiming[] = [];

  observe(event: AgentEvent): AgentEvent {
    if (event.type === "message_start") return this.begin(event);
    if (event.type === "message_update") return this.stream(event);
    if (event.type === "message_end") return this.finish(event);
    return event;
  }

  decorate<T extends object>(message: T): T & { dexonTiming: DexonTiming } {
    return { ...message, dexonTiming: this.recorded() };
  }

  private begin(event: AgentEvent): AgentEvent {
    this.blocks = [];
    const message = assistantMessageOf(event);
    if (!message) return event;
    return { ...event, message: this.decorate(message) };
  }

  private stream(event: AgentEvent): AgentEvent {
    const message = assistantMessageOf(event);
    if (!message) return event;
    this.record(event.assistantMessageEvent);
    return { ...event, message: this.decorate(message) };
  }

  private finish(event: AgentEvent): AgentEvent {
    const message = assistantMessageOf(event);
    if (!message) {
      this.blocks = [];
      return event;
    }
    const now = Date.now();
    const length = Array.isArray(message.content) ? message.content.length : 0;
    const blocks: BlockTiming[] = [];
    for (let index = 0; index < length; index += 1) {
      const recorded = this.blocks[index];
      blocks.push({ startedAt: recorded?.startedAt ?? now, endedAt: recorded?.endedAt ?? now });
    }
    this.blocks = [];
    message.dexonTiming = { blocks };
    return event;
  }

  private record(streamEvent: unknown): void {
    if (!streamEvent || typeof streamEvent !== "object") return;
    const { type, contentIndex } = streamEvent as StreamBlockEvent;
    if (typeof type !== "string" || typeof contentIndex !== "number") return;
    if (!Number.isInteger(contentIndex) || contentIndex < 0) return;
    if (type.endsWith("_start")) this.openBlock(contentIndex);
    else if (type.endsWith("_end")) this.closeBlock(contentIndex);
  }

  private openBlock(index: number): void {
    const now = Date.now();
    for (let earlier = 0; earlier < index; earlier += 1) {
      if (!this.blocks[earlier]) this.blocks[earlier] = { startedAt: now };
      if (this.blocks[earlier].endedAt === undefined) this.blocks[earlier].endedAt = now;
    }
    this.blocks[index] = { startedAt: now };
  }

  private closeBlock(index: number): void {
    const block = this.blocks[index];
    if (!block) {
      const now = Date.now();
      this.blocks[index] = { startedAt: now, endedAt: now };
      return;
    }
    if (block.endedAt === undefined) block.endedAt = Date.now();
  }

  private recorded(): DexonTiming {
    const now = Date.now();
    const blocks: BlockTiming[] = [];
    for (let index = 0; index < this.blocks.length; index += 1) {
      const block = this.blocks[index];
      blocks.push(block ? { ...block } : { startedAt: now });
    }
    return { blocks };
  }
}

function assistantMessageOf(event: AgentEvent): TimedMessage | null {
  const message = event.message as TimedMessage | undefined;
  if (!message || typeof message !== "object" || message.role !== "assistant") return null;
  return message;
}
