import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent, type MutableRefObject } from "react";
import { type AtQueryMatch, type FileIndexEntry } from "@/lib/file-fuzzy";
import {
  FileSuggestionLruCache,
  fileSuggestionCacheKey,
  projectFileSuggestionResponse,
} from "@/lib/file-suggestion-client";
import { LatestAbortableRequest } from "@/lib/latest-abortable-request";
import type { ComposerEditableHandle } from "./types";
import { triggerKey, type ComposerTrigger } from "./composer-trigger";
import type { AtSuggestionState } from "./AtMenu";

interface Options {
  cwd?: string | null;
  atTrigger: Extract<ComposerTrigger, { kind: "at" }> | null;
  editableRef: MutableRefObject<ComposerEditableHandle | null>;
  onDismiss: () => void;
  onEscape?: () => void;
}

export function useAtSuggestions({ cwd, atTrigger, editableRef, onDismiss, onEscape }: Options) {
  const [atActiveIndex, setAtActiveIndex] = useState(0);
  const [atSuggestionState, setAtSuggestionState] = useState<AtSuggestionState | null>(null);
  const atItemRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const fileSuggestionCacheRef = useRef(new FileSuggestionLruCache());
  const fileSuggestionRequestRef = useRef(new LatestAbortableRequest());
  const atQuery: AtQueryMatch | null = atTrigger?.match ?? null;
  const atMenuOpen = atTrigger !== null;
  const atQueryText = atQuery?.query ?? null;
  const atTokenKey = triggerKey(atTrigger);

  useEffect(() => {
    setAtActiveIndex(0);
    if (atTokenKey === null) setAtSuggestionState(null);
  }, [atTokenKey]);

  useEffect(() => {
    if (atTokenKey === null || atQueryText === null || !cwd) {
      fileSuggestionRequestRef.current.cancel();
      setAtSuggestionState(null);
      return;
    }
    const fetchCwd = cwd;
    const query = atQueryText;
    const tokenKey = atTokenKey;
    const cacheKey = fileSuggestionCacheKey(fetchCwd, query, window.piBridge?.platform ?? "linux");
    const cached = fileSuggestionCacheRef.current.get(cacheKey);
    if (cached) {
      setAtSuggestionState({ cwd: fetchCwd, tokenKey, query, ...cached, status: "ready" });
      return;
    }

    setAtSuggestionState({ cwd: fetchCwd, tokenKey, query, matches: [], truncated: false, status: "loading" });
    const requests = fileSuggestionRequestRef.current;
    let generation: number | null = null;
    const timer = setTimeout(
      () => {
        const request = requests.begin();
        generation = request.generation;
        fetch(`/api/file-index?cwd=${encodeURIComponent(fetchCwd)}&q=${encodeURIComponent(query)}`, {
          signal: request.signal,
        })
          .then((response) => {
            if (!response.ok) throw new Error(`file suggestions failed: ${response.status}`);
            return response.json() as Promise<unknown>;
          })
          .then((data) => {
            if (!requests.isCurrent(request.generation)) return;
            const snapshot = projectFileSuggestionResponse(data, query);
            fileSuggestionCacheRef.current.setWithTtl(
              cacheKey,
              snapshot,
              query === "" || query.endsWith("/") ? 2_000 : 1_000,
            );
            setAtSuggestionState({ cwd: fetchCwd, tokenKey, query, ...snapshot, status: "ready" });
          })
          .catch((error) => {
            if (!requests.isCurrent(request.generation) || (error as { name?: string })?.name === "AbortError") return;
            setAtSuggestionState({
              cwd: fetchCwd,
              tokenKey,
              query,
              matches: [],
              truncated: false,
              status: "error",
            });
          })
          .finally(() => requests.finish(request.generation));
      },
      query === "" || query.endsWith("/") ? 0 : 150,
    );
    return () => {
      clearTimeout(timer);
      if (generation !== null) requests.cancel(generation);
    };
  }, [atTokenKey, atQueryText, cwd]);

  const activeSuggestionState =
    atSuggestionState !== null && atSuggestionState.cwd === cwd && atSuggestionState.tokenKey === atTokenKey
      ? atSuggestionState
      : null;
  const atMatches = useMemo(() => activeSuggestionState?.matches ?? [], [activeSuggestionState]);

  const applyAtCompletion = useCallback(
    (entry: FileIndexEntry) => {
      if (atQuery) editableRef.current?.completeAtQuery(atQuery, entry.path, entry.isDir);
    },
    [atQuery, editableRef],
  );

  const handleMenuKey = useCallback(
    (event: KeyboardEvent<HTMLDivElement>): boolean => {
      if (atMenuOpen && atQuery !== null) {
        if (event.key === "ArrowDown") {
          event.preventDefault();
          setAtActiveIndex((index) => Math.min(Math.max(0, atMatches.length - 1), index + 1));
          return true;
        }
        if (event.key === "ArrowUp") {
          event.preventDefault();
          setAtActiveIndex((index) => Math.max(0, index - 1));
          return true;
        }
        if (event.key === "Escape") {
          event.preventDefault();
          onDismiss();
          onEscape?.();
          return true;
        }
        if ((event.key === "Tab" || (event.key === "Enter" && !event.shiftKey)) && atMatches[atActiveIndex]) {
          event.preventDefault();
          applyAtCompletion(atMatches[atActiveIndex]);
          return true;
        }
      }
      return false;
    },
    [applyAtCompletion, atActiveIndex, atMatches, atMenuOpen, atQuery, onDismiss, onEscape],
  );

  useEffect(() => {
    if (atActiveIndex >= atMatches.length) setAtActiveIndex(Math.max(0, atMatches.length - 1));
  }, [atActiveIndex, atMatches.length]);
  useEffect(() => {
    atItemRefs.current.length = atMatches.length;
  }, [atMatches.length]);
  useEffect(() => {
    if (atMenuOpen) atItemRefs.current[atActiveIndex]?.scrollIntoView({ block: "nearest", inline: "nearest" });
  }, [atActiveIndex, atMenuOpen]);

  return {
    atQuery,
    atMenuOpen,
    atActiveIndex,
    setAtActiveIndex,
    atItemRefs,
    activeSuggestionState,
    atMatches,
    applyAtCompletion,
    handleMenuKey,
  };
}
