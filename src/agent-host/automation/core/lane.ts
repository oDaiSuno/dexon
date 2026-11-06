import type { RunPhase } from "../../../shared/automation/phases";

export interface LaneState {
  readonly laneKey: string;
  readonly capacity: number;
  readonly overflow: "skip" | "queue" | "latest";
  readonly maxPending?: number;
  readonly liveCount: number;
  readonly pendingCount: number;
  readonly pendingRunIds?: readonly string[];
}
export type AdmissionDecision =
  { readonly kind: "admit" | "skip" } | { readonly kind: "enqueue"; readonly supersede: readonly string[] };

export function decideAdmission(lane: LaneState, dedupeHit = false): AdmissionDecision {
  if (dedupeHit) return { kind: "skip" };
  if (lane.liveCount < lane.capacity) return { kind: "admit" };
  if (lane.overflow === "skip") return { kind: "skip" };
  if (lane.overflow === "queue" && lane.pendingCount >= (lane.maxPending ?? 100)) return { kind: "skip" };
  return { kind: "enqueue", supersede: lane.overflow === "latest" ? (lane.pendingRunIds ?? []) : [] };
}
export interface PromotionCandidate {
  readonly runId: string;
  readonly createdAtMs: number;
  readonly phase: RunPhase;
}
export function selectPromotion(candidates: readonly PromotionCandidate[]): string | null {
  return (
    [...candidates]
      .filter((candidate) => candidate.phase === "pending")
      .sort((a, b) => a.createdAtMs - b.createdAtMs || a.runId.localeCompare(b.runId))[0]?.runId ?? null
  );
}
