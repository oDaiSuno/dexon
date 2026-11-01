import { useSyncExternalStore } from "react";
import type { ContextInfo } from "@contract/types";
import { isThinkingLevelOption, type SelectedModel, type ThinkingLevelOption } from "./shared";

export interface SessionModelChoice {
  model: SelectedModel | null;
  thinkingLevel: ThinkingLevelOption | null;
}

export type ChoicePatch =
  | { model: SelectedModel; thinkingLevel?: ThinkingLevelOption | null }
  | { thinkingLevel: ThinkingLevelOption; model?: undefined };

export type ChoiceReply = { thinkingLevel?: ThinkingLevelOption | null };

const EMPTY_CHOICE: SessionModelChoice = { model: null, thinkingLevel: null };

function sameModel(a: SelectedModel | null, b: SelectedModel | null): boolean {
  if (!a || !b) return a === b;
  return a.provider === b.provider && a.modelId === b.modelId;
}

export class ModelChoiceLedger {
  #confirmed: SessionModelChoice = EMPTY_CHOICE;
  #pending = new Map<number, ChoicePatch>();
  #claims = { model: 0, thinkingLevel: 0 };
  #nextChoice = 0;
  #epoch = 0;
  #generation = 0;
  #nextRead = 0;
  #acceptedRead = 0;
  #view: SessionModelChoice = EMPTY_CHOICE;
  #listeners = new Set<() => void>();

  subscribe = (listener: () => void): (() => void) => {
    this.#listeners.add(listener);
    return () => {
      this.#listeners.delete(listener);
    };
  };

  getSnapshot = (): SessionModelChoice => this.#view;

  reset(initial: SessionModelChoice = EMPTY_CHOICE): void {
    this.#generation += 1;
    this.#epoch += 1;
    this.#pending.clear();
    this.#claims = { model: 0, thinkingLevel: 0 };
    this.#acceptedRead = this.#nextRead;
    this.#confirmed = initial;
    this.#publish();
  }

  async observe<T>(read: () => Promise<T>, choiceOf: (value: T) => SessionModelChoice | null): Promise<T> {
    const ticket = { seq: ++this.#nextRead, epoch: this.#epoch, quiet: this.#pending.size === 0 };
    const value = await read();
    const choice = choiceOf(value);
    if (
      choice &&
      ticket.quiet &&
      this.#pending.size === 0 &&
      ticket.epoch === this.#epoch &&
      ticket.seq > this.#acceptedRead
    ) {
      this.#acceptedRead = ticket.seq;
      this.#confirmed = choice;
      this.#publish();
    }
    return value;
  }

  async choose(patch: ChoicePatch, send: () => Promise<ChoiceReply>): Promise<void> {
    const id = ++this.#nextChoice;
    const generation = this.#generation;
    this.#epoch += 1;
    this.#pending.set(id, patch);
    if (patch.model) this.#claims.model = id;
    this.#claims.thinkingLevel = id;
    this.#publish();
    try {
      const reply = await send();
      if (generation !== this.#generation) return;
      this.#confirm(id, patch, reply);
    } finally {
      if (generation === this.#generation) {
        this.#pending.delete(id);
        this.#epoch += 1;
        this.#publish();
      }
    }
  }

  #confirm(id: number, patch: ChoicePatch, reply: ChoiceReply): void {
    const next = { ...this.#confirmed };
    if (this.#claims.model === id && patch.model) next.model = patch.model;
    if (this.#claims.thinkingLevel === id) {
      next.thinkingLevel = this.#confirmedLevel(patch, reply, next.thinkingLevel);
    }
    this.#confirmed = next;
  }

  #confirmedLevel(
    patch: ChoicePatch,
    reply: ChoiceReply,
    current: ThinkingLevelOption | null,
  ): ThinkingLevelOption | null {
    if (patch.thinkingLevel) return patch.thinkingLevel;
    if (reply.thinkingLevel) return reply.thinkingLevel;
    return patch.thinkingLevel === null ? null : current;
  }

  #publish(): void {
    const modelPatch = this.#pending.get(this.#claims.model);
    const thinkingPatch = this.#pending.get(this.#claims.thinkingLevel);
    const next: SessionModelChoice = {
      model: modelPatch?.model ?? this.#confirmed.model,
      thinkingLevel:
        thinkingPatch?.thinkingLevel === undefined ? this.#confirmed.thinkingLevel : thinkingPatch.thinkingLevel,
    };
    if (sameModel(next.model, this.#view.model) && next.thinkingLevel === this.#view.thinkingLevel) return;
    this.#view = next;
    for (const listener of [...this.#listeners]) listener();
  }
}

export function useModelChoice(ledger: ModelChoiceLedger): SessionModelChoice {
  return useSyncExternalStore(ledger.subscribe, ledger.getSnapshot, ledger.getSnapshot);
}

export function choiceOfContext(
  context: Pick<ContextInfo, "model" | "thinkingLevel">,
  liveThinkingLevel?: unknown,
): SessionModelChoice {
  const thinkingLevel = isThinkingLevelOption(liveThinkingLevel) ? liveThinkingLevel : context.thinkingLevel;
  return {
    model: context.model ? { provider: context.model.provider, modelId: context.model.modelId } : null,
    thinkingLevel: isThinkingLevelOption(thinkingLevel) ? thinkingLevel : null,
  };
}
