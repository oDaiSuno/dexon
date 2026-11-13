import { homedir } from "os";
import path from "path";
import type { RpcServer } from "../../contract/rpc";
import { RpcError } from "../../contract/types";
import { allowFileRoot } from "../file-access";
import { validateExistingDirectory } from "../file-access-core";
import { preparePersonalDirectory } from "../personal-directory";
import { getRunningRpcSessionIds } from "../rpc-manager";
import { peekActiveEnvironmentDescriptor } from "../parent-rpc";
import { toolchainRuntime } from "../toolchain-runtime";
import { runHostSelfCheck, type HostSelfCheckDeps } from "../self-check";

export interface HostHandlerDeps {
  getHome?: () => string;
  selfCheck?: HostSelfCheckDeps;
}

export function registerHostHandlers(server: RpcServer, deps: HostHandlerDeps = {}): void {
  const getHome = deps.getHome ?? homedir;

  server.handle({
    "host.selfCheck": () => {
      if (!deps.selfCheck) throw new Error("Host self-check services are unavailable");
      return runHostSelfCheck(deps.selfCheck);
    },
    "host.ping": () => {
      const descriptor = peekActiveEnvironmentDescriptor();
      return descriptor ? { ok: true as const, ts: Date.now(), descriptor } : { ok: true as const, ts: Date.now() };
    },

    "host.toolchain": async (params) => {
      const { cwd } = params as { cwd: string };
      if (!cwd || !path.isAbsolute(cwd)) throw new RpcError({ code: "BAD_REQUEST", message: "absolute cwd required" });
      const context = await toolchainRuntime.createExecutionContext({ cwd, intent: "project-command" });
      return {
        inventoryRevision: context.inventoryRevision,
        resolutionId: context.resolutionId,
        capabilities: Object.fromEntries(
          Object.entries(context.commands).map(([capability, command]) => [
            capability,
            { provider: command.provider, version: command.version },
          ]),
        ),
      };
    },

    "system.home": () => ({ home: getHome() }),

    "system.validateCwd": async (params) => {
      const { path: dir } = params as { path: string };
      const validation = validateExistingDirectory(dir);
      if (!validation.ok) return validation;
      allowFileRoot(validation.canonicalPath);
      return { ok: true as const, path: validation.path };
    },

    "system.defaultCwd": async () => {
      const prepared = preparePersonalDirectory({ home: getHome() });
      if (!prepared.ok) {
        throw new RpcError({
          code: prepared.reason === "not-directory" ? "CONFLICT" : "INTERNAL",
          message: prepared.error,
        });
      }
      allowFileRoot(prepared.canonicalPath);
      return { cwd: prepared.path };
    },

    "system.allowRoot": async (params) => {
      const { path: dir } = params as { path: string };
      const validation = validateExistingDirectory(dir);
      if (!validation.ok) throw new RpcError({ code: "BAD_REQUEST", message: validation.error });
      allowFileRoot(validation.canonicalPath);
      return { ok: true as const };
    },

    "system.runningCount": async () => {
      const sessionIds = getRunningRpcSessionIds();
      return { count: sessionIds.length, sessionIds };
    },
  });
}
