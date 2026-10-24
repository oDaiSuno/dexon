import { useCallback, useEffect, useRef, useState, type RefObject } from "react";
import { useI18n } from "@/i18n";
import type { NavigatorTurn } from "./shared";

interface Props {
  turns: NavigatorTurn[];
  scrollContainer: RefObject<HTMLDivElement | null>;
  messageRefs: RefObject<(HTMLDivElement | null)[]>;
  visible: boolean;
}

const EMPTY = { show: false, current: -1, tops: [] as number[] };

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
      const node = messageRefs.current?.[turn.refIndex];
      return node ? node.getBoundingClientRect().top - containerTop + el.scrollTop : 0;
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

export function TurnNavigator({ turns, scrollContainer, messageRefs, visible }: Props) {
  const { t } = useI18n();
  const { show, current, tops } = useTurnGeometry(turns, scrollContainer, messageRefs, visible);
  const buttonsRef = useRef<(HTMLButtonElement | null)[]>([]);

  const jump = useCallback(
    (index: number) => {
      const el = scrollContainer.current;
      if (!visible || !el) return;
      el.scrollTo({ top: Math.max(0, (tops[index] ?? 0) - 16), behavior: "smooth" });
    },
    [visible, scrollContainer, tops],
  );

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
    <nav className="chat-turn-nav" aria-label={t("conversationMinimap", "Conversation navigator")}>
      {turns.map((turn, index) => {
        const number = String(index + 1);
        const label = turn.title
          ? t("turnNavigatorItem", "Turn {number}: {title}").replace("{number}", number).replace("{title}", turn.title)
          : t("turnNavigatorItemUntitled", "Turn {number}").replace("{number}", number);
        return (
          <button
            key={turn.refIndex}
            ref={(node) => {
              buttonsRef.current[index] = node;
            }}
            type="button"
            className="chat-turn-nav-row"
            aria-label={label}
            aria-current={index === current ? "true" : undefined}
            tabIndex={index === tabStop ? 0 : -1}
            onClick={() => jump(index)}
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
