import type { AutomationGuideTopic } from "../../../shared/automation/chat-tools";
import type { TaskSpec } from "../../../shared/automation/spec";

export const AUTOMATION_GUIDE_RECIPES: Readonly<Record<string, TaskSpec>> = {
  scheduledRepoDigestToChannel: {
    schema: "dexon.automation/v1",
    id: "daily-repo-digest",
    name: "Daily Repository Digest",
    description: "Summarize repository updates every weekday morning and send to a messaging channel.",
    cwd: "/path/to/workspace",
    triggers: [
      {
        id: "weekday-morning",
        kind: "schedule",
        cron: "0 9 * * 1-5",
        tz: "Asia/Shanghai",
        catchup: "skip",
      },
      {
        id: "manual",
        kind: "manual",
      },
    ],
    steps: [
      {
        id: "summarize",
        kind: "agent",
        title: "Summarize recent changes",
        prompt: "Inspect recent git commits and open issues in this workspace, then summarize key updates.",
        tools: ["read", "grep", "find"],
        effect: "read",
        output: {
          schema: {
            type: "object",
            required: ["headline", "markdown"],
            properties: {
              headline: { type: "string" },
              markdown: { type: "string" },
            },
            additionalProperties: false,
          },
        },
      },
      {
        id: "notify",
        kind: "action",
        title: "Send digest",
        call: {
          action: "channel.send",
          with: {
            to: { accountId: "replace-account-id", peerId: "replace-peer-id" },
            format: "markdown",
            text: { $tmpl: "**{{steps.summarize.output.headline}}**\n\n{{steps.summarize.output.markdown}}" },
          },
        },
      },
    ],
  },
  watchEndpointWithApproval: {
    schema: "dexon.automation/v1",
    id: "service-health-alert",
    name: "Service Health Alert with Approval",
    description: "Poll a health endpoint, diagnose failures, ask for approval, then trigger a recovery webhook.",
    cwd: "/path/to/workspace",
    triggers: [
      {
        id: "health-watch",
        kind: "watch",
        every: "5m",
        probe: {
          action: "http.request",
          with: {
            method: "GET",
            url: { origin: "https://status.example.com", path: "/health" },
            effect: "read",
          },
        },
        mode: {
          type: "threshold",
          healthy: { ref: "probe.ok", op: "eq", value: true },
          consecutive: 3,
          cooldown: "30m",
        },
      },
    ],
    steps: [
      {
        id: "diagnose",
        kind: "agent",
        title: "Diagnose incident",
        prompt: "Review the failed health probe facts and suggest whether a restart webhook should be triggered.",
        data: { trigger: { $ref: "trigger" } },
        tools: ["read", "grep"],
        effect: "read",
        stopRunIf: { ref: "steps.diagnose.output.shouldRestart", op: "ne", value: true },
        output: {
          schema: {
            type: "object",
            required: ["summary", "shouldRestart"],
            properties: {
              summary: { type: "string" },
              shouldRestart: { type: "boolean" },
            },
            additionalProperties: false,
          },
        },
      },
      {
        id: "confirm-restart",
        kind: "wait",
        expiresIn: "2h",
        onTimeout: "fail",
        wait: {
          kind: "approval",
          title: "Approve service recovery webhook?",
          prompt: { $tmpl: "{{steps.diagnose.output.summary}}" },
          show: { summary: { $ref: "steps.diagnose.output.summary" } },
        },
      },
      {
        id: "trigger-recovery",
        kind: "action",
        when: { ref: "steps.confirm-restart.output.approved", op: "eq", value: true },
        call: {
          action: "http.request",
          with: {
            method: "POST",
            url: { origin: "https://ops.example.com", path: "/recover" },
            secretHeaders: { Authorization: "ops.webhook-token" },
            body: { runId: { $ref: "run.id" }, reason: { $ref: "steps.diagnose.output.summary" } },
            effect: "unsafe",
          },
        },
      },
    ],
  },
};

const SECTIONS: Readonly<Record<AutomationGuideTopic, string>> = {
  playbook: [
    "## Playbook: From intent to a safe draft",
    "- Clarify only missing decisions: schedule/timezone or condition, target absolute `cwd`, key steps, external writes and approvals, and notification target. Reuse known context, ask concisely, and avoid a blanket questionnaire.",
    "- For an existing repository, confirm its real absolute path with the user or workspace inspection; never fabricate it or assume the current session directory is the target.",
    '- For a standalone task, default `cwd` to `<managedAutomationRoot>/<taskId>` using `managedAutomationRoot` from `automation_inspect(view: "capabilities")`.',
    '- Place an approval wait step (`wait.kind: "approval"`) before destructive or mutating external actions and gate each write on `approved: true`, unless the user explicitly authorizes those unattended writes. Enabling a task is not blanket permission for unattended writes.',
    '- Reference secrets by lowercase name and use `automation_request_user_action(action: "configure_secret")` for secure entry; never request or include secret values in chat or specs.',
    "- Always call `automation_validate` and fix all issues before `automation_save_draft`; saving never enables a task. Explain that updating an enabled task with a new draft pauses its triggers until the user enables the new revision.",
  ].join("\n"),
  core: [
    "## Core (`dexon.automation/v1`)",
    '- Required top-level fields: `schema: "dexon.automation/v1"`, `id` (unique non-empty string, recommend kebab-case), `name`, `cwd` (absolute path), `triggers` (non-empty array), `steps` (non-empty array).',
    '- Optional top-level fields: `description`, `inputSchema` (JSON Schema for manual/trigger input), `concurrency` (`{ maxExecuting?: int >= 1, lane?: { key?: Text, capacity: int >= 1, overflow: "skip" | "queue" | "latest", maxPending?: int >= 0 } }`).',
    '- Durations use `<number><unit>` where unit is `s`, `m`, `h`, or `d` (e.g. `"30s"`, `"15m"`, `"2h"`, `"1d"`).',
    "- Secret names must match `/^[a-z0-9._-]{1,80}$/` (lowercase only, e.g. `github.token`). Never put secret values in specs or chat.",
    '- Effect declarations (`effect`): `"read"`, `"unsafe"`, or `{ idempotent: { window: Duration | "forever" } }`. `script.run` requires explicit `effect`.',
    "- Authoring workflow: call `automation_validate` before `automation_save_draft`. Saving creates an unenabled draft revision; the user enables it via the review card.",
  ].join("\n"),
  triggers: [
    "## Triggers (`triggers[]`)",
    '- Every trigger requires a unique `id` and `kind`: `"manual" | "schedule" | "watch"`.',
    '- `manual`: `{ id: "manual", kind: "manual" }`.',
    '- `schedule`: provide EXACTLY ONE of `cron` (5-field cron string + optional `tz` IANA timezone) OR `every` (Duration). Optional: `catchup: "skip" | "once"`, `catchupWindow: Duration`, `input` (static JSON).',
    '- `watch`: `{ id, kind: "watch", every: Duration (>= 30s), probe, staleResetGap?: Duration, mode }`.',
    '  - `probe` must be read-only: either `http.request` (`method: "GET" | "HEAD"`, `effect?: "read"`) or `script.run` (`effect: "read"`, relative path inside `cwd`).',
    '  - `mode` is either `{ type: "threshold", healthy: Cond, consecutive: int >= 1, cooldown?: Duration, staleResetGap?: Duration }` (refs allowed: `probe.ok`, `probe.output`, `probe.output.*`) OR `{ type: "items", itemsPath, keyPath, cursorPath?, dedupeWindow?, match?: Cond, emit: { startRun: { input? } } | { emitSignal: string, payload? } }` (refs allowed: `item`, `item.*`).',
  ].join("\n"),
  steps: [
    "## Steps (`steps[]`)",
    '- Common fields on every step: `id` (unique), `title?`, `when?: Cond`, `stopRunIf?: Cond`, `timeout?: Duration`, `onFailure?: "fail_run" | "continue"`. Non-wait steps also accept `retry?: { maxAttempts: int >= 1, backoff: Duration, factor?: number >= 1 }` and `onUnknown?: "attention" | "continue"`.',
    '- `kind: "agent"`: `{ id, kind: "agent", prompt: Text, data?: Value, tools: ("read" | "write" | "edit" | "bash" | "grep" | "find")[], effect?, model?: { provider, modelId }, thinkingLevel?: "off" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max", output: { schema: JsonSchema } }`.',
    "  - Agent steps run in an isolated session and MUST return structured JSON matching `output.schema`.",
    '- `kind: "action"`: `{ id, kind: "action", call }` where `call` is one of:',
    '  - `http.request`: `{ action: "http.request", with: { method?, url: { origin, path?: Text, query?: Record<string, Text> }, headers?: Record<string, Text>, secretHeaders?: Record<string, SecretName>, body?: Value, timeout?: Duration, effect? } }`. `url.origin` must be a static `http://` or `https://` origin with no path/credentials. Note: HTTP 2xx responses are treated as success.',
    '  - `channel.send`: `{ action: "channel.send", with: { to: { accountId, peerId }, text: Text, format?: "text" | "markdown" } }`. Discover valid static `accountId` and `peerId` via `automation_inspect(view: "capabilities")`.',
    '  - `script.run`: `{ action: "script.run", with: { path, args?: Value, effect: EffectDecl, secrets?: SecretName[], timeout?: Duration } }`. `path` must be relative and inside `cwd`, and the file must already exist so its SHA-256 can be pinned.',
    '- `kind: "wait"`: `{ id, kind: "wait", expiresIn?: Duration, onTimeout?: "fail" | "continue", wait }` where `wait` is:',
    '  - `approval`: `{ kind: "approval", title: Text, prompt?: Text, show?: Value, fields?: JsonSchema, defaults?: Value, notify?: { to: { accountId, peerId }, text?: Text } }`. Settled step output has `{ approved: boolean, data?: ... }`.',
    '  - `signal`: `{ kind: "signal", signal: string, key: Text, history?: "run-start" | "retained" }`.',
    '  - `duration`: `{ kind: "duration", duration: Duration }`.',
  ].join("\n"),
  expressions: [
    "## References, Templates, and Conditions",
    '- `Text`: either a plain string OR `{ $tmpl: "Hello {{steps.prev.output.name}}" }`.',
    '- `Value`: plain JSON, `{ $ref: "steps.prev.output.items" }`, `{ $tmpl: "..." }`, or nested arrays/objects of `Value`.',
    "- Allowed step reference roots: `input`, `input.*`, `trigger`, `trigger.*`, `steps.<earlierStepId>.output`, `steps.<earlierStepId>.output.*`, `run.id`, `task.name`. Only `stopRunIf` may also reference the current step's own output (`steps.<selfId>.output`).",
    '- `Cond`: `{ all: Cond[] }`, `{ any: Cond[] }`, `{ not: Cond }`, or `{ ref: path, op: "eq" | "ne" | "gt" | "gte" | "lt" | "lte" | "in" | "contains" | "exists", value?: Json }`.',
    "- Literal fields (`id`, `name`, `cwd`, `url.origin`, `script.path`, `channel.to.*`, `cron`, `signal`) cannot contain `{{` templates.",
  ].join("\n"),
  recipes: [
    "## Validated Recipes",
    "### Recipe 1: Scheduled repo digest sent to a messaging channel",
    "```json",
    JSON.stringify(AUTOMATION_GUIDE_RECIPES.scheduledRepoDigestToChannel, null, 2),
    "```",
    "### Recipe 2: Watch health endpoint with diagnosis, human approval, and webhook",
    "```json",
    JSON.stringify(AUTOMATION_GUIDE_RECIPES.watchEndpointWithApproval, null, 2),
    "```",
  ].join("\n"),
};

export function buildAutomationGuide(topics?: readonly AutomationGuideTopic[]): {
  readonly schema: "dexon.automation/v1";
  readonly topics: readonly AutomationGuideTopic[];
  readonly guide: string;
} {
  const selected: readonly AutomationGuideTopic[] =
    topics && topics.length > 0 ? topics : ["playbook", "core", "recipes"];
  return {
    schema: "dexon.automation/v1",
    topics: selected,
    guide: selected.map((topic) => SECTIONS[topic]).join("\n\n"),
  };
}
