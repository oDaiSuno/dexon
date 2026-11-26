import { Type } from "typebox";
import {
  AUTOMATION_GUIDE_TOPICS,
  AUTOMATION_USER_ACTIONS,
  type AutomationGuideTopic,
  type AutomationToolDetails,
} from "../../../shared/automation/chat-tools";
import { RUN_PHASES } from "../../../shared/automation/phases";
import { ATTENTION_ACTIONS } from "../../../shared/automation/views";
import { defineDexonTool, type DexonToolDefinition } from "../../agent-session/tool-definition";
import { getBrowserSessionSource } from "../../browser-tools";
import { peekAutomationChatHost, type AutomationChatHostContext } from "./context";
import { buildAutomationGuide } from "./guide";
import {
  saveAutomationDraft,
  stopAutomation,
  validateAutomationSpec,
  type SaveDraftInput,
  type StopInput,
  type ValidateInput,
} from "./authoring";
import { inspectAutomation, type InspectInput } from "./inspect";
import { requestAutomationUserAction, type RequestUserActionInput } from "./user-actions";

type ToolContext = { sessionManager: { getSessionId(): string } };

const AUTOMATION_PROMPT_GUIDELINES = [
  "Before authoring or editing an automation task spec, load automation_guide with the 'playbook' and needed schema topics once in the session. Follow the playbook and call automation_inspect(view: 'capabilities') to choose the task cwd and any messaging targets.",
  "Always call automation_validate before automation_save_draft. Stop and ask the user if validation fails 3 times in a row.",
  "Never ask the user to paste secret values (tokens, passwords, API keys) into chat. Reference secrets by lowercase name matching /^[a-z0-9._-]{1,80}$/ and use automation_request_user_action(action: 'configure_secret') so the user enters them in the secure desktop vault.",
  "You cannot enable tasks, approve wait steps, resolve ambiguous side effects, delete tasks, or trigger runs directly; hand those to the user via automation_save_draft or automation_request_user_action.",
];

function buildTaskSpecSchema(allowEmptyLists: boolean) {
  return Type.Object(
    {
      schema: Type.Literal("dexon.automation/v1", {
        description: "Task schema version; must be 'dexon.automation/v1'.",
      }),
      id: Type.String({
        minLength: 1,
        maxLength: 256,
        description: "Stable unique task identifier (recommend lowercase kebab-case like 'daily-pr-digest').",
      }),
      name: Type.String({
        minLength: 1,
        maxLength: 256,
        description: "Human-readable task title shown in the UI and confirmation dialog.",
      }),
      description: Type.Optional(
        Type.String({
          maxLength: 2_000,
          description: "Optional short description of the task's purpose.",
        }),
      ),
      cwd: Type.String({
        minLength: 1,
        maxLength: 4_096,
        description: "Absolute workspace directory path where agent steps and relative scripts run.",
      }),
      inputSchema: Type.Optional(
        Type.Record(Type.String(), Type.Unknown(), {
          description: "Optional JSON Schema validating manual or trigger run input.",
        }),
      ),
      triggers: Type.Array(Type.Record(Type.String(), Type.Unknown()), {
        ...(allowEmptyLists ? {} : { minItems: 1 }),
        description:
          "Non-empty list of triggers (kind: 'manual' | 'schedule' | 'watch'). See automation_guide(topics: ['triggers']).",
      }),
      steps: Type.Array(Type.Record(Type.String(), Type.Unknown()), {
        ...(allowEmptyLists ? {} : { minItems: 1 }),
        description:
          "Non-empty ordered list of steps (kind: 'agent' | 'action' | 'wait'). See automation_guide(topics: ['steps']).",
      }),
      concurrency: Type.Optional(
        Type.Record(Type.String(), Type.Unknown(), {
          description: "Optional concurrency limits (maxExecuting and lane capacity/overflow).",
        }),
      ),
    },
    {
      additionalProperties: false,
      description: "Complete dexon.automation/v1 task definition.",
    },
  );
}

const ValidateTaskSpecSchema = buildTaskSpecSchema(true);
const TaskSpecSchema = buildTaskSpecSchema(false);

function formatResult(payload: unknown, details?: AutomationToolDetails) {
  return {
    content: [{ type: "text" as const, text: JSON.stringify(payload, null, 2) }],
    details,
  };
}

function enter(ctx: ToolContext, hostOverride?: AutomationChatHostContext): AutomationChatHostContext {
  if (getBrowserSessionSource(ctx.sessionManager) === "channel") {
    throw new Error("Automation management tools are unavailable for messaging-channel turns");
  }
  const host = hostOverride ?? peekAutomationChatHost();
  if (!host || host.runtime.status().kind !== "ready") {
    throw new Error("Automation runtime is not ready in this environment");
  }
  return host;
}

export function createAutomationChatToolDefinitions(
  sessionCwd: string,
  hostOverride?: AutomationChatHostContext,
): DexonToolDefinition[] {
  return [
    defineDexonTool({
      dexonOwner: "automation",
      name: "automation_inspect",
      label: "inspect automation",
      description:
        "Read-only inspection of automation state in the current environment. Use view 'tasks' to list tasks, 'task' to read a task's full spec and grants, 'runs' to list recent runs (summary only), 'run' to inspect one run (pass stepIndex to read a specific step's full output/error), 'inbox' to list pending approvals and attention items, or 'capabilities' to discover the current workspace cwd, managedAutomationRoot for standalone task directories, and configured messaging channel targets (accountId and peerId). Never returns secret values or enumerates the secret vault.",
      promptSnippet: "automation_inspect: read automation tasks, runs, step errors, inbox items, or available channels",
      promptGuidelines: AUTOMATION_PROMPT_GUIDELINES,
      parameters: Type.Object(
        {
          view: Type.Union(
            [
              Type.Literal("tasks"),
              Type.Literal("task"),
              Type.Literal("runs"),
              Type.Literal("run"),
              Type.Literal("inbox"),
              Type.Literal("capabilities"),
            ],
            { description: "What to inspect." },
          ),
          taskId: Type.Optional(
            Type.String({
              minLength: 1,
              maxLength: 256,
              description: "Required when view is 'task'. Optional task filter when view is 'runs'.",
            }),
          ),
          revision: Type.Optional(
            Type.Integer({
              minimum: 1,
              description: "Only for view 'task'. Specific revision number to read; defaults to the latest revision.",
            }),
          ),
          cwd: Type.Optional(
            Type.String({
              minLength: 1,
              maxLength: 4_096,
              description: "Only for view 'tasks'. Optional workspace directory filter.",
            }),
          ),
          runId: Type.Optional(
            Type.String({
              minLength: 1,
              maxLength: 256,
              description: "Required when view is 'run'.",
            }),
          ),
          stepIndex: Type.Optional(
            Type.Integer({
              minimum: 0,
              description:
                "Only for view 'run'. When omitted, returns compact step previews; when provided, returns bounded output and error details for that step.",
            }),
          ),
          phases: Type.Optional(
            Type.Array(Type.Union(RUN_PHASES.map((phase) => Type.Literal(phase))), {
              minItems: 1,
              maxItems: RUN_PHASES.length,
              uniqueItems: true,
              description: "Only for view 'runs'. Filter runs by phase.",
            }),
          ),
          limit: Type.Optional(
            Type.Integer({
              minimum: 1,
              maximum: 50,
              description: "Only for view 'runs'. Maximum runs to return (default 20, max 50).",
            }),
          ),
          beforeMs: Type.Optional(
            Type.Integer({
              minimum: 0,
              description:
                "Only for view 'runs'. Pagination cursor returning runs created before this Unix timestamp in milliseconds.",
            }),
          ),
        },
        { additionalProperties: false },
      ),
      async execute(_toolCallId, input, _signal, _onUpdate, ctx) {
        const host = enter(ctx, hostOverride);
        const outcome = await inspectAutomation(host, sessionCwd, input as InspectInput);
        return formatResult(outcome.payload, outcome.details);
      },
    }),
    defineDexonTool({
      dexonOwner: "automation",
      name: "automation_guide",
      label: "read automation guide",
      description:
        "Load the automation authoring playbook, exact dexon.automation/v1 specification reference, field constraints, and validated examples on demand. Before writing or modifying a task spec, load 'playbook' and any needed schema topics not yet loaded in this session.",
      promptSnippet: "automation_guide: load the authoring playbook, exact schema rules, and recipes before authoring",
      parameters: Type.Object(
        {
          topics: Type.Optional(
            Type.Array(Type.Union(AUTOMATION_GUIDE_TOPICS.map((topic) => Type.Literal(topic))), {
              minItems: 1,
              maxItems: AUTOMATION_GUIDE_TOPICS.length,
              uniqueItems: true,
              description:
                "Reference sections to load (defaults to ['playbook', 'core', 'recipes']). 'playbook': clarify intent, choose cwd, approvals, secrets, safe draft workflow; 'core': top-level structure, limits, secrets, effects, concurrency; 'triggers': manual, schedule, watch; 'steps': agent, http.request, channel.send, script.run, waits; 'expressions': $ref, $tmpl, conditions; 'recipes': complete validated examples.",
            }),
          ),
        },
        { additionalProperties: false },
      ),
      async execute(_toolCallId, input, _signal, _onUpdate, ctx) {
        enter(ctx, hostOverride);
        const topics = (input as { topics?: readonly AutomationGuideTopic[] }).topics;
        const guide = buildAutomationGuide(topics);
        return formatResult(guide, { summary: guide.topics.join(", ") });
      },
    }),
    defineDexonTool({
      dexonOwner: "automation",
      name: "automation_validate",
      label: "validate automation spec",
      description:
        "Dry-run validate a dexon.automation/v1 task spec without writing to the database. Returns structured field-level validation issues (if any), the derived permission summary (requiredGrant), planHash, and upgrade impact (such as permission changes or whether saving will pause a currently enabled revision). Always call this and fix all issues before calling automation_save_draft.",
      promptSnippet: "automation_validate: dry-run validate a task spec and preview permissions without saving",
      parameters: Type.Object(
        {
          mode: Type.Union([Type.Literal("create"), Type.Literal("update")], {
            description:
              "'create' rejects an already-existing task id; 'update' requires an existing task and matching expectedRevision.",
          }),
          expectedRevision: Type.Optional(
            Type.Integer({
              minimum: 1,
              description: "Required when mode is 'update'. Must match the task's currentRevision.",
            }),
          ),
          spec: ValidateTaskSpecSchema,
        },
        { additionalProperties: false },
      ),
      async execute(_toolCallId, input, _signal, _onUpdate, ctx) {
        const host = enter(ctx, hostOverride);
        const outcome = validateAutomationSpec(host, input as ValidateInput);
        return formatResult(outcome.payload, outcome.details);
      },
    }),
    defineDexonTool({
      dexonOwner: "automation",
      name: "automation_save_draft",
      label: "save automation draft",
      description:
        "Persist a validated dexon.automation/v1 task as an unenabled draft revision and display a review card in chat so the user can inspect permissions, configure any missing secrets, and enable it via the desktop authorization dialog. Saving never enables the task. Always call automation_validate first. Note: updating an existing task disarms its currently enabled revision until the user enables the new revision—inform the user clearly if an active task was paused.",
      promptSnippet: "automation_save_draft: save a validated task draft and show the review/enable card",
      parameters: Type.Object(
        {
          mode: Type.Union([Type.Literal("create"), Type.Literal("update")], {
            description: "'create' for a new task; 'update' to save a new revision of an existing task.",
          }),
          expectedRevision: Type.Optional(
            Type.Integer({
              minimum: 1,
              description: "Required when mode is 'update'. Must match currentRevision.",
            }),
          ),
          spec: TaskSpecSchema,
          summary: Type.String({
            minLength: 1,
            maxLength: 300,
            description:
              "Concise plain-language summary of what this task does or what changed in this revision, displayed at the top of the user's review card.",
          }),
        },
        { additionalProperties: false },
      ),
      async execute(_toolCallId, input, _signal, _onUpdate, ctx) {
        const host = enter(ctx, hostOverride);
        const outcome = await saveAutomationDraft(host, input as SaveDraftInput);
        return formatResult(outcome.payload, outcome.details);
      },
    }),
    defineDexonTool({
      dexonOwner: "automation",
      name: "automation_stop",
      label: "stop automation",
      description:
        "Safe stop-only control for active automations. Use action 'disable_task' to disarm a task's triggers so it stops firing, or 'cancel_run' to request cancellation of an active run. This tool only stops work; it can never enable, start, or delete anything.",
      promptSnippet: "automation_stop: immediately disable a task or cancel a live run",
      parameters: Type.Object(
        {
          action: Type.Union([Type.Literal("disable_task"), Type.Literal("cancel_run")], {
            description: "'disable_task' disarms a task; 'cancel_run' cancels an in-flight run.",
          }),
          taskId: Type.Optional(
            Type.String({
              minLength: 1,
              maxLength: 256,
              description: "Required when action is 'disable_task'.",
            }),
          ),
          runId: Type.Optional(
            Type.String({
              minLength: 1,
              maxLength: 256,
              description: "Required when action is 'cancel_run'.",
            }),
          ),
          reason: Type.Optional(
            Type.String({
              minLength: 1,
              maxLength: 200,
              description: "Optional brief explanation shown in the chat activity log.",
            }),
          ),
        },
        { additionalProperties: false },
      ),
      async execute(_toolCallId, input, _signal, _onUpdate, ctx) {
        const host = enter(ctx, hostOverride);
        const outcome = await stopAutomation(host, input as StopInput);
        return formatResult(outcome.payload, outcome.details);
      },
    }),
    defineDexonTool({
      dexonOwner: "automation",
      name: "automation_request_user_action",
      label: "request user action",
      description:
        "Validate that the target exists and render an interactive confirmation card in chat for privileged or irreversible operations that only the user may perform. This tool never executes the operation itself—the user must click the card (and complete the native desktop authorization dialog for enable_task, resolve_attention, and configure_secret). Use configure_secret whenever a secret must be created, rotated, or deleted; never collect secret values in chat.",
      promptSnippet:
        "automation_request_user_action: show an interactive card for user-only actions (enable, run, delete, approve, resolve attention, signal, secret)",
      parameters: Type.Object(
        {
          action: Type.Union(
            AUTOMATION_USER_ACTIONS.map((action) => Type.Literal(action)),
            { description: "Which user-confirmed action card to display." },
          ),
          reason: Type.String({
            minLength: 1,
            maxLength: 300,
            description:
              "Plain-language explanation displayed on the card telling the user what will happen if they confirm.",
          }),
          taskId: Type.Optional(
            Type.String({
              minLength: 1,
              maxLength: 256,
              description: "Required for 'enable_task', 'start_run', 'delete_task', and 'emit_signal'.",
            }),
          ),
          revision: Type.Optional(
            Type.Integer({
              minimum: 1,
              description: "Required for 'enable_task'. Exact task revision to enable.",
            }),
          ),
          planHash: Type.Optional(
            Type.String({
              pattern: "^[a-f0-9]{64}$",
              description:
                "Required for 'enable_task'. 64-character hex planHash from automation_inspect or automation_save_draft.",
            }),
          ),
          triggerId: Type.Optional(
            Type.String({
              minLength: 1,
              maxLength: 256,
              description: "Required for 'start_run'. Trigger ID defined in the enabled task.",
            }),
          ),
          input: Type.Optional(
            Type.Unknown({
              description:
                "Optional JSON input payload prefilled on the 'start_run' card for user review before running.",
            }),
          ),
          runId: Type.Optional(
            Type.String({
              minLength: 1,
              maxLength: 256,
              description: "Required for 'resolve_approval' and 'resolve_attention'.",
            }),
          ),
          stepIndex: Type.Optional(
            Type.Integer({
              minimum: 0,
              description: "Required for 'resolve_approval' and 'resolve_attention'.",
            }),
          ),
          expectedVersion: Type.Optional(
            Type.Integer({
              minimum: 1,
              description:
                "Required for 'resolve_approval' and 'resolve_attention'. Current run version from automation_inspect.",
            }),
          ),
          suggestedAttentionAction: Type.Optional(
            Type.Union(
              ATTENTION_ACTIONS.map((action) => Type.Literal(action)),
              {
                description:
                  "Optional recommendation pre-highlighted on the 'resolve_attention' card; the user still chooses and confirms via the native desktop dialog.",
              },
            ),
          ),
          signalName: Type.Optional(
            Type.String({
              minLength: 1,
              maxLength: 256,
              description: "Required for 'emit_signal'. Signal name expected by a waiting step.",
            }),
          ),
          signalKey: Type.Optional(
            Type.String({
              minLength: 1,
              maxLength: 1_024,
              description: "Required for 'emit_signal'. Correlation key matching the waiting step.",
            }),
          ),
          signalPayload: Type.Optional(
            Type.Unknown({
              description: "Optional JSON payload prefilled on the 'emit_signal' card.",
            }),
          ),
          secretName: Type.Optional(
            Type.String({
              pattern: "^[a-z0-9._-]{1,80}$",
              description:
                "Required for 'configure_secret'. Lowercase secret identifier only (e.g. 'github.token'); NEVER pass a secret value.",
            }),
          ),
          secretOperation: Type.Optional(
            Type.Union([Type.Literal("set"), Type.Literal("delete")], {
              description: "Only for 'configure_secret'. Defaults to 'set'.",
            }),
          ),
        },
        { additionalProperties: false },
      ),
      async execute(_toolCallId, input, _signal, _onUpdate, ctx) {
        const host = enter(ctx, hostOverride);
        const outcome = requestAutomationUserAction(host, input as RequestUserActionInput);
        return formatResult(outcome.payload, outcome.details);
      },
    }),
  ];
}
