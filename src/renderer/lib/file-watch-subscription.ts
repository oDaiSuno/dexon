import type { EnvironmentId } from "@contract/environment";
import type { Streams } from "@contract/api";
import { RpcError } from "@contract/types";
import { getEnvironmentApiClient } from "./api-client";
import { environmentRegistry } from "./environment-registry";

export type FileWatchChangedEvent = Streams["files.changed"];

export function subscribeFileWatch({
  environmentId,
  path,
  sourceSessionId,
  onEvent,
  onGap,
  onOpen,
  onError,
}: {
  environmentId: EnvironmentId;
  path: string;
  sourceSessionId?: string;
  onEvent?: (event: FileWatchChangedEvent) => void;
  onGap?: () => void;
  onOpen?: () => void;
  onError?: (error: unknown) => void;
}): () => void {
  if (!environmentId || !path) {
    onError?.(new Error("File environment and path are required"));
    return () => {};
  }
  const api = getEnvironmentApiClient(environmentId);
  let closed = false;
  let unsubscribe: (() => void) | undefined;
  const failed = (error: unknown) => {
    if (!closed) onError?.(error);
  };
  const start = (gap: boolean) => {
    if (closed) return;
    if (gap) onGap?.();
    void api.call("files.watchStart", { path, sourceSessionId }).then(() => {
      if (closed) {
        void api.call("files.watchStop", { path }).catch(() => {});
        return;
      }
      onOpen?.();
    }, failed);
  };
  const offStatus = environmentRegistry.subscribe(() => {
    const view = environmentRegistry.getEnvironments().find((entry) => entry.id === environmentId);
    if (view && view.status.phase !== "connected" && view.status.phase !== "available") {
      failed(new RpcError({ code: "DISCONNECTED", message: "Environment is not connected" }));
    }
  });
  void api
    .subscribe(
      "files.changed",
      path,
      (event) => {
        if (closed) return;
        if (event.event === "error") failed(new Error(event.message ?? "File watcher unavailable"));
        onEvent?.(event);
      },
      () => start(true),
    )
    .then((off) => {
      if (closed) off();
      else {
        unsubscribe = off;
        start(false);
      }
    }, failed);
  return () => {
    if (closed) return;
    closed = true;
    offStatus();
    unsubscribe?.();
    void api.call("files.watchStop", { path }).catch(() => {});
  };
}
