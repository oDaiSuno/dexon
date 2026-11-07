import type {
  RunPhase,
  StepStatus,
  WaitKind,
  CommitOutcomeKind,
  AttemptOrigin,
  TriggerLifecycle,
  TriggerKind,
} from "../../../shared/automation/phases";
export interface TaskRow {
  id: string;
  name: string;
  cwd: string;
  current_revision: number;
  enabled_revision: number | null;
  created_at_ms: number;
  updated_at_ms: number;
}
export interface RevisionRow {
  task_id: string;
  revision: number;
  source_json: string;
  plan_json: string;
  plan_hash: string;
  required_grant_json: string;
  created_at_ms: number;
}
export interface RunRow {
  id: string;
  task_id: string;
  revision: number;
  version: number;
  trigger_json: string;
  input_json: string;
  dedupe_key: string | null;
  lane_key: string | null;
  lane_capacity: number | null;
  lane_overflow: string | null;
  max_executing: number;
  phase: RunPhase;
  admitted_at_ms: number | null;
  lease_token: string | null;
  wake_at_ms: number | null;
  end_json: string | null;
  created_at_ms: number;
  updated_at_ms: number;
  ended_at_ms: number | null;
}
export interface StepRow {
  run_id: string;
  step_index: number;
  status: StepStatus;
  output_json: string | null;
  error_json: string | null;
  wait_kind: WaitKind | null;
  signal_name: string | null;
  signal_key: string | null;
  wake_at_ms: number | null;
  expires_at_ms: number | null;
  request_json: string | null;
  opened_at_ms: number;
  settled_at_ms: number | null;
}
export interface AttemptRow {
  run_id: string;
  step_index: number;
  attempt_no: number;
  effect_key: string;
  policy_json: string;
  lease_token: string;
  session_id: string | null;
  origin: AttemptOrigin;
  started_at_ms: number;
  settled_at_ms: number | null;
  outcome: CommitOutcomeKind | null;
  detail_json: string | null;
}
export interface TriggerRow {
  task_id: string;
  revision: number;
  trigger_id: string;
  kind: TriggerKind;
  lifecycle: TriggerLifecycle;
  armed_at_ms: number;
  next_due_at_ms: number;
  state_json: string;
  last_error_json: string | null;
}
