import type { EnvironmentId } from "@contract/environment";
import type { TaskSpec } from "@shared/automation/spec";

export type AutomationTaskTab = "runs" | "flow" | "revisions";

export type AutomationRouteTarget =
  | { view: "overview" }
  | { view: "task"; environmentId: EnvironmentId; taskId: string; tab?: AutomationTaskTab }
  | { view: "run"; environmentId: EnvironmentId; taskId: string; runId: string }
  | { view: "editor"; environmentId: EnvironmentId; taskId?: string; baseSpec?: TaskSpec };

export type AutomationAiSessionIntent =
  | {
      mode: "draft";
      environmentId?: EnvironmentId;
      cwd?: string;
      initialPrompt?: string;
    }
  | {
      mode: "modify";
      environmentId: EnvironmentId;
      cwd: string;
      taskId: string;
      taskName: string;
      revision: number;
      enabledRevision: number | null;
      environmentLabel: string;
      summary: string;
    }
  | {
      mode: "adjust";
      environmentId: EnvironmentId;
      cwd: string;
      taskId?: string;
      taskName: string;
      revision?: number;
      environmentLabel: string;
      hasUnsavedChanges: boolean;
      draftSpec: TaskSpec;
      missingSecrets?: readonly string[];
    };

export interface SealedAutomationSessionRef {
  readonly environmentId: EnvironmentId;
  readonly sessionId: string;
  readonly taskId: string;
  readonly taskName?: string;
  readonly runId: string;
  readonly stepId?: string;
}

type PageListener = (target: AutomationRouteTarget) => void;
type AiSessionListener = (intent: AutomationAiSessionIntent) => void;
type SealedSessionListener = (ref: SealedAutomationSessionRef) => void;

const pageListeners = new Set<PageListener>();
let pendingPageTarget: AutomationRouteTarget | null = null;

const aiSessionListeners = new Set<AiSessionListener>();
let pendingAiSession: AutomationAiSessionIntent | null = null;

const sealedSessionListeners = new Set<SealedSessionListener>();
let pendingSealedSession: SealedAutomationSessionRef | null = null;

const sealedSessionOrigins = new Map<string, SealedAutomationSessionRef>();

export function requestAutomationPage(target: AutomationRouteTarget): void {
  if (!pageListeners.size) {
    pendingPageTarget = target;
    return;
  }
  for (const listener of [...pageListeners]) listener(target);
}

export function subscribeAutomationPageRequest(listener: PageListener): () => void {
  pageListeners.add(listener);
  if (pendingPageTarget !== null) {
    const target = pendingPageTarget;
    pendingPageTarget = null;
    listener(target);
  }
  return () => {
    pageListeners.delete(listener);
  };
}

export function requestAutomationAiSession(intent: AutomationAiSessionIntent): void {
  if (!aiSessionListeners.size) {
    pendingAiSession = intent;
    return;
  }
  for (const listener of [...aiSessionListeners]) listener(intent);
}

export function subscribeAutomationAiSessionRequest(listener: AiSessionListener): () => void {
  aiSessionListeners.add(listener);
  if (pendingAiSession !== null) {
    const intent = pendingAiSession;
    pendingAiSession = null;
    listener(intent);
  }
  return () => {
    aiSessionListeners.delete(listener);
  };
}

export function rememberSealedSessionOrigin(ref: SealedAutomationSessionRef): void {
  sealedSessionOrigins.set(ref.sessionId, ref);
}

export function getSealedSessionOrigin(sessionId: string): SealedAutomationSessionRef | null {
  return sealedSessionOrigins.get(sessionId) ?? null;
}

export function requestSealedAutomationSession(ref: SealedAutomationSessionRef): void {
  rememberSealedSessionOrigin(ref);
  if (!sealedSessionListeners.size) {
    pendingSealedSession = ref;
    return;
  }
  for (const listener of [...sealedSessionListeners]) listener(ref);
}

export function subscribeSealedAutomationSessionRequest(listener: SealedSessionListener): () => void {
  sealedSessionListeners.add(listener);
  if (pendingSealedSession !== null) {
    const ref = pendingSealedSession;
    pendingSealedSession = null;
    listener(ref);
  }
  return () => {
    sealedSessionListeners.delete(listener);
  };
}
