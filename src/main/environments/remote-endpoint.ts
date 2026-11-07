import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import {
  DEXON_ENVIRONMENT_PROTOCOL_VERSION,
  PRIMARY_ENVIRONMENT_ID,
  type EnvironmentDescriptor,
  type WebSocketEnvironmentTarget,
} from "../../contract/environment.ts";
import { createRpcClient, type PiRpc, type RpcChannel } from "../../contract/rpc.ts";
import { channelFromMessagePort, createWebSocketClientPort } from "../../contract/rpc-channel.ts";
import { EnvironmentConnectionError, REMOTE_PROBE_TIMEOUT_MS } from "./supervisor-policy.ts";
import { diagnoseWebSocketUpgrade } from "./websocket-upgrade-error.ts";

export interface RemoteEndpoint {
  httpBaseUrl: string;
  wsUrl: string;
  authToken?: string;
}

export interface RemoteConnection extends RemoteEndpoint {
  descriptor: EnvironmentDescriptor;
  wsPort: ReturnType<typeof createWebSocketClientPort>;
  channel: RpcChannel;
  rpc: PiRpc;
  close(): void;
}

function isLoopback(host: string): boolean {
  return (
    host === "localhost" ||
    host === "[::1]" ||
    /^127\.\d{1,3}\.\d{1,3}\.\d{1,3}$/u.test(host) ||
    /^\[::ffff:7f[0-9a-f]{2}:[0-9a-f]{1,4}\]$/iu.test(host)
  );
}

export function resolveWebSocketTarget(target: WebSocketEnvironmentTarget, authToken?: string): RemoteEndpoint {
  let url: URL;
  try {
    url = new URL(target.url);
  } catch {
    throw new EnvironmentConnectionError("blocked", "configuration", "Invalid environment URL");
  }
  if (
    !["ws:", "wss:", "http:", "https:"].includes(url.protocol) ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    !["/", "/rpc"].includes(url.pathname)
  ) {
    throw new EnvironmentConnectionError("blocked", "configuration", "Invalid environment URL or embedded credentials");
  }
  url.protocol = url.protocol === "https:" || url.protocol === "wss:" ? "wss:" : "ws:";
  if (authToken && url.protocol === "ws:" && !isLoopback(url.hostname)) {
    throw new EnvironmentConnectionError(
      "blocked",
      "configuration",
      "Plaintext authenticated WebSocket requires a loopback host",
    );
  }
  url.pathname = "/rpc";
  const wsUrl = url.toString();
  url.protocol = url.protocol === "wss:" ? "https:" : "http:";
  url.pathname = "/";
  return { httpBaseUrl: url.toString(), wsUrl, authToken };
}

export async function fetchUnauthenticatedDescriptor(
  httpBaseUrl: string,
  expectedEnvironmentId?: string,
  timeoutMs = REMOTE_PROBE_TIMEOUT_MS,
  signal?: AbortSignal,
  proofToken?: string,
): Promise<EnvironmentDescriptor> {
  const url = new URL("/.well-known/dexon/environment", httpBaseUrl);
  if (url.username || url.password || !["http:", "https:"].includes(url.protocol)) {
    throw new EnvironmentConnectionError("blocked", "configuration", "Invalid descriptor URL");
  }
  const nonce = proofToken ? randomBytes(16).toString("hex") : null;
  const requestOptions = {
    ...(nonce ? { headers: { "x-dexon-nonce": nonce } } : {}),
    cache: "no-store" as const,
    redirect: "error" as const,
    credentials: "omit" as const,
    signal: AbortSignal.any([AbortSignal.timeout(timeoutMs), ...(signal ? [signal] : [])]),
  };
  const response = await fetch(url, requestOptions);
  if (!response.ok) {
    await response.body?.cancel();
    const blocked = response.status === 401 || response.status === 403;
    throw new EnvironmentConnectionError(
      blocked ? "blocked" : "transient",
      response.status === 401 ? "authentication" : response.status === 403 ? "permission" : "endpoint-unavailable",
      `Environment descriptor request failed (${response.status})`,
    );
  }
  if (nonce && proofToken) {
    const proof = response.headers.get("x-dexon-proof") ?? "";
    const expected = createHmac("sha256", proofToken).update(nonce).digest("hex");
    if (!/^[a-f0-9]{64}$/u.test(proof) || !timingSafeEqual(Buffer.from(proof, "hex"), Buffer.from(expected, "hex"))) {
      await response.body?.cancel();
      throw new EnvironmentConnectionError(
        "blocked",
        "authentication",
        "Remote environment did not prove possession of the bound token",
      );
    }
  }
  const reader = response.body?.getReader();
  if (!reader) throw new EnvironmentConnectionError("blocked", "configuration", "Missing environment descriptor");
  const chunks: Uint8Array[] = [];
  let length = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      length += value.byteLength;
      if (length > 65_536)
        throw new EnvironmentConnectionError("blocked", "configuration", "Environment descriptor is too large");
      chunks.push(value);
    }
  } finally {
    await reader.cancel();
  }
  let value: unknown;
  try {
    value = JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    throw new EnvironmentConnectionError("blocked", "configuration", "Invalid environment descriptor JSON");
  }
  const descriptor = value as EnvironmentDescriptor | null;
  if (
    !descriptor ||
    typeof descriptor !== "object" ||
    typeof descriptor.environmentId !== "string" ||
    !descriptor.environmentId ||
    descriptor.environmentId === PRIMARY_ENVIRONMENT_ID
  ) {
    throw new EnvironmentConnectionError("blocked", "identity-mismatch", "Invalid remote environment identity");
  }
  if (expectedEnvironmentId && descriptor.environmentId !== expectedEnvironmentId) {
    throw new EnvironmentConnectionError(
      "blocked",
      "identity-mismatch",
      "Remote environment identity does not match the bound environment",
      {
        reason: "identity-mismatch",
        detail: "Remote environment identity does not match the bound environment",
        expectedEnvironmentId,
        actualEnvironmentId: descriptor.environmentId,
        mismatchLayer: "dexon-environment-id",
      },
    );
  }
  if (descriptor.protocolVersion !== DEXON_ENVIRONMENT_PROTOCOL_VERSION) {
    if (
      typeof descriptor.protocolVersion === "number" &&
      descriptor.protocolVersion < DEXON_ENVIRONMENT_PROTOCOL_VERSION
    )
      throw new EnvironmentConnectionError("blocked", "outdated-daemon", "Remote daemon requires an update", {
        reason: "outdated-daemon",
        detail: "Remote daemon requires an update",
        remoteProtocolVersion: descriptor.protocolVersion,
      });
    throw new EnvironmentConnectionError("blocked", "unsupported-protocol", "Unsupported environment protocol version");
  }
  if (
    typeof descriptor.label !== "string" ||
    typeof descriptor.serverVersion !== "string" ||
    !descriptor.platform ||
    !["linux", "darwin", "win32"].includes(descriptor.platform.os) ||
    typeof descriptor.platform.arch !== "string" ||
    typeof descriptor.platform.home !== "string" ||
    !["posix", "win32"].includes(descriptor.platform.pathStyle) ||
    !descriptor.capabilities ||
    !["browser", "nativeDialogs", "revealInFileManager", "managedProcesses", "toolchainInstall"].every(
      (key) => typeof descriptor.capabilities[key as keyof typeof descriptor.capabilities] === "boolean",
    )
  ) {
    throw new EnvironmentConnectionError("blocked", "configuration", "Invalid environment descriptor shape");
  }
  if (
    descriptor.runtime &&
    (typeof descriptor.runtime.nodeVersion !== "string" ||
      !descriptor.runtime.nodeVersion ||
      typeof descriptor.runtime.payloadVersion !== "string" ||
      !descriptor.runtime.payloadVersion ||
      !Number.isFinite(descriptor.runtime.startedAt) ||
      descriptor.runtime.startedAt <= 0)
  )
    throw new EnvironmentConnectionError("blocked", "configuration", "Invalid remote runtime descriptor");
  return descriptor;
}

export async function openRemoteConnection(
  endpoint: RemoteEndpoint,
  descriptor: EnvironmentDescriptor,
  signal?: AbortSignal,
): Promise<RemoteConnection> {
  signal?.throwIfAborted();
  const url = new URL(endpoint.wsUrl);
  if (url.username || url.password || (endpoint.authToken && url.protocol === "ws:" && !isLoopback(url.hostname))) {
    throw new EnvironmentConnectionError("blocked", "configuration", "Unsafe authenticated WebSocket URL");
  }
  url.searchParams.set("environmentId", descriptor.environmentId);
  url.searchParams.set("protocolVersion", String(DEXON_ENVIRONMENT_PROTOCOL_VERSION));
  if (endpoint.authToken) url.searchParams.set("token", endpoint.authToken);
  const socket = new WebSocket(url);
  try {
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(
        () => finish(new EnvironmentConnectionError("transient", "timeout", "Remote WebSocket opening timed out")),
        REMOTE_PROBE_TIMEOUT_MS,
      );
      const onOpen = () => finish();
      const onAbort = () => finish(new Error("Remote WebSocket opening aborted"));
      const onClose = () =>
        finish(new EnvironmentConnectionError("transient", "transport", "Remote WebSocket opening failed"));
      const finish = (error?: Error) => {
        clearTimeout(timer);
        socket.removeEventListener("open", onOpen);
        socket.removeEventListener("error", onClose);
        socket.removeEventListener("close", onClose);
        signal?.removeEventListener("abort", onAbort);
        if (error) reject(error);
        else resolve();
      };
      socket.addEventListener("open", onOpen, { once: true });
      socket.addEventListener("error", onClose, { once: true });
      socket.addEventListener("close", onClose, { once: true });
      signal?.addEventListener("abort", onAbort, { once: true });
      if (signal?.aborted) onAbort();
    });
  } catch (error) {
    socket.close();
    if (!signal?.aborted && error instanceof EnvironmentConnectionError && error.reason === "transport") {
      throw await diagnoseWebSocketUpgrade(endpoint, descriptor, signal);
    }
    throw error;
  }
  const wsPort = createWebSocketClientPort(socket);
  const channel = channelFromMessagePort(wsPort);
  const rpc = createRpcClient(wsPort, { callTimeoutMs: REMOTE_PROBE_TIMEOUT_MS });
  return {
    ...endpoint,
    descriptor,
    wsPort,
    channel,
    rpc,
    close: () => {
      rpc.close();
      channel.close();
    },
  };
}
