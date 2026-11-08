import { useEffect, useRef } from "react";
import type { SessionInfo } from "@/lib/types";
import { sessionAncestorIds } from "@/lib/session-tree";

export function useShownSessionReveal(
  sessionKey: string | null,
  session: SessionInfo | undefined,
  sessions: readonly SessionInfo[],
  reveal: (session: SessionInfo, introducedAncestorIds?: readonly string[]) => void,
) {
  const requested = useRef<{ key: string | null; ancestors: ReadonlySet<string> | null }>({
    key: null,
    ancestors: null,
  });
  useEffect(() => {
    if (requested.current.key !== sessionKey) requested.current = { key: sessionKey, ancestors: null };
    if (sessionKey === null || !session) return;
    const previous = requested.current.ancestors;
    const introduced = sessionAncestorIds(sessions, session.id).filter((id) => !previous?.has(id));
    if (previous !== null && introduced.length === 0) return;
    requested.current.ancestors = new Set([...(previous ?? []), ...introduced]);
    reveal(session, previous === null ? undefined : introduced);
  }, [sessionKey, session, sessions, reveal]);
}
