import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent, type MutableRefObject } from "react";
import { useI18n } from "@/i18n";
import { extractAtQuery, type AtQueryMatch, type FileIndexEntry } from "@/lib/file-fuzzy";
import {
  FileSuggestionLruCache,
  fileSuggestionCacheKey,
  projectFileSuggestionResponse,
} from "@/lib/file-suggestion-client";
import { LatestAbortableRequest } from "@/lib/latest-abortable-request";
import type { SlashCommandInfo } from "@/hooks/useAgentSession";
import { builtinSlashCommands, compareSlashCommands, type SlashCommandPaletteItem } from "./slash-commands";
import type { ComposerEditableHandle } from "./types";
import { compositionEnterAction } from "./composition-guard";
import type { AtSuggestionState } from "./AtMenu";

interface Options {
  value: string;
  cwd?: string | null;
  isStreaming: boolean;
  visible: boolean;
  slashCommands?: SlashCommandInfo[];
  slashCommandsLoading?: boolean;
  onLoadSlashCommands?: () => Promise<SlashCommandInfo[]> | SlashCommandInfo[];
  onFollowUp?: (message: string) => Promise<void> | void;
  handleSend: () => Promise<void>;
  sendQueued: (mode: "steer" | "followup") => Promise<void>;
  editableRef: MutableRefObject<ComposerEditableHandle | null>;
  onAtEscape?: () => void;
}

export function useComposerSuggestions({
  value,
  cwd,
  isStreaming,
  visible,
  slashCommands,
  slashCommandsLoading,
  onLoadSlashCommands,
  onFollowUp,
  handleSend,
  sendQueued,
  editableRef,
  onAtEscape,
}: Options) {
  const { t } = useI18n();
  const [slashMenuOpen, setSlashMenuOpen] = useState(false);
  const [slashActiveIndex, setSlashActiveIndex] = useState(0);
  const [atQuery, setAtQuery] = useState<AtQueryMatch | null>(null);
  const [atMenuOpen, setAtMenuOpen] = useState(false);
  const [atActiveIndex, setAtActiveIndex] = useState(0);
  const [atSuggestionState, setAtSuggestionState] = useState<AtSuggestionState | null>(null);
  const slashCommandsRequestedRef = useRef(false);
  const slashItemRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const atItemRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const fileSuggestionCacheRef = useRef(new FileSuggestionLruCache());
  const fileSuggestionRequestRef = useRef(new LatestAbortableRequest());
  const isComposingRef = useRef(false);
  const lastCompositionEndAtRef = useRef(0);

  const slashQueryText = value.startsWith("/") && !/\s/.test(value.slice(1)) ? value.slice(1) : null;
  const slashQuery = slashQueryText?.toLowerCase() ?? null;
  const builtinCommands = useMemo(() => builtinSlashCommands(t), [t]);
  const filteredSlashCommands = useMemo(() => {
    if (slashQuery === null) return [];
    const commands = [...(isStreaming ? [] : builtinCommands), ...(slashCommands ?? [])];
    return commands
      .filter((command) => {
        const name = command.name.toLowerCase();
        const description = command.description?.toLowerCase() ?? "";
        return name.includes(slashQuery) || description.includes(slashQuery);
      })
      .sort((a, b) => compareSlashCommands(a, b, slashQuery));
  }, [builtinCommands, isStreaming, slashCommands, slashQuery]);
  const updateAtQuery = useCallback(
    (text: string) => {
      setAtQuery(cwd ? extractAtQuery(text) : null);
    },
    [cwd],
  );

  const atQueryText = atQuery?.query ?? null;
  const atTokenKey = atQuery === null ? null : `${atQuery.start}:${atQuery.quoted ? 1 : 0}:${atQuery.query}`;

  useEffect(() => {
    if (!visible || slashQuery === null) {
      setSlashMenuOpen(false);
      setSlashActiveIndex(0);
      if (slashQuery === null) slashCommandsRequestedRef.current = false;
      return;
    }
    setSlashMenuOpen(true);
    setSlashActiveIndex(0);
    if (!slashCommandsRequestedRef.current && onLoadSlashCommands) {
      slashCommandsRequestedRef.current = true;
      Promise.resolve(onLoadSlashCommands()).catch(() => {
        slashCommandsRequestedRef.current = false;
      });
    }
  }, [onLoadSlashCommands, slashQuery, visible]);

  useEffect(() => {
    if (!visible || atTokenKey === null) {
      setAtMenuOpen(false);
      setAtActiveIndex(0);
      if (!visible) setAtSuggestionState(null);
      return;
    }
    setAtMenuOpen(true);
    setAtActiveIndex(0);
  }, [atTokenKey, visible]);

  useEffect(() => {
    if (!visible || atTokenKey === null || atQueryText === null || !cwd) {
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
  }, [atTokenKey, atQueryText, cwd, visible]);

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

  const applySlashCommand = useCallback(
    (command: SlashCommandPaletteItem) => {
      editableRef.current?.replaceAll(`/${command.name} `);
      setSlashMenuOpen(false);
      setSlashActiveIndex(0);
    },
    [editableRef],
  );

  const getNextSlashIndex = useCallback(
    (direction: "up" | "down" | "left" | "right") => {
      const lastIndex = filteredSlashCommands.length - 1;
      if (lastIndex < 0) return 0;
      if (direction === "left") return Math.max(0, slashActiveIndex - 1);
      if (direction === "right") return Math.min(lastIndex, slashActiveIndex + 1);
      const currentNode = slashItemRefs.current[slashActiveIndex];
      if (!currentNode)
        return direction === "down" ? Math.min(lastIndex, slashActiveIndex + 1) : Math.max(0, slashActiveIndex - 1);
      const currentRect = currentNode.getBoundingClientRect();
      const currentX = currentRect.left + currentRect.width / 2;
      const currentY = currentRect.top + currentRect.height / 2;
      let bestIndex = -1;
      let bestScore = Number.POSITIVE_INFINITY;
      for (let index = 0; index <= lastIndex; index += 1) {
        if (index === slashActiveIndex) continue;
        const node = slashItemRefs.current[index];
        if (!node) continue;
        const rect = node.getBoundingClientRect();
        const verticalDelta = rect.top + rect.height / 2 - currentY;
        if (direction === "down" ? verticalDelta <= 4 : verticalDelta >= -4) continue;
        const candidateX = rect.left + rect.width / 2;
        const score = Math.abs(verticalDelta) * 1000 + Math.abs(candidateX - currentX);
        if (score < bestScore) {
          bestIndex = index;
          bestScore = score;
        }
      }
      return bestIndex >= 0
        ? bestIndex
        : direction === "down"
          ? Math.min(lastIndex, slashActiveIndex + 1)
          : Math.max(0, slashActiveIndex - 1);
    },
    [filteredSlashCommands.length, slashActiveIndex],
  );

  const handleKeyDown = useCallback(
    (event: KeyboardEvent<HTMLDivElement>) => {
      const nativeEvent = event.nativeEvent;
      const enterAction = compositionEnterAction(
        nativeEvent,
        { composing: isComposingRef.current, endedAt: lastCompositionEndAtRef.current },
        Date.now(),
      );
      if (event.key === "Enter" && !event.shiftKey && enterAction !== "send") {
        if (enterAction === "prevent") event.preventDefault();
        return;
      }
      if (slashMenuOpen && slashQuery !== null) {
        if (event.key === "ArrowDown") {
          event.preventDefault();
          setSlashActiveIndex(getNextSlashIndex("down"));
          return;
        }
        if (event.key === "ArrowUp") {
          event.preventDefault();
          setSlashActiveIndex(getNextSlashIndex("up"));
          return;
        }
        if (event.key === "ArrowRight") {
          event.preventDefault();
          setSlashActiveIndex(getNextSlashIndex("right"));
          return;
        }
        if (event.key === "ArrowLeft") {
          event.preventDefault();
          setSlashActiveIndex(getNextSlashIndex("left"));
          return;
        }
        if (event.key === "Escape") {
          event.preventDefault();
          setSlashMenuOpen(false);
          return;
        }
        if ((event.key === "Tab" || (event.key === "Enter" && !event.shiftKey)) && slashCommandsLoading === true) {
          event.preventDefault();
          return;
        }
        if (
          (event.key === "Tab" || (event.key === "Enter" && !event.shiftKey)) &&
          filteredSlashCommands[slashActiveIndex]
        ) {
          event.preventDefault();
          applySlashCommand(filteredSlashCommands[slashActiveIndex]);
          return;
        }
      }
      const composing = isComposingRef.current || nativeEvent.isComposing === true || nativeEvent.keyCode === 229;
      if (atMenuOpen && atQuery !== null && !composing) {
        if (event.key === "ArrowDown") {
          event.preventDefault();
          setAtActiveIndex((index) => Math.min(Math.max(0, atMatches.length - 1), index + 1));
          return;
        }
        if (event.key === "ArrowUp") {
          event.preventDefault();
          setAtActiveIndex((index) => Math.max(0, index - 1));
          return;
        }
        if (event.key === "Escape") {
          event.preventDefault();
          setAtMenuOpen(false);
          onAtEscape?.();
          return;
        }
        if ((event.key === "Tab" || (event.key === "Enter" && !event.shiftKey)) && atMatches[atActiveIndex]) {
          event.preventDefault();
          applyAtCompletion(atMatches[atActiveIndex]);
          return;
        }
      }
      if (event.key === "Enter" && !event.shiftKey) {
        event.preventDefault();
        if (isStreaming) {
          if (onFollowUp) void sendQueued("followup");
        } else {
          void handleSend();
        }
      }
    },
    [
      applyAtCompletion,
      applySlashCommand,
      atActiveIndex,
      atMatches,
      atMenuOpen,
      atQuery,
      filteredSlashCommands,
      getNextSlashIndex,
      handleSend,
      isStreaming,
      onFollowUp,
      sendQueued,
      slashActiveIndex,
      slashCommandsLoading,
      slashMenuOpen,
      slashQuery,
      onAtEscape,
    ],
  );

  useEffect(() => {
    if (slashActiveIndex >= filteredSlashCommands.length) {
      setSlashActiveIndex(Math.max(0, filteredSlashCommands.length - 1));
    }
  }, [filteredSlashCommands.length, slashActiveIndex]);
  useEffect(() => {
    slashItemRefs.current.length = filteredSlashCommands.length;
  }, [filteredSlashCommands.length]);
  useEffect(() => {
    if (visible && slashMenuOpen)
      slashItemRefs.current[slashActiveIndex]?.scrollIntoView({ block: "nearest", inline: "nearest" });
  }, [slashActiveIndex, slashMenuOpen, visible]);
  useEffect(() => {
    if (atActiveIndex >= atMatches.length) setAtActiveIndex(Math.max(0, atMatches.length - 1));
  }, [atActiveIndex, atMatches.length]);
  useEffect(() => {
    atItemRefs.current.length = atMatches.length;
  }, [atMatches.length]);
  useEffect(() => {
    if (visible && atMenuOpen)
      atItemRefs.current[atActiveIndex]?.scrollIntoView({ block: "nearest", inline: "nearest" });
  }, [atActiveIndex, atMenuOpen, visible]);

  const onCompositionStart = useCallback(() => {
    isComposingRef.current = true;
  }, []);
  const onCompositionEnd = useCallback(() => {
    isComposingRef.current = false;
    lastCompositionEndAtRef.current = Date.now();
  }, []);
  const clearAtQuery = useCallback(() => setAtQuery(null), []);
  const closeMenus = useCallback(() => {
    setSlashMenuOpen(false);
    setAtMenuOpen(false);
    setAtActiveIndex(0);
  }, []);

  return {
    slashMenuOpen: visible && slashMenuOpen && slashQuery !== null,
    slashActiveIndex,
    setSlashActiveIndex,
    slashItemRefs,
    slashQuery: slashQueryText,
    filteredSlashCommands,
    slashCommandsLoading,
    applySlashCommand,
    atQuery,
    atMenuOpen: visible && atMenuOpen,
    atActiveIndex,
    setAtActiveIndex,
    atItemRefs,
    activeSuggestionState,
    atMatches,
    updateAtQuery,
    applyAtCompletion,
    handleKeyDown,
    onCompositionStart,
    onCompositionEnd,
    clearAtQuery,
    closeMenus,
  };
}
