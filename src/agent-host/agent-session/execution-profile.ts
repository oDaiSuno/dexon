import type { InlineExtension, ToolDefinition } from "@earendil-works/pi-coding-agent";
import type { ToolLoadoutReader } from "../../shared/pi-types";
import { isSessionToolName } from "../../shared/session-orchestration";
import {
  SessionAccess,
  sessionOriginStore,
  type SessionMutationOperation,
  type SessionOriginRecord,
} from "../session-origin-store";
import type { AutomationResultSink } from "./automation-result-tool";
import {
  RunPolicy,
  readToolGlobals,
  type RunPolicyDeps,
  type RunPolicyView,
  type ToolGlobals,
  type ToolchainSection,
} from "./run-policy";
import { isCodingToolName } from "./tool-intent";

export const AGENT_WORKSPACE_TOOLS = ["read", "write", "edit", "bash", "grep", "find"] as const;
export type AgentWorkspaceTool = (typeof AGENT_WORKSPACE_TOOLS)[number];

export interface AutomationStepRef {
  readonly taskId: string;
  readonly runId: string;
  readonly stepId: string;
  readonly attemptNo: number;
}

export interface AutomationResultContract<T = unknown> {
  readonly schema: Record<string, unknown>;
  readonly sink: AutomationResultSink<T>;
}

export type SessionExecutionProfile =
  | { readonly kind: "interactive"; readonly toolNames?: readonly string[] }
  | {
      readonly kind: "automation";
      readonly step: AutomationStepRef;
      readonly tools: readonly AgentWorkspaceTool[];
      readonly result: AutomationResultContract;
    }
  | { readonly kind: "sealed"; readonly step: AutomationStepRef };

export function customToolsFor<T extends { readonly name: string }>(
  profile: SessionExecutionProfile,
  allCustomTools: readonly T[],
  resultToolFactory: (contract: AutomationResultContract) => T,
): T[] {
  switch (profile.kind) {
    case "interactive":
      return [...allCustomTools];
    case "automation":
      return [resultToolFactory(profile.result)];
    case "sealed":
      return [];
  }
}

export function activeToolNamesFor(
  profile: SessionExecutionProfile,
  availableToolNames: readonly string[],
  caps: ToolGlobals,
): string[] {
  if (profile.kind === "sealed") return [];
  const available = new Set(availableToolNames);
  if (profile.kind === "automation") {
    const workspace = new Set<string>(AGENT_WORKSPACE_TOOLS);
    for (const tool of profile.tools) {
      if (!workspace.has(tool)) throw new Error(`Unsupported automation workspace tool: ${tool}`);
      if (!available.has(tool)) throw new Error(`Automation workspace tool is unavailable: ${tool}`);
    }
    if (!available.has("automation_result")) throw new Error("Automation result tool is unavailable");
    return [...new Set([...profile.tools, "automation_result"])];
  }
  if (profile.toolNames?.length === 0) return [];
  const requested = new Set(profile.toolNames ?? availableToolNames);
  return availableToolNames.filter((name) => {
    if (name.startsWith("browser_")) return caps.browserToolNames.has(name);
    if (isSessionToolName(name)) return caps.orchestrationEnabled;
    return !isCodingToolName(name) || requested.has(name);
  });
}

export function systemPromptPolicy(profile: SessionExecutionProfile): "empty" | "pi_default" {
  return profile.kind === "interactive" && Array.isArray(profile.toolNames) && profile.toolNames.length === 0
    ? "empty"
    : "pi_default";
}

export function headlessReason(
  profile: SessionExecutionProfile,
  externalTurnActive: boolean,
): "automation" | "channel" | null {
  return profile.kind !== "interactive" ? "automation" : externalTurnActive ? "channel" : null;
}

export function extensionLoadingFor(profile: SessionExecutionProfile): "user_and_project" | "none" {
  return profile.kind === "interactive" ? "user_and_project" : "none";
}

export function profileFromOrigin(
  origin: SessionOriginRecord | null | undefined,
  requestedToolNames?: readonly string[],
): SessionExecutionProfile {
  return origin?.relation === "automation"
    ? {
        kind: "sealed",
        step: origin.automationStep ?? { taskId: "unknown", runId: "unknown", stepId: "unknown", attemptNo: 1 },
      }
    : { kind: "interactive", toolNames: requestedToolNames };
}

export function isMutatingWorkspaceTool(toolName: string): boolean {
  return toolName === "write" || toolName === "edit" || toolName === "bash";
}

function immutableSchema<T>(value: T): T {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const entry of Object.values(value)) immutableSchema(entry);
  }
  return value;
}

export function immutableExecutionProfile(profile: SessionExecutionProfile): SessionExecutionProfile {
  if (profile.kind === "interactive") {
    return Object.freeze({
      ...profile,
      ...(profile.toolNames ? { toolNames: Object.freeze([...profile.toolNames]) } : {}),
    });
  }
  const step = Object.freeze({ ...profile.step });
  return profile.kind === "sealed"
    ? Object.freeze({ kind: "sealed", step })
    : Object.freeze({
        ...profile,
        step,
        tools: Object.freeze([...profile.tools]),
        result: Object.freeze({ ...profile.result, schema: immutableSchema(structuredClone(profile.result.schema)) }),
      });
}

export class ProfileRunPolicy extends RunPolicy {
  constructor(
    private readonly execution: SessionExecutionProfile,
    private readonly options: RunPolicyDeps,
  ) {
    super(options);
  }

  override view(): RunPolicyView {
    if (this.execution.kind === "interactive") return super.view();
    const view = super.view();
    const active = new Set(
      activeToolNamesFor(
        this.execution,
        this.options.session.getAllTools().map((tool) => tool.name),
        this.options.globals(),
      ),
    );
    return {
      profile: "agent",
      systemPrompt: this.options.session.agent.state?.systemPrompt ?? "",
      tools: view.tools.map((tool) => ({ ...tool, active: active.has(tool.name) })),
    };
  }

  override setToolIntent(intent: Parameters<RunPolicy["setToolIntent"]>[0]): void {
    SessionAccess.authorizeMutation(originReaderFor(this.execution), this.options.session.sessionId, "agent_command");
    super.setToolIntent(intent);
  }

  override reconcileLiveToolsFromBranch(): void {
    if (this.execution.kind === "interactive") return super.reconcileLiveToolsFromBranch();
    this.options.session.setActiveToolsByName(
      activeToolNamesFor(
        this.execution,
        this.options.session.getAllTools().map((tool) => tool.name),
        this.options.globals(),
      ),
    );
  }
}

export interface ExecutionProfileHost {
  readonly executionProfile: SessionExecutionProfile;
  readonly executionToolchain: ToolchainSection | null;
  readonly inner: ToolLoadoutReader;
  applyActiveTools(): void;
  automationToolBlocked(toolName: string): boolean;
}

export function executionProfileExtension(read: () => ExecutionProfileHost | undefined): InlineExtension {
  return {
    name: "dexon-execution-profile",
    hidden: true,
    factory: (pi) => {
      pi.on("before_agent_start", (event) => {
        const host = read();
        if (!host) throw new Error("Automation execution profile is not bound");
        host.applyActiveTools();
        event.systemPromptOptions.selectedTools = host.inner.getActiveToolNames();
        const toolchain = host.executionToolchain;
        if (toolchain) event.systemPromptOptions.sections[toolchain.name] = toolchain.body;
      });
      pi.on("tool_call", (event) => {
        const host = read();
        if (!host || host.automationToolBlocked(event.toolName)) {
          return { block: true, reason: "Automation tool execution is sealed or not permitted", terminate: true };
        }
        return undefined;
      });
      pi.on("turn_end", (_event, ctx) => {
        const host = read();
        if (!host || host.automationToolBlocked("automation_result")) ctx.abort();
      });
    },
  };
}

export function installAutomationWorkspaceGuards(
  session: ToolLoadoutReader,
  guarded: WeakSet<object>,
  blocked: (name: string) => boolean,
  emit: (event: { type: string; toolCallId: string; toolName: string }) => void,
): void {
  for (const name of AGENT_WORKSPACE_TOOLS) {
    const definition = session.getToolDefinition(name) as ToolDefinition | undefined;
    if (!definition || guarded.has(definition)) continue;
    const execute = definition.execute.bind(definition);
    definition.execute = async (id, args, signal, onUpdate, ctx) => {
      if (blocked(name)) throw new Error("Automation workspace tool execution is sealed or not permitted");
      emit({ type: "automation_workspace_tool_start", toolCallId: id, toolName: name });
      try {
        return await execute(id, args, signal, onUpdate, ctx);
      } finally {
        emit({ type: "automation_workspace_tool_end", toolCallId: id, toolName: name });
      }
    };
    guarded.add(definition);
  }
}

export class ExecutionProfileControl {
  private stopped = false;
  private readonly guarded = new WeakSet<object>();
  constructor(
    private readonly profile: SessionExecutionProfile,
    private readonly session: ToolLoadoutReader,
    private readonly policy: RunPolicy,
    private readonly emit: (event: { type: string; toolCallId: string; toolName: string }) => void,
  ) {}

  applyActiveTools(): void {
    if (this.profile.kind === "interactive") {
      this.session.setActiveToolsByName(
        this.policy
          .view()
          .tools.filter((tool) => tool.active)
          .map((tool) => tool.name),
      );
      return;
    }
    installAutomationWorkspaceGuards(this.session, this.guarded, (name) => this.blocked(name), this.emit);
    this.session.setActiveToolsByName(
      this.stopped
        ? []
        : activeToolNamesFor(
            this.profile,
            this.session.getAllTools().map((tool) => tool.name),
            readToolGlobals(),
          ),
    );
  }

  blocked(name: string): boolean {
    if (this.profile.kind === "interactive") return false;
    return (
      this.profile.kind === "sealed" ||
      this.stopped ||
      this.profile.result.sink.state.status === "submitted" ||
      (name !== "automation_result" && !this.profile.tools.some((allowed) => allowed === name))
    );
  }

  block(): void {
    this.stopped = true;
  }

  authorizeLaunchConfiguration(sessionId: string, running: boolean): void {
    if (this.profile.kind !== "interactive" && (running || this.blocked("automation_result"))) {
      this.authorizeMutation(sessionId, "agent_command");
    }
  }

  authorizeMutation(sessionId: string, operation: SessionMutationOperation): void {
    SessionAccess.authorizeMutation(originReaderFor(this.profile), sessionId, operation);
  }
}

function originReaderFor(profile: SessionExecutionProfile): Parameters<typeof SessionAccess.authorizeMutation>[0] {
  return {
    get: (id) =>
      profile.kind === "interactive"
        ? sessionOriginStore.get(id)
        : { relation: "automation", createdAt: "", automationStep: profile.step },
  };
}
