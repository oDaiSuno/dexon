import { useCallback, type RefObject } from "react";
import { getFileName } from "@/lib/file-paths";
import { buildAtMentionText } from "@/lib/file-fuzzy";
import type { ChatInputHandle } from "../ChatInput";
import type { useRightPanelDock } from "./use-right-panel-dock";

export function useShellFileActions({
  chatInputRef,
  sessionId,
  dispatchFileTab,
  openRightPanel,
}: Pick<ReturnType<typeof useRightPanelDock>, "dispatchFileTab" | "openRightPanel"> & {
  chatInputRef: RefObject<ChatInputHandle | null>;
  sessionId: string | null;
}) {
  const handleAtMention = useCallback(
    (relativePath: string, isDir: boolean) => {
      chatInputRef.current?.insertText(buildAtMentionText(relativePath, isDir));
    },
    [chatInputRef],
  );

  const handleOpenFile = useCallback(
    (filePath: string, fileName: string, sourceSessionId?: string | null) => {
      dispatchFileTab({
        type: "open",
        tab: { id: `file:${filePath}`, label: fileName, filePath, sourceSessionId },
      });
      openRightPanel();
    },
    [dispatchFileTab, openRightPanel],
  );

  const handleOpenLinkedFile = useCallback(
    (filePath: string) => {
      handleOpenFile(filePath, getFileName(filePath), sessionId);
    },
    [handleOpenFile, sessionId],
  );

  return { handleAtMention, handleOpenFile, handleOpenLinkedFile };
}
