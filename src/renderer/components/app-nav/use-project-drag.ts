import { useCallback, useRef, useState, type MouseEvent as ReactMouseEvent, type RefObject } from "react";

const DRAG_THRESHOLD = 4;

function insertionIndex(rows: readonly Element[], pointerY: number): number {
  for (let index = 0; index < rows.length; index += 1) {
    const rect = rows[index].getBoundingClientRect();
    if (pointerY < rect.top + rect.height / 2) return index;
  }
  return rows.length;
}

export interface ProjectDrag {
  draggingIndex: number | null;
  start: (index: number, event: ReactMouseEvent<HTMLElement>) => void;
  consumeClick: () => boolean;
}

export function useProjectDrag({
  listRef,
  onReorder,
}: {
  listRef: RefObject<HTMLElement | null>;
  onReorder: (from: number, to: number) => void;
}): ProjectDrag {
  const [draggingIndex, setDraggingIndex] = useState<number | null>(null);
  const draggedRef = useRef(false);

  const rowsOf = useCallback(
    () => [...(listRef.current?.children ?? [])].filter((element) => element instanceof HTMLElement),
    [listRef],
  );

  const start = useCallback(
    (index: number, event: ReactMouseEvent<HTMLElement>) => {
      if (event.button !== 0 || index < 1) return;
      const startY = event.clientY;
      let active = false;
      let target = index;
      const move = (moveEvent: MouseEvent) => {
        if (!active) {
          if (Math.abs(moveEvent.clientY - startY) < DRAG_THRESHOLD) return;
          active = true;
          draggedRef.current = true;
          setDraggingIndex(index);
        }
        target = insertionIndex(rowsOf(), moveEvent.clientY);
      };
      const finish = (commit: boolean) => {
        document.removeEventListener("mousemove", move);
        document.removeEventListener("mouseup", up);
        document.removeEventListener("keydown", key, true);
        setDraggingIndex(null);
        if (active) {
          setTimeout(() => {
            draggedRef.current = false;
          }, 0);
        }
        if (active && commit) onReorder(index, target);
      };
      const up = (upEvent: MouseEvent) => {
        const rect = listRef.current?.getBoundingClientRect();
        const inside =
          !!rect &&
          upEvent.clientY >= rect.top &&
          upEvent.clientY <= rect.bottom &&
          upEvent.clientX >= rect.left &&
          upEvent.clientX <= rect.right;
        finish(inside);
      };
      const key = (keyEvent: KeyboardEvent) => {
        if (keyEvent.key !== "Escape") return;
        keyEvent.preventDefault();
        keyEvent.stopPropagation();
        finish(false);
      };
      document.addEventListener("mousemove", move);
      document.addEventListener("mouseup", up);
      document.addEventListener("keydown", key, true);
    },
    [listRef, onReorder, rowsOf],
  );

  const consumeClick = useCallback(() => {
    if (!draggedRef.current) return false;
    draggedRef.current = false;
    return true;
  }, []);

  return { draggingIndex, start, consumeClick };
}
