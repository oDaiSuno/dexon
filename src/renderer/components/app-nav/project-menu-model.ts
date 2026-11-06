import { PRIMARY_ENVIRONMENT_ID } from "@contract/environment";
import type { ProjectSpaceRow } from "./project-space-rows";

export type ProjectMenuAction =
  "new-session" | "copy-path" | "server-settings" | "reveal" | "move-up" | "move-down" | "remove";
export interface ProjectMenuEntry {
  readonly action: ProjectMenuAction;
  readonly disabled: boolean;
  readonly reason?: "remote-folder" | "unavailable";
}

export function projectMenuFor(row: ProjectSpaceRow, options: { canMoveUp: boolean; canMoveDown: boolean }) {
  const remote = row.environmentId !== PRIMARY_ENVIRONMENT_ID;
  const entries: ProjectMenuEntry[] = [];
  if (remote)
    entries.push(
      {
        action: "new-session",
        disabled: row.missing || !row.connection.canSend,
        ...(row.missing || !row.connection.canSend ? { reason: "unavailable" as const } : {}),
      },
      { action: "copy-path", disabled: false },
      { action: "server-settings", disabled: false },
      { action: "reveal", disabled: true, reason: "remote-folder" },
    );
  entries.push(
    { action: "move-up", disabled: row.pinned || !options.canMoveUp },
    { action: "move-down", disabled: row.pinned || !options.canMoveDown },
    { action: "remove", disabled: row.pinned || (!remote && row.activity.workInFlight) },
  );
  return { remote, entries };
}
