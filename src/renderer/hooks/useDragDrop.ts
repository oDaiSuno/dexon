import { useState, useCallback, useEffect, useRef } from "react";

export function useDragDrop(onDrop: (files: File[]) => void, enabled = true) {
  const [isDragOver, setIsDragOver] = useState(false);
  const counterRef = useRef(0);

  const hasFiles = (e: React.DragEvent) => Array.from(e.dataTransfer.items).some((item) => item.kind === "file");

  useEffect(() => {
    if (enabled) return;
    counterRef.current = 0;
    setIsDragOver(false);
  }, [enabled]);

  const handleDragEnter = useCallback(
    (e: React.DragEvent) => {
      if (!enabled || !hasFiles(e)) return;
      e.preventDefault();
      counterRef.current += 1;
      setIsDragOver(true);
    },
    [enabled],
  );

  const handleDragOver = useCallback(
    (e: React.DragEvent) => {
      if (!enabled || !hasFiles(e)) return;
      e.preventDefault();
    },
    [enabled],
  );

  const handleDragLeave = useCallback(() => {
    if (!enabled) return;
    counterRef.current -= 1;
    if (counterRef.current <= 0) {
      counterRef.current = 0;
      setIsDragOver(false);
    }
  }, [enabled]);

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      if (!enabled) return;
      e.preventDefault();
      counterRef.current = 0;
      setIsDragOver(false);
      const files = Array.from(e.dataTransfer.files);
      if (files.length) onDrop(files);
    },
    [enabled, onDrop],
  );

  return { isDragOver, handleDragEnter, handleDragOver, handleDragLeave, handleDrop };
}
