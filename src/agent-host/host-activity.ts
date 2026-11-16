import { monitorEventLoopDelay } from "node:perf_hooks";
import { subscribeRpcRequestActivity } from "../contract/rpc";
import type { HostActivitySnapshot, HostToMain } from "../shared/host-protocol";

export interface HostActivityDeps {
  readonly post: (message: Extract<HostToMain, { type: "activity" }>) => void;
  readonly now?: () => number;
  readonly inFlightRequests?: () => number;
}

export class HostActivity {
  private current: HostActivitySnapshot = { running: [], starting: [] };
  private requestsActive = false;
  private readonly stopRequests: () => void;
  private readonly lag = monitorEventLoopDelay({ resolution: 20 });

  constructor(private readonly deps: HostActivityDeps) {
    this.lag.enable();
    this.stopRequests = deps.inFlightRequests ? subscribeRpcRequestActivity(() => this.observeRequests()) : () => {};
  }

  observe(next: HostActivitySnapshot): void {
    const activity = {
      running: [...new Set(next.running)].sort(),
      starting: [...new Set(next.starting)].sort(),
    };
    if (JSON.stringify(activity) === JSON.stringify(this.current)) return;
    this.current = activity;
    try {
      this.deps.post({ type: "activity", activity });
    } catch {}
  }

  private observeRequests(): void {
    const inFlightRequests = this.deps.inFlightRequests?.() ?? 0;
    const active = inFlightRequests > 0;
    if (active === this.requestsActive) return;
    this.requestsActive = active;
    try {
      this.deps.post({ type: "activity", activity: { ...this.current, inFlightRequests } });
    } catch {}
  }

  pong(seq: number): Extract<HostToMain, { type: "pong" }> {
    const lagMaxMs = Math.round(this.lag.max / 1e6);
    this.lag.reset();
    const activity = this.deps.inFlightRequests
      ? { ...this.current, inFlightRequests: this.deps.inFlightRequests() }
      : this.current;
    return { type: "pong", seq, ts: (this.deps.now ?? Date.now)(), lagMaxMs, activity };
  }

  dispose(): void {
    this.stopRequests();
    this.lag.disable();
  }
}
