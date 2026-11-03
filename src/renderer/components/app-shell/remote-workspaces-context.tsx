import { createContext, useContext } from "react";
import type { RemoteWorkspaces } from "@/hooks/use-remote-workspaces";
import { workspaceFacts } from "@/lib/remote-workspace";
import { fromKey, hostIdOf, relativeWorkspacePath } from "@shared/workspace-ref";

const RemoteWorkspacesContext = createContext<RemoteWorkspaces | null>(null);

export const RemoteWorkspacesProvider = RemoteWorkspacesContext.Provider;

export function useRemoteWorkspacesContext() {
  return useContext(RemoteWorkspacesContext);
}

export function useWorkspaceFacts(folder: string | null | undefined) {
  const remote = useRemoteWorkspacesContext();
  return workspaceFacts(folder ?? "", remote?.statesByWorkspace ?? {});
}

export function useFileWorkspaceFacts(filePath: string, cwd?: string) {
  const remote = useRemoteWorkspacesContext();
  const states = remote?.statesByWorkspace ?? {};
  const workspace = Object.keys(states)
    .filter((key) => relativeWorkspacePath(key, filePath) !== null)
    .sort((left, right) => right.length - left.length)[0];
  const file = fromKey(filePath);
  const session = fromKey(cwd ?? "");
  const sameServer =
    file.ok &&
    session.ok &&
    file.value.kind === "ssh" &&
    session.value.kind === "ssh" &&
    hostIdOf(file.value) === hostIdOf(session.value);
  return workspaceFacts(workspace ?? (sameServer ? cwd! : filePath), states);
}
