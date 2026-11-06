import type { TaskSpec, DesktopConsent, RequiredGrant } from "../../shared/automation/spec";
import type {
  TaskView,
  TaskRevisionView,
  RunSummaryView,
  RunDetailView,
  InboxItem,
  FireRequest,
  FireResult,
  ResolveInboxRequest,
  ResolveInboxResult,
  SignalEmit,
} from "../../shared/automation/views";
import type { RunPhase } from "../../shared/automation/phases";
import type { SecretReader, AutomationChannelPort, AgentSessionPort } from "./exec/types";
export type { SecretReader, AutomationChannelPort, AgentSessionPort } from "./exec/types";
export interface RuntimeLimits {
  readonly maxConcurrentDrivers: number;
  readonly maxSchedulerSleepMs: number;
  readonly resumeGraceMs: number;
  readonly shutdownGraceMs: number;
  readonly maxOutputBytes: number;
}
export interface AutomationChange {
  readonly taskIds: readonly string[];
  readonly runIds: readonly string[];
  readonly inboxChanged: boolean;
}
export interface AutomationRuntimeDeps {
  readonly dataDirectory: string;
  readonly clock?: { now(): number };
  readonly channels: AutomationChannelPort;
  readonly agentSessions: AgentSessionPort;
  readonly secrets: SecretReader;
  readonly fetch?: typeof fetch;
  readonly limits?: Partial<RuntimeLimits>;
  readonly onError?: (error: unknown) => void;
}
export type RuntimeStatus =
  { readonly kind: "starting" | "ready" | "stopped" } | { readonly kind: "unavailable"; readonly reason: string };
export interface SaveTaskResult {
  readonly task: TaskView;
  readonly revision: number;
  readonly planHash: string;
  readonly requiredGrant: RequiredGrant;
}
export interface EnableTaskRequest extends DesktopConsent {
  readonly taskId: string;
  readonly revision: number;
  readonly planHash: string;
}
export interface ListRunsQuery {
  readonly taskId?: string;
  readonly phases?: readonly RunPhase[];
  readonly limit?: number;
  readonly beforeMs?: number;
}
export interface AutomationRuntime {
  status(): RuntimeStatus;
  start(): Promise<void>;
  stop(): Promise<void>;
  saveTask(spec: TaskSpec | unknown): Promise<SaveTaskResult>;
  enableTask(request: EnableTaskRequest): TaskView;
  disableTask(taskId: string): TaskView;
  deleteTask(taskId: string): void;
  listTasks(query?: { readonly cwd?: string }): readonly TaskView[];
  getTask(taskId: string, revision?: number): TaskRevisionView;
  startRun(request: FireRequest): FireResult;
  cancelRun(runId: string): Promise<RunSummaryView>;
  listRuns(query?: ListRunsQuery): readonly RunSummaryView[];
  getRun(runId: string): RunDetailView;
  listInbox(): readonly InboxItem[];
  resolveInbox(request: ResolveInboxRequest): ResolveInboxResult;
  emitSignal(taskId: string, emit: SignalEmit): { readonly woke: number };
  tickNow(): Promise<void>;
  subscribe(listener: (change: AutomationChange) => void): () => void;
}
