import type { AutomationStore, Clock, DueTrigger } from "./store";
import { observeTickGap, type WatchSample } from "./core/triggers";

export class AutomationScheduler {
  private timer: ReturnType<typeof setTimeout> | null = null;
  private readonly inFlight = new Map<string, { controller: AbortController; task: Promise<void> }>();
  private running = false;
  private lastTickAtMs: number | null = null;
  private expectedMs = 60000;
  private probesDeferredUntil = 0;
  constructor(
    private readonly store: AutomationStore,
    private readonly probe: (due: DueTrigger, signal: AbortSignal) => Promise<WatchSample>,
    private readonly clock: Clock,
    private readonly options: { maxSleepMs: number; resumeGraceMs: number; onError: (error: unknown) => void },
  ) {}
  start(): void {
    if (this.running) return;
    this.running = true;
    this.lastTickAtMs = this.clock.now();
    this.rearm();
  }
  async stop(): Promise<void> {
    this.running = false;
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    for (const entry of this.inFlight.values()) entry.controller.abort();
    await Promise.all([...this.inFlight.values()].map((entry) => entry.task));
  }
  rearm(): void {
    if (!this.running) return;
    if (this.timer) clearTimeout(this.timer);
    const now = this.clock.now();
    const due = this.store.nextWakeAtMs(new Set(this.inFlight.keys()));
    const wake =
      this.probesDeferredUntil > now ? Math.max(due ?? now + this.options.maxSleepMs, this.probesDeferredUntil) : due;
    const delay = Math.max(0, Math.min(this.options.maxSleepMs, wake === null ? this.options.maxSleepMs : wake - now));
    this.expectedMs = Math.max(1, delay);
    this.timer = setTimeout(() => {
      this.timer = null;
      void this.tickNow().catch(this.options.onError);
    }, delay);
    this.timer.unref();
  }
  async tickNow(): Promise<void> {
    if (!this.running) return;
    const now = this.clock.now();
    const gap = observeTickGap(this.lastTickAtMs, now, this.expectedMs);
    this.lastTickAtMs = now;
    if (gap.discontinuity) this.probesDeferredUntil = now + this.options.resumeGraceMs;
    this.store.wakeDueRuns(now);
    for (const due of this.store.listDueTriggers(now, new Set(this.inFlight.keys()))) {
      if (due.plan.kind === "schedule") {
        this.store.tickSchedule(due, now);
        continue;
      }
      if (now < this.probesDeferredUntil) continue;
      const controller = new AbortController();
      const task = Promise.resolve()
        .then(() => this.probe(due, controller.signal))
        .then((sample) => {
          if (this.running) this.store.recordTriggerSample(due, sample, this.clock.now());
        })
        .catch(this.options.onError)
        .finally(() => {
          this.inFlight.delete(due.key);
          this.rearm();
        });
      this.inFlight.set(due.key, { controller, task });
    }
    this.rearm();
    await Promise.all([...this.inFlight.values()].map((entry) => entry.task));
  }
}
