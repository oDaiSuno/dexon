import {
  sqlEnumList,
  RUN_PHASES,
  STEP_STATUSES,
  COMMIT_OUTCOMES,
  TRIGGER_KINDS,
  TRIGGER_LIFECYCLES,
  WAIT_KINDS,
  ATTEMPT_ORIGINS,
  LANE_OVERFLOW_POLICIES,
  LIVE_RUN_PHASES,
  END_RUN_PHASES,
} from "../../../shared/automation/phases";

export function generateSchema(): string {
  return `
CREATE TABLE IF NOT EXISTS tasks (
  id               TEXT PRIMARY KEY,
  name             TEXT NOT NULL,
  cwd              TEXT NOT NULL,
  current_revision INTEGER NOT NULL,
  enabled_revision INTEGER CHECK (enabled_revision IS NULL OR enabled_revision = current_revision),
  created_at_ms    INTEGER NOT NULL,
  updated_at_ms    INTEGER NOT NULL,
  FOREIGN KEY (id, current_revision) REFERENCES task_revisions (task_id, revision) DEFERRABLE INITIALLY DEFERRED,
  FOREIGN KEY (id, enabled_revision) REFERENCES grants (task_id, revision) DEFERRABLE INITIALLY DEFERRED
) STRICT;

CREATE TABLE IF NOT EXISTS task_revisions (
  task_id             TEXT NOT NULL REFERENCES tasks (id) ON DELETE CASCADE DEFERRABLE INITIALLY DEFERRED,
  revision            INTEGER NOT NULL CHECK (revision >= 1),
  source_json         TEXT NOT NULL,
  plan_json           TEXT NOT NULL,
  plan_hash           TEXT NOT NULL,
  required_grant_json TEXT NOT NULL,
  created_at_ms       INTEGER NOT NULL,
  PRIMARY KEY (task_id, revision)
) STRICT;

CREATE TABLE IF NOT EXISTS grants (
  task_id                     TEXT NOT NULL,
  revision                    INTEGER NOT NULL,
  plan_hash                   TEXT NOT NULL,
  grant_json                  TEXT NOT NULL,
  unattended_write_approved   INTEGER NOT NULL CHECK (unattended_write_approved IN (0, 1)),
  trusted_local_exec_approved INTEGER NOT NULL CHECK (trusted_local_exec_approved IN (0, 1)),
  confirmed_at_ms             INTEGER NOT NULL,
  PRIMARY KEY (task_id, revision),
  FOREIGN KEY (task_id, revision) REFERENCES task_revisions (task_id, revision) ON DELETE CASCADE
) STRICT;

CREATE TABLE IF NOT EXISTS triggers (
  task_id         TEXT NOT NULL,
  revision        INTEGER NOT NULL,
  trigger_id      TEXT NOT NULL,
  kind            TEXT NOT NULL CHECK (kind IN (${sqlEnumList(TRIGGER_KINDS)})),
  lifecycle       TEXT NOT NULL CHECK (lifecycle IN (${sqlEnumList(TRIGGER_LIFECYCLES)})),
  armed_at_ms     INTEGER NOT NULL,
  next_due_at_ms  INTEGER NOT NULL,
  state_json      TEXT NOT NULL,
  last_error_json TEXT,
  PRIMARY KEY (task_id, revision, trigger_id),
  FOREIGN KEY (task_id, revision) REFERENCES grants (task_id, revision) ON DELETE CASCADE
) STRICT;

CREATE INDEX IF NOT EXISTS triggers_due ON triggers (next_due_at_ms);

CREATE TABLE IF NOT EXISTS runs (
  id             TEXT PRIMARY KEY,
  task_id        TEXT NOT NULL,
  revision       INTEGER NOT NULL,
  version        INTEGER NOT NULL DEFAULT 1,
  trigger_json   TEXT NOT NULL,
  input_json     TEXT NOT NULL,
  dedupe_key     TEXT,
  lane_key       TEXT,
  lane_capacity  INTEGER,
  lane_overflow  TEXT CHECK (lane_overflow IN (${sqlEnumList(LANE_OVERFLOW_POLICIES)})),
  max_executing  INTEGER NOT NULL CHECK (max_executing >= 1),
  phase          TEXT NOT NULL CHECK (phase IN (${sqlEnumList(RUN_PHASES)})),
  admitted_at_ms INTEGER,
  lease_token    TEXT,
  wake_at_ms     INTEGER,
  end_json       TEXT,
  created_at_ms  INTEGER NOT NULL,
  updated_at_ms  INTEGER NOT NULL,
  ended_at_ms    INTEGER,
  FOREIGN KEY (task_id, revision) REFERENCES grants (task_id, revision) ON DELETE CASCADE,
  CHECK ((lane_key IS NULL) = (lane_capacity IS NULL)),
  CHECK ((lane_key IS NULL) = (lane_overflow IS NULL)),
  CHECK (phase <> 'pending' OR (admitted_at_ms IS NULL AND lane_key IS NOT NULL)),
  CHECK (phase NOT IN (${sqlEnumList(LIVE_RUN_PHASES)}) OR admitted_at_ms IS NOT NULL),
  CHECK (phase <> 'superseded' OR admitted_at_ms IS NULL),
  CHECK ((phase IN ('running','cancelling')) = (lease_token IS NOT NULL)),
  CHECK ((phase = 'backoff') = (wake_at_ms IS NOT NULL)),
  CHECK ((phase IN (${sqlEnumList(END_RUN_PHASES)})) = (ended_at_ms IS NOT NULL)),
  CHECK ((ended_at_ms IS NULL) = (end_json IS NULL))
) STRICT;

CREATE UNIQUE INDEX IF NOT EXISTS runs_dedupe ON runs (task_id, dedupe_key)
  WHERE dedupe_key IS NOT NULL AND phase NOT IN ('cancelled', 'superseded');
CREATE UNIQUE INDEX IF NOT EXISTS runs_singleton_lane ON runs (lane_key)
  WHERE lane_capacity = 1 AND phase IN (${sqlEnumList(LIVE_RUN_PHASES)});
CREATE UNIQUE INDEX IF NOT EXISTS runs_latest_pending ON runs (lane_key)
  WHERE lane_overflow = 'latest' AND phase = 'pending';
CREATE INDEX IF NOT EXISTS runs_lane_live ON runs (lane_key) WHERE lane_key IS NOT NULL AND phase IN (${sqlEnumList(LIVE_RUN_PHASES)});
CREATE INDEX IF NOT EXISTS runs_lane_pending ON runs (lane_key, created_at_ms) WHERE phase = 'pending';
CREATE INDEX IF NOT EXISTS runs_ready ON runs (admitted_at_ms, created_at_ms) WHERE phase = 'ready';
CREATE INDEX IF NOT EXISTS runs_executing ON runs (task_id) WHERE phase IN ('running','cancelling');
CREATE INDEX IF NOT EXISTS runs_backoff_due ON runs (wake_at_ms) WHERE phase = 'backoff';
CREATE INDEX IF NOT EXISTS runs_by_task ON runs (task_id, created_at_ms DESC);

CREATE TABLE IF NOT EXISTS steps (
  run_id        TEXT NOT NULL REFERENCES runs (id) ON DELETE CASCADE,
  step_index    INTEGER NOT NULL CHECK (step_index >= 0),
  status        TEXT NOT NULL CHECK (status IN (${sqlEnumList(STEP_STATUSES)})),
  output_json   TEXT,
  error_json    TEXT,
  wait_kind     TEXT CHECK (wait_kind IN (${sqlEnumList(WAIT_KINDS)})),
  signal_name   TEXT,
  signal_key    TEXT,
  wake_at_ms    INTEGER,
  expires_at_ms INTEGER,
  request_json  TEXT,
  opened_at_ms  INTEGER NOT NULL,
  settled_at_ms INTEGER,
  PRIMARY KEY (run_id, step_index),
  CHECK ((status = 'waiting') = (settled_at_ms IS NULL)),
  CHECK (status <> 'waiting' OR wait_kind IS NOT NULL),
  CHECK (status <> 'done' OR output_json IS NOT NULL),
  CHECK (status NOT IN ('failed','unknown') OR error_json IS NOT NULL),
  CHECK (wait_kind IS NOT 'signal' OR (signal_name IS NOT NULL AND signal_key IS NOT NULL)),
  CHECK (wait_kind IS NOT 'approval' OR request_json IS NOT NULL),
  CHECK (wait_kind IS NOT 'duration' OR wake_at_ms IS NOT NULL)
) STRICT;

CREATE INDEX IF NOT EXISTS steps_signal_open ON steps (signal_name, signal_key) WHERE status = 'waiting' AND wait_kind = 'signal';
CREATE INDEX IF NOT EXISTS steps_approval_open ON steps (opened_at_ms) WHERE status = 'waiting' AND wait_kind = 'approval';
CREATE INDEX IF NOT EXISTS steps_wake_due ON steps (wake_at_ms) WHERE status = 'waiting' AND wait_kind = 'duration';
CREATE INDEX IF NOT EXISTS steps_expiry_due ON steps (expires_at_ms) WHERE status = 'waiting' AND expires_at_ms IS NOT NULL;
CREATE INDEX IF NOT EXISTS steps_unknown ON steps (settled_at_ms) WHERE status = 'unknown';

CREATE TABLE IF NOT EXISTS attempts (
  run_id        TEXT NOT NULL REFERENCES runs (id) ON DELETE CASCADE,
  step_index    INTEGER NOT NULL,
  attempt_no    INTEGER NOT NULL CHECK (attempt_no >= 1),
  effect_key    TEXT NOT NULL,
  policy_json   TEXT NOT NULL,
  lease_token   TEXT NOT NULL,
  session_id    TEXT,
  origin        TEXT NOT NULL CHECK (origin IN (${sqlEnumList(ATTEMPT_ORIGINS)})),
  started_at_ms INTEGER NOT NULL,
  settled_at_ms INTEGER,
  outcome       TEXT CHECK (outcome IN (${sqlEnumList(COMMIT_OUTCOMES)})),
  detail_json   TEXT,
  PRIMARY KEY (run_id, step_index, attempt_no),
  CHECK ((outcome IS NULL) = (settled_at_ms IS NULL))
) STRICT;

CREATE UNIQUE INDEX IF NOT EXISTS attempts_one_open_per_run ON attempts (run_id) WHERE outcome IS NULL;

CREATE TABLE IF NOT EXISTS signals (
  task_id             TEXT NOT NULL REFERENCES tasks (id) ON DELETE CASCADE,
  name                TEXT NOT NULL,
  key                 TEXT NOT NULL,
  event_id            TEXT NOT NULL,
  payload_json        TEXT NOT NULL,
  first_emitted_at_ms INTEGER NOT NULL,
  last_emitted_at_ms  INTEGER NOT NULL,
  PRIMARY KEY (task_id, name, key)
) STRICT, WITHOUT ROWID;

CREATE INDEX IF NOT EXISTS signals_gc ON signals (last_emitted_at_ms);

CREATE TABLE IF NOT EXISTS command_receipts (
  scope          TEXT NOT NULL,
  request_id     TEXT NOT NULL,
  request_digest TEXT NOT NULL,
  result_json    TEXT NOT NULL,
  committed_ms   INTEGER NOT NULL,
  PRIMARY KEY (scope, request_id)
) STRICT;
`.trim();
}
