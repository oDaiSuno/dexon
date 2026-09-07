import { useCallback, useEffect, useState, type RefObject } from "react";
import type { SkillDetailHandle } from "./skill-detail";

export interface SkillLeaveGuard {
  detailDirty: boolean;
  setDetailDirty: (dirty: boolean) => void;
  pendingTransition: (() => void) | null;
  transitionSaving: boolean;
  requestTransition: (action: () => void) => void;
  discardAndContinue: () => void;
  cancelTransition: () => void;
  saveAndContinue: () => Promise<void>;
}

export function useSkillLeaveGuard(detailRef: RefObject<SkillDetailHandle | null>): SkillLeaveGuard {
  const [detailDirty, setDetailDirty] = useState(false);
  const [pendingTransition, setPendingTransition] = useState<(() => void) | null>(null);
  const [transitionSaving, setTransitionSaving] = useState(false);

  const requestTransition = useCallback(
    (action: () => void) => {
      if (!(detailRef.current?.hasUnsavedChanges() ?? detailDirty)) {
        action();
        return;
      }
      setPendingTransition(() => action);
    },
    [detailDirty, detailRef],
  );

  useEffect(() => {
    if (!detailDirty) return;
    const preventReload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", preventReload);
    return () => window.removeEventListener("beforeunload", preventReload);
  }, [detailDirty]);

  const discardAndContinue = useCallback(() => {
    const action = pendingTransition;
    setPendingTransition(null);
    setDetailDirty(false);
    action?.();
  }, [pendingTransition]);

  const cancelTransition = useCallback(() => setPendingTransition(null), []);

  const saveAndContinue = useCallback(async () => {
    setTransitionSaving(true);
    const saved = (await detailRef.current?.save()) ?? false;
    setTransitionSaving(false);
    if (!saved) return;
    const action = pendingTransition;
    setPendingTransition(null);
    action?.();
  }, [pendingTransition, detailRef]);

  return {
    detailDirty,
    setDetailDirty,
    pendingTransition,
    transitionSaving,
    requestTransition,
    discardAndContinue,
    cancelTransition,
    saveAndContinue,
  };
}
