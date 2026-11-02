import { getCurrentTools } from "@earendil-works/pi-ai";
import type { InlineExtension } from "@earendil-works/pi-coding-agent";
import type {
  AgentSessionLike,
  DexonToolOwner,
  ToolDefinitionMetadata,
  ToolExposure,
  ToolLoadoutReader,
} from "../../shared/pi-types";
import { browserCapabilityRuntime } from "../browser-capability-runtime";
import { browserToolNamesForSnapshot } from "../browser-tools";
import { sessionOrchestrationEnabled } from "../session-orchestration/settings";
import { stripLegacyChannelPrompts } from "./compat";
import { isCodingToolName } from "./tool-intent";
import { DEFAULT_TOOL_INTENT, type ToolIntent, type ToolIntentStore } from "./tool-intent";

export interface ToolGlobals {
  readonly browserToolNames: ReadonlySet<string>;
  readonly orchestrationEnabled: boolean;
}

export function readToolGlobals(): ToolGlobals {
  return {
    browserToolNames: new Set(browserToolNamesForSnapshot(browserCapabilityRuntime.getSnapshot())),
    orchestrationEnabled: sessionOrchestrationEnabled(),
  };
}

export type ToolOwner = DexonToolOwner | "pi" | "withheld";

export interface CatalogTool {
  readonly name: string;
  readonly description: string;
  readonly exposure: ToolExposure;
  readonly owner: ToolOwner;
  readonly activatedOnRegistration: boolean;
}

declare const toolchainSectionBrand: unique symbol;

export interface ToolchainSection {
  readonly name: "dexon-toolchain";
  readonly body: string;
  readonly [toolchainSectionBrand]: true;
}

export function renderToolchainSection(revision: number, summary: readonly string[]): ToolchainSection {
  const lines = [...summary.map((line) => line.trim()).filter(Boolean), `revision ${revision}`];
  return { name: "dexon-toolchain", body: lines.join("\n") } as ToolchainSection;
}

export type RunPlan =
  | { readonly profile: "bare"; readonly tools: readonly [] }
  | { readonly profile: "agent"; readonly tools: readonly string[]; readonly toolchain: ToolchainSection | null };

export type SessionProfile = RunPlan["profile"];

type AgentIntent = Extract<ToolIntent, { kind: "agent" }>;

interface DeclareContext {
  readonly intent: AgentIntent;
  readonly globals: ToolGlobals;
  readonly live: ReadonlySet<string>;
}

const DECLARE: { readonly [O in ToolOwner]: (tool: CatalogTool, context: DeclareContext) => boolean } = {
  coding: (tool, { intent }) => intent.coding === "all" || (intent.coding as readonly string[]).includes(tool.name),
  browser: (tool, { globals }) => globals.browserToolNames.has(tool.name),
  orchestration: (_tool, { globals }) => globals.orchestrationEnabled,
  pi: (tool, { live }) => tool.activatedOnRegistration || live.has(tool.name),
  withheld: () => false,
};

const BUILTIN_SOURCE = "builtin";

function classifyTool(name: string, source: string, definition: ToolDefinitionMetadata | undefined): ToolOwner {
  if (definition?.dexonOwner) return definition.dexonOwner;
  if (isCodingToolName(name)) return "coding";
  if (source === BUILTIN_SOURCE) return "withheld";
  return "pi";
}

function isActivatedOnRegistration(exposure: ToolExposure, definition: ToolDefinitionMetadata | undefined): boolean {
  return (exposure === "direct" || exposure === "model-only") && definition?.defaultActive !== false;
}

function readCatalog(session: ToolLoadoutReader): CatalogTool[] {
  return session.getAllTools().map((info) => {
    const definition = session.getToolDefinition(info.name);
    return {
      name: info.name,
      description: info.description,
      exposure: info.exposure,
      owner: classifyTool(info.name, info.sourceInfo.source, definition),
      activatedOnRegistration: isActivatedOnRegistration(info.exposure, definition),
    };
  });
}

interface PlanInput {
  readonly intent: ToolIntent;
  readonly globals: ToolGlobals;
  readonly catalog: readonly CatalogTool[];
  readonly live: ReadonlySet<string>;
  readonly toolchain: ToolchainSection | null;
}

function planRun(input: PlanInput): RunPlan {
  if (input.intent.kind === "bare") return { profile: "bare", tools: [] };
  const context: DeclareContext = { intent: input.intent, globals: input.globals, live: input.live };
  const tools = input.catalog
    .filter((tool) => tool.exposure !== "hidden" && DECLARE[tool.owner](tool, context))
    .map((tool) => tool.name);
  return { profile: "agent", tools, toolchain: input.toolchain };
}

export type PolicySession = Pick<AgentSessionLike, "sessionId" | "agent"> & ToolLoadoutReader;

export interface PolicyToolView extends CatalogTool {
  readonly active: boolean;
}

export interface RunPolicyView {
  readonly profile: SessionProfile;
  readonly tools: readonly PolicyToolView[];
  readonly systemPrompt: string;
}

export interface RunPolicyDeps {
  readonly session: PolicySession;
  readonly toolchain: ToolchainSection | null;
  readonly intents: ToolIntentStore;
  readonly globals: () => ToolGlobals;
}

interface PolicySnapshot {
  readonly plan: RunPlan;
  readonly catalog: readonly CatalogTool[];
}

export class RunPolicy {
  private readonly deps: RunPolicyDeps;

  constructor(deps: RunPolicyDeps) {
    this.deps = deps;
  }

  view(): RunPolicyView {
    const { plan, catalog } = this.snapshot();
    const declared = new Set<string>(plan.tools);
    return {
      profile: plan.profile,
      tools: catalog
        .filter((tool) => tool.exposure !== "hidden")
        .map((tool) => ({ ...tool, active: declared.has(tool.name) })),
      systemPrompt: plan.profile === "bare" ? "" : (this.deps.session.agent.state?.systemPrompt ?? ""),
    };
  }

  intent(): ToolIntent {
    return this.deps.intents.get(this.deps.session.sessionId) ?? DEFAULT_TOOL_INTENT;
  }

  setToolIntent(intent: ToolIntent): void {
    this.deps.intents.set(this.deps.session.sessionId, intent);
  }

  reconcileLiveToolsFromBranch(): void {
    const session = this.deps.session;
    const branchTools = getCurrentTools(session.agent.state?.messages ?? []).map((tool) => tool.name);
    const registrationDefaults = readCatalog(session)
      .filter((tool) => tool.owner === "pi" && tool.activatedOnRegistration)
      .map((tool) => tool.name);
    session.setActiveToolsByName([...new Set([...branchTools, ...registrationDefaults])]);
  }

  private snapshot(): PolicySnapshot {
    const catalog = readCatalog(this.deps.session);
    const plan = planRun({
      intent: this.intent(),
      globals: this.deps.globals(),
      catalog,
      live: new Set(this.deps.session.getActiveToolNames()),
      toolchain: this.deps.toolchain,
    });
    return { plan, catalog };
  }

  static extension(read: () => RunPolicy | undefined): InlineExtension {
    return {
      name: "dexon-run-policy",
      hidden: true,
      factory: (pi) => {
        pi.on("before_agent_start", (event) => {
          const policy = read();
          if (!policy) {
            pi.setActiveTools([]);
            event.systemPromptOptions.selectedTools = [];
            return { systemPrompt: "" };
          }
          const { plan } = policy.snapshot();
          const tools = [...plan.tools];
          pi.setActiveTools(tools);
          event.systemPromptOptions.selectedTools = tools;
          delete event.systemPromptOptions.sections["dexon-toolchain"];
          if (plan.profile === "bare") return { systemPrompt: "" };
          if (plan.toolchain) event.systemPromptOptions.sections[plan.toolchain.name] = plan.toolchain.body;
          return undefined;
        });
        pi.on("context", (event) => ({
          messages: stripLegacyChannelPrompts(event.messages) as typeof event.messages,
        }));
      },
    };
  }
}
