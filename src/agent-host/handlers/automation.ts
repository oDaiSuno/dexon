import type { RpcServer } from "../../contract/rpc";
import { RpcError } from "../../contract/types";
import type { AutomationConsentRequest, AutomationConsentResult } from "../../shared/automation/views";
import type { AutomationRuntime } from "../automation";
import { callMain } from "../parent-rpc";
import { invalid, object, text, integer, json, queryRuns, inboxRequest } from "./automation-input";

async function confirm(request: AutomationConsentRequest): Promise<void> {
  const consent = await callMain<AutomationConsentResult>("automationConsent.confirm", request, 110000);
  if (
    !consent ||
    consent.confirmed !== true ||
    consent.taskId !== request.taskId ||
    consent.revision !== request.revision ||
    consent.planHash !== request.planHash ||
    consent.requestId !== (request.kind === "resolve" ? request.request.requestId : null)
  )
    throw new RpcError({ code: "FORBIDDEN", message: "Automation operation requires native confirmation" });
}
export function registerAutomationHandlers(server: RpcServer, runtime: AutomationRuntime): () => void {
  const unsubscribe = runtime.subscribe((change) => server.emit("automation.changed", "*", change));
  server.handle({
    "automation.listTasks": (params) => {
      const body = params === undefined ? {} : object(params);
      return { tasks: runtime.listTasks(body.cwd === undefined ? {} : { cwd: text(body.cwd, 4096) }) };
    },
    "automation.getTask": (params) => {
      const body = object(params);
      return {
        task: runtime.getTask(text(body.taskId), body.revision === undefined ? undefined : integer(body.revision, 1)),
      };
    },
    "automation.saveTask": async (params) => runtime.saveTask(object(params).spec),
    "automation.enableTask": async (params) => {
      const body = object(params);
      const taskId = text(body.taskId);
      const revision = integer(body.revision, 1);
      const planHash = text(body.planHash, 64);
      const task = runtime.getTask(taskId, revision);
      if (task.planHash !== planHash) invalid("Automation definition changed");
      await confirm({
        kind: "enable",
        taskId,
        revision,
        planHash,
        taskName: task.source.name,
        requiredGrant: task.requiredGrant,
      });
      return {
        task: runtime.enableTask({
          taskId,
          revision,
          planHash,
          unattendedWriteApproved: true,
          trustedLocalExecApproved: true,
        }),
      };
    },
    "automation.disableTask": (params) => ({ task: runtime.disableTask(text(object(params).taskId)) }),
    "automation.deleteTask": (params) => {
      runtime.deleteTask(text(object(params).taskId));
      return { ok: true };
    },
    "automation.startRun": (params) => {
      const body = object(params);
      return runtime.startRun({
        taskId: text(body.taskId),
        triggerId: text(body.triggerId),
        input: body.input === undefined ? null : json(body.input),
        ...(body.trigger === undefined ? {} : { trigger: json(body.trigger) }),
        ...(body.expectedRevision === undefined
          ? {}
          : { expectedRevision: body.expectedRevision === null ? null : integer(body.expectedRevision, 1) }),
        ...(body.dedupeKey === undefined ? {} : { dedupeKey: text(body.dedupeKey, 1024) }),
        ...(body.requestId === undefined ? {} : { requestId: text(body.requestId) }),
      });
    },
    "automation.cancelRun": async (params) => ({ run: await runtime.cancelRun(text(object(params).runId)) }),
    "automation.listRuns": (params) => ({ runs: runtime.listRuns(queryRuns(params)) }),
    "automation.getRun": (params) => ({ run: runtime.getRun(text(object(params).runId)) }),
    "automation.listInbox": () => ({ items: runtime.listInbox() }),
    "automation.resolveInbox": async (params) => {
      const request = inboxRequest(params);
      if (request.resolution.kind === "attention") {
        const run = runtime.getRun(request.runId);
        const task = runtime.getTask(run.taskId, run.revision);
        await confirm({
          kind: "resolve",
          taskId: run.taskId,
          revision: run.revision,
          planHash: task.planHash,
          taskName: task.source.name,
          requiredGrant: task.requiredGrant,
          request,
        });
      }
      return runtime.resolveInbox(request);
    },
    "automation.emitSignal": (params) => {
      const body = object(params);
      return runtime.emitSignal(text(body.taskId), {
        name: text(body.name),
        key: text(body.key, 1024),
        eventId: text(body.eventId),
        payload: body.payload === undefined ? null : json(body.payload),
      });
    },
  });
  return unsubscribe;
}
