import type { PiRpc } from "../contract/rpc";
import type {
  AutomationCommand,
  AutomationCommandResult,
  AutomationCommandResults,
} from "../contract/automation-commands";
import { PRIMARY_ENVIRONMENT_ID, type EnvironmentId } from "../contract/environment";
import { RpcError } from "../contract/types";
import type { TaskRevisionView } from "../shared/automation/views";
import { confirmAutomation, type AutomationTargetIdentity, type ShowAutomationDialog } from "./automation-consent";
import type { CredentialVault } from "./credential-vault";

export interface BoundAutomationTarget extends AutomationTargetIdentity {
  call: PiRpc["call"];
  isStillCurrent(): boolean;
}

export type AutomationAuthority = <C extends AutomationCommand>(command: C) => Promise<AutomationCommandResult<C>>;

function assertCurrent(target: BoundAutomationTarget): void {
  if (!target.isStillCurrent())
    throw new RpcError({ code: "DISCONNECTED", message: "Automation target connection changed during confirmation" });
}

function assertTask(task: TaskRevisionView, taskId: string, revision: number, planHash: string): void {
  if (
    task.taskId !== taskId ||
    task.revision !== revision ||
    task.planHash !== planHash ||
    task.requiredGrant.planHash !== planHash
  )
    throw new RpcError({ code: "CONFLICT", message: "Automation task revision or plan changed" });
}

export function createAutomationAuthority(options: {
  targets: { bindAutomationTarget(environmentId: EnvironmentId): BoundAutomationTarget };
  primarySecrets: Pick<CredentialVault, "setAutomationSecret" | "deleteAutomationSecret" | "listAutomationSecretNames">;
  show: ShowAutomationDialog;
}): AutomationAuthority {
  let confirmationQueue: Promise<void> = Promise.resolve();
  const serializeConfirmation = <T>(operation: () => Promise<T>): Promise<T> => {
    const next = confirmationQueue.then(operation, operation);
    confirmationQueue = next.then(
      () => undefined,
      () => undefined,
    );
    return next;
  };
  const execute = async (command: AutomationCommand): Promise<AutomationCommandResults[AutomationCommand["type"]]> => {
    if (command.environmentId === PRIMARY_ENVIRONMENT_ID) {
      switch (command.type) {
        case "set-secret":
          options.primarySecrets.setAutomationSecret(command.name, command.value);
          return { ok: true };
        case "delete-secret":
          options.primarySecrets.deleteAutomationSecret(command.name);
          return { ok: true };
        case "list-secret-names":
          return { names: options.primarySecrets.listAutomationSecretNames() };
      }
    }
    const target = options.targets.bindAutomationTarget(command.environmentId);
    switch (command.type) {
      case "set-secret":
        await target.call("automation.setSecret", { name: command.name, value: command.value });
        return { ok: true };
      case "delete-secret":
        await target.call("automation.deleteSecret", { name: command.name });
        return { ok: true };
      case "list-secret-names": {
        const { names } = await target.call("automation.listSecretNames");
        return { names };
      }
      case "enable-task":
        return serializeConfirmation(async () => {
          assertCurrent(target);
          const { task } = await target.call("automation.getTask", {
            taskId: command.taskId,
            revision: command.revision,
          });
          assertTask(task, command.taskId, command.revision, command.planHash);
          assertCurrent(target);
          if (!(await confirmAutomation({ kind: "enable", target, task }, options.show)))
            return { outcome: "cancelled" };
          assertCurrent(target);
          const result = await target.call("automation.enableTask", {
            taskId: command.taskId,
            revision: command.revision,
            planHash: command.planHash,
          });
          return { outcome: "enabled", task: result.task };
        });
      case "resolve-attention":
        return serializeConfirmation(async () => {
          assertCurrent(target);
          const request = command.request;
          const { run } = await target.call("automation.getRun", { runId: request.runId });
          if (
            run.phase !== "attention" ||
            run.version !== request.expectedVersion ||
            !run.steps.some((step) => step.stepIndex === request.stepIndex && step.status === "unknown")
          )
            throw new RpcError({ code: "CONFLICT", message: "Automation attention state or version changed" });
          const { task } = await target.call("automation.getTask", { taskId: run.taskId, revision: run.revision });
          assertTask(task, run.taskId, run.revision, task.planHash);
          assertCurrent(target);
          if (!(await confirmAutomation({ kind: "resolve", target, task, request }, options.show)))
            return { outcome: "cancelled" };
          assertCurrent(target);
          return { outcome: "resolved", result: await target.call("automation.resolveAttention", request) };
        });
    }
  };
  return async <C extends AutomationCommand>(command: C): Promise<AutomationCommandResult<C>> =>
    execute(command) as Promise<AutomationCommandResult<C>>;
}
