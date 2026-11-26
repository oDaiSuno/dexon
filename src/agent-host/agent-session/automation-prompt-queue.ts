import type { ExtensionContext, InputEvent, SessionManager } from "@earendil-works/pi-coding-agent";
import type { AutomationPromptPayload } from "../../shared/automation/prompt-context";
import type { SessionEntry } from "../../shared/types";
import { automationPromptsOnBranch } from "../automation-prompt-context";
import { AUTOMATION_PROMPT_CANCELLED_TYPE, AUTOMATION_PROMPT_TYPE } from "../session-entry-compat";

type ReadonlySessionManager = ExtensionContext["sessionManager"];
type Disposition = "handled" | "queued" | "started";
type Lane = "direct" | "steer" | "followUp";

interface PendingInput {
  payload: AutomationPromptPayload | null;
  delivered: boolean;
}

interface Preparation {
  text: string;
  payload: AutomationPromptPayload | null;
  input?: PendingInput;
  disposition?: Disposition;
}

interface PromptQueue {
  writer?: SessionManager;
  preparing: Preparation[];
  direct: PendingInput[];
  steer: PendingInput[];
  followUp: PendingInput[];
}

const queues = new WeakMap<ReadonlySessionManager, PromptQueue>();

function queueFor(manager: ReadonlySessionManager): PromptQueue {
  let queue = queues.get(manager);
  if (!queue) {
    queue = { preparing: [], direct: [], steer: [], followUp: [] };
    queues.set(manager, queue);
  }
  return queue;
}

function pendingPayload(manager: ReadonlySessionManager): AutomationPromptPayload | null {
  return automationPromptsOnBranch(manager.getBranch() as unknown as SessionEntry[]).pending;
}

function cancelMarker(manager: SessionManager, payload: AutomationPromptPayload | null): void {
  if (payload && pendingPayload(manager)) manager.appendCustomEntry(AUTOMATION_PROMPT_CANCELLED_TYPE);
}

function removeInput(queue: PromptQueue, input: PendingInput | undefined): void {
  if (!input) return;
  for (const lane of [queue.direct, queue.steer, queue.followUp]) {
    const index = lane.indexOf(input);
    if (index !== -1) lane.splice(index, 1);
  }
}

export interface AutomationPromptPreparation {
  observe(disposition: Disposition): void;
  finish(): void;
}

export function prepareAutomationPrompt(
  manager: SessionManager,
  text: string,
  payload: AutomationPromptPayload | null,
): AutomationPromptPreparation {
  const queue = queueFor(manager);
  queue.writer = manager;
  const preparation: Preparation = { text, payload };
  queue.preparing.push(preparation);
  if (payload) manager.appendCustomEntry(AUTOMATION_PROMPT_TYPE, payload);
  else cancelMarker(manager, pendingPayload(manager));
  return {
    observe(disposition) {
      preparation.disposition = disposition;
    },
    finish() {
      const index = queue.preparing.indexOf(preparation);
      if (index !== -1) queue.preparing.splice(index, 1);
      if (preparation.disposition === "queued") return;
      removeInput(queue, preparation.input);
      if (!preparation.input?.delivered) cancelMarker(manager, payload);
    },
  };
}

export function observeAutomationPromptInput(event: InputEvent, manager: ReadonlySessionManager): void {
  const queue = queueFor(manager);
  const preparation = queue.preparing.find((candidate) => candidate.text === event.text && !candidate.input);
  const lane: Lane = event.streamingBehavior ?? "direct";
  const input: PendingInput = {
    payload: preparation?.payload ?? (lane === "direct" ? pendingPayload(manager) : null),
    delivered: false,
  };
  if (preparation) preparation.input = input;
  queue[lane].push(input);
  if (lane !== "direct" && queue.writer) cancelMarker(queue.writer, input.payload);
}

export function startAutomationPromptMessage(message: { role: string }, manager: ReadonlySessionManager): void {
  if (message.role !== "user") return;
  const queue = queues.get(manager);
  const input = queue?.direct.shift() ?? queue?.steer.shift() ?? queue?.followUp.shift();
  if (input) input.delivered = true;
  const payload = input?.payload ?? (!input ? pendingPayload(manager) : null);
  if (!payload) {
    if (queue?.writer) cancelMarker(queue.writer, pendingPayload(manager));
    return;
  }
  if (queue?.writer && JSON.stringify(pendingPayload(manager)) !== JSON.stringify(payload)) {
    queue.writer.appendCustomEntry(AUTOMATION_PROMPT_TYPE, payload);
  }
  Object.assign(message, { automationPrompt: payload.badge });
}

export function clearAutomationPromptQueue(manager: ReadonlySessionManager): void {
  const queue = queues.get(manager);
  if (!queue) return;
  queue.direct.length = 0;
  queue.steer.length = 0;
  queue.followUp.length = 0;
  if (queue.writer) cancelMarker(queue.writer, pendingPayload(manager));
}
