import { useCallback, useRef } from "react";
import type { SkillsConfigHandle } from "../SkillsConfig";

export type RequestDeparture = (action: () => void) => void;

export function useDepartureGuard() {
  const leaveRef = useRef<SkillsConfigHandle | null>(null);
  const requestDeparture = useCallback<RequestDeparture>((action) => {
    const guard = leaveRef.current;
    if (guard) guard.requestLeave(action);
    else action();
  }, []);
  return { leaveRef, requestDeparture };
}
