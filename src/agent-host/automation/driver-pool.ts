import type { AutomationStore, ClaimedRun, Clock } from "./store";
import { classifyCommit, planNext, contextFor } from "./core/run-machine";
import type { StepExecutors } from "./exec/types";

interface Driver {
  readonly controller: AbortController;
  task: Promise<void>;
}
export class DriverPool {
  private readonly active = new Map<string, Driver>();
  private stopping = false;
  private abandoned = false;
  private pumping = false;
  constructor(
    private readonly store: AutomationStore,
    private readonly executors: StepExecutors,
    private readonly clock: Clock,
    private readonly options: {
      readonly maxConcurrentDrivers: number;
      readonly maxOutputBytes: number;
      readonly onError: (error: unknown) => void;
    },
  ) {}
  pump(): void {
    if (this.stopping || this.pumping) return;
    this.pumping = true;
    try {
      while (this.active.size < this.options.maxConcurrentDrivers) {
        const claim = this.store.claimNextReady();
        if (!claim) break;
        const driver: Driver = { controller: new AbortController(), task: Promise.resolve() };
        this.active.set(claim.runId, driver);
        driver.task = Promise.resolve()
          .then(() => this.drive(claim, driver.controller.signal))
          .catch(this.options.onError)
          .finally(() => {
            this.active.delete(claim.runId);
            this.pump();
          });
      }
    } finally {
      this.pumping = false;
    }
  }
  async cancelRun(runId: string): Promise<void> {
    this.store.cancelRun(runId);
    const driver = this.active.get(runId);
    driver?.controller.abort();
    await driver?.task;
  }
  async shutdown(graceMs: number): Promise<void> {
    this.stopping = true;
    for (const driver of this.active.values()) driver.controller.abort();
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      await Promise.race([
        Promise.all([...this.active.values()].map((driver) => driver.task)),
        new Promise<void>((resolve) => {
          timer = setTimeout(resolve, graceMs);
        }),
      ]);
    } finally {
      if (timer) clearTimeout(timer);
      this.abandoned = true;
    }
  }
  private async drive(claim: ClaimedRun, signal: AbortSignal): Promise<void> {
    for (;;) {
      if (this.abandoned) return;
      if (this.store.getRun(claim.runId)?.phase === "cancelling") {
        this.store.settleCancelledRun(claim);
        return;
      }
      const view = this.store.readRun(claim);
      const move = planNext(view.run, view.plan, view.steps, view.attempts, view.signals, this.clock.now());
      if (move.kind !== "run_step") {
        if (this.store.commitMove(claim, move).kind !== "continue") return;
        continue;
      }
      const step = view.plan.steps[move.stepIndex];
      if (step.kind === "wait") throw new Error("Cannot execute a wait step");
      const history = view.attempts.filter((attempt) => attempt.stepIndex === move.stepIndex);
      const policy = history[0]?.policy ?? this.executors.policyFor(step);
      const ticket = this.store.beginAttempt(claim, move, policy);
      const observation = await this.executors.execute(step, {
        taskId: view.run.taskId,
        runId: view.run.id,
        stepId: step.id,
        attemptNo: ticket.attemptNo,
        effectKey: ticket.effectKey,
        cwd: view.plan.cwd,
        grant: view.grant,
        values: contextFor(view.run, view.plan, view.steps),
        signal,
        maxOutputBytes: this.options.maxOutputBytes,
        onSession: (sessionId) => this.store.attachSession(ticket, sessionId),
      });
      if (this.abandoned) return;
      const outcome = classifyCommit(
        observation,
        policy,
        history[0]?.startedAtMs ?? ticket.startedAtMs,
        history,
        this.clock.now(),
      );
      const result = this.store.settleAttempt(ticket, outcome);
      if (this.store.getRun(claim.runId)?.phase === "cancelling") {
        this.store.settleCancelledRun(claim);
        return;
      }
      if (result.kind !== "continue") return;
    }
  }
}
