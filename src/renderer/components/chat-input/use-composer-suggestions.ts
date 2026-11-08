import { useCallback, useState, type KeyboardEvent, type MutableRefObject } from "react";
import type { SessionCommandInfo } from "@/hooks/useAgentSession";
import { useSlashPalette } from "./use-slash-palette";
import { useAtSuggestions } from "./use-at-suggestions";
import type { SkillCatalog } from "./use-skill-catalog";
import type { ComposerChange, ComposerEditableHandle } from "./types";
import { initialTriggerGate, nextTriggerGate, openTrigger, type ComposerTrigger } from "./composer-trigger";

interface Options {
  cwd?: string | null;
  skillCatalog: SkillCatalog;
  isStreaming: boolean;
  visible: boolean;
  slashCommands?: SessionCommandInfo[];
  slashCommandsLoading?: boolean;
  onLoadSlashCommands?: () => Promise<SessionCommandInfo[]> | SessionCommandInfo[];
  editableRef: MutableRefObject<ComposerEditableHandle | null>;
  onAtEscape?: () => void;
}

export function useComposerSuggestions({
  cwd,
  skillCatalog,
  isStreaming,
  visible,
  slashCommands,
  slashCommandsLoading,
  onLoadSlashCommands,
  editableRef,
  onAtEscape,
}: Options) {
  const [gate, setGate] = useState(initialTriggerGate);
  const atEnabled = Boolean(cwd);
  const observe = useCallback(
    (change: ComposerChange) => setGate((current) => nextTriggerGate(current, { type: "changed", change }, atEnabled)),
    [atEnabled],
  );
  const dismiss = useCallback(
    () => setGate((current) => nextTriggerGate(current, { type: "dismissed" }, atEnabled)),
    [atEnabled],
  );

  const open: ComposerTrigger | null = openTrigger(gate, visible);
  const slashTrigger = open?.kind === "slash" ? open : null;
  const atTrigger = open?.kind === "at" ? open : null;
  const slash = useSlashPalette({
    query: slashTrigger?.query ?? null,
    isStreaming,
    sessionCommands: slashCommands,
    sessionCommandsLoading: slashCommandsLoading === true,
    onLoadSessionCommands: onLoadSlashCommands,
    skillCatalog,
    editableRef,
    onDismiss: dismiss,
  });
  const at = useAtSuggestions({ cwd, atTrigger, editableRef, onDismiss: dismiss, onEscape: onAtEscape });
  const handleMenuKey = useCallback(
    (event: KeyboardEvent<HTMLDivElement>): boolean => slash.handleKey(event) || at.handleMenuKey(event),
    [at, slash],
  );

  return {
    observe,
    dismiss,
    slashMenu: slash.view,
    ...at,
    handleMenuKey,
  };
}
