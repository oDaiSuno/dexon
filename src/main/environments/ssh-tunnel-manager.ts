import { osErrorFacts } from "../../agent-host/subprocess-cwd.ts";
import path from "node:path";
import type { RemoteRuntimeMeta, RemoveOutcome } from "../../contract/environment-commands.ts";
import { RemotePayloadCatalog } from "./remote-payload.ts";
import { RemoteProvisioner, type StageReporter } from "./remote-provisioner.ts";
import { localSshSpawnOptions, runSsh, sshArguments, sshFailure, runLocalSshTool } from "./ssh-command.ts";
import { spawn, type ChildProcess } from "node:child_process";
import { createServer } from "node:net";
import type { EnvironmentDescriptor, SshEnvironmentTarget } from "../../contract/environment.ts";
import { fetchUnauthenticatedDescriptor, type RemoteEndpoint } from "./remote-endpoint.ts";
import { buildRemoteLaunchScript, buildRemoteStopScript, computeSshStateKey } from "./ssh-scripts.ts";
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
  runtime: RemoteRuntimeMeta;
  nodePath: string;
}

type CloseMode = "disconnect" | "stop-managed";

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

  private readonly options: { payloadDirectory?: string };
  private provisioner: RemoteProvisioner | null = null;

  constructor(options: { payloadDirectory?: string } = {}) {
    this.options = options;
  }

  private getProvisioner(): RemoteProvisioner {
    return (this.provisioner ??= new RemoteProvisioner(
      new RemotePayloadCatalog(this.options.payloadDirectory ?? path.resolve(process.cwd(), "out/remote-payload")),
    ));
  }

  probe(target: SshEnvironmentTarget, signal?: AbortSignal, report?: StageReporter) {
    return this.getProvisioner().probe(
      target,
      AbortSignal.any([this.controller.signal, ...(signal ? [signal] : [])]),
      report,
    );
  }

  async trustHostKey(target: SshEnvironmentTarget, knownHost?: string, knownHostsFile?: string): Promise<void> {
    const host =
      knownHost ??
      (target.port && target.port !== 22
        ? `[${target.hostname ?? target.sshAlias}]:${target.port}`
        : (target.hostname ?? target.sshAlias));
    if (!host || host.startsWith("-") || /[\0\r\n]/u.test(host)) throw new Error("Invalid known host");
    await runLocalSshTool(
      "ssh-keygen",
      ["-R", host, ...(knownHostsFile ? ["-f", knownHostsFile] : [])],
      this.controller.signal,
    );
  }

  async stopRemoteDaemon(target: SshEnvironmentTarget): Promise<RemoveOutcome["remoteDaemon"]> {
    const key = computeSshStateKey(target);
    return this.withTargetLock(key, async () => {
      const existing = this.tunnels.get(key);
      const probe = existing ? null : await this.probe(target);
      if (!existing && (!probe?.daemon.running || probe.daemon.ownership !== "managed")) return "not-owned";
      if (existing?.ownership === "external") return "not-owned";
      const nodePath = existing?.nodePath ?? probe?.node?.path;
      if (!nodePath) return "unreachable";
      const output = await runSsh(
        target,
        buildRemoteStopScript({ stateKey: key, remoteStateDir: target.remoteStateDir, nodePath }),
        { signal: this.controller.signal, timeoutMs: 10000 },
      );
      return output.trim() === "stopped" ? "stopped" : "not-owned";
    });
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

  async ensureTunnel(
    target: SshEnvironmentTarget,
    signal?: AbortSignal,
    report: StageReporter = () => {},
  ): Promise<SshTunnelEntry> {
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
      const runtime = await this.getProvisioner().prepare(target, cancellation, report);
      if (runtime.restartDaemon) {
        const fresh = await this.probe(target, cancellation);
        if (fresh.daemon.ownership === "managed" && fresh.daemon.activeSessions === 0)
          await runSsh(
            target,
            buildRemoteStopScript({ stateKey: key, remoteStateDir: target.remoteStateDir, nodePath: runtime.nodePath }),
            { signal: cancellation },
          );
        else runtime.updatePending = true;
      }
      report("starting-daemon");
      const output = await runSsh(
        target,
        buildRemoteLaunchScript({
          stateKey: key,
          preferredPort: target.remotePort ?? 3780,
          remoteStateDir: target.remoteStateDir,
          daemonScriptPath: runtime.daemonScriptPath,
          nodePath: runtime.nodePath,
        }),
        { signal: cancellation },
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
        {
          ...localSshSpawnOptions(),
          stdio: ["ignore", "ignore", "pipe"],
        },
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
            throw spawnError
              ? sshFailure(diagnostic.trim() || (spawnError as Error).message, target, osErrorFacts(spawnError)?.code)
              : sshFailure(diagnostic.trim() || "SSH forward exited", target);
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
              launch.authToken,
            );
          } catch (error) {
            if (cancellation.aborted || classifyConnectError(error).kind === "blocked" || Date.now() >= deadline)
              throw error;
            await new Promise((resolve) => setTimeout(resolve, 100));
          }
        }
        if (spawnError)
          throw sshFailure(diagnostic.trim() || (spawnError as Error).message, target, osErrorFacts(spawnError)?.code);
        if (cancellation.aborted || this.disposed || child.exitCode !== null || child.signalCode !== null)
          throw new Error("SSH forward closed during preparation");
        const entry: SshTunnelEntry = {
          key,
          target: { ...target },
          localPort: reservation.port,
          remotePort: Number(launch.port),
          ownership: launch.ownership,
          process: child,
          descriptor,
          nodePath: runtime.nodePath,
          runtime: {
            nodeVersion: descriptor.runtime?.nodeVersion ?? runtime.probe.node!.version,
            payloadVersion:
              descriptor.runtime?.payloadVersion ?? runtime.probe.daemon.payloadVersion ?? runtime.payloadVersion,
            startedAt: descriptor.runtime?.startedAt ?? Date.now(),
            ownership: launch.ownership,
            updatePending: runtime.updatePending,
          },
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
    if (mode === "stop-managed") await this.stopRemoteDaemon(target);
    const key = computeSshStateKey(target);
    await this.withTargetLock(key, async () => {
      const entry = this.tunnels.get(key);
      if (entry) await this.closeTunnelEntry(entry, "disconnect");
    });
  }

  async closeTunnelEntry(entry: SshTunnelEntry, mode: CloseMode): Promise<void> {
    const ownsRemote = this.tunnels.get(entry.key) === entry;
    if (ownsRemote) this.tunnels.delete(entry.key);
    await terminateForward(entry.process);
    if (ownsRemote && entry.ownership === "managed" && mode === "stop-managed") {
      await runSsh(
        entry.target,
        buildRemoteStopScript({
          stateKey: entry.key,
          remoteStateDir: entry.target.remoteStateDir,
          nodePath: entry.nodePath,
        }),
      );
    }
  }

  async dispose(): Promise<void> {
    this.disposed = true;
    this.controller.abort();
    await Promise.all([...this.tunnels.values()].map((entry) => this.closeTunnel(entry.target)));
    await Promise.all([...this.locks.values()]);
  }
}
