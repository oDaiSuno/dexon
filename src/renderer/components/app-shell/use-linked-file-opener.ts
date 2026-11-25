import { useCallback } from "react";
import type { EnvironmentId } from "@contract/environment";
import type { ProjectSpaceRef } from "@shared/project-space-state";
import { getFileName, getParentFilePath } from "@/lib/file-paths";
import { workspaceStore } from "@/lib/workspace-store";

export function useLinkedFileOpener({
  environmentId,
  selectedSession,
  resourceLocation,
  onShowChat,
  onOpenFile,
}: {
  environmentId: EnvironmentId;
  selectedSession: { id: string; environmentId: EnvironmentId } | null;
  resourceLocation: ProjectSpaceRef | null;
  onShowChat: () => void;
  onOpenFile: (
    filePath: string,
    fileName: string,
    sourceSessionId: string | null,
    sourceEnvironmentId: EnvironmentId,
  ) => void;
}) {
  const resourceEnvironmentId = resourceLocation?.environmentId;
  const resourcePath = resourceLocation?.path;
  const sessionId = selectedSession?.id;
  const sessionEnvironmentId = selectedSession?.environmentId;
  return useCallback(
    (filePath: string, sourceEnvironmentId?: EnvironmentId) => {
      const owner = sourceEnvironmentId ?? resourceEnvironmentId ?? sessionEnvironmentId ?? environmentId;
      if (resourceEnvironmentId) {
        if (owner !== environmentId) {
          const path = resourcePath || getParentFilePath(getParentFilePath(filePath));
          workspaceStore.openSpace({ environmentId: owner, path });
        }
        onShowChat();
      }
      onOpenFile(filePath, getFileName(filePath), sessionEnvironmentId === owner ? (sessionId ?? null) : null, owner);
    },
    [environmentId, resourceEnvironmentId, resourcePath, sessionId, sessionEnvironmentId, onShowChat, onOpenFile],
  );
}
