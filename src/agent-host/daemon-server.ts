import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { createConnection, isIP, type Socket } from "node:net";
import { DEXON_ENVIRONMENT_PROTOCOL_VERSION, type EnvironmentDescriptor } from "../contract/environment.ts";
import { createWebSocketServerPort } from "../contract/rpc-channel.ts";
import type { RpcServer } from "../contract/rpc.ts";
import { DaemonWebSocket } from "./daemon-websocket.ts";
import type { RemoteAttachmentStore } from "./remote-attachment-store.ts";

const WEBSOCKET_ACCEPT_GUID = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11";

export interface DaemonServerOptions {
  rpcServer: Pick<RpcServer, "attachPort">;
  getDescriptor: () => EnvironmentDescriptor;
  authToken: string;
  listenPort: number;
  listenHost?: string;
  allowRemoteBind?: boolean;
  allowLoopbackTunnel?: boolean;
  attachmentStore?: RemoteAttachmentStore;
}

export interface DaemonServer {
  server: Server;
  listenHost: string;
  port: number;
  close(): Promise<void>;
}

function isLoopback(host: string): boolean {
  if (isIP(host) === 4) return host.startsWith("127.");
  if (isIP(host) !== 6) return false;
  const normalized = new URL(`http://[${host}]`).hostname;
  return normalized === "[::1]" || /^\[::ffff:7f[0-9a-f]{2}:[0-9a-f]{1,4}\]$/iu.test(normalized);
}

function requestValue(request: IncomingMessage, url: URL, header: string, query: string): string | null {
  const value = request.headers[header];
  return value === undefined ? url.searchParams.get(query) : Array.isArray(value) ? value.join(",") : value;
}

function rejectUpgrade(socket: Socket, status: string): void {
  socket.end(`HTTP/1.1 ${status}\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`);
  socket.destroySoon();
}

function authorized(request: IncomingMessage, url: URL, authToken: string): boolean {
  const authorization = request.headers.authorization;
  const token =
    authorization === undefined ? url.searchParams.get("token") : /^Bearer (.+)$/iu.exec(authorization)?.[1];
  if (!token || !authToken) return false;
  const candidate = Buffer.from(token, "utf8");
  const expected = Buffer.from(authToken, "utf8");
  return candidate.length === expected.length && timingSafeEqual(candidate, expected);
}

function stageError(code: string, statusCode: number, message: string): Error {
  return Object.assign(new Error(message), { code, statusCode });
}

function readAttachment(request: IncomingMessage): Promise<Buffer> {
  const limit = 25 * 1024 * 1024;
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    const cleanup = () => {
      request.off("data", data);
      request.off("end", end);
      request.off("error", error);
      request.off("aborted", aborted);
    };
    const error = (reason: Error) => {
      cleanup();
      reject(reason);
    };
    const aborted = () => error(new Error("Upload aborted"));
    const end = () => {
      cleanup();
      resolve(Buffer.concat(chunks, size));
    };
    const data = (chunk: Buffer) => {
      size += chunk.length;
      if (size > limit) {
        request.pause();
        error(stageError("ATTACHMENT_TOO_LARGE", 413, "Attachment exceeds 25 MiB"));
      } else chunks.push(chunk);
    };
    if (Number(request.headers["content-length"]) > limit) {
      reject(stageError("ATTACHMENT_TOO_LARGE", 413, "Attachment exceeds 25 MiB"));
      return;
    }
    request.on("data", data).once("end", end).once("error", error).once("aborted", aborted);
  });
}

async function stageAttachment(
  request: IncomingMessage,
  response: ServerResponse,
  url: URL,
  options: DaemonServerOptions,
): Promise<void> {
  const controller = new AbortController();
  const abort = () => controller.abort();
  const disconnected = () => {
    if (!response.writableFinished) abort();
  };
  request.once("aborted", abort);
  request.once("error", abort);
  response.once("close", disconnected);
  try {
    if (!authorized(request, url, options.authToken)) throw stageError("UNAUTHORIZED", 401, "Authentication required");
    if (!options.attachmentStore) throw stageError("ATTACHMENTS_UNAVAILABLE", 500, "Attachment storage is unavailable");
    const filename = request.headers["x-dexon-filename"];
    let name: string | undefined;
    try {
      if (Array.isArray(filename)) throw new Error("Invalid filename");
      name = filename === undefined ? undefined : decodeURIComponent(filename);
    } catch {
      throw stageError("INVALID_FILENAME", 400, "Filename must be URL encoded");
    }
    const sha256 = request.headers["x-dexon-sha256"];
    if (Array.isArray(sha256)) throw stageError("INVALID_HASH", 400, "Invalid attachment hash");
    const data = await readAttachment(request);
    const result = await options.attachmentStore.stage({
      name,
      mime: request.headers["content-type"],
      data,
      sha256,
      signal: controller.signal,
    });
    if (controller.signal.aborted) return;
    response.writeHead(200, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" });
    response.end(JSON.stringify(result));
  } catch (error) {
    if (controller.signal.aborted || response.destroyed) return;
    const structured =
      error instanceof Error &&
      "statusCode" in error &&
      "code" in error &&
      [400, 401, 413, 500].includes(Number(error.statusCode)) &&
      typeof error.code === "string" &&
      /^[A-Z][A-Z0-9_]{0,63}$/u.test(error.code);
    const status = structured ? Number(error.statusCode) : 500;
    const code = structured ? error.code : "ATTACHMENT_STAGE_FAILED";
    const message = status === 500 ? "Attachment staging failed" : (error as Error).message;
    const body = JSON.stringify({ code, message });
    response.writeHead(status, {
      "content-type": "application/json; charset=utf-8",
      "content-length": Buffer.byteLength(body),
      connection: "close",
    });
    const finish = () => {
      clearTimeout(timer);
      request.off("end", finish);
      response.end();
    };
    const timer = setTimeout(finish, 1000);
    timer.unref();
    response.once("close", () => {
      clearTimeout(timer);
      request.off("end", finish);
    });
    request.once("end", finish);
    response.write(body);
    request.resume();
    if (request.readableEnded) finish();
  } finally {
    request.off("aborted", abort);
    request.off("error", abort);
    response.off("close", disconnected);
  }
}

function bridgeTunnel(webSocket: DaemonWebSocket, port: number, track: (socket: Socket) => void): void {
  const target = createConnection({ host: "127.0.0.1", port });
  track(target);
  webSocket.pause();
  target.once("connect", () => webSocket.resume());
  target.on("drain", () => webSocket.resume());
  webSocket.on("drain", () => target.resume());
  webSocket.on("message", (data: string | Buffer) => {
    if (!Buffer.isBuffer(data)) {
      webSocket.close(1003);
      target.destroy();
    } else if (!target.write(data)) webSocket.pause();
  });
  target.on("data", (data: Buffer) => {
    try {
      if (!webSocket.send(data)) target.pause();
    } catch {
      target.destroy();
    }
  });
  target.on("error", () => webSocket.close(1011));
  target.once("close", () => webSocket.close());
  webSocket.once("close", () => target.destroy());
  webSocket.once("error", () => target.destroy());
}

function upgrade(
  request: IncomingMessage,
  socket: Socket,
  head: Buffer,
  options: DaemonServerOptions,
  track: (socket: Socket) => void,
): void {
  const url = new URL(request.url ?? "/", "http://localhost");
  if (!["/rpc", "/tunnel"].includes(url.pathname)) return rejectUpgrade(socket, "404 Not Found");
  const descriptor = options.getDescriptor();
  const environmentId = requestValue(request, url, "x-dexon-environment-id", "environmentId");
  if (environmentId !== null && environmentId !== descriptor.environmentId) {
    return rejectUpgrade(socket, "409 Conflict");
  }
  const protocolVersion = requestValue(request, url, "x-dexon-protocol-version", "protocolVersion");
  if (protocolVersion !== null && protocolVersion !== String(DEXON_ENVIRONMENT_PROTOCOL_VERSION)) {
    return rejectUpgrade(socket, "426 Upgrade Required");
  }
  if (!authorized(request, url, options.authToken)) return rejectUpgrade(socket, "401 Unauthorized");
  if (url.pathname === "/tunnel") {
    if (options.allowLoopbackTunnel === false) return rejectUpgrade(socket, "403 Forbidden");
    const ports = url.searchParams.getAll("port");
    if (
      [...url.searchParams.keys()].some(
        (key) => !["port", "token", "environmentId", "protocolVersion"].includes(key),
      ) ||
      ports.length !== 1 ||
      !/^[1-9]\d{0,4}$/u.test(ports[0]!) ||
      Number(ports[0]) > 65535
    )
      return rejectUpgrade(socket, "400 Bad Request");
    if (Number(ports[0]) === socket.localPort) return rejectUpgrade(socket, "403 Forbidden");
  }
  const key = request.headers["sec-websocket-key"];
  if (
    request.method !== "GET" ||
    request.headers.upgrade?.toLowerCase() !== "websocket" ||
    !request.headers.connection
      ?.toLowerCase()
      .split(/\s*,\s*/u)
      .includes("upgrade") ||
    request.headers["sec-websocket-version"] !== "13" ||
    typeof key !== "string" ||
    !/^[a-z0-9+/]{22}==$/iu.test(key) ||
    Buffer.from(key, "base64").length !== 16
  ) {
    return rejectUpgrade(socket, "400 Bad Request");
  }
  const accept = createHash("sha1").update(`${key}${WEBSOCKET_ACCEPT_GUID}`).digest("base64");
  socket.write(
    `HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ${accept}\r\n\r\n`,
  );
  const webSocket = new DaemonWebSocket(socket, url.pathname === "/tunnel");
  if (url.pathname === "/tunnel") bridgeTunnel(webSocket, Number(url.searchParams.get("port")), track);
  else options.rpcServer.attachPort(createWebSocketServerPort(webSocket), "gatekeeper");
  webSocket.receive(head);
}

export async function startDaemonServer(options: DaemonServerOptions): Promise<DaemonServer> {
  const listenHost = options.listenHost === "localhost" ? "127.0.0.1" : (options.listenHost ?? "127.0.0.1");
  if (!isLoopback(listenHost) && options.allowRemoteBind !== true) {
    throw new Error("Non-loopback daemon binding requires allowRemoteBind: true");
  }
  if (!Number.isInteger(options.listenPort) || options.listenPort < 0 || options.listenPort > 65535) {
    throw new Error("Invalid daemon listen port");
  }
  const sockets = new Set<Socket>();
  const server = createServer((request, response) => {
    try {
      const url = new URL(request.url ?? "/", "http://localhost");
      if (request.method === "POST" && url.pathname === "/attachments/stage") {
        void stageAttachment(request, response, url, options).catch(() => response.destroy());
      } else if (request.method === "GET" && url.pathname === "/.well-known/dexon/environment") {
        const nonceHeader = request.headers["x-dexon-nonce"];
        const headers: Record<string, string> = {
          "content-type": "application/json; charset=utf-8",
          "cache-control": "no-store",
        };
        if (typeof nonceHeader === "string" && /^[a-f0-9]{16,128}$/iu.test(nonceHeader)) {
          headers["x-dexon-proof"] = createHmac("sha256", options.authToken).update(nonceHeader).digest("hex");
        }
        response.writeHead(200, headers);
        response.end(JSON.stringify(options.getDescriptor()));
      } else {
        response.writeHead(404);
        response.end();
      }
    } catch {
      response.statusCode = 500;
      response.end();
    }
  });
  const track = (socket: Socket) => {
    sockets.add(socket);
    socket.once("close", () => sockets.delete(socket));
  };
  server.on("connection", track);
  server.on("upgrade", (request, socket, head) => {
    try {
      upgrade(request, socket as Socket, head, options, track);
    } catch {
      socket.destroy();
    }
  });
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(options.listenPort, listenHost, () => {
      server.removeListener("error", reject);
      resolve();
    });
  });
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Daemon did not bind a TCP port");
  let closing: Promise<void> | undefined;
  return {
    server,
    listenHost,
    port: address.port,
    close() {
      closing ??= new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
        for (const socket of sockets) socket.destroy();
      });
      return closing;
    },
  };
}
