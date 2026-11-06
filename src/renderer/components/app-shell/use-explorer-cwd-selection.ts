import { useEffect, useRef, useSyncExternalStore } from "react";
import { PRIMARY_ENVIRONMENT_ID } from "@contract/environment";
import { projectKeyOf } from "@shared/project-space-state";
import { workspaceStore } from "@/lib/workspace-store";
import type { FileTabAction } from "@/lib/file-tab-state";
import type { SessionInfo } from "@/lib/types";
import { EXPLORER_TAB_ID } from "./use-right-panel-dock";

export function useExplorerCwdSelection(
  cwd: string | null,
  isMobile: boolean,
  dispatchFileTab: (action: Extract<FileTabAction, { type: "select" }>) => void,
  session: Pick<SessionInfo, "id" | "environmentId" | "cwd"> | null,
) {
  const { focus } = useSyncExternalStore(
    workspaceStore.subscribe,
    workspaceStore.getSnapshot,
    workspaceStore.getSnapshot,
  );
  const { environmentId } = focus;
  const focusedSession =
    session?.id === focus.sessionId && (session?.environmentId ?? PRIMARY_ENVIRONMENT_ID) === environmentId
      ? session
      : null;
  const targetKey = focusedSession ? projectKeyOf({ environmentId, path: focusedSession.cwd }) : focus.spaceKey;
  const cwdKey = cwd ? projectKeyOf({ environmentId, path: cwd }) : null;
  const previousScope = useRef({ environmentId, cwd, isMobile });
  useEffect(() => {
    const before = previousScope.current;
    if (before.environmentId !== environmentId && before.cwd === cwd && targetKey && targetKey !== cwdKey) return;
    previousScope.current = { environmentId, cwd, isMobile };
    if (!cwd || isMobile || before.environmentId !== environmentId) return;
    if (before.cwd !== cwd || before.isMobile !== isMobile) {
      dispatchFileTab({ type: "select", tabId: EXPLORER_TAB_ID });
    }
  }, [environmentId, cwd, cwdKey, targetKey, isMobile, dispatchFileTab]);
}
