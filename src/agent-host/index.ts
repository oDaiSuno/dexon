import { parseArgs } from "node:util";
import { createRpcServer } from "../contract/rpc";
import { registerHandlers } from "./handlers";
import { startSessionWatcher } from "./session-watcher";
import { toolchainRuntime } from "./toolchain-runtime";
import type { ToolchainSnapshot } from "../shared/toolchains/types";
import { installToolchainGitRunner } from "./toolchain-git";
import type { BrowserCapabilitySnapshot } from "../contract/browser";
import { browserCapabilityRuntime } from "./browser-capability-runtime";
import { readPiRuntimeVersion } from "./runtime-version";
import { applyManagedProcessOwnerIdentity } from "./managed-process/owner-identity";
import { initializeStandaloneHostPlatform } from "./platform-services";
import { startDaemonServer, type DaemonServer } from "./daemon-server";

function parseStandaloneArguments(args: string[]) {
  const { values } = parseArgs({
    args,
    options: { listen: { type: "string" }, "state-dir": { type: "string" }, label: { type: "string" } },
    strict: true,
    allowPositionals: false,
  });
  let listenPort: number | undefined;
  let listenHost = "127.0.0.1";
  if (values.listen !== undefined) {
    const match = /^(?:(?:\[([^\]]+)\]|([^:]+)):)?(\d{1,5})$/u.exec(values.listen);
    if (!match || Number(match[3]) > 65535) throw new Error("--listen requires [host:]port between 0 and 65535");
    listenHost = match[1] ?? match[2] ?? listenHost;
    listenPort = Number(match[3]);
  }
  return { stateDir: values["state-dir"], label: values.label, listenHost, listenPort };
}

const piRuntimeVersion = readPiRuntimeVersion();
const standaloneOptions = process.parentPort ? null : parseStandaloneArguments(process.argv.slice(2));
const standalonePlatform = standaloneOptions
  ? await initializeStandaloneHostPlatform({ ...standaloneOptions, piVersion: piRuntimeVersion })
  : null;
let daemon: DaemonServer | undefined;

const server = createRpcServer();
const restoreGitRunner = installToolchainGitRunner();
const stopHandlers = registerHandlers(server);
const stopWatcher = startSessionWatcher(server);

function log(message: string): void {
  try {
    if (process.parentPort) process.parentPort.postMessage({ type: "log", message });
    else console.log(`[agent-host] ${message}`);
  } catch {
    console.log(`[agent-host] ${message}`);
  }
}

const parentPort = process.parentPort;
if (parentPort) {
  parentPort.on("message", (event) => {
    const msg = event.data as {
      type?: string;
      snapshot?: ToolchainSnapshot | BrowserCapabilitySnapshot;
      version?: unknown;
      mainPid?: unknown;
      mainStartFingerprint?: unknown;
      mainImagePath?: unknown;
      hostInstanceId?: unknown;
    };
    if (msg?.type === "ping") {
      parentPort.postMessage({ type: "pong", ts: Date.now() });
      return;
    }
    if (msg?.type === "attach-port") {
      const port = event.ports?.[0];
      if (port) {
        try {
          server.attachPort(port as never);
          log("renderer port attached");
        } catch (err) {
          log(`attach-port failed: ${err instanceof Error ? err.message : String(err)}`);
        }
      } else {
        log("attach-port: no port in event");
      }
      return;
    }
    if (msg?.type === "managed-process-owner:init") {
      try {
        const owner = applyManagedProcessOwnerIdentity(msg);
        parentPort.postMessage({
          type: "managed-process-owner:ack",
          version: 1,
          hostInstanceId: owner.hostInstanceId,
        });
      } catch (error) {
        log(`managed process owner identity rejected: ${error instanceof Error ? error.message : String(error)}`);
      }
      return;
    }
    if (msg?.type === "toolchain:init" || msg?.type === "toolchain:changed") {
      try {
        if (!msg.snapshot) throw new Error("missing snapshot");
        toolchainRuntime.apply(msg.snapshot as ToolchainSnapshot);
        parentPort.postMessage({ type: "toolchain:ack", revision: msg.snapshot.revision });
        log(`toolchain ${msg.type === "toolchain:init" ? "initialized" : "updated"} revision=${msg.snapshot.revision}`);
      } catch (error) {
        log(`toolchain snapshot rejected: ${error instanceof Error ? error.message : String(error)}`);
      }
      return;
    }
    if (msg?.type === "browser:init" || msg?.type === "browser:changed") {
      try {
        if (!msg.snapshot) throw new Error("missing snapshot");
        browserCapabilityRuntime.apply(msg.snapshot as BrowserCapabilitySnapshot);
        parentPort.postMessage({ type: "browser:ack", revision: msg.snapshot.revision });
        log(`browser ${msg.type === "browser:init" ? "initialized" : "updated"} revision=${msg.snapshot.revision}`);
      } catch (error) {
        log(`browser capability snapshot rejected: ${error instanceof Error ? error.message : String(error)}`);
      }
      return;
    }
    if (msg?.type === "shutdown") {
      stopWatcher();
      restoreGitRunner();
      void stopHandlers().finally(() => process.exit(0));
    }
  });

  parentPort.postMessage({ type: "ready", ts: Date.now(), piVersion: piRuntimeVersion });
  log("agent-host ready");
} else if (standalonePlatform && standaloneOptions) {
  if (standaloneOptions.listenPort !== undefined) {
    daemon = await startDaemonServer({
      rpcServer: server,
      getDescriptor: () => standalonePlatform.getDescriptor(),
      authToken: standalonePlatform.authToken,
      listenHost: standaloneOptions.listenHost,
      listenPort: standaloneOptions.listenPort,
    });
    const host = daemon.listenHost.includes(":") ? `[${daemon.listenHost}]` : daemon.listenHost;
    log(`daemon listening on http://${host}:${daemon.port}`);
  } else {
    log("standalone platform ready");
  }
  let stopping = false;
  const shutdown = () => {
    if (stopping) return;
    stopping = true;
    stopWatcher();
    restoreGitRunner();
    void (async () => {
      await daemon?.close();
      try {
        await stopHandlers();
      } finally {
        await standalonePlatform.dispose();
      }
    })().then(
      () => process.exit(0),
      (error: unknown) => {
        log(`shutdown failed: ${error instanceof Error ? error.message : String(error)}`);
        process.exit(1);
      },
    );
  };
  process.once("SIGINT", shutdown);
  process.once("SIGTERM", shutdown);
}

process.on("uncaughtException", (err) => {
  log(`uncaughtException: ${err instanceof Error ? (err.stack ?? err.message) : String(err)}`);
  setImmediate(() => process.exit(1));
});
process.on("unhandledRejection", (err) => {
  log(`unhandledRejection: ${err instanceof Error ? (err.stack ?? err.message) : String(err)}`);
  setImmediate(() => process.exit(1));
});

setInterval(() => {}, 1 << 30);
