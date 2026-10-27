import { useCallback, useEffect, useRef, useState, type RefObject } from "react";
import { useI18n } from "@/i18n";
import type { NavigatorTurn } from "./shared";
import type { TurnJumpHandle } from "./use-older-history";
import { useTurnJump } from "./use-turn-jump";

interface Props {
  turns: NavigatorTurn[];
  scrollContainer: RefObject<HTMLDivElement | null>;
  messageRefs: RefObject<(HTMLDivElement | null)[]>;
  visible: boolean;
  turnJump: TurnJumpHandle;
}

const EMPTY = { show: false, current: -1, tops: [] as number[] };
const EXPAND_SETTLE_MS = 300;

function useTurnGeometry(
  turns: NavigatorTurn[],
  scrollContainer: RefObject<HTMLDivElement | null>,
  messageRefs: RefObject<(HTMLDivElement | null)[]>,
  visible: boolean,
) {
  const [geometry, setGeometry] = useState(EMPTY);
  const turnsRef = useRef(turns);
  turnsRef.current = turns;

  const measure = useCallback(() => {
    if (!visible) return;
    const el = scrollContainer.current;
    if (!el) return;

    const containerTop = el.getBoundingClientRect().top;
    const tops = turnsRef.current.map((turn) => {
      if (turn.refIndex === undefined) return -Infinity;
      const node = messageRefs.current?.[turn.refIndex];
      return node ? node.getBoundingClientRect().top - containerTop + el.scrollTop : -Infinity;
    });

    const show = turnsRef.current.length > 0 && el.scrollHeight - el.clientHeight > 20;
    const atBottom = el.scrollHeight - el.clientHeight - el.scrollTop <= 2;
    const line = el.scrollTop + el.clientHeight / 3;

    let current = tops.length > 0 ? 0 : -1;
    tops.forEach((top, index) => {
      if (top <= line) current = index;
    });
    if (atBottom && tops.length > 0) current = tops.length - 1;

    setGeometry((prev) =>
      prev.show === show &&
      prev.current === current &&
      prev.tops.length === tops.length &&
      prev.tops.every((top, index) => top === tops[index])
        ? prev
        : { show, current, tops },
    );
  }, [visible, scrollContainer, messageRefs]);

  useEffect(() => {
    if (!visible) {
      setGeometry((prev) => (prev === EMPTY ? prev : EMPTY));
      return;
    }
    const el = scrollContainer.current;
    if (!el) return;
    el.addEventListener("scroll", measure, { passive: true });
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    if (el.firstElementChild) observer.observe(el.firstElementChild);
    measure();
    return () => {
      el.removeEventListener("scroll", measure);
      observer.disconnect();
    };
  }, [visible, scrollContainer, measure]);

  useEffect(() => {
    if (!visible) return;
    const id = setTimeout(measure, 50);
    return () => clearTimeout(id);
  }, [turns, visible, measure]);

  return geometry;
}

export function TurnNavigator({ turns, scrollContainer, messageRefs, visible, turnJump }: Props) {
  const { t } = useI18n();
  const { show, current, tops } = useTurnGeometry(turns, scrollContainer, messageRefs, visible);
  const { chooseTurn } = useTurnJump({ visible, turns, tops, scrollContainer, messageRefs, turnJump });
  const buttonsRef = useRef<(HTMLButtonElement | null)[]>([]);
  const navRef = useRef<HTMLElement | null>(null);
  const [interacting, setInteracting] = useState(false);
  const [focused, setFocused] = useState(false);
  const browsingRef = useRef(false);
  const expansionCentredRef = useRef(false);
  const pointerRef = useRef<{ x: number; y: number } | null>(null);
  const currentRef = useRef(current);
  currentRef.current = current;
  const expanded = interacting || focused;

  const focusInsideNav = useCallback(() => {
    const nav = navRef.current;
    const active = nav?.ownerDocument.activeElement;
    return Boolean(nav && active && nav.contains(active));
  }, []);

  const pointerOverNav = useCallback(() => {
    const nav = navRef.current;
    const point = pointerRef.current;
    if (!nav || !point) return false;
    const element = nav.ownerDocument.elementFromPoint(point.x, point.y);
    return element !== null && nav.contains(element);
  }, []);

  const trackPointer = useCallback((event: { clientX: number; clientY: number }) => {
    pointerRef.current = { x: event.clientX, y: event.clientY };
  }, []);

  useEffect(() => {
    const onMouseMove = (event: MouseEvent) => {
      pointerRef.current = { x: event.clientX, y: event.clientY };
      const nav = navRef.current;
      if (!nav) return;
      const inside = event.target instanceof Node && nav.contains(event.target);
      setInteracting(inside);
      if (inside) return;
      browsingRef.current = false;
      if (!focusInsideNav()) setFocused(false);
    };
    window.addEventListener("mousemove", onMouseMove, { passive: true });
    return () => window.removeEventListener("mousemove", onMouseMove);
  }, [focusInsideNav]);

  const centreCurrent = useCallback(() => {
    const nav = navRef.current;
    const row = currentRef.current >= 0 ? buttonsRef.current[currentRef.current] : null;
    if (!nav || !row) return;
    const target = row.offsetTop + row.offsetHeight / 2 - nav.clientHeight / 2;
    nav.scrollTop = Math.min(Math.max(0, target), Math.max(0, nav.scrollHeight - nav.clientHeight));
  }, []);

  useEffect(() => {
    if (expanded || browsingRef.current) return;
    centreCurrent();
  }, [centreCurrent, current, expanded, turns.length]);

  useEffect(() => {
    const nav = navRef.current;
    if (!expanded) expansionCentredRef.current = false;
    if (!nav || !visible || !show || expansionCentredRef.current) return;
    let settled = false;
    const settle = () => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      nav.removeEventListener("transitionend", onTransitionEnd);
      if (expanded) expansionCentredRef.current = true;
      if (!browsingRef.current) centreCurrent();
    };
    const onTransitionEnd = (event: TransitionEvent) => {
      if (event.target === nav && event.propertyName === "width") settle();
    };
    const timer = setTimeout(settle, EXPAND_SETTLE_MS);
    nav.addEventListener("transitionend", onTransitionEnd);
    return () => {
      settled = true;
      clearTimeout(timer);
      nav.removeEventListener("transitionend", onTransitionEnd);
    };
  }, [centreCurrent, expanded, show, visible]);

  const onKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLButtonElement>, index: number) => {
      const last = turns.length - 1;
      let target: number;
      if (event.key === "ArrowDown") target = Math.min(index + 1, last);
      else if (event.key === "ArrowUp") target = Math.max(index - 1, 0);
      else if (event.key === "Home") target = 0;
      else if (event.key === "End") target = last;
      else return;
      event.preventDefault();
      buttonsRef.current[target]?.focus();
    },
    [turns.length],
  );

  if (!visible || !show) return null;

  const tabStop = current >= 0 ? current : 0;

  return (
    <nav
      ref={navRef}
      className="chat-turn-nav"
      aria-label={t("conversationMinimap", "Conversation navigator")}
      data-expanded={expanded ? "true" : undefined}
      onMouseEnter={(event) => {
        trackPointer(event);
        setInteracting(true);
      }}
      onMouseMove={trackPointer}
      onMouseLeave={() => {
        if (pointerOverNav()) return;
        browsingRef.current = false;
        setInteracting(false);
        if (!focusInsideNav()) setFocused(false);
      }}
      onFocus={() => setFocused(true)}
      onBlur={() => setFocused(false)}
      onWheel={(event) => {
        trackPointer(event);
        browsingRef.current = true;
        setInteracting(true);
      }}
    >
      {turns.map((turn, index) => {
        const number = String(index + 1);
        const label = turn.title
          ? t("turnNavigatorItem", "Turn {number}: {title}").replace("{number}", number).replace("{title}", turn.title)
          : t("turnNavigatorItemUntitled", "Turn {number}").replace("{number}", number);
        return (
          <button
            key={turn.key}
            ref={(node) => {
              buttonsRef.current[index] = node;
            }}
            type="button"
            className="chat-turn-nav-row"
            aria-label={label}
            aria-current={index === current ? "true" : undefined}
            tabIndex={index === tabStop ? 0 : -1}
            onClick={() => chooseTurn(index)}
            onKeyDown={(event) => onKeyDown(event, index)}
          >
            <span
              className={
                index === current ? "chat-turn-nav-title type-label-medium" : "chat-turn-nav-title type-label-default"
              }
              aria-hidden="true"
            >
              {turn.title}
            </span>
            <span className="chat-turn-nav-tick" aria-hidden="true" />
          </button>
        );
      })}
    </nav>
  );
}
