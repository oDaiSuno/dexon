import { alignReadingPosition, type ReadingAlignmentOutcome } from "./reading-anchor";
import { logSessionPerformanceEvent } from "./session-performance";

const SMOOTH_MAX_VIEWPORTS = 3;
const SMOOTH_DRIFT_CUTOFF_PX = 48;
const SMOOTH_STILL_FRAMES = 4;
const SMOOTH_TIMEOUT_MS = 900;
const TOP_STANDBY_SCROLL_TOP = 240;
const TRANSITION_RING_LIMIT = 24;

export type ViewportReason =
  | "turn-jump"
  | "quote-jump"
  | "reading-restore"
  | "history-anchor"
  | "settle-latest"
  | "scroll-to-bottom"
  | "sent-message"
  | "user-gesture"
  | "session-reset"
  | "hidden";

export interface ViewportClaimOptions {
  blocksAutoOlder?: boolean;
  releaseAutoFollow?: boolean;
}

export interface ViewportFinishOptions {
  armTopStandby?: boolean;
  outcome?: ReadingAlignmentOutcome;
  errorPx?: number;
}

export interface ViewportLease {
  readonly generation: number;
  readonly reason: ViewportReason;
  isCurrent: () => boolean;
  onAbort: (cleanup: (byReason: ViewportReason) => void) => void;
  finish: (options?: ViewportFinishOptions) => void;
}

export interface ViewportNavigateOptions {
  container: HTMLElement;
  targetOffset: number | (() => number);
  measure: () => number | null;
  preferSmooth: boolean;
  onSettled?: (outcome: ReadingAlignmentOutcome) => void;
}

export interface ViewportTransition {
  generation: number;
  event: "claim" | "finish" | "standby-clear";
  reason: ViewportReason | null;
  interrupted: ViewportReason | null;
  outcome?: ReadingAlignmentOutcome;
  errorPx?: number;
  durationMs?: number;
}

function prefersReducedMotion(): boolean {
  if (typeof globalThis.matchMedia !== "function") return false;
  return globalThis.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

export class ChatViewportController {
  private currentGeneration = 0;
  private activeReason: ViewportReason | null = null;
  private activeStartedAt = 0;
  private activeBlocksAutoOlder = false;
  private navigationActive = false;
  private autoOlderStandby = false;
  private abortCallbacks: ((byReason: ViewportReason) => void)[] = [];
  private listeners = new Set<() => void>();
  private releaseAutoFollowHandler: (() => void) | null = null;
  private transitions: ViewportTransition[] = [];

  get generation(): number {
    return this.currentGeneration;
  }

  isNavigationActive(): boolean {
    return this.navigationActive;
  }

  isAutoOlderBlocked(): boolean {
    return this.navigationActive || this.autoOlderStandby;
  }

  setReleaseAutoFollow(handler: (() => void) | null): void {
    this.releaseAutoFollowHandler = handler;
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  recentTransitions(): readonly ViewportTransition[] {
    return this.transitions;
  }

  claim(reason: ViewportReason, options: ViewportClaimOptions = {}): ViewportLease {
    const interrupted = this.activeReason;
    const prevNav = this.navigationActive;
    const prevStandby = this.autoOlderStandby;
    const pendingAborts = this.abortCallbacks;
    this.abortCallbacks = [];
    this.currentGeneration += 1;
    const leaseGeneration = this.currentGeneration;
    const blocksAutoOlder = Boolean(options.blocksAutoOlder);
    const passive = reason === "user-gesture" || reason === "session-reset" || reason === "hidden";
    this.activeReason = passive ? null : reason;
    this.activeStartedAt = Date.now();
    this.activeBlocksAutoOlder = blocksAutoOlder;
    this.navigationActive = !passive && blocksAutoOlder;
    this.autoOlderStandby = false;

    for (const cleanup of pendingAborts) cleanup(reason);

    this.recordTransition({
      generation: leaseGeneration,
      event: "claim",
      reason,
      interrupted,
    });

    if (options.releaseAutoFollow) {
      this.releaseAutoFollowHandler?.();
    }

    if (prevNav !== this.navigationActive || prevStandby !== this.autoOlderStandby) {
      this.notify();
    }

    const isCurrent = () => this.currentGeneration === leaseGeneration;
    return {
      generation: leaseGeneration,
      reason,
      isCurrent,
      onAbort: (cleanup) => {
        if (!isCurrent()) {
          cleanup(this.activeReason ?? "user-gesture");
          return;
        }
        this.abortCallbacks.push(cleanup);
      },
      finish: (finishOptions = {}) => {
        if (!isCurrent()) return;
        const durationMs = Math.max(0, Date.now() - this.activeStartedAt);
        const beforeNav = this.navigationActive;
        const beforeStandby = this.autoOlderStandby;
        this.abortCallbacks = [];
        this.activeReason = null;
        this.activeBlocksAutoOlder = false;
        this.navigationActive = false;
        this.autoOlderStandby = Boolean(finishOptions.armTopStandby);
        this.recordTransition({
          generation: leaseGeneration,
          event: "finish",
          reason,
          interrupted: null,
          outcome: finishOptions.outcome,
          errorPx: finishOptions.errorPx,
          durationMs,
        });
        if (beforeNav !== this.navigationActive || beforeStandby !== this.autoOlderStandby) {
          this.notify();
        }
      },
    };
  }

  onUserGesture(upward: boolean): void {
    if (this.activeReason !== null) {
      this.claim("user-gesture");
      return;
    }
    if (upward && this.autoOlderStandby) {
      this.clearAutoOlderStandby();
    }
  }

  clearAutoOlderStandby(): void {
    if (!this.autoOlderStandby) return;
    this.autoOlderStandby = false;
    this.recordTransition({
      generation: this.currentGeneration,
      event: "standby-clear",
      reason: this.activeReason,
      interrupted: null,
    });
    this.notify();
  }

  reset(reason: "session-reset" | "hidden"): void {
    if (this.activeReason === null && !this.navigationActive && !this.autoOlderStandby) return;
    this.claim(reason);
  }

  navigateLease(lease: ViewportLease, options: ViewportNavigateOptions): void {
    const { container, targetOffset, measure, preferSmooth, onSettled } = options;
    const targetOf = typeof targetOffset === "function" ? targetOffset : () => targetOffset;

    if (!lease.isCurrent()) {
      onSettled?.("aborted");
      return;
    }

    const initialOffset = measure();
    if (initialOffset === null) {
      lease.finish({ outcome: "missing" });
      onSettled?.("missing");
      return;
    }

    const blocksAutoOlder = this.activeBlocksAutoOlder;
    const complete = (outcome: ReadingAlignmentOutcome) => {
      if (!lease.isCurrent()) {
        onSettled?.("aborted");
        return;
      }
      const finalOffset = measure();
      const errorPx = finalOffset === null ? undefined : Math.round(Math.abs(finalOffset - targetOf()) * 10) / 10;
      const armTopStandby =
        blocksAutoOlder &&
        (outcome === "settled" || outcome === "clamped") &&
        container.scrollTop <= TOP_STANDBY_SCROLL_TOP;
      lease.finish({ armTopStandby, outcome, errorPx });
      onSettled?.(outcome);
    };

    const startConvergence = () => {
      if (!lease.isCurrent()) {
        onSettled?.("aborted");
        return;
      }
      const cancelAlign = alignReadingPosition({
        container,
        target: targetOf,
        measure,
        shouldStop: () => !lease.isCurrent(),
        onSettled: complete,
      });
      lease.onAbort(cancelAlign);
    };

    const initialTarget = targetOf();
    const desiredTop = Math.max(0, container.scrollTop + initialOffset - initialTarget);
    const distance = Math.abs(desiredTop - container.scrollTop);
    const useSmooth =
      preferSmooth &&
      !prefersReducedMotion() &&
      typeof container.scrollTo === "function" &&
      distance >= 1 &&
      container.clientHeight > 0 &&
      distance <= container.clientHeight * SMOOTH_MAX_VIEWPORTS;

    if (!useSmooth) {
      container.scrollTop = desiredTop;
      startConvergence();
      return;
    }

    const expectedAbsTop = container.scrollTop + initialOffset;
    const smoothDirection = Math.sign(desiredTop - container.scrollTop);
    const startedAt = Date.now();
    let prevScrollTop = container.scrollTop;
    let prevScrollHeight = container.scrollHeight;
    let stillFrames = 0;
    let scrollEnded = false;
    let frameId = 0;
    let monitorDone = false;

    const cleanupMonitor = () => {
      if (monitorDone) return;
      monitorDone = true;
      globalThis.cancelAnimationFrame?.(frameId);
      container.removeEventListener("scrollend", onScrollEnd);
    };

    const onScrollEnd = () => {
      scrollEnded = true;
    };

    const handoffToConvergence = () => {
      cleanupMonitor();
      if (!lease.isCurrent()) return;
      const liveOffset = measure();
      if (liveOffset === null) {
        complete("missing");
        return;
      }
      container.scrollTop = Math.max(0, container.scrollTop + liveOffset - targetOf());
      startConvergence();
    };

    container.addEventListener("scrollend", onScrollEnd, { passive: true });
    lease.onAbort(cleanupMonitor);
    container.scrollTo({ top: desiredTop, behavior: "smooth" });

    const monitor = () => {
      if (monitorDone || !lease.isCurrent()) {
        cleanupMonitor();
        return;
      }
      const currentOffset = measure();
      if (currentOffset === null) {
        cleanupMonitor();
        complete("missing");
        return;
      }
      const currentTarget = targetOf();
      const currentAbsTop = container.scrollTop + currentOffset;
      const absDrift = Math.abs(currentAbsTop - expectedAbsTop);
      if (absDrift > SMOOTH_DRIFT_CUTOFF_PX) {
        handoffToConvergence();
        return;
      }
      const error = Math.abs(currentOffset - currentTarget);
      if (error < 1) {
        cleanupMonitor();
        startConvergence();
        return;
      }
      const scrollStep = container.scrollTop - prevScrollTop;
      const heightStep = Math.abs(container.scrollHeight - prevScrollHeight);
      if (smoothDirection !== 0 && scrollStep * smoothDirection < -(heightStep + 16)) {
        cleanupMonitor();
        complete("aborted");
        return;
      }
      const moved = Math.abs(scrollStep);
      prevScrollTop = container.scrollTop;
      prevScrollHeight = container.scrollHeight;
      stillFrames = moved < 0.5 ? stillFrames + 1 : 0;
      if (scrollEnded || stillFrames >= SMOOTH_STILL_FRAMES || Date.now() - startedAt >= SMOOTH_TIMEOUT_MS) {
        handoffToConvergence();
        return;
      }
      frameId = globalThis.requestAnimationFrame?.(monitor) ?? 0;
    };

    frameId = globalThis.requestAnimationFrame?.(monitor) ?? 0;
  }

  private notify(): void {
    for (const listener of this.listeners) listener();
  }

  private recordTransition(entry: ViewportTransition): void {
    this.transitions.push(entry);
    if (this.transitions.length > TRANSITION_RING_LIMIT) {
      this.transitions.shift();
    }
    logSessionPerformanceEvent("viewport", {
      generation: entry.generation,
      event: entry.event,
      reason: entry.reason ?? "none",
      interrupted: entry.interrupted ?? "none",
      ...(entry.outcome ? { outcome: entry.outcome } : {}),
      ...(entry.errorPx !== undefined ? { errorPx: entry.errorPx } : {}),
      ...(entry.durationMs !== undefined ? { durationMs: entry.durationMs } : {}),
    });
  }
}
