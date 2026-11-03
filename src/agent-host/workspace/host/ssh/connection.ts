import { type ChildProcess, spawn } from "node:child_process";
import { mkdirSync } from "node:fs";
import { desktopUserDataPath } from "../../../desktop-state-file.ts";
import { sanitizeToolEnvironment } from "../../../tool-environment.ts";
import { RemoteConnectError, RemoteTransportError, type RemoteConnectFailure } from "../errors.ts";
import type {
  ExecutionHost,
  HostConnectionEvent,
  ProbeFacts,
  RemoteExecRequest,
  RemoteExecOutcome,
  RemoteOperationMap,
  RemoteOpName,
  RemoteWatchEvent,
} from "../execution-host.ts";
import type { HostId, PosixAbsPath, SshTarget } from "../../../../shared/workspace-ref.ts";
import { attachHelperLink, HelperStartError, type HelperLink } from "./helper-link.ts";
import { helperScript } from "./python-helper.ts";
import {
  buildSshArgv,
  controlSocketPathFor,
  ensureControlDirectory,
  remotePythonCommand,
  type SshContext,
} from "./argv.ts";

const MAX_RECONNECT_ATTEMPTS = 3;
const RECONNECT_INITIAL_MS = 500;
const RECONNECT_MULTIPLIER = 2;
const HEARTBEAT_MS = 5_000;
const CONNECT_TIMEOUT_MS = 20_000;

function dexonKnownHostsPath(): string {
  const dir = `${desktopUserDataPath()}/ssh`;
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  return `${dir}/known_hosts`;
}

function sshBinary(): string {
  return process.env.DEXON_SSH_BINARY ?? "ssh";
}

function toHelperError(error: unknown, target: SshTarget, stderr: string): Error {
  if (error instanceof RemoteConnectError) return error;
  if (!(error instanceof HelperStartError)) return new RemoteTransportError(String(error));
  const text = error.stderr || stderr;
  const patterns: Array<[RegExp, (match: RegExpMatchArray) => RemoteConnectFailure]> = [
    [
      /Host key verification failed|No (\S+) host key is known/,
      () => ({
        code: "host-key-unverified",
        target,
        host: target.host,
        keyType: "ed25519",
        fingerprint: "",
      }),
    ],
    [
      /REMOTE HOST IDENTIFICATION HAS CHANGED/,
      () => ({ code: "host-key-changed", target, detail: text.slice(0, 300) }),
    ],
    [
      /Permission denied/,
      () => ({
        code: "auth-required",
        target,
        copyIdCommand: `ssh-copy-id${target.port && target.port !== 22 ? ` -p ${target.port}` : ""} ${target.user ? `${target.user}@` : ""}${target.host}`,
      }),
    ],
    [
      /command not found.*python3?|python3?.*not found/i,
      () => ({
        code: "python-missing",
        target,
        installCommand: "sudo apt-get update && sudo apt-get install -y python3",
        canAutoInstall: false,
      }),
    ],
    [
      /connect to host.*Connection refused|Network is unreachable|No route to host/,
      () => ({ code: "unreachable", target, message: text.slice(0, 300) }),
    ],
  ];
  for (const [regex, builder] of patterns) {
    const match = regex.exec(text);
    if (match) return new RemoteConnectError(builder(match));
  }
  return new RemoteTransportError(`SSH helper did not start: ${text.slice(-300)}`);
}

export type SshConnectionState = "idle" | "connecting" | "connected" | "reconnecting" | "offline";

interface ConnectionListeners {
  readonly onConnection: Set<(event: HostConnectionEvent) => void>;
}

function spawnSsh(binary: string, argv: string[], env: NodeJS.ProcessEnv): ChildProcess {
  return spawn(binary, argv, {
    stdio: ["pipe", "pipe", "pipe"],
    env: sanitizeToolEnvironment(env),
    detached: false,
  });
}

export class SshConnection implements ExecutionHost {
  readonly kind = "ssh" as const;
  readonly id: HostId;
  readonly target: SshTarget;
  private link: HelperLink | null = null;
  private masterChild: ChildProcess | null = null;
  private helperChild: ChildProcess | null = null;
  private epoch = 0;
  private connectionEvent: HostConnectionEvent;
  private cachedFacts: ProbeFacts | null = null;
  private disposed = false;
  private connectingPromise: Promise<ProbeFacts> | null = null;
  private readonly listeners: ConnectionListeners = { onConnection: new Set() };
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  readonly context: SshContext;

  constructor(id: HostId, target: SshTarget, contextOverrides: Partial<SshContext> = {}) {
    this.id = id;
    this.target = target;
    this.context = {
      target,
      controlPath: controlSocketPathFor(target),
      dexonKnownHostsPath: dexonKnownHostsPath(),
      userKnownHostsPath: `${process.env.HOME ?? "~"}/.ssh/known_hosts`,
      connectTimeoutSeconds: Math.ceil(CONNECT_TIMEOUT_MS / 1000),
      ...contextOverrides,
    };
    this.connectionEvent = { state: "connecting", epoch: 0 };
  }

  facts(): ProbeFacts | null {
    return this.cachedFacts;
  }

  connectionState(): HostConnectionEvent {
    return this.connectionEvent;
  }

  onConnection(listener: (event: HostConnectionEvent) => void): () => void {
    this.listeners.onConnection.add(listener);
    return () => this.listeners.onConnection.delete(listener);
  }

  controlPath(): string | null {
    return this.context.controlPath ?? null;
  }

  private setState(event: HostConnectionEvent): void {
    this.connectionEvent = event;
    for (const listener of this.listeners.onConnection) {
      queueMicrotask(() => listener(event));
    }
  }

  async connect(signal?: AbortSignal): Promise<ProbeFacts> {
    if (this.disposed) throw new RemoteTransportError("Connection was disposed");
    if (this.link?.hello && this.cachedFacts) return this.cachedFacts;
    if (this.connectingPromise) return this.connectingPromise;
    this.connectingPromise = this.doConnect(signal).finally(() => {
      this.connectingPromise = null;
    });
    return this.connectingPromise;
  }

  private async doConnect(signal?: AbortSignal): Promise<ProbeFacts> {
    this.setState({ state: "connecting", epoch: this.epoch });
    ensureControlDirectory();
    const binary = sshBinary();
    const masterArgv = buildSshArgv(this.context, { kind: "master" });
    const masterChild = spawnSsh(binary, masterArgv, process.env);
    this.masterChild = masterChild;
    let masterStderr = "";
    masterChild.stderr?.on("data", (c: Buffer) => {
      masterStderr = `${masterStderr}${c.toString("utf8")}`.slice(-4096);
    });
    masterChild.on("exit", () => {
      if (!this.disposed) void this.onTransportDropped();
    });
    await this.waitForMasterSocket(masterChild, masterStderr, signal);
    if (signal?.aborted) {
      masterChild.kill();
      throw new RemoteTransportError("Connection was cancelled");
    }
    const script = helperScript();
    const helperArgv = buildSshArgv(this.context, {
      kind: "exec",
      remoteCommand: remotePythonCommand(script),
    });
    const helperChild = spawnSsh(binary, helperArgv, process.env);
    this.helperChild = helperChild;
    let helperStderr = "";
    helperChild.stderr?.on("data", (c: Buffer) => {
      helperStderr = `${helperStderr}${c.toString("utf8")}`.slice(-4096);
    });
    this.epoch += 1;
    let link: HelperLink;
    try {
      link = await attachHelperLink(helperChild, script, {
        epoch: this.epoch,
        helloTimeoutMs: CONNECT_TIMEOUT_MS,
      });
    } catch (error) {
      masterChild.kill();
      throw toHelperError(error, this.target, helperStderr);
    }
    this.link = link;
    const closed = link.closed;
    void closed.then(() => {
      if (this.link === link) void this.onTransportDropped();
    });
    const factsBody = await link.request("hostFacts", {}, { signal });
    const facts = factsBody as unknown as ProbeFacts;
    this.cachedFacts = facts;
    this.startHeartbeat();
    this.setState({ state: "connected", epoch: this.epoch, rttMs: 0 });
    return facts;
  }

  private async waitForMasterSocket(masterChild: ChildProcess, stderrRef: string, signal?: AbortSignal): Promise<void> {
    const binary = sshBinary();
    const deadline = Date.now() + CONNECT_TIMEOUT_MS;
    while (Date.now() < deadline) {
      if (signal?.aborted) return;
      if (masterChild.exitCode !== null) {
        throw toHelperError(
          new HelperStartError("Master exited before socket was ready", stderrRef, masterChild.exitCode),
          this.target,
          stderrRef,
        );
      }
      const checkArgv = buildSshArgv(this.context, { kind: "check" });
      const result = await new Promise<number>((resolve) => {
        const child = spawnSsh(binary, checkArgv, process.env);
        child.on("close", (code) => resolve(code ?? 255));
      });
      if (result === 0) return;
      await new Promise<void>((resolve) => setTimeout(resolve, 200));
    }
    throw new RemoteTransportError("SSH master socket was not ready in time");
  }

  private startHeartbeat(): void {
    this.stopHeartbeat();
    this.heartbeatTimer = setInterval(() => {
      if (!this.link) return;
      const before = Date.now();
      void this.link
        .request("ping", {})
        .then(() => {
          const rtt = Date.now() - before;
          this.setState({ state: "connected", epoch: this.epoch, rttMs: rtt });
        })
        .catch(() => undefined);
    }, HEARTBEAT_MS);
    this.heartbeatTimer.unref?.();
  }

  private stopHeartbeat(): void {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
  }

  private async onTransportDropped(): Promise<void> {
    if (this.disposed) return;
    this.stopHeartbeat();
    this.link = null;
    this.cachedFacts = null;
    this.setState({ state: "reconnecting", epoch: this.epoch, attempt: 1, maxAttempts: MAX_RECONNECT_ATTEMPTS });
    let delay = RECONNECT_INITIAL_MS;
    for (let attempt = 1; attempt <= MAX_RECONNECT_ATTEMPTS; attempt += 1) {
      await new Promise<void>((resolve) => setTimeout(resolve, delay));
      if (this.disposed) return;
      this.setState({ state: "reconnecting", epoch: this.epoch, attempt, maxAttempts: MAX_RECONNECT_ATTEMPTS });
      try {
        await this.doConnect();
        return;
      } catch {
        delay *= RECONNECT_MULTIPLIER;
      }
    }
    this.setState({ state: "offline", epoch: this.epoch });
  }

  async reconnect(): Promise<ProbeFacts> {
    this.link?.close();
    this.link = null;
    this.cachedFacts = null;
    this.masterChild?.kill();
    return this.connect();
  }

  async request<K extends RemoteOpName>(
    op: K,
    input: RemoteOperationMap[K]["input"],
    signal?: AbortSignal,
  ): Promise<RemoteOperationMap[K]["output"]> {
    const link = this.link;
    if (!link) throw new RemoteTransportError("Not connected");
    const body = await link.request(op, input as object, { signal });
    return body as unknown as RemoteOperationMap[K]["output"];
  }

  async streamExec(request: RemoteExecRequest, signal?: AbortSignal): Promise<RemoteExecOutcome> {
    const link = this.link;
    if (!link) throw new RemoteTransportError("Not connected");
    const body = await link.request(
      "exec",
      {
        argv: request.argv,
        cwd: request.cwd,
        ...(request.env ? { env: request.env } : {}),
        ...(request.stdin ? { stdin: request.stdin } : {}),
        ...(request.timeoutMs ? { timeoutMs: request.timeoutMs } : {}),
      },
      {
        signal,
        onData: (data) => request.onData(data.stream as "stdout" | "stderr", data.bytes),
      },
    );
    const transportDropped = false;
    return {
      exitCode: typeof body.exitCode === "number" ? body.exitCode : null,
      signal: typeof body.signal === "string" ? body.signal : null,
      timedOut: body.timedOut === true,
      transportDropped,
    };
  }

  async watchPath(
    input: RemoteOperationMap["watchStart"]["input"],
    listener: (event: RemoteWatchEvent) => void,
  ): Promise<() => Promise<void>> {
    const result = await this.request("watchStart", input);
    const { watchId } = result;
    const stopWatchData = this.link
      ? this.link.onWatchData((data) => {
          if (data.meta.watchId === watchId) {
            const eventKind = data.meta.event === "removed" ? "removed" : "change";
            const eventPath = typeof data.meta.path === "string" ? (data.meta.path as PosixAbsPath) : input.path;
            listener({ watchId, path: eventPath, event: eventKind });
          }
        })
      : () => undefined;
    const unsubscribe = this.onConnection((event) => {
      if (event.state === "reconnecting" || event.state === "offline") {
        listener({ watchId, path: input.path as PosixAbsPath, event: "removed" });
      }
    });
    return async () => {
      stopWatchData();
      unsubscribe();
      await this.request("watchStop", { watchId }).catch(() => undefined);
    };
  }

  async dispose(): Promise<void> {
    this.disposed = true;
    this.stopHeartbeat();
    const link = this.link;
    this.link = null;
    link?.close();
    await link?.closed.catch(() => undefined);
    this.masterChild?.kill();
    this.helperChild?.kill();
    this.setState({ state: "offline", epoch: this.epoch });
  }
}
