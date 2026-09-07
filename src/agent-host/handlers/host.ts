import { homedir } from "os";
import path from "path";
import type { RpcServer } from "../../contract/rpc";
import { RpcError } from "../../contract/types";
import { allowFileRoot } from "../file-access";
import { validateExistingDirectory } from "../file-access-core";
import { preparePersonalDirectory } from "../personal-directory";
import { getRunningRpcSessionIds } from "../rpc-manager";
import { toolchainRuntime } from "../toolchain-runtime";

export interface HostHandlerDeps {
  /**
   * Injectable home provider; production defaults to os.homedir(). Tests
   * substitute an isolated temporary directory and never touch the real home.
   */
  getHome?: () => string;
}

export function registerHostHandlers(server: RpcServer, deps: HostHandlerDeps = {}): void {
  const getHome = deps.getHome ?? homedir;

  server.handle({
    "host.ping": () => ({ ok: true as const, ts: Date.now() }),

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

    // Fixed personal space: prepare ~/.dexon under the real home, authorize
    // the canonical path, and report real failures instead of fake readiness.
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
