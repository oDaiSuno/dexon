import { useCallback, useState } from "react";
import type { ProjectWorkspaceState, WorkspaceSelectResult } from "../session-sidebar/project-workspace";
import type { OpenProjects } from "./use-open-projects";

export function useProjectFolderActions(workspace: ProjectWorkspaceState, openProjects: OpenProjects) {
  const [error, setError] = useState<string | null>(null);
  const { openDirectory, selectDirectoryFromPicker } = workspace;
  const reportResult = useCallback((result: WorkspaceSelectResult) => {
    if (result.status === "invalid") setError(result.error);
    if (result.status === "selected") setError(null);
  }, []);
  const chooseFolder = useCallback(() => {
    void selectDirectoryFromPicker((folder) => openProjects.add(folder)).then(reportResult);
  }, [selectDirectoryFromPicker, openProjects, reportResult]);
  const openFolder = useCallback(
    (folder: string) => {
      void openDirectory(folder).then((result) => {
        if (result.status === "selected") openProjects.add(folder);
        reportResult(result);
      });
    },
    [openDirectory, openProjects, reportResult],
  );
  const clearError = useCallback(() => setError(null), []);
  return { chooseFolder, openFolder, error, clearError };
}

export type ProjectFolderActions = ReturnType<typeof useProjectFolderActions>;
