import { homedir } from "node:os";
import type { RpcServer } from "../../contract/rpc";
import { RpcError } from "../../contract/types";
import type { AutomationRuntime } from "../automation";
import type { DaemonAutomationSecrets } from "../daemon-automation-secrets";
import { cleanupAutomationTask } from "../automation-task-cleanup";
import {
  invalid,
  object,
  text,
  integer,
  json,
  queryRuns,
  approvalResolveRequest,
  attentionResolveRequest,
} from "./automation-input";

export type AutomationSecretOwner = { kind: "desktop-main" } | { kind: "host"; store: DaemonAutomationSecrets };

export interface AutomationHandlerDeps {
  readonly getHome?: () => string;
}

export function registerAutomationHandlers(
  server: RpcServer,
  runtime: AutomationRuntime,
  owner: AutomationSecretOwner,
  deps: AutomationHandlerDeps = {},
): () => void {
  const unsubscribe = runtime.subscribe((change) => server.emit("automation.changed", "*", change));
  const secretStore = () => {
    if (owner.kind === "desktop-main")
      throw new RpcError({
        code: "FORBIDDEN",
        message: "Primary automation secrets are managed by desktop main process",
      });
    return owner.store;
  };
  server.handle({
    "automation.setSecret": async (params) => {
      const store = secretStore();
      const body = object(params);
      await store.set(body.name, body.value);
      return { ok: true };
    },
    "automation.deleteSecret": async (params) => {
      const store = secretStore();
      await store.delete(object(params).name);
      return { ok: true };
    },
    "automation.listSecretNames": async () => ({ names: await secretStore().listNames() }),
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
    "automation.validateTask": async (params) => runtime.validateTask(object(params).spec),
    "automation.listRevisions": (params) => ({ revisions: runtime.listTaskRevisions(text(object(params).taskId)) }),
    "automation.saveTask": async (params) => runtime.saveTask(object(params).spec),
    "automation.enableTask": (params) => {
      const body = object(params);
      const taskId = text(body.taskId);
      const revision = integer(body.revision, 1);
      const planHash = text(body.planHash, 64);
      const task = runtime.getTask(taskId, revision);
      if (task.planHash !== planHash) invalid("Automation definition changed");
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
    "automation.deleteTask": async (params) => {
      const taskId = text(object(params).taskId);
      const task = runtime.listTasks().find((entry) => entry.id === taskId);
      runtime.deleteTask(taskId);
      if (task) {
        await cleanupAutomationTask(server, taskId, task.cwd, (deps.getHome ?? homedir)(), () =>
          runtime.listTasks().map((remaining) => remaining.cwd),
        );
      }
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
    "automation.activity": () => runtime.activity(),
    "automation.resolveInbox": (params) => runtime.resolveInbox(approvalResolveRequest(params)),
    "automation.resolveAttention": (params) => runtime.resolveInbox(attentionResolveRequest(params)),
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
