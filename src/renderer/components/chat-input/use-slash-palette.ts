import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent, type MutableRefObject } from "react";
import { useI18n } from "@/i18n";
import type { SessionCommandInfo } from "@/hooks/useAgentSession";
import type { SlashQuery } from "./command-slot";
import { builtinSlashCommands, suggestSlash, type SlashSuggestion } from "./slash-commands";
import type { SkillCatalog } from "./use-skill-catalog";
import type { ComposerEditableHandle } from "./types";

export interface SlashPaletteView {
  readonly query: string;
  readonly scope: SlashQuery["scope"];
  readonly items: readonly SlashSuggestion[];
  readonly pending: boolean;
  readonly activeIndex: number;
  readonly itemRefs: MutableRefObject<(HTMLButtonElement | null)[]>;
  readonly apply: (item: SlashSuggestion) => void;
  readonly hover: (index: number) => void;
}

export interface SlashSelection {
  readonly queryKey: string;
  readonly id: string;
}

interface Options {
  readonly query: SlashQuery | null;
  readonly isStreaming: boolean;
  readonly sessionCommands?: readonly SessionCommandInfo[];
  readonly sessionCommandsLoading: boolean;
  readonly onLoadSessionCommands?: () => unknown;
  readonly skillCatalog: SkillCatalog;
  readonly editableRef: MutableRefObject<ComposerEditableHandle | null>;
  readonly onDismiss: () => void;
}

export function useSlashPalette({
  query,
  isStreaming,
  sessionCommands,
  sessionCommandsLoading,
  onLoadSessionCommands,
  skillCatalog,
  editableRef,
  onDismiss,
}: Options) {
  const { t } = useI18n();
  const [selection, setSelection] = useState<SlashSelection | null>(null);
  const requestedRef = useRef(false);
  const itemRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const builtins = useMemo(() => (isStreaming ? [] : builtinSlashCommands(t)), [isStreaming, t]);
  const suggestions = useMemo(
    () =>
      query
        ? suggestSlash(
            {
              builtins,
              session: { commands: sessionCommands ?? [], loading: sessionCommandsLoading },
              skills: { entries: skillCatalog.skills, loading: skillCatalog.status === "loading" },
            },
            query,
          )
        : { items: [], pending: false },
    [builtins, query, sessionCommands, sessionCommandsLoading, skillCatalog.skills, skillCatalog.status],
  );
  const activeIndex = resolveActiveIndex(suggestions.items, selection, query?.key ?? "");
  const { refresh } = skillCatalog;
  const hasQuery = query !== null;

  useEffect(() => {
    if (!hasQuery) {
      requestedRef.current = false;
      setSelection(null);
      return;
    }
    if (requestedRef.current) return;
    requestedRef.current = true;
    refresh();
    void Promise.resolve(onLoadSessionCommands?.()).catch(() => undefined);
  }, [hasQuery, onLoadSessionCommands, refresh]);

  const apply = useCallback(
    (item: SlashSuggestion) => {
      editableRef.current?.fillCommandSlot(item.completion);
    },
    [editableRef],
  );
  const hover = useCallback(
    (index: number) => {
      const item = suggestions.items[index];
      if (!query || !item) return;
      setSelection({ queryKey: query.key, id: item.id });
    },
    [query, suggestions.items],
  );
  const view: SlashPaletteView | null = query
    ? {
        query: query.raw,
        scope: query.scope,
        ...suggestions,
        activeIndex,
        itemRefs,
        apply,
        hover,
      }
    : null;
  const handleKey = (event: KeyboardEvent<HTMLElement>): boolean => {
    if (!view || event.altKey || event.ctrlKey || event.metaKey) return false;
    const intent = slashKeyIntent(event.key, event.shiftKey, view);
    if (intent.type === "pass") return false;
    event.preventDefault();
    if (intent.type === "apply") apply(intent.item);
    if (intent.type === "dismiss") onDismiss();
    if (intent.type === "move") hover(nextIndex(intent.direction, view));
    return true;
  };

  useEffect(() => {
    itemRefs.current.length = suggestions.items.length;
  }, [suggestions.items.length]);
  useEffect(() => {
    if (hasQuery) itemRefs.current[activeIndex]?.scrollIntoView({ block: "nearest", inline: "nearest" });
  }, [activeIndex, hasQuery, suggestions.items]);

  return { view, handleKey };
}

export function resolveActiveIndex(
  items: readonly SlashSuggestion[],
  selection: SlashSelection | null,
  queryKey: string,
): number {
  if (!selection || selection.queryKey !== queryKey) return 0;
  const index = items.findIndex((item) => item.id === selection.id);
  return index >= 0 ? index : 0;
}

type SlashKeyIntent =
  | { readonly type: "move"; readonly direction: "up" | "down" | "left" | "right" }
  | { readonly type: "apply"; readonly item: SlashSuggestion }
  | { readonly type: "dismiss" }
  | { readonly type: "swallow" }
  | { readonly type: "pass" };

export function slashKeyIntent(
  key: string,
  shiftKey: boolean,
  view: Pick<SlashPaletteView, "items" | "pending" | "activeIndex">,
): SlashKeyIntent {
  if (key === "ArrowUp") return { type: "move", direction: "up" };
  if (key === "ArrowDown") return { type: "move", direction: "down" };
  if (key === "ArrowLeft") return { type: "move", direction: "left" };
  if (key === "ArrowRight") return { type: "move", direction: "right" };
  if (key === "Escape") return { type: "dismiss" };
  if (key === "Tab" || (key === "Enter" && !shiftKey)) {
    const item = view.items[view.activeIndex];
    return item ? { type: "apply", item } : { type: "swallow" };
  }
  return { type: "pass" };
}

function nextIndex(direction: "up" | "down" | "left" | "right", view: SlashPaletteView): number {
  const { activeIndex, items, itemRefs } = view;
  const lastIndex = items.length - 1;
  if (lastIndex < 0) return 0;
  if (direction === "left") return Math.max(0, activeIndex - 1);
  if (direction === "right") return Math.min(lastIndex, activeIndex + 1);
  const fallback = direction === "down" ? Math.min(lastIndex, activeIndex + 1) : Math.max(0, activeIndex - 1);
  const currentNode = itemRefs.current[activeIndex];
  if (!currentNode) return fallback;
  const current = currentNode.getBoundingClientRect();
  const currentX = current.left + current.width / 2;
  const currentY = current.top + current.height / 2;
  let bestIndex = -1;
  let bestScore = Number.POSITIVE_INFINITY;
  for (let index = 0; index <= lastIndex; index += 1) {
    if (index === activeIndex) continue;
    const node = itemRefs.current[index];
    if (!node) continue;
    const rect = node.getBoundingClientRect();
    const verticalDelta = rect.top + rect.height / 2 - currentY;
    if (direction === "down" ? verticalDelta <= 4 : verticalDelta >= -4) continue;
    const score = Math.abs(verticalDelta) * 1000 + Math.abs(rect.left + rect.width / 2 - currentX);
    if (score < bestScore) {
      bestIndex = index;
      bestScore = score;
    }
  }
  return bestIndex >= 0 ? bestIndex : fallback;
}
