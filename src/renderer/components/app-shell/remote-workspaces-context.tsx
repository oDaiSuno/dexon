import { createContext, useContext } from "react";
import type { RemoteWorkspaces } from "@/hooks/use-remote-workspaces";
import { workspaceFacts } from "@/lib/remote-workspace";

const RemoteWorkspacesContext = createContext<RemoteWorkspaces | null>(null);

export const RemoteWorkspacesProvider = RemoteWorkspacesContext.Provider;

export function useRemoteWorkspacesContext() {
  return useContext(RemoteWorkspacesContext);
}

export function useWorkspaceFacts(folder: string | null | undefined) {
  const remote = useRemoteWorkspacesContext();
  return workspaceFacts(folder ?? "", remote?.statesByWorkspace ?? {});
}
