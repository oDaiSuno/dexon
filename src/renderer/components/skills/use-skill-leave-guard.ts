import { useCallback, useEffect, useRef, useState, type RefObject } from "react";
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
  const pendingRef = useRef<(() => void) | null>(null);

  const settlePending = useCallback((action: (() => void) | null) => {
    pendingRef.current = action;
    setPendingTransition(() => action);
  }, []);

  const requestTransition = useCallback(
    (action: () => void) => {
      if (pendingRef.current) return;
      if (!(detailRef.current?.hasUnsavedChanges() ?? detailDirty)) {
        action();
        return;
      }
      settlePending(action);
    },
    [detailDirty, detailRef, settlePending],
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
    const action = pendingRef.current;
    settlePending(null);
    setDetailDirty(false);
    action?.();
  }, [settlePending]);

  const cancelTransition = useCallback(() => settlePending(null), [settlePending]);

  const saveAndContinue = useCallback(async () => {
    const detail = detailRef.current;
    if (!detail) return;
    setTransitionSaving(true);
    const saved = await detail.save();
    setTransitionSaving(false);
    const action = pendingRef.current;
    settlePending(null);
    if (saved) action?.();
  }, [detailRef, settlePending]);

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
