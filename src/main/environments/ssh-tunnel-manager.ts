import { execFile, spawn, type ChildProcess } from "node:child_process";
import { createServer } from "node:net";
import type { EnvironmentDescriptor, SshEnvironmentTarget } from "../../contract/environment.ts";
import { fetchUnauthenticatedDescriptor, type RemoteEndpoint } from "./remote-endpoint.ts";
import {
  buildRemoteLaunchScript,
  buildRemoteStopScript,
  computeSshStateKey,
  shellQuote,
  validateSshTarget,
} from "./ssh-scripts.ts";
import {
  classifyConnectError,
  EnvironmentConnectionError,
  QUICK_PROBE_TIMEOUT_MS,
  REMOTE_PROBE_TIMEOUT_MS,
} from "./supervisor-policy.ts";

export { fetchUnauthenticatedDescriptor } from "./remote-endpoint.ts";

export interface SshTunnelEntry extends RemoteEndpoint {
  key: string;
  target: SshEnvironmentTarget;
  localPort: number;
  remotePort: number;
  ownership: "managed" | "external";
  process: ChildProcess;
  descriptor: EnvironmentDescriptor;
}

type CloseMode = "disconnect" | "stop-managed";

function sshArguments(target: SshEnvironmentTarget): string[] {
  validateSshTarget(target);
  return [
    "-T",
    "-o",
    "ExitOnForwardFailure=yes",
    "-o",
    "ControlMaster=no",
    "-o",
    "ControlPath=none",
    "-o",
    "ControlPersist=no",
    "-o",
    "ServerAliveInterval=15",
    "-o",
    "ServerAliveCountMax=3",
    "-o",
    "BatchMode=yes",
    "-o",
    "ConnectTimeout=15",
    ...(target.port === undefined ? [] : ["-p", String(target.port)]),
    ...(target.user === undefined ? [] : ["-l", target.user]),
    ...(target.hostname === undefined ? [] : ["-o", `HostName=${target.hostname}`]),
  ];
}

function executeRemote(target: SshEnvironmentTarget, script: string, signal?: AbortSignal): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(
      "ssh",
      [...sshArguments(target), "-n", target.sshAlias, `sh -c ${shellQuote(script)}`],
      { timeout: 45_000, maxBuffer: 262_144, windowsHide: true, signal },
      (error, stdout, stderr) => {
        if (!error) resolve(stdout);
        else if (error.code === "ENOENT")
          reject(new EnvironmentConnectionError("blocked", "configuration", "SSH executable is unavailable"));
        else
          reject(
            new Error(
              stderr.trim().slice(-4096) ||
                (error.killed && !signal?.aborted ? "Remote SSH command timed out" : "Remote SSH command failed"),
            ),
          );
      },
    );
  });
}

async function reserveLoopbackPort(): Promise<{ port: number; release: () => Promise<void> }> {
  const server = createServer();
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      server.removeListener("error", reject);
      resolve();
    });
  });
  const address = server.address();
  if (!address || typeof address === "string") {
    server.close();
    throw new Error("Could not reserve a loopback port");
  }
  return {
    port: address.port,
    release: () => new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve()))),
  };
}

async function terminateForward(child: ChildProcess): Promise<void> {
  if (child.exitCode !== null || child.signalCode !== null) return;
  await new Promise<void>((resolve) => {
    const done = () => {
      clearTimeout(timer);
      child.removeListener("exit", done);
      resolve();
    };
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      done();
    }, 2_000);
    timer.unref();
    child.once("exit", done);
    child.kill();
  });
}

export class SshEnvironmentManager {
  private readonly tunnels = new Map<string, SshTunnelEntry>();
  private readonly locks = new Map<string, Promise<void>>();
  private disposed = false;
  private readonly controller = new AbortController();

  private readonly options: { daemonScriptPath?: string };

  constructor(options: { daemonScriptPath?: string } = {}) {
    this.options = options;
  }

  async withTargetLock<T>(stateKey: string, fn: () => Promise<T>): Promise<T> {
    const previous = this.locks.get(stateKey) ?? Promise.resolve();
    const running = previous.then(fn);
    const settled = running.then(
      () => undefined,
      () => undefined,
    );
    this.locks.set(stateKey, settled);
    try {
      return await running;
    } finally {
      if (this.locks.get(stateKey) === settled) this.locks.delete(stateKey);
    }
  }

  async ensureTunnel(target: SshEnvironmentTarget, signal?: AbortSignal): Promise<SshTunnelEntry> {
    const key = computeSshStateKey(target);
    const cancellation = AbortSignal.any([this.controller.signal, ...(signal ? [signal] : [])]);
    return this.withTargetLock(key, async () => {
      if (this.disposed) throw new Error("SSH environment manager is disposed");
      cancellation.throwIfAborted();
      const oldEntry = this.tunnels.get(key);
      if (oldEntry) {
        this.tunnels.delete(key);
        await this.closeTunnelEntry(oldEntry, "disconnect");
      }
      const output = await executeRemote(
        target,
        buildRemoteLaunchScript({
          stateKey: key,
          preferredPort: target.remotePort ?? 3780,
          remoteStateDir: target.remoteStateDir,
          daemonScriptPath: this.options.daemonScriptPath,
        }),
        cancellation,
      );
      cancellation.throwIfAborted();
      let launch: { port?: unknown; ownership?: unknown; authToken?: unknown };
      try {
        launch = JSON.parse(output.trim()) as typeof launch;
      } catch {
        throw new Error("Invalid remote SSH launch response");
      }
      if (
        !launch ||
        !Number.isInteger(launch.port) ||
        Number(launch.port) < 1 ||
        Number(launch.port) > 65535 ||
        (launch.ownership !== "managed" && launch.ownership !== "external") ||
        typeof launch.authToken !== "string" ||
        !/^[a-f0-9]{64}$/u.test(launch.authToken)
      ) {
        throw new Error("Invalid remote SSH launch response");
      }
      const reservation = await reserveLoopbackPort();
      await reservation.release();
      const child = spawn(
        "ssh",
        [
          ...sshArguments(target),
          "-v",
          "-n",
          "-N",
          "-L",
          `127.0.0.1:${reservation.port}:127.0.0.1:${launch.port}`,
          target.sshAlias,
        ],
        { stdio: ["ignore", "ignore", "pipe"], windowsHide: true },
      );
      let diagnostic = "";
      let forwardReady = false;
      let spawnError: Error | null = null;
      child.stderr?.on("data", (chunk: Buffer) => {
        diagnostic = (diagnostic + chunk.toString()).slice(-4096);
        if (diagnostic.includes(`Local forwarding listening on 127.0.0.1 port ${reservation.port}`))
          forwardReady = true;
      });
      child.on("error", (error) => {
        spawnError = error;
      });
      const httpBaseUrl = `http://127.0.0.1:${reservation.port}`;
      try {
        const deadline = Date.now() + REMOTE_PROBE_TIMEOUT_MS;
        let descriptor: EnvironmentDescriptor | undefined;
        while (!descriptor) {
          if (spawnError || child.exitCode !== null || child.signalCode !== null)
            throw spawnError ?? new Error(diagnostic.trim() || "SSH forward exited");
          if (!forwardReady) {
            if (cancellation.aborted || Date.now() >= deadline)
              throw new EnvironmentConnectionError("transient", "timeout", "SSH forward setup timed out");
            await new Promise((resolve) => setTimeout(resolve, 100));
            continue;
          }
          try {
            descriptor = await fetchUnauthenticatedDescriptor(
              httpBaseUrl,
              target.expectedEnvironmentId,
              QUICK_PROBE_TIMEOUT_MS,
              cancellation,
            );
          } catch (error) {
            if (cancellation.aborted || classifyConnectError(error).kind === "blocked" || Date.now() >= deadline)
              throw error;
            await new Promise((resolve) => setTimeout(resolve, 100));
          }
        }
        if (cancellation.aborted || this.disposed || spawnError || child.exitCode !== null || child.signalCode !== null)
          throw new Error("SSH forward closed during preparation");
        const entry: SshTunnelEntry = {
          key,
          target: { ...target },
          localPort: reservation.port,
          remotePort: Number(launch.port),
          ownership: launch.ownership,
          process: child,
          descriptor,
          httpBaseUrl,
          wsUrl: `ws://127.0.0.1:${reservation.port}/rpc`,
          authToken: launch.authToken,
        };
        this.tunnels.set(key, entry);
        return entry;
      } catch (error) {
        await terminateForward(child);
        throw error;
      }
    });
  }

  async closeTunnel(target: SshEnvironmentTarget, mode: CloseMode = "disconnect"): Promise<void> {
    const key = computeSshStateKey(target);
    await this.withTargetLock(key, async () => {
      const entry = this.tunnels.get(key);
      if (entry) await this.closeTunnelEntry(entry, mode);
    });
  }

  async closeTunnelEntry(entry: SshTunnelEntry, mode: CloseMode): Promise<void> {
    const ownsRemote = this.tunnels.get(entry.key) === entry;
    if (ownsRemote) this.tunnels.delete(entry.key);
    await terminateForward(entry.process);
    if (ownsRemote && entry.ownership === "managed" && mode === "stop-managed") {
      await executeRemote(entry.target, buildRemoteStopScript({ stateKey: entry.key }));
    }
  }

  async dispose(): Promise<void> {
    this.disposed = true;
    this.controller.abort();
    await Promise.all([...this.tunnels.values()].map((entry) => this.closeTunnel(entry.target)));
    await Promise.all([...this.locks.values()]);
  }
}
