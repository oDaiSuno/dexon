import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { createServer, type IncomingMessage, type Server } from "node:http";
import { isIP, type Socket } from "node:net";
import { DEXON_ENVIRONMENT_PROTOCOL_VERSION, type EnvironmentDescriptor } from "../contract/environment.ts";
import { createWebSocketServerPort } from "../contract/rpc-channel.ts";
import type { RpcServer } from "../contract/rpc.ts";
import { DaemonWebSocket } from "./daemon-websocket.ts";

const WEBSOCKET_ACCEPT_GUID = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11";

export interface DaemonServerOptions {
  rpcServer: Pick<RpcServer, "attachPort">;
  getDescriptor: () => EnvironmentDescriptor;
  authToken: string;
  listenPort: number;
  listenHost?: string;
  allowRemoteBind?: boolean;
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
  socket.write(`HTTP/1.1 ${status}\r\n\r\n`);
  socket.destroy();
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

function upgrade(request: IncomingMessage, socket: Socket, head: Buffer, options: DaemonServerOptions): void {
  const url = new URL(request.url ?? "/", "http://localhost");
  if (url.pathname !== "/rpc") return rejectUpgrade(socket, "404 Not Found");
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
  const webSocket = new DaemonWebSocket(socket);
  const port = createWebSocketServerPort(webSocket);
  options.rpcServer.attachPort(port);
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
      if (request.method === "GET" && url.pathname === "/.well-known/dexon/environment") {
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
  server.on("connection", (socket) => {
    sockets.add(socket);
    socket.once("close", () => sockets.delete(socket));
  });
  server.on("upgrade", (request, socket, head) => {
    try {
      upgrade(request, socket as Socket, head, options);
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
