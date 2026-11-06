import { useCallback, useSyncExternalStore } from "react";
import { worktreePathsEqual } from "@shared/worktree-path";
import { flushDraft, getDraft, mergeCarriedDraft, setDraft, withoutCarriedDraft } from "@/lib/draft-store";
import { newSessionDraftKey } from "@/lib/unsaved-messages";
import { workspaceStore } from "@/lib/workspace-store";

export interface DraftCarry {
  carry: (target: string | null) => (() => void) | null;
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
  const carry = useCallback(
    (target: string | null) => {
      if (!enabled || !target) return null;
      if (currentFolder && worktreePathsEqual(currentFolder, target)) return null;
      const text = take();
      if (!text.trim()) return null;
      const targetKey = newSessionDraftKey(target, environmentId);
      const originKey = currentFolder ? newSessionDraftKey(currentFolder, environmentId) : null;
      setDraft(targetKey, mergeCarriedDraft(getDraft(targetKey), text) ?? { value: text });
      flushDraft(targetKey);
      return () => {
        setDraft(targetKey, withoutCarriedDraft(getDraft(targetKey), text) ?? { value: "" });
        flushDraft(targetKey);
        if (originKey) {
          setDraft(originKey, { value: text });
          flushDraft(originKey);
        }
        restore(text);
      };
    },
    [currentFolder, environmentId, enabled, restore, take],
  );
  return { carry };
}
