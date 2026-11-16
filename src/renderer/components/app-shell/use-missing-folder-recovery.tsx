import { useCallback, useState } from "react";
import { useI18n } from "@/i18n";
import { PRIMARY_ENVIRONMENT_ID } from "@contract/environment";
import { workspaceStore } from "@/lib/workspace-store";
import { createTemporarySessionId } from "@/lib/temporary-session-id";
import type { SessionInfo } from "@/lib/types";
import type { ProjectSpaceRef } from "@shared/project-space-state";
import type { MissingFolderRecovery } from "../chat-input/types";
import { RemoteFolderPickerDialog } from "../remote-folder-picker/remote-folder-picker-dialog";
import type { SpaceCoordination } from "./use-space-coordination";
import type { useProjectWorkspace } from "../session-sidebar/project-workspace";

export function useMissingFolderRecovery({
  session,
  workspace,
  coordination,
  onNewSession,
  onOpenSettings,
}: {
  session: SessionInfo | null;
  workspace: Pick<ReturnType<typeof useProjectWorkspace>, "selectDirectoryFromPicker">;
  coordination: Pick<SpaceCoordination, "returnToPersonalSpace">;
  onNewSession: (sessionId: string, cwd: string) => void;
  onOpenSettings: () => void;
}) {
  const { t } = useI18n();
  const [remoteEnvironmentId, setRemoteEnvironmentId] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const start = useCallback(
    (ref: ProjectSpaceRef) => {
      workspaceStore.openSpace(ref);
      onNewSession(createTemporarySessionId(), ref.path);
    },
    [onNewSession],
  );
  const chooseExistingFolder = useCallback(() => {
    if (!session || pending) return;
    setError(null);
    if (session.environmentId !== PRIMARY_ENVIRONMENT_ID) {
      setRemoteEnvironmentId(session.environmentId);
      return;
    }
    setPending(true);
    void workspace
      .selectDirectoryFromPicker(
        (path) => start({ environmentId: PRIMARY_ENVIRONMENT_ID, path }),
        PRIMARY_ENVIRONMENT_ID,
      )
      .then((result) => {
        if (result.status === "invalid") setError(result.error);
      })
      .finally(() => setPending(false));
  }, [pending, session, start, workspace]);
  const newDefaultChat = useCallback(() => {
    if (pending) return;
    setPending(true);
    setError(null);
    void coordination
      .returnToPersonalSpace()
      .then((cwd) => {
        if (cwd) start({ environmentId: PRIMARY_ENVIRONMENT_ID, path: cwd });
        else setError(t("personalSpaceUnavailable", "The default space couldn't be prepared."));
      })
      .finally(() => setPending(false));
  }, [coordination, pending, start, t]);
  const recovery: MissingFolderRecovery = { chooseExistingFolder, newDefaultChat, pending, error };
  const picker = remoteEnvironmentId && (
    <RemoteFolderPickerDialog
      initialEnvironmentId={remoteEnvironmentId}
      onSelected={(ref) => {
        setRemoteEnvironmentId(null);
        start(ref);
      }}
      onClose={() => setRemoteEnvironmentId(null)}
      onOpenSettings={() => {
        setRemoteEnvironmentId(null);
        onOpenSettings();
      }}
    />
  );
  return { recovery, picker };
}
