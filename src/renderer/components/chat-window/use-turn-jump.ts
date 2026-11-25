import type { ChatViewportController, ViewportLease } from "@/lib/chat-viewport";
import { useCallback, useEffect, useRef, type RefObject } from "react";
import { findMessageElements } from "./quote-jump-target";
import type { NavigatorTurn } from "./shared";
import type { TurnJumpHandle } from "./use-older-history";

const TURN_TOP_OFFSET = 16;

interface Options {
  visible: boolean;
  turns: NavigatorTurn[];
  scrollContainer: RefObject<HTMLDivElement | null>;
  messageRefs: RefObject<(HTMLDivElement | null)[]>;
  turnJump: TurnJumpHandle;
  viewport: ChatViewportController;
}

function resolveTurnElement(
  container: HTMLElement,
  entryId: string | undefined,
  refIndex: number | undefined,
  messageRefs: RefObject<(HTMLDivElement | null)[]>,
): HTMLElement | null {
  if (entryId) {
    const matched = findMessageElements(container, entryId)[0];
    if (matched) return matched;
  }
  return refIndex === undefined ? null : (messageRefs.current?.[refIndex] ?? null);
}

export function useTurnJump({ visible, turns, scrollContainer, messageRefs, turnJump, viewport }: Options) {
  const { jumpTarget, arrivedTurn, requestTurn, cancelJump } = turnJump;
  const pendingRef = useRef<{ entryId: string; lease: ViewportLease } | null>(null);
  const handledArrivalRef = useRef<string | null>(null);
  const prevJumpTargetRef = useRef<string | null>(jumpTarget);

  const navigateElement = useCallback(
    (
      lease: ViewportLease,
      container: HTMLElement,
      entryId: string | undefined,
      refIndex: number | undefined,
      preferSmooth: boolean,
    ) => {
      viewport.navigateLease(lease, {
        container,
        targetOffset: TURN_TOP_OFFSET,
        measure: () => {
          const node = resolveTurnElement(container, entryId, refIndex, messageRefs);
          if (!node) return null;
          return node.getBoundingClientRect().top - container.getBoundingClientRect().top;
        },
        preferSmooth,
      });
    },
    [messageRefs, viewport],
  );

  const chooseTurn = useCallback(
    (index: number) => {
      const turn = turns[index];
      if (!visible || !turn) return;
      handledArrivalRef.current = null;
      if (turn.refIndex !== undefined) {
        const container = scrollContainer.current;
        if (!container) return;
        const lease = viewport.claim("turn-jump", {
          blocksAutoOlder: true,
          releaseAutoFollow: true,
        });
        navigateElement(lease, container, turn.entryId, turn.refIndex, true);
        return;
      }
      if (turn.entryId) {
        const entryId = turn.entryId;
        const lease = viewport.claim("turn-jump", {
          blocksAutoOlder: true,
          releaseAutoFollow: true,
        });
        pendingRef.current = { entryId, lease };
        lease.onAbort(() => {
          if (pendingRef.current?.lease === lease) pendingRef.current = null;
          cancelJump();
        });
        requestTurn(entryId);
      }
    },
    [cancelJump, navigateElement, requestTurn, scrollContainer, turns, viewport, visible],
  );

  useEffect(() => {
    const previousTarget = prevJumpTargetRef.current;
    prevJumpTargetRef.current = jumpTarget;
    const pending = pendingRef.current;
    if (!pending) return;
    if (previousTarget === pending.entryId && jumpTarget === null && arrivedTurn !== pending.entryId) {
      pendingRef.current = null;
      pending.lease.finish({ outcome: "missing" });
    }
  }, [arrivedTurn, jumpTarget]);

  useEffect(() => {
    const pending = pendingRef.current;
    if (!visible || !pending || arrivedTurn !== pending.entryId || handledArrivalRef.current === arrivedTurn) return;
    if (!pending.lease.isCurrent()) {
      pendingRef.current = null;
      return;
    }
    const container = scrollContainer.current;
    if (!container) return;
    const fallbackRefIndex = turns.find((turn) => turn.entryId === arrivedTurn)?.refIndex;
    const element = resolveTurnElement(container, arrivedTurn, fallbackRefIndex, messageRefs);
    if (!element) return;
    handledArrivalRef.current = arrivedTurn;
    const { lease } = pending;
    pendingRef.current = null;
    navigateElement(lease, container, arrivedTurn, undefined, false);
  }, [arrivedTurn, messageRefs, navigateElement, scrollContainer, turns, visible]);

  return { chooseTurn };
}
