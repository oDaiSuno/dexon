import { monitorEventLoopDelay } from "node:perf_hooks";
import type { HostActivitySnapshot, HostToMain } from "../shared/host-protocol";

export interface HostActivityDeps {
  readonly post: (message: Extract<HostToMain, { type: "activity" }>) => void;
  readonly now?: () => number;
}

export class HostActivity {
  private current: HostActivitySnapshot = { running: [], starting: [] };
  private readonly lag = monitorEventLoopDelay({ resolution: 20 });

  constructor(private readonly deps: HostActivityDeps) {
    this.lag.enable();
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

  pong(seq: number): Extract<HostToMain, { type: "pong" }> {
    const lagMaxMs = Math.round(this.lag.max / 1e6);
    this.lag.reset();
    return { type: "pong", seq, ts: (this.deps.now ?? Date.now)(), lagMaxMs, activity: this.current };
  }

  dispose(): void {
    this.lag.disable();
  }
}
