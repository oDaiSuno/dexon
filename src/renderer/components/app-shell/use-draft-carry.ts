import { useCallback } from "react";
import { worktreePathsEqual } from "@shared/worktree-path";
import { flushDraft, getDraft, mergeCarriedDraft, setDraft, withoutCarriedDraft } from "@/lib/draft-store";

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
  const carry = useCallback(
    (target: string | null) => {
      if (!enabled || !target) return null;
      if (currentFolder && worktreePathsEqual(currentFolder, target)) return null;
      const text = take();
      if (!text.trim()) return null;
      const targetKey = `new:${target}`;
      const originKey = currentFolder ? `new:${currentFolder}` : null;
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
    [currentFolder, enabled, restore, take],
  );
  return { carry };
}
