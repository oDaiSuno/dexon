import type { RpcServer } from "../../contract/rpc";
import type {
  ManagedProcessReadParams,
  ManagedProcessWaitParams,
  ManagedProcessWriteParams,
} from "../../contract/processes";
import { RpcError } from "../../contract/types";
import { ManagedProcessError, type ManagedProcessService } from "../managed-process/service";

export interface ProcessHandlerDeps {
  managedProcesses: ManagedProcessService;
}

export function registerProcessHandlers(server: RpcServer, deps: ProcessHandlerDeps): () => Promise<void> {
  const { managedProcesses } = deps;

  const managedCall = async <T>(operation: () => T | Promise<T>): Promise<T> => {
    try {
      return await operation();
    } catch (error) {
      if (error instanceof ManagedProcessError) {
        throw new RpcError({ code: error.code, message: error.message, detail: error.details });
      }
      throw error;
    }
  };

  server.handle({
    "processes.list": (params) =>
      managedCall(() =>
        managedProcesses.list((params as { includeExited?: boolean } | undefined)?.includeExited === true),
      ),

    "processes.get": (params) => managedCall(() => managedProcesses.get((params as { processId: string }).processId)),

    "processes.read": (params) =>
      managedCall(() => managedProcesses.read(params as ManagedProcessReadParams, undefined, true)),

    "processes.wait": (params) =>
      managedCall(() => managedProcesses.wait(params as ManagedProcessWaitParams, undefined, true)),

    "processes.write": (params) => managedCall(() => managedProcesses.write(params as ManagedProcessWriteParams)),

    "processes.stop": (params) => {
      const body = params as { processId: string; runId: string; mode?: "graceful" | "force" };
      return managedCall(() => managedProcesses.stop(body.processId, body.runId, body.mode, "user"));
    },

    "processes.stopAll": (params) =>
      managedCall(async () => ({
        ok: true as const,
        stopped: await managedProcesses.stopAll(
          "user",
          (params as { mode?: "graceful" | "force" } | undefined)?.mode,
          false,
        ),
      })),

    "processes.restart": (params) => {
      const body = params as { processId: string; runId: string };
      return managedCall(() => managedProcesses.restart(body.processId, body.runId, "user"));
    },

    "processes.dismiss": (params) =>
      managedCall(() => managedProcesses.dismiss((params as { processId: string }).processId)),

    "processes.export": (params) => {
      const body = params as {
        processId: string;
        runId: string;
        streams?: Array<"stdout" | "stderr" | "system">;
      };
      return managedCall(() => managedProcesses.exportLogs(body.processId, body.runId, body.streams));
    },
  });

  // Host-level shutdown stops processes it owns; user-requested stops are explicit.
  return async () => {
    await managedProcesses.stopAll("host");
  };
}
