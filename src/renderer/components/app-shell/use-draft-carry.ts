import { useCallback, useLayoutEffect, useRef, useSyncExternalStore } from "react";
import type { EnvironmentId } from "@contract/environment";
import { worktreePathsEqual } from "@shared/worktree-path";
import { flushDraft, getDraft, mergeCarriedDraft, setDraft, withoutCarriedDraft } from "@/lib/draft-store";
import { newSessionDraftKey } from "@/lib/unsaved-messages";
import { workspaceStore } from "@/lib/workspace-store";

interface CapturedDraft {
  carry: (target: string, targetEnvironmentId: EnvironmentId) => void;
  rollback: () => void;
}

export interface DraftCarry {
  carry: (target: string | null, targetEnvironmentId?: EnvironmentId) => (() => void) | null;
  capture: () => CapturedDraft | null;
}

export function useDraftCarry({
  enabled,
  currentFolder,
  take,
  restore,
}: {
  enabled: boolean;
  currentFolder: string | null;
  take: () => string;
  restore: (text: string) => void;
}): DraftCarry {
  const { focus } = useSyncExternalStore(
    workspaceStore.subscribe,
    workspaceStore.getSnapshot,
    workspaceStore.getSnapshot,
  );
  const environmentId = focus.environmentId;
  const committedLocation = useRef({ environmentId, folder: currentFolder });
  useLayoutEffect(() => {
    committedLocation.current = { environmentId, folder: currentFolder };
  }, [environmentId, currentFolder]);
  const capture = useCallback((): CapturedDraft | null => {
    if (!enabled) return null;
    const text = take();
    if (!text.trim()) return null;
    const originKey = currentFolder ? newSessionDraftKey(currentFolder, environmentId) : null;
    let targetKey: string | null = null;
    return {
      carry: (target, targetEnvironmentId) => {
        targetKey = newSessionDraftKey(target, targetEnvironmentId);
        setDraft(targetKey, mergeCarriedDraft(getDraft(targetKey), text) ?? { value: text });
        flushDraft(targetKey);
        const committed = committedLocation.current;
        if (
          committed.environmentId === targetEnvironmentId &&
          committed.folder &&
          worktreePathsEqual(committed.folder, target)
        )
          restore(text);
      },
      rollback: () => {
        if (targetKey) {
          setDraft(targetKey, withoutCarriedDraft(getDraft(targetKey), text) ?? { value: "" });
          flushDraft(targetKey);
        }
        if (originKey) {
          setDraft(originKey, { value: text });
          flushDraft(originKey);
        }
        restore(text);
      },
    };
  }, [currentFolder, environmentId, enabled, restore, take]);
  const carry = useCallback(
    (target: string | null, targetEnvironmentId: EnvironmentId = workspaceStore.getSnapshot().focus.environmentId) => {
      if (!target) return null;
      if (targetEnvironmentId === environmentId && currentFolder && worktreePathsEqual(currentFolder, target))
        return null;
      const captured = capture();
      captured?.carry(target, targetEnvironmentId);
      return captured?.rollback ?? null;
    },
    [capture, currentFolder, environmentId],
  );
  return { carry, capture };
}
