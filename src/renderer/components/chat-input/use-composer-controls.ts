import { useCallback, useEffect, useLayoutEffect, useRef, useState, type RefObject } from "react";

interface Options {
  visible: boolean;
  isMobile: boolean;
  isStreaming: boolean;
  modelRefreshing?: boolean;
  onModelsRefreshCancel?: () => void;
}

export function useComposerControls({
  visible,
  isMobile,
  isStreaming,
  modelRefreshing,
  onModelsRefreshCancel,
}: Options) {
  const [modelDropdownOpen, setModelDropdownOpen] = useState(false);
  const [modelDropdownRect, setModelDropdownRect] = useState<{ top: number; left: number; width: number } | null>(null);
  const [thinkingDropdownOpen, setThinkingDropdownOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const modelButtonRef = useRef<HTMLButtonElement>(null);
  const modelDropdownPanelRef = useRef<HTMLDivElement>(null);
  const thinkingDropdownRef = useRef<HTMLDivElement>(null);
  const thinkingButtonRef = useRef<HTMLButtonElement>(null);
  const focusFrameIdsRef = useRef<Set<number>>(new Set());

  const cancelFocusFrames = useCallback(() => {
    for (const frameId of focusFrameIdsRef.current) globalThis.cancelAnimationFrame?.(frameId);
    focusFrameIdsRef.current.clear();
  }, []);
  const focusThinkingButtonAfterPaint = useCallback(() => {
    if (!visible || typeof globalThis.requestAnimationFrame !== "function") return;
    let frameId = 0;
    frameId = globalThis.requestAnimationFrame(() => {
      focusFrameIdsRef.current.delete(frameId);
      if (visible) thinkingButtonRef.current?.focus();
    });
    focusFrameIdsRef.current.add(frameId);
  }, [visible]);
  useEffect(() => {
    if (!visible) cancelFocusFrames();
    return cancelFocusFrames;
  }, [cancelFocusFrames, visible]);

  const closeControlDropdowns = useCallback(() => {
    setThinkingDropdownOpen(false);
  }, []);

  const updateModelDropdownRect = useCallback(() => {
    const button = modelButtonRef.current;
    if (!button) return;
    const rect = button.getBoundingClientRect();
    const next = { top: rect.top, left: rect.left, width: rect.width };
    setModelDropdownRect((previous) =>
      previous && previous.top === next.top && previous.left === next.left && previous.width === next.width
        ? previous
        : next,
    );
  }, []);

  const toggleModelDropdown = useCallback(() => {
    if (!visible) return;
    updateModelDropdownRect();
    setModelDropdownOpen((open) => !open);
  }, [updateModelDropdownRect, visible]);

  const toggleThinkingDropdown = useCallback(() => {
    if (!visible || isStreaming) return;
    setModelDropdownOpen(false);
    setThinkingDropdownOpen((open) => !open);
  }, [isStreaming, visible]);

  useEffect(() => {
    if (visible) return;
    setModelDropdownOpen(false);
    setThinkingDropdownOpen(false);
    setModelDropdownRect(null);
  }, [visible]);

  useEffect(() => {
    if (!visible) return;
    const handler = (event: MouseEvent) => {
      const target = event.target as Node;
      if (
        dropdownRef.current &&
        !dropdownRef.current.contains(target) &&
        modelDropdownPanelRef.current &&
        !modelDropdownPanelRef.current.contains(target)
      ) {
        setModelDropdownOpen(false);
      }
      if (thinkingDropdownRef.current && !thinkingDropdownRef.current.contains(target)) {
        setThinkingDropdownOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [visible]);

  useEffect(() => {
    if (!visible) return;
    closeControlDropdowns();
  }, [closeControlDropdowns, isMobile, isStreaming, visible]);

  const modelDropdownWasOpenRef = useRef(false);
  useEffect(() => {
    if (modelDropdownWasOpenRef.current && !modelDropdownOpen && modelRefreshing) onModelsRefreshCancel?.();
    modelDropdownWasOpenRef.current = modelDropdownOpen;
  }, [modelDropdownOpen, modelRefreshing, onModelsRefreshCancel]);

  useLayoutEffect(() => {
    if (!visible || !modelDropdownOpen) return;
    updateModelDropdownRect();
    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(() => updateModelDropdownRect());
    if (modelButtonRef.current) observer?.observe(modelButtonRef.current);
    if (dropdownRef.current?.parentElement) observer?.observe(dropdownRef.current.parentElement);
    const visualViewport = window.visualViewport;
    window.addEventListener("resize", updateModelDropdownRect);
    window.addEventListener("scroll", updateModelDropdownRect, true);
    visualViewport?.addEventListener("resize", updateModelDropdownRect);
    visualViewport?.addEventListener("scroll", updateModelDropdownRect);
    return () => {
      observer?.disconnect();
      window.removeEventListener("resize", updateModelDropdownRect);
      window.removeEventListener("scroll", updateModelDropdownRect, true);
      visualViewport?.removeEventListener("resize", updateModelDropdownRect);
      visualViewport?.removeEventListener("scroll", updateModelDropdownRect);
    };
  }, [modelDropdownOpen, updateModelDropdownRect, visible]);

  useEffect(() => {
    if (!visible || !thinkingDropdownOpen) return;
    const handleEscape = (event: globalThis.KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      event.stopPropagation();
      closeControlDropdowns();
      focusThinkingButtonAfterPaint();
    };
    document.addEventListener("keydown", handleEscape, true);
    return () => document.removeEventListener("keydown", handleEscape, true);
  }, [closeControlDropdowns, focusThinkingButtonAfterPaint, thinkingDropdownOpen, visible]);

  return {
    modelDropdownOpen: visible && modelDropdownOpen,
    setModelDropdownOpen,
    modelDropdownRect,
    dropdownRef,
    modelButtonRef,
    modelDropdownPanelRef,
    thinkingDropdownOpen: visible && thinkingDropdownOpen,
    setThinkingDropdownOpen,
    thinkingDropdownRef,
    thinkingButtonRef,
    closeControlDropdowns,
    updateModelDropdownRect,
    toggleModelDropdown,
    toggleThinkingDropdown,
  } satisfies {
    modelDropdownOpen: boolean;
    setModelDropdownOpen: (open: boolean) => void;
    modelDropdownRect: { top: number; left: number; width: number } | null;
    dropdownRef: RefObject<HTMLDivElement | null>;
    modelButtonRef: RefObject<HTMLButtonElement | null>;
    modelDropdownPanelRef: RefObject<HTMLDivElement | null>;
    thinkingDropdownOpen: boolean;
    setThinkingDropdownOpen: (open: boolean) => void;
    thinkingDropdownRef: RefObject<HTMLDivElement | null>;
    thinkingButtonRef: RefObject<HTMLButtonElement | null>;
    closeControlDropdowns: () => void;
    updateModelDropdownRect: () => void;
    toggleModelDropdown: () => void;
    toggleThinkingDropdown: () => void;
  };
}
