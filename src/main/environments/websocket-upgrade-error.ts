import { randomBytes } from "node:crypto";
import { request as httpRequest } from "node:http";
import { request as httpsRequest } from "node:https";
import type { EnvironmentDescriptor } from "../../contract/environment.ts";
import type { RemoteEndpoint } from "./remote-endpoint.ts";
import { EnvironmentConnectionError, QUICK_PROBE_TIMEOUT_MS } from "./supervisor-policy.ts";

export function diagnoseWebSocketUpgrade(
  endpoint: RemoteEndpoint,
  descriptor: EnvironmentDescriptor,
  signal?: AbortSignal,
): Promise<Error> {
  const url = new URL(endpoint.wsUrl);
  url.protocol = url.protocol === "wss:" ? "https:" : "http:";
  return new Promise((resolve) => {
    const request = (url.protocol === "https:" ? httpsRequest : httpRequest)(url, {
      signal: AbortSignal.any([AbortSignal.timeout(QUICK_PROBE_TIMEOUT_MS), ...(signal ? [signal] : [])]),
      headers: {
        Connection: "Upgrade",
        Upgrade: "websocket",
        "Sec-WebSocket-Version": "13",
        "Sec-WebSocket-Key": randomBytes(16).toString("base64"),
        "X-Dexon-Environment-Id": descriptor.environmentId,
        "X-Dexon-Protocol-Version": String(descriptor.protocolVersion),
        ...(endpoint.authToken ? { Authorization: `Bearer ${endpoint.authToken}` } : {}),
      },
    });
    request.once("response", (response) => {
      const status = response.statusCode;
      response.resume();
      if (status === 401)
        resolve(new EnvironmentConnectionError("blocked", "authentication", "Remote authentication was rejected"));
      else if (status === 403)
        resolve(new EnvironmentConnectionError("blocked", "permission", "Remote access was denied"));
      else if (status === 409)
        resolve(
          new EnvironmentConnectionError(
            "blocked",
            "identity-mismatch",
            "Remote environment identity changed during upgrade",
          ),
        );
      else if (status === 426)
        resolve(
          new EnvironmentConnectionError(
            "blocked",
            "unsupported-protocol",
            "Remote protocol was rejected during upgrade",
          ),
        );
      else resolve(new EnvironmentConnectionError("transient", "transport", "Remote WebSocket upgrade failed"));
    });
    request.once("upgrade", (_response, socket) => {
      socket.destroy();
      resolve(new EnvironmentConnectionError("transient", "transport", "Remote WebSocket opening failed"));
    });
    request.once("error", () =>
      resolve(new EnvironmentConnectionError("transient", "network", "Remote WebSocket endpoint is unavailable")),
    );
    request.end();
  });
}
