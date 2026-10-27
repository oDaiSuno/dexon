import { SCROLL_KEYS } from "@/hooks/agent-session/shared";
import { marksChatScrollIntent } from "@/hooks/chat-scroll-policy";
import { alignReadingPosition } from "@/lib/reading-anchor";
import { useCallback, useEffect, useRef, type RefObject } from "react";
import type { NavigatorTurn } from "./shared";
import type { TurnJumpHandle } from "./use-older-history";

const TURN_TOP_OFFSET = 16;

interface Options {
  visible: boolean;
  turns: NavigatorTurn[];
  tops: number[];
  scrollContainer: RefObject<HTMLDivElement | null>;
  messageRefs: RefObject<(HTMLDivElement | null)[]>;
  turnJump: TurnJumpHandle;
}

export function useTurnJump({ visible, turns, tops, scrollContainer, messageRefs, turnJump }: Options) {
  const { jumpTarget, arrivedTurn, requestTurn, cancelJump } = turnJump;
  const handledArrivalRef = useRef<string | null>(null);
  const cancelAlignmentRef = useRef<(() => void) | null>(null);
  const pointerHeldRef = useRef(false);
  const gestureAtRef = useRef(0);

  const stopAlignment = useCallback(() => {
    cancelAlignmentRef.current?.();
    cancelAlignmentRef.current = null;
  }, []);

  const chooseTurn = useCallback(
    (index: number) => {
      const turn = turns[index];
      if (!visible || !turn) return;
      stopAlignment();
      if (turn.refIndex !== undefined) {
        cancelJump();
        const container = scrollContainer.current;
        const top = tops[index];
        if (container && Number.isFinite(top))
          container.scrollTo({ top: Math.max(0, top - TURN_TOP_OFFSET), behavior: "smooth" });
        return;
      }
      if (turn.entryId) requestTurn(turn.entryId);
    },
    [cancelJump, requestTurn, scrollContainer, stopAlignment, tops, turns, visible],
  );

  useEffect(() => {
    if (!visible || (jumpTarget === null && arrivedTurn === null)) return;
    const container = scrollContainer.current;
    const markGesture = () => {
      gestureAtRef.current = Date.now();
      if (jumpTarget !== null) cancelJump();
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (marksChatScrollIntent(event, SCROLL_KEYS)) markGesture();
    };
    const onPointerDown = () => {
      pointerHeldRef.current = true;
    };
    const onPointerUp = () => {
      pointerHeldRef.current = false;
    };
    const onScroll = () => {
      if (pointerHeldRef.current) markGesture();
    };
    container?.addEventListener("wheel", markGesture, { passive: true });
    container?.addEventListener("touchmove", markGesture, { passive: true });
    container?.addEventListener("pointerdown", onPointerDown, { passive: true });
    container?.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("pointerup", onPointerUp);
    window.addEventListener("pointercancel", onPointerUp);
    return () => {
      container?.removeEventListener("wheel", markGesture);
      container?.removeEventListener("touchmove", markGesture);
      container?.removeEventListener("pointerdown", onPointerDown);
      container?.removeEventListener("scroll", onScroll);
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("pointerup", onPointerUp);
      window.removeEventListener("pointercancel", onPointerUp);
      pointerHeldRef.current = false;
    };
  }, [arrivedTurn, cancelJump, jumpTarget, scrollContainer, visible]);

  useEffect(() => {
    if (!visible || arrivedTurn === null || handledArrivalRef.current === arrivedTurn) return;
    const container = scrollContainer.current;
    const refIndex = turns.find((turn) => turn.entryId === arrivedTurn)?.refIndex;
    const element = refIndex === undefined ? null : messageRefs.current?.[refIndex];
    if (!container || !element || refIndex === undefined) return;
    handledArrivalRef.current = arrivedTurn;
    const startAt = gestureAtRef.current;
    container.scrollTop = Math.max(
      0,
      element.getBoundingClientRect().top -
        container.getBoundingClientRect().top +
        container.scrollTop -
        TURN_TOP_OFFSET,
    );
    stopAlignment();
    cancelAlignmentRef.current = alignReadingPosition({
      container,
      target: TURN_TOP_OFFSET,
      measure: () => {
        const node = messageRefs.current?.[refIndex] ?? null;
        if (!node) return null;
        return node.getBoundingClientRect().top - container.getBoundingClientRect().top;
      },
      shouldStop: () => !visible || gestureAtRef.current > startAt,
      onSettled: () => {
        cancelAlignmentRef.current = null;
      },
    });
  }, [arrivedTurn, messageRefs, scrollContainer, stopAlignment, turns, visible]);

  useEffect(() => stopAlignment, [stopAlignment]);

  return { chooseTurn };
}
