import type {
  EnvironmentCommand,
  EnvironmentCommandResult,
  EnvironmentDraft,
} from "../../contract/environment-commands.ts";
import type { EnvironmentManager } from "./environment-manager.ts";
import { parseAddEnvironmentInput } from "./environment-store.ts";
function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Invalid environment command");
  return value as Record<string, unknown>;
}
function environmentId(value: unknown): string {
  if (typeof value !== "string" || !value || value.length > 1024 || /[\0\r\n]/u.test(value))
    throw new Error("Invalid environment ID");
  return value;
}
function boundedString(value: unknown, name: string, maxLength: number): string {
  if (typeof value !== "string" || !value.trim() || value.length > maxLength || /\p{Cc}/u.test(value))
    throw new Error(`Invalid ${name}`);
  return value;
}
function remotePort(value: unknown): number {
  if (typeof value !== "number" || !Number.isInteger(value) || value < 1 || value > 65535)
    throw new Error("Invalid remote port");
  return value;
}
function commandFields(command: Record<string, unknown>, fields: readonly string[]): void {
  if (Object.keys(command).some((key) => key !== "type" && !fields.includes(key)))
    throw new Error("Unexpected environment command field");
}
function draft(value: unknown): EnvironmentDraft {
  const input = record(value);
  if ("expectedEnvironmentId" in record(input.target)) throw new Error("Drafts cannot bind an environment identity");
  const parsed = parseAddEnvironmentInput(input);
  return { label: parsed.label, target: parsed.target, ...(parsed.authToken ? { authToken: parsed.authToken } : {}) };
}
export function parseEnvironmentCommand(value: unknown): EnvironmentCommand {
  const command = record(value);
  switch (command.type) {
    case "add":
      if (typeof command.connect !== "boolean") throw new Error("Invalid connect flag");
      return { type: "add", draft: draft(command.draft), connect: command.connect };
    case "update":
      return { type: "update", environmentId: environmentId(command.environmentId), draft: draft(command.draft) };
    case "test": {
      const subject = record(command.subject);
      if ("draft" in subject === "environmentId" in subject) throw new Error("Test must have exactly one subject");
      return {
        type: "test",
        subject:
          "draft" in subject
            ? { draft: draft(subject.draft) }
            : { environmentId: environmentId(subject.environmentId) },
      };
    }
    case "connect":
    case "disconnect":
    case "restart-daemon":
      return { type: command.type, environmentId: environmentId(command.environmentId) };
    case "trust":
      if (command.trust !== "host-key" && command.trust !== "environment-identity")
        throw new Error("Invalid trust choice");
      return { type: "trust", environmentId: environmentId(command.environmentId), trust: command.trust };
    case "remove":
      if (command.remoteDaemon !== "keep" && command.remoteDaemon !== "stop") throw new Error("Invalid removal choice");
      return {
        type: "remove",
        environmentId: environmentId(command.environmentId),
        remoteDaemon: command.remoteDaemon,
      };
    case "set-policy": {
      const policy = record(command.policy);
      if (
        Object.entries(policy).some(
          ([key, value]) => !["detachedDaemon", "autoReconnect"].includes(key) || typeof value !== "boolean",
        )
      )
        throw new Error("Invalid lifecycle policy");
      return { type: "set-policy", policy };
    }
    case "discover-ssh-hosts":
      return { type: "discover-ssh-hosts" };
    case "list-port-forwards":
      commandFields(command, ["environmentId"]);
      return {
        type: "list-port-forwards",
        ...(command.environmentId === undefined
          ? {}
          : { environmentId: boundedString(command.environmentId, "environment ID", 1024) }),
      };
    case "open-port-forward":
      commandFields(command, ["environmentId", "remotePort", "processId", "label"]);
      return {
        type: "open-port-forward",
        environmentId: boundedString(command.environmentId, "environment ID", 1024),
        remotePort: remotePort(command.remotePort),
        ...(command.processId === undefined ? {} : { processId: boundedString(command.processId, "process ID", 1024) }),
        ...(command.label === undefined ? {} : { label: boundedString(command.label, "port forward label", 256) }),
      };
    case "close-port-forward":
      commandFields(command, ["environmentId", "remotePort"]);
      return {
        type: "close-port-forward",
        environmentId: boundedString(command.environmentId, "environment ID", 1024),
        remotePort: remotePort(command.remotePort),
      };
    default:
      throw new Error("Unknown environment command");
  }
}
export async function dispatchEnvironmentCommand<C extends EnvironmentCommand>(
  manager: EnvironmentManager,
  command: C,
): Promise<EnvironmentCommandResult<C>> {
  let result: unknown;
  switch (command.type) {
    case "add":
      result = await manager.addEnvironment({ ...command.draft, enabled: command.connect });
      break;
    case "connect":
      result = await manager.connectEnvironment(command.environmentId);
      break;
    case "disconnect":
      result = await manager.disconnectEnvironment(command.environmentId);
      break;
    case "remove":
      result = await manager.removeEnvironment(command.environmentId, command.remoteDaemon);
      break;
    case "update":
      result = await manager.updateEnvironment(command.environmentId, command.draft);
      break;
    case "test":
      result = await manager.test(command.subject);
      break;
    case "trust":
      result = await manager.trust(command.environmentId, command.trust);
      break;
    case "restart-daemon":
      result = await manager.restartDaemon(command.environmentId);
      break;
    case "set-policy":
      result = await manager.setPolicy(command.policy);
      break;
    case "discover-ssh-hosts":
      result = await manager.discoverSshHosts();
      break;
    case "list-port-forwards":
      result = manager.listPortForwards(command.environmentId);
      break;
    case "open-port-forward":
      result = await manager.openPortForward({
        environmentId: command.environmentId,
        remotePort: command.remotePort,
        ...(command.processId === undefined ? {} : { processId: command.processId }),
        ...(command.label === undefined ? {} : { label: command.label }),
      });
      break;
    case "close-port-forward":
      result = await manager.closePortForward(command.environmentId, command.remotePort);
      break;
  }
  return result as EnvironmentCommandResult<C>;
}
