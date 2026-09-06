import { useCallback, useEffect, useState } from "react";
import type { BrowserAgentAuthorizationRequest, BrowserAgentAuthorizationDecision } from "../../../contract/browser";

// Split from AppShell.tsx in Phase 2: the browser agent authorization dialog's
// state owner. Subscribes to authorization requests and resolves them through
// the trusted bridge.

export function useBrowserAuthorization({ onResolved }: { onResolved?: () => void } = {}) {
  const [browserAuthorization, setBrowserAuthorization] = useState<BrowserAgentAuthorizationRequest | null>(null);

  useEffect(
    () =>
      window.piBridge.onBrowserEvent((event) => {
        if (event.type === "agent-authorization-request") {
          setBrowserAuthorization(event.request);
          void window.piBridge.browserSetSurfaceVisible({ visible: false }).catch(() => undefined);
        } else if (event.type === "agent-authorization-resolved") {
          setBrowserAuthorization((current) => (current?.id === event.requestId ? null : current));
          onResolved?.();
        }
      }),
    [onResolved],
  );

  const respondToBrowserAuthorization = useCallback(
    (decision: BrowserAgentAuthorizationDecision) => {
      const requestId = browserAuthorization?.id;
      if (!requestId) return;
      void window.piBridge
        .browserRespondAgentAuthorization(requestId, decision)
        .catch(() => undefined)
        .finally(() => setBrowserAuthorization((current) => (current?.id === requestId ? null : current)));
    },
    [browserAuthorization?.id],
  );

  return {
    browserAuthorization,
    setBrowserAuthorization,
    respondToBrowserAuthorization,
  };
}
