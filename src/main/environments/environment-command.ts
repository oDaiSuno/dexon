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
  }
  return result as EnvironmentCommandResult<C>;
}
