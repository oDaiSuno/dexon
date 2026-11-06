import { useCallback, useEffect, useRef, useState } from "react";
import type { FolderEntry } from "@contract/folder-browse";
import { getEnvironmentApiClient } from "@/lib/api-client";
import { environmentRegistry, useEnvironments } from "@/lib/environment-registry";
import {
  createFolderBrowserState,
  folderBrowserReducer,
  folderMountTarget,
  remoteFolderServers,
  type FolderBrowserAction,
} from "./folder-browser-state";

export interface FolderBrowserOptions {
  initialEnvironmentId?: string;
}

export function useFolderBrowser({ initialEnvironmentId }: FolderBrowserOptions = {}) {
  const environments = useEnvironments();
  const [state, setState] = useState(() => createFolderBrowserState(environments, initialEnvironmentId));
  const current = useRef(state);
  const transition = useCallback((action: FolderBrowserAction) => {
    const next = folderBrowserReducer(current.current, action);
    if (next !== current.current) {
      current.current = next;
      setState(next);
    }
  }, []);

  useEffect(() => {
    transition({ type: "servers-changed", servers: environments, initialEnvironmentId });
  }, [environments, initialEnvironmentId, transition]);

  const request = state.kind === "loading" ? state.request : null;
  useEffect(() => {
    if (!request) return;
    let cancelled = false;
    void getEnvironmentApiClient(request.environmentId)
      .call("projects.browse", { path: request.path })
      .then(
        (listing) => {
          if (!cancelled) transition({ type: "completed", request, listing });
        },
        (error: unknown) => {
          if (!cancelled)
            transition({
              type: "failed",
              request,
              message: error instanceof Error ? error.message : String(error),
            });
        },
      );
    return () => {
      cancelled = true;
    };
  }, [request, transition]);

  const selectServer = useCallback(
    (id: string) => {
      const server = remoteFolderServers(environmentRegistry.getEnvironments()).find((view) => view.id === id);
      if (server) transition({ type: "select-server", server });
    },
    [transition],
  );
  const openPath = useCallback(
    (path: string) => {
      transition({ type: "servers-changed", servers: environmentRegistry.getEnvironments() });
      transition({ type: "open-path", path: path.trim() || "~" });
    },
    [transition],
  );
  const selectChild = useCallback(
    (entry: FolderEntry) => {
      transition({ type: "servers-changed", servers: environmentRegistry.getEnvironments() });
      transition({ type: "select-child", entry });
    },
    [transition],
  );
  const mountTarget = useCallback(() => folderMountTarget(current.current, environmentRegistry.getEnvironments()), []);

  return {
    state,
    servers: remoteFolderServers(environments),
    selectServer,
    openPath,
    selectChild,
    mountTarget,
  };
}
