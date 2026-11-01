import { buildContextEntries, sessionEntryToContextMessages } from "@earendil-works/pi-coding-agent";
import type { SessionEntry as PiSessionEntry } from "@earendil-works/pi-coding-agent";
import type { SessionEntry } from "../shared/types";
import {
  foldSessionModelEvidence,
  sameModelRef,
  type ChosenSessionModel,
  type SessionModelEvidence,
} from "./session-model";

const sessionBranchBrand: unique symbol = Symbol("SessionBranch");

export interface SessionBranch extends SessionModelEvidence {
  readonly [sessionBranchBrand]: true;
  readonly leafId: string | null;
  readonly allEntries: readonly SessionEntry[];
  readonly path: readonly SessionEntry[];
}

export function lastEntryIdOf(entries: readonly SessionEntry[]): string | null {
  return entries.at(-1)?.id ?? null;
}

export function branchAt(entries: readonly SessionEntry[], leafId?: string | null): SessionBranch {
  if (leafId === null || entries.length === 0) {
    return {
      [sessionBranchBrand]: true,
      leafId: null,
      allEntries: entries,
      path: [],
      model: null,
      thinkingLevel: null,
      modelCandidates: [],
    };
  }

  const byId = new Map(entries.map((entry) => [entry.id, entry]));
  const targetLeafId = leafId === undefined ? lastEntryIdOf(entries) : leafId;
  let current = (targetLeafId === null ? undefined : byId.get(targetLeafId)) ?? entries.at(-1);
  const reversedPath: SessionEntry[] = [];
  const visited = new Set<string>();
  while (current) {
    reversedPath.push(current);
    visited.add(current.id);
    const next = current.parentId ? byId.get(current.parentId) : undefined;
    if (next && visited.has(next.id)) {
      reversedPath[reversedPath.length - 1] = { ...current, parentId: null };
      break;
    }
    current = next;
  }

  const path = reversedPath.reverse();
  return {
    [sessionBranchBrand]: true,
    leafId: path.at(-1)?.id ?? null,
    allEntries: entries,
    path,
    ...foldSessionModelEvidence(path),
  };
}

export function withBranchModelChoice(branch: SessionBranch, choice: ChosenSessionModel): SessionBranch {
  const modelCandidates =
    choice.model && !sameModelRef(choice.model, branch.modelCandidates[0])
      ? [choice.model, ...branch.modelCandidates.filter((model) => !sameModelRef(model, choice.model))]
      : branch.modelCandidates;
  return { ...branch, model: choice.model, thinkingLevel: choice.thinkingLevel, modelCandidates };
}

export function buildBranchLlmMessages(branch: SessionBranch): unknown[] {
  if (branch.leafId === null || branch.path.length === 0) return [];
  return buildContextEntries(branch.path as unknown as PiSessionEntry[], branch.leafId).flatMap(
    sessionEntryToContextMessages,
  );
}
