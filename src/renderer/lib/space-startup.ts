// Pure startup-space decision for the Phase 6 space coordinator. The decision
// implements the approved three-tier startup priority: an explicitly requested
// session first, then the remembered last space, then the personal space.
// It must stay free of React and I/O so every branch stays exhaustively
// testable.

export type StartupSpaceDecision =
  { type: "wait" } | { type: "explicit" } | { type: "restore"; path: string } | { type: "personal" };

export function resolveStartupSpace({
  sessionIntent,
  sessionResolved,
  sessionFound,
  storedSpaceCwd,
}: {
  /** Session id requested by the launch/deep-link URL, if any. */
  sessionIntent: string | null | undefined;
  /** True once the explicit-session branch has been resolved (found or absent). */
  sessionResolved: boolean;
  /** True when a session is open (the explicit branch won, or a deep link). */
  sessionFound: boolean;
  /**
   * Remembered last-space cwd: null when absent, undefined while the stored
   * preference has not been read yet.
   */
  storedSpaceCwd: string | null | undefined;
}): StartupSpaceDecision {
  if (storedSpaceCwd === undefined) return { type: "wait" };
  // HC-2: a loading or failed session list does not mean the session is gone.
  // The explicit branch must resolve successfully before later tiers run.
  if (sessionIntent && !sessionResolved) return { type: "wait" };
  if (sessionFound) return { type: "explicit" };
  // No explicit session branch to wait for: restoring the remembered space or
  // preparing the personal space must not depend on the session list.
  return storedSpaceCwd ? { type: "restore", path: storedSpaceCwd } : { type: "personal" };
}

/**
 * Defensive read-side normalization for the stored last-space preference.
 * Garbage shapes mean "no record" (first-run tier), never a fake path; a
 * well-shaped but broken path stays a restore attempt so its failure can be
 * reported honestly by the coordinator.
 */
export function parseStoredSpaceCwd(value: unknown): string | null {
  if (typeof value !== "string" || !value || value.length > 4096) return null;
  if (/[\0\r\n]/.test(value)) return null;
  // Lexical absolute-path shape (POSIX, Windows drive, or UNC). A relative
  // record must never resolve against some process cwd; treat it as no record.
  if (!(value.startsWith("/") || /^(?:[a-zA-Z]:[\\/]|\\\\)/.test(value))) return null;
  return value;
}
