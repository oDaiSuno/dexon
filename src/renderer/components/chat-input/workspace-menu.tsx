import type { RefObject } from "react";
import type { ComposerWorkspace } from "./types";
import { WorkspaceCard } from "./workspace-card";
import { WorkspaceReadOnlyCard } from "./workspace-read-only-card";

export function WorkspaceMenu({
  id,
  workspace,
  anchorRef,
  isMobile,
  onFocusTrigger,
}: {
  id: string;
  workspace: ComposerWorkspace;
  anchorRef: RefObject<HTMLButtonElement | null>;
  isMobile: boolean;
  onFocusTrigger: () => void;
}) {
  if (workspace.mode === "read-only") {
    return (
      <WorkspaceReadOnlyCard
        id={id}
        workspace={workspace}
        anchorRef={anchorRef}
        onRequestClose={workspace.closeMenu}
        onFocusTrigger={onFocusTrigger}
      />
    );
  }
  return (
    <WorkspaceCard
      id={id}
      workspace={workspace}
      anchorRef={anchorRef}
      isMobile={isMobile}
      onRequestClose={workspace.closeMenu}
      onFocusTrigger={onFocusTrigger}
    />
  );
}
