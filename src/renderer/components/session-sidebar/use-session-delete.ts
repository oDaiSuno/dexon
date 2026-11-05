import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type MouseEvent as ReactMouseEvent,
  type RefObject,
} from "react";
import { getEnvironmentApiClient } from "@/lib/api-client";
import { useI18n } from "@/i18n";
import { PRIMARY_ENVIRONMENT_ID, type EnvironmentId } from "@contract/environment";

export type SessionSubtree =
  { status: "loading" } | { status: "ready"; count: number; running: boolean } | { status: "error"; message: string };

export function useSessionDelete(options: {
  sessionId: string;
  environmentId?: EnvironmentId;
  isRunning: boolean;
  onDeleted?: (id: string) => void;
  onOpen: () => void;
  returnFocusRef: RefObject<HTMLButtonElement | null>;
}): {
  open: boolean;
  busy: boolean;
  error: string | null;
  subtree: SessionSubtree;
  requestDelete: (event: ReactMouseEvent) => void;
  confirm: (event: ReactMouseEvent) => Promise<void>;
  cancel: (event: ReactMouseEvent | ReactKeyboardEvent) => void;
} {
  const { sessionId, environmentId = PRIMARY_ENVIRONMENT_ID, isRunning, onDeleted, onOpen, returnFocusRef } = options;
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [subtree, setSubtree] = useState<SessionSubtree>({ status: "loading" });
  const requestRef = useRef(0);

  useEffect(
    () => () => {
      requestRef.current += 1;
    },
    [],
  );

  const requestDelete = useCallback(
    (event: ReactMouseEvent) => {
      event.stopPropagation();
      onOpen();
      setError(null);
      setSubtree({ status: "loading" });
      setOpen(true);
      requestRef.current += 1;
      const request = requestRef.current;
      void getEnvironmentApiClient(environmentId)
        .getSessionDescendants(sessionId)
        .then(
          (result) => {
            if (requestRef.current !== request) return;
            setSubtree({
              status: "ready",
              count: result.sessionIds.length,
              running: result.runningSessionIds.length > 0,
            });
          },
          (err: unknown) => {
            if (requestRef.current !== request) return;
            setSubtree({ status: "error", message: err instanceof Error ? err.message : String(err) });
          },
        );
    },
    [onOpen, sessionId, environmentId],
  );

  const confirm = useCallback(
    async (event: ReactMouseEvent) => {
      event.stopPropagation();
      if (isRunning || busy || subtree.status !== "ready" || subtree.running) return;
      setError(null);
      setBusy(true);
      try {
        await getEnvironmentApiClient(environmentId).deleteSession(sessionId);
        setOpen(false);
        setBusy(false);
        onDeleted?.(sessionId);
      } catch (err) {
        setError(
          err instanceof Error
            ? err.message
            : err
              ? String(err)
              : t("deleteSessionFailedStatus", "Delete failed ({status})").replace("{status}", t("unknown", "unknown")),
        );
        setBusy(false);
      }
    },
    [sessionId, environmentId, onDeleted, isRunning, busy, subtree, t],
  );

  const cancel = useCallback(
    (event: ReactMouseEvent | ReactKeyboardEvent) => {
      event.stopPropagation();
      requestRef.current += 1;
      setOpen(false);
      setError(null);
      returnFocusRef.current?.focus();
    },
    [returnFocusRef],
  );

  return useMemo(
    () => ({ open, busy, error, subtree, requestDelete, confirm, cancel }),
    [open, busy, error, subtree, requestDelete, confirm, cancel],
  );
}
