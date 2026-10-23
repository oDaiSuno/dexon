import { useCallback, useEffect, useState } from "react";
import type { DesktopUpdateState } from "../../../contract/desktop";

export type UpdateAction = "status" | "check" | "download" | "install" | "automatic" | "logs";

export interface SoftwareUpdateModel {
  state: DesktopUpdateState | null;
  pendingAction: UpdateAction | null;
  actionFailed: boolean;
  isBusy: boolean;
  run: (action: UpdateAction, operation: () => Promise<unknown>) => void;
  reload: () => void;
  setAutomaticChecks: (enabled: boolean) => void;
}

export function useSoftwareUpdate(): SoftwareUpdateModel {
  const [state, setState] = useState<DesktopUpdateState | null>(null);
  const [pendingAction, setPendingAction] = useState<UpdateAction | null>(null);
  const [actionFailed, setActionFailed] = useState(false);

  useEffect(() => {
    let disposed = false;
    let receivedStateEvent = false;
    const unsubscribe = window.piBridge.onUpdateState((nextState) => {
      if (disposed) return;
      receivedStateEvent = true;
      setState(nextState);
      setActionFailed(false);
    });

    void window.piBridge
      .getUpdateState()
      .then((nextState) => {
        if (!disposed && !receivedStateEvent) setState(nextState);
      })
      .catch(() => {
        if (!disposed && !receivedStateEvent) setActionFailed(true);
      });

    return () => {
      disposed = true;
      unsubscribe();
    };
  }, []);

  const run = useCallback((action: UpdateAction, operation: () => Promise<unknown>) => {
    setPendingAction(action);
    setActionFailed(false);
    void Promise.resolve()
      .then(operation)
      .catch(() => setActionFailed(true))
      .finally(() => setPendingAction(null));
  }, []);

  const reload = useCallback(() => run("status", async () => setState(await window.piBridge.getUpdateState())), [run]);

  const setAutomaticChecks = useCallback(
    (enabled: boolean) =>
      run("automatic", async () => setState(await window.piBridge.setAutomaticUpdateChecks(enabled))),
    [run],
  );

  return {
    state,
    pendingAction,
    actionFailed,
    isBusy: pendingAction !== null,
    run,
    reload,
    setAutomaticChecks,
  };
}
