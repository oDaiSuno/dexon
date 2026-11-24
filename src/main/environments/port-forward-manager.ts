import { spawn, type ChildProcess } from "node:child_process";
import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { request as httpRequest } from "node:http";
import { request as httpsRequest } from "node:https";
import { validateHeaderValue } from "node:http";
import { createServer, type Server, type Socket } from "node:net";
import type { PortForwardEntry } from "../../contract/environment-commands.ts";
import {
  DEXON_ENVIRONMENT_PROTOCOL_VERSION,
  type SshEnvironmentTarget,
  type WebSocketEnvironmentTarget,
} from "../../contract/environment.ts";
import { resolveWebSocketTarget } from "./remote-endpoint.ts";
import { localSshSpawnOptions, sshArguments, sshFailure } from "./ssh-command.ts";

type Transport = {
  target: SshEnvironmentTarget | WebSocketEnvironmentTarget;
  endpoint?: { wsUrl: string; authToken?: string };
  remoteEnvironmentId?: string;
};
type OpenInput = { environmentId: string; remotePort: number; processId?: string; label?: string };
type Options = {
  resolveTransport: (environmentId: string) => Transport | null;
  onChanged?: () => void;
  spawn?: typeof spawn;
  openingTimeoutMs?: number;
  killTimeoutMs?: number;
};
type WebSocketConnection = {
  socket: Socket;
  head: Buffer;
  send(payload: Buffer, opcode: number): Promise<void>;
  terminate(): void;
};
const MAX_WEBSOCKET_MESSAGE = 64 * 1024 * 1024;
const WEBSOCKET_GUID = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11";
type Run = {
  controller: AbortController;
  server?: Server;
  child?: ChildProcess;
  killTimeoutMs?: number;
  sockets: Set<Socket>;
  websockets: Set<WebSocketConnection>;
  ready: Promise<PortForwardEntry>;
  stopping?: Promise<void>;
};
type Forward = {
  entry: PortForwardEntry;
  run?: Run;
  stopping?: Promise<void>;
  resuming?: Promise<void>;
  revision: number;
};

function validateEnvironment(value: string): void {
  if (typeof value !== "string" || !value.trim() || value.length > 1024 || /[\0\r\n]/u.test(value))
    throw new Error("Invalid environment identifier");
}
function validatePort(value: number): void {
  if (!Number.isInteger(value) || value < 1 || value > 65535) throw new Error("Invalid remote port");
}
function validateMetadata(value: string | undefined): void {
  if (
    value !== undefined &&
    (typeof value !== "string" || !value.trim() || value.length > 1024 || /[\p{Cc}\p{Cf}]/u.test(value))
  )
    throw new Error("Invalid port forward metadata");
}
function key(environmentId: string, remotePort: number): string {
  return `${environmentId}:${remotePort}`;
}
function hasToken(value: string | string[] | undefined, token: string): boolean {
  return String(value ?? "")
    .split(",")
    .some((part) => part.trim().toLowerCase() === token);
}
function websocketFrame(payload: Buffer, opcode: number): Buffer {
  if (opcode >= 8 && payload.length > 125) throw new Error("Invalid WebSocket control frame");
  const length = payload.length;
  const headerLength = length < 126 ? 2 : length <= 65535 ? 4 : 10;
  const frame = Buffer.alloc(headerLength + 4 + length);
  frame[0] = 0x80 | opcode;
  if (length < 126) frame[1] = 0x80 | length;
  else if (length <= 65535) {
    frame[1] = 0x80 | 126;
    frame.writeUInt16BE(length, 2);
  } else {
    frame[1] = 0x80 | 127;
    frame.writeBigUInt64BE(BigInt(length), 2);
  }
  const mask = randomBytes(4);
  mask.copy(frame, headerLength);
  for (let index = 0; index < length; index++) frame[headerLength + 4 + index] = payload[index] ^ mask[index & 3];
  return frame;
}
function writeSocket(socket: Socket, frame: Buffer): Promise<void> {
  return new Promise((resolve, reject) => {
    let waitingDrain = false;
    let settled = false;
    const finish = (error?: Error | null) => {
      if (settled) return;
      settled = true;
      socket.removeListener("error", failed);
      socket.removeListener("drain", drained);
      if (error) reject(error);
      else resolve();
    };
    const failed = (error: Error) => finish(error);
    const drained = () => finish();
    socket.once("error", failed);
    try {
      waitingDrain = !socket.write(frame, (error?: Error | null) => {
        if (error) finish(error);
        else if (!waitingDrain) finish();
      });
      if (waitingDrain) socket.once("drain", drained);
    } catch (error) {
      finish(error as Error);
    }
  });
}
function websocketSender(socket: Socket): (payload: Buffer, opcode: number) => Promise<void> {
  let tail = Promise.resolve();
  return (payload, opcode) => {
    const next = tail.then(() => writeSocket(socket, websocketFrame(payload, opcode)));
    tail = next.catch(() => undefined);
    return next;
  };
}
class WebSocketParser {
  private buffer: Buffer = Buffer.alloc(0);
  private fragmented = false;
  private messageBytes = 0;
  private readonly message: (payload: Buffer) => boolean;
  private readonly control: (opcode: number, payload: Buffer) => void;
  constructor(message: (payload: Buffer) => boolean, control: (opcode: number, payload: Buffer) => void) {
    this.message = message;
    this.control = control;
  }
  feed(chunk: Buffer): void {
    this.buffer = this.buffer.length ? Buffer.concat([this.buffer, chunk]) : chunk;
    this.drain();
  }
  resume(): void {
    this.drain();
  }
  private drain(): void {
    for (;;) {
      if (this.buffer.length < 2) return;
      const first = this.buffer[0];
      const second = this.buffer[1];
      if ((first & 0x70) !== 0) throw new Error("Unsupported WebSocket frame flags");
      const fin = (first & 0x80) !== 0;
      const opcode = first & 0x0f;
      const masked = (second & 0x80) !== 0;
      if (masked) throw new Error("Masked WebSocket server frame");
      const lengthCode = second & 0x7f;
      let headerLength = 2;
      let length: number;
      if (lengthCode < 126) length = lengthCode;
      else if (lengthCode === 126) {
        if (this.buffer.length < 4) return;
        length = this.buffer.readUInt16BE(2);
        headerLength = 4;
      } else {
        if (this.buffer.length < 10) return;
        if ((this.buffer[2] & 0x80) !== 0) throw new Error("Invalid WebSocket frame length");
        const bigLength = this.buffer.readBigUInt64BE(2);
        if (bigLength > BigInt(MAX_WEBSOCKET_MESSAGE)) throw new Error("WebSocket message is too large");
        length = Number(bigLength);
        headerLength = 10;
      }
      if (length > MAX_WEBSOCKET_MESSAGE) throw new Error("WebSocket message is too large");
      if (opcode >= 8 && (!fin || length > 125)) throw new Error("Invalid WebSocket control frame");
      if (this.buffer.length < headerLength + length) return;
      const payload = this.buffer.subarray(headerLength, headerLength + length);
      this.buffer = this.buffer.subarray(headerLength + length);
      if (opcode >= 8) {
        if (opcode !== 8 && opcode !== 9 && opcode !== 10) throw new Error("Unsupported WebSocket control frame");
        if (opcode === 8 && payload.length === 1) throw new Error("Invalid WebSocket close frame");
        this.control(opcode, payload);
        continue;
      }
      if (opcode === 1) throw new Error("Text WebSocket frames are not supported");
      if (opcode === 2) {
        if (this.fragmented) throw new Error("Unexpected WebSocket binary frame");
        this.messageBytes = length;
        this.fragmented = !fin;
      } else if (opcode === 0) {
        if (!this.fragmented) throw new Error("Unexpected WebSocket continuation frame");
        this.messageBytes += length;
        if (this.messageBytes > MAX_WEBSOCKET_MESSAGE) throw new Error("WebSocket message is too large");
        if (fin) {
          this.fragmented = false;
          this.messageBytes = 0;
        }
      } else throw new Error("Unsupported WebSocket data frame");
      if (!this.message(payload)) return;
    }
  }
}
function validateSwitchingUpgrade(
  response: { statusCode?: number; headers: Record<string, string | string[] | undefined> },
  keyValue: string,
): void {
  if (
    response.statusCode !== 101 ||
    !hasToken(response.headers.upgrade, "websocket") ||
    !hasToken(response.headers.connection, "upgrade")
  )
    throw new Error("Invalid WebSocket upgrade response");
  const expected = createHash("sha1")
    .update(keyValue + WEBSOCKET_GUID)
    .digest("base64");
  const actual = String(response.headers["sec-websocket-accept"] ?? "");
  const expectedBytes = Buffer.from(expected);
  const actualBytes = Buffer.from(actual);
  if (expectedBytes.length !== actualBytes.length || !timingSafeEqual(expectedBytes, actualBytes))
    throw new Error("Invalid WebSocket accept key");
}
function connectWebSocket(
  url: URL,
  headers: Record<string, string>,
  signal: AbortSignal,
): Promise<WebSocketConnection> {
  const requestUrl = new URL(url);
  requestUrl.protocol = requestUrl.protocol === "wss:" ? "https:" : "http:";
  const keyValue = randomBytes(16).toString("base64");
  const request = requestUrl.protocol === "https:" ? httpsRequest : httpRequest;
  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = (error?: Error) => {
      if (settled) return;
      settled = true;
      signal.removeEventListener("abort", aborted);
      if (error) {
        req.destroy();
        reject(error);
      }
    };
    const aborted = () => finish(new Error("WebSocket opening aborted"));
    const req = request(requestUrl, {
      method: "GET",
      headers: {
        Connection: "Upgrade",
        Upgrade: "websocket",
        "Sec-WebSocket-Version": "13",
        "Sec-WebSocket-Key": keyValue,
        ...headers,
      },
    });
    req.once("upgrade", (response, socket, head) => {
      try {
        validateSwitchingUpgrade(response, keyValue);
        settled = true;
        signal.removeEventListener("abort", aborted);
        socket.setNoDelay(true);
        const send = websocketSender(socket);
        resolve({ socket, head, send, terminate: () => socket.destroy() });
      } catch (error) {
        socket.destroy();
        finish(error as Error);
      }
    });
    req.once("response", (response) => {
      response.resume();
      finish(new Error(`WebSocket upgrade failed (${response.statusCode ?? 0})`));
    });
    req.once("error", finish);
    req.setTimeout(15000, () => finish(new Error("WebSocket opening timed out")));
    signal.addEventListener("abort", aborted, { once: true });
    if (signal.aborted) aborted();
    else req.end();
  });
}
function listen(server: Server, port: number, signal: AbortSignal): Promise<number> {
  signal.throwIfAborted();
  return new Promise((resolve, reject) => {
    const finish = (error?: Error) => {
      server.removeListener("error", failed);
      signal.removeEventListener("abort", aborted);
      if (error) reject(error);
      else resolve((server.address() as { port: number }).port);
    };
    const failed = (error: Error) => finish(error);
    const aborted = () => finish(new Error("Port forward opening aborted"));
    server.once("error", failed);
    signal.addEventListener("abort", aborted, { once: true });
    server.listen({ port, host: "127.0.0.1", signal }, () => finish());
  });
}
async function terminate(child: ChildProcess, timeoutMs: number): Promise<void> {
  if (child.exitCode !== null || child.signalCode !== null) return;
  await new Promise<void>((resolve) => {
    const done = () => {
      clearTimeout(timer);
      child.removeListener("exit", done);
      child.removeListener("close", done);
      resolve();
    };
    child.once("exit", done);
    child.once("close", done);
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
    }, timeoutMs);
    child.kill("SIGTERM");
  });
}

function waitForSsh(
  child: ChildProcess,
  target: SshEnvironmentTarget,
  port: number,
  signal: AbortSignal,
  timeoutMs: number,
): Promise<void> {
  signal.throwIfAborted();
  return new Promise((resolve, reject) => {
    let diagnostic = "";
    const finish = (error?: Error) => {
      clearTimeout(timer);
      signal.removeEventListener("abort", aborted);
      child.removeListener("error", failed);
      child.removeListener("exit", exited);
      child.removeListener("close", exited);
      child.stderr?.removeListener("data", data);
      child.stderr?.resume();
      if (error) reject(error);
      else resolve();
    };
    const aborted = () => finish(new Error("Port forward opening aborted"));
    const failed = (error: Error) => finish(sshFailure(error.message, target, (error as NodeJS.ErrnoException).code));
    const exited = () => finish(sshFailure(diagnostic || "SSH forward exited", target));
    const data = (chunk: Buffer) => {
      diagnostic = (diagnostic + chunk.toString()).slice(-4096);
      if (new RegExp(`Local forwarding listening on 127\\.0\\.0\\.1 port ${port}(?:\\.|\\s|$)`, "u").test(diagnostic))
        finish();
    };
    const timer = setTimeout(() => finish(new Error("SSH port forward opening timed out")), timeoutMs);
    signal.addEventListener("abort", aborted, { once: true });
    child.once("error", failed);
    child.once("exit", exited);
    child.once("close", exited);
    child.stderr?.on("data", data);
    if (child.exitCode !== null || child.signalCode !== null) exited();
  });
}

async function stopResources(run: Run): Promise<void> {
  run.controller.abort();
  run.stopping ??= Promise.all([
    new Promise<void>((resolve) => (run.server ? run.server.close(() => resolve()) : resolve())),
    run.child ? terminate(run.child, run.killTimeoutMs ?? 2000) : Promise.resolve(),
    Promise.resolve().then(() => {
      for (const socket of run.sockets) socket.destroy();
      for (const socket of run.websockets) socket.terminate();
    }),
  ]).then(() => undefined);
  await run.stopping;
}

export class PortForwardManager {
  private readonly forwards = new Map<string, Forward>();
  private disposed = false;
  private readonly stopping = new Set<Promise<void>>();
  private readonly options: Options;
  constructor(options: Options) {
    this.options = options;
  }

  list(environmentId?: string): PortForwardEntry[] {
    if (environmentId !== undefined) validateEnvironment(environmentId);
    return [...this.forwards.values()]
      .filter(({ entry }) => environmentId === undefined || entry.environmentId === environmentId)
      .map(({ entry }) => ({ ...entry }));
  }

  async open(input: OpenInput): Promise<PortForwardEntry> {
    validateEnvironment(input.environmentId);
    validatePort(input.remotePort);
    validateMetadata(input.processId);
    validateMetadata(input.label);
    if (this.disposed) throw new Error("Port forward manager is disposed");
    const existing = this.forwards.get(key(input.environmentId, input.remotePort));
    if (existing) {
      if (existing.entry.status === "active") return { ...existing.entry };
      if (existing.run && !existing.run.controller.signal.aborted) return { ...(await existing.run.ready) };
      await this.restore(existing);
      if ((existing.entry.status as string) !== "active") throw new Error("Port forward opening aborted");
      return { ...existing.entry };
    }
    const environmentCount = [...this.forwards.values()].filter(
      ({ entry }) => entry.environmentId === input.environmentId,
    ).length;
    if (environmentCount >= 8) throw new Error("Port forward limit of 8 reached");
    const forward: Forward = {
      revision: 0,
      entry: {
        ...input,
        id: key(input.environmentId, input.remotePort),
        localPort: input.remotePort,
        localUrl: `http://127.0.0.1:${input.remotePort}`,
        status: "reconnecting",
      },
    };
    this.forwards.set(key(input.environmentId, input.remotePort), forward);
    return this.start(forward);
  }

  private changed(): void {
    try {
      this.options.onChanged?.();
    } catch {}
  }

  private current(forward: Forward): boolean {
    return !this.disposed && this.forwards.get(key(forward.entry.environmentId, forward.entry.remotePort)) === forward;
  }

  private start(forward: Forward, restoring = false): Promise<PortForwardEntry> {
    const run: Run = {
      controller: new AbortController(),
      sockets: new Set(),
      websockets: new Set(),
      killTimeoutMs: this.options.killTimeoutMs,
      ready: Promise.resolve({ ...forward.entry }),
    };
    forward.run = run;
    run.ready = Promise.resolve()
      .then(async () => {
        run.controller.signal.throwIfAborted();
        if (!this.current(forward)) throw new Error("Port forward opening aborted");
        const transport = this.options.resolveTransport(forward.entry.environmentId);
        if (!transport) throw new Error("Port forwarding transport is unavailable");
        const { target } = transport;
        const args = target.kind === "ssh" ? sshArguments(target) : null;
        const server = target.kind === "ssh" ? createServer() : this.websocketServer(forward, run, transport);
        run.server = server;
        let port: number;
        try {
          port = await listen(server, forward.entry.localPort, run.controller.signal);
        } catch (error) {
          if (!["EADDRINUSE", "EACCES"].includes((error as NodeJS.ErrnoException).code ?? "")) throw error;
          port = await listen(server, 0, run.controller.signal);
        }
        run.controller.signal.throwIfAborted();
        forward.entry.localPort = port;
        forward.entry.localUrl = `http://127.0.0.1:${port}`;
        if (target.kind === "ssh") {
          await new Promise<void>((resolve) => server.close(() => resolve()));
          run.controller.signal.throwIfAborted();
          run.server = undefined;
          const child = (this.options.spawn ?? spawn)(
            "ssh",
            [
              ...args!,
              "-v",
              "-n",
              "-N",
              "-L",
              `127.0.0.1:${port}:127.0.0.1:${forward.entry.remotePort}`,
              target.sshAlias,
            ],
            { ...localSshSpawnOptions(), stdio: ["ignore", "ignore", "pipe"] },
          );
          run.child = child;
          const failed = () => {
            if (
              !this.current(forward) ||
              forward.run !== run ||
              run.controller.signal.aborted ||
              forward.entry.status !== "active"
            )
              return;
            forward.entry.status = "error";
            forward.entry.error = "SSH port forward closed";
            this.changed();
            void this.cleanup(run);
          };
          child.on("error", failed);
          child.on("exit", failed);
          await waitForSsh(child, target, port, run.controller.signal, this.options.openingTimeoutMs ?? 15000);
          if (child.exitCode !== null || child.signalCode !== null)
            throw new Error("SSH port forward closed during opening");
        }
        run.controller.signal.throwIfAborted();
        forward.entry.status = "active";
        delete forward.entry.error;
        this.changed();
        return { ...forward.entry };
      })
      .catch(async (error: unknown) => {
        const cancelled = run.controller.signal.aborted;
        const stopping = this.cleanup(run);
        if (this.current(forward) && forward.run === run && !cancelled) {
          if (restoring) forward.entry.error = "Port forward reconnect failed";
          else this.forwards.delete(key(forward.entry.environmentId, forward.entry.remotePort));
          this.changed();
        }
        await stopping;
        throw error;
      });
    return run.ready;
  }

  private websocketServer(forward: Forward, run: Run, transport: Transport): Server {
    const target = transport.target as WebSocketEnvironmentTarget;
    const endpoint = resolveWebSocketTarget(
      { ...target, url: transport.endpoint?.wsUrl ?? target.url },
      transport.endpoint?.authToken,
    );
    const remoteEnvironmentId =
      transport.remoteEnvironmentId ?? target.expectedEnvironmentId ?? forward.entry.environmentId;
    validateEnvironment(remoteEnvironmentId);
    validateHeaderValue("x-dexon-environment-id", remoteEnvironmentId);
    if (
      endpoint.authToken !== undefined &&
      (typeof endpoint.authToken !== "string" ||
        !endpoint.authToken ||
        endpoint.authToken.length > 8192 ||
        /[^\x21-\x7e]/u.test(endpoint.authToken))
    )
      throw new Error("Invalid port forward authentication token");
    const url = new URL(endpoint.wsUrl);
    url.pathname = "/tunnel";
    url.searchParams.set("port", String(forward.entry.remotePort));
    return createServer({ allowHalfOpen: true }, (socket) =>
      this.bridge(run, socket, url, remoteEnvironmentId, endpoint.authToken),
    );
  }

  private bridge(run: Run, socket: Socket, url: URL, environmentId: string, authToken?: string): void {
    run.sockets.add(socket);
    const handshake = new AbortController();
    let websocket: WebSocketConnection | undefined;
    let finished = false;
    const release = () => {
      run.sockets.delete(socket);
      if (websocket) run.websockets.delete(websocket);
    };
    const finish = () => {
      if (finished) return;
      finished = true;
      handshake.abort();
      release();
      socket.destroy();
      websocket?.terminate();
    };
    const graceful = () => {
      if (finished) return;
      finished = true;
      handshake.abort();
      socket.end();
      websocket?.socket.end();
    };
    socket.on("error", finish);
    socket.once("close", () => {
      release();
      finish();
    });
    void connectWebSocket(
      url,
      {
        "x-dexon-protocol-version": String(DEXON_ENVIRONMENT_PROTOCOL_VERSION),
        "x-dexon-environment-id": environmentId,
        ...(authToken ? { Authorization: `Bearer ${authToken}` } : {}),
      },
      AbortSignal.any([run.controller.signal, handshake.signal]),
    ).then((connection) => {
      if (finished || run.controller.signal.aborted) {
        connection.terminate();
        return;
      }
      websocket = connection;
      run.websockets.add(connection);
      let blocked = false;
      let outbound = Promise.resolve();
      const parser = new WebSocketParser(
        (payload) => {
          if (finished) return true;
          const accepted = socket.write(payload);
          if (!accepted && !blocked) {
            blocked = true;
            connection.socket.pause();
            socket.once("drain", () => {
              blocked = false;
              if (!finished) {
                connection.socket.resume();
                try {
                  parser.resume();
                } catch {
                  finish();
                }
              }
            });
          }
          return accepted;
        },
        (opcode, payload) => {
          if (opcode === 9) void connection.send(payload, 10).catch(finish);
          else if (opcode === 8) void connection.send(payload, 8).then(graceful, finish);
        },
      );
      connection.socket.on("error", finish);
      connection.socket.once("close", graceful);
      connection.socket.on("data", (chunk: Buffer) => {
        try {
          parser.feed(chunk);
        } catch {
          finish();
        }
      });
      socket.on("data", (chunk: Buffer) => {
        socket.pause();
        outbound = outbound
          .then(() => connection!.send(chunk, 2))
          .then(() => {
            if (!finished) socket.resume();
          })
          .catch(finish);
      });
      socket.once("end", () => {
        void outbound.then(() => connection!.send(Buffer.alloc(0), 8)).catch(finish);
      });
      if (connection.head.length) {
        try {
          parser.feed(connection.head);
        } catch {
          finish();
        }
      }
    }, finish);
  }

  private cleanup(run: Run): Promise<void> {
    const stopping = stopResources(run);
    this.stopping.add(stopping);
    void stopping.finally(() => this.stopping.delete(stopping));
    return stopping;
  }

  private stop(forward: Forward): Promise<void> {
    forward.revision++;
    const run = forward.run;
    if (!run) return Promise.resolve();
    const stopping = Promise.all([stopResources(run), run.ready.catch(() => undefined)]).then(() => undefined);
    forward.stopping = stopping;
    this.stopping.add(stopping);
    void stopping.finally(() => this.stopping.delete(stopping));
    return stopping;
  }

  async close(environmentId: string, remotePort: number): Promise<{ closed: boolean }> {
    validateEnvironment(environmentId);
    validatePort(remotePort);
    const forward = this.forwards.get(key(environmentId, remotePort));
    if (!forward) return { closed: false };
    this.forwards.delete(key(environmentId, remotePort));
    const stopping = this.stop(forward);
    this.changed();
    await stopping;
    return { closed: true };
  }

  async closeEnvironment(environmentId: string, reconnecting = false): Promise<void> {
    validateEnvironment(environmentId);
    const stopping = [...this.forwards.values()]
      .filter(({ entry }) => entry.environmentId === environmentId)
      .map((forward) => {
        if (reconnecting) forward.entry.status = "reconnecting";
        else this.forwards.delete(key(environmentId, forward.entry.remotePort));
        return this.stop(forward);
      });
    if (stopping.length) this.changed();
    await Promise.all(stopping);
  }

  private restore(forward: Forward): Promise<void> {
    if (forward.run && !forward.run.controller.signal.aborted) return forward.run.ready.then(() => undefined);
    if (forward.resuming) return forward.resuming;
    const revision = forward.revision;
    const resuming = Promise.resolve(forward.stopping)
      .then(async () => {
        if (!this.current(forward) || revision !== forward.revision) return;
        await this.start(forward, true);
      })
      .finally(() => {
        if (forward.resuming === resuming) forward.resuming = undefined;
      });
    forward.resuming = resuming;
    return resuming;
  }

  async reconnectEnvironment(environmentId: string): Promise<void> {
    validateEnvironment(environmentId);
    if (this.disposed) return;
    await Promise.all(
      [...this.forwards.values()]
        .filter(({ entry }) => entry.environmentId === environmentId && entry.status === "reconnecting")
        .map((forward) => this.restore(forward)),
    );
  }

  async dispose(): Promise<void> {
    this.disposed = true;
    const forwards = [...this.forwards.values()];
    this.forwards.clear();
    for (const forward of forwards) void this.stop(forward);
    this.changed();
    await Promise.all(this.stopping);
  }
}
