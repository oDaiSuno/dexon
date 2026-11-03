import { useI18n } from "@/i18n";
import type { FileReadResult } from "@/lib/file-blob";
import { useFileWorkspaceFacts } from "../app-shell/remote-workspaces-context";

type ViewerWatchState =
  | { kind: "local"; watching: boolean }
  | { kind: "remote"; watching: boolean; hostLabel: string }
  | { kind: "local-overlay" };

export function WatchIndicator({
  watching,
  noShrink = false,
  showLabel = true,
  filePath = "",
  cwd,
  file,
}: {
  watching: boolean;
  noShrink?: boolean;
  showLabel?: boolean;
  filePath?: string;
  cwd?: string;
  file?: Pick<FileReadResult, "space" | "remoteHostLabel">;
}) {
  const { t } = useI18n();
  const facts = useFileWorkspaceFacts(filePath, cwd);
  const state: ViewerWatchState =
    file?.space === "local-overlay"
      ? { kind: "local-overlay" }
      : facts.kind === "ssh" || file?.space === "remote"
        ? {
            kind: "remote",
            watching: watching && (facts.kind !== "ssh" || facts.connection === "connected"),
            hostLabel: file?.remoteHostLabel ?? (facts.kind === "ssh" ? facts.hostLabel : ""),
          }
        : { kind: "local", watching };
  const label =
    state.kind === "local-overlay"
      ? t("sshViewerLocalOverlay", "💻 Local read-only layer")
      : state.kind === "remote"
        ? state.watching
          ? t("sshViewerLive", "Live · {host}").replace("{host}", state.hostLabel)
          : t("sshViewerOffline", "Offline snapshot (read-only)")
        : state.watching
          ? t("live", "live")
          : t("static", "static");
  return (
    <span
      className="file-viewer-live"
      role={state.kind === "local" ? undefined : "status"}
      title={
        state.kind === "local"
          ? watching
            ? t("liveSyncActive", "Live sync active")
            : t("notWatching", "Not watching")
          : label
      }
      style={noShrink ? { flexShrink: 0 } : undefined}
    >
      {state.kind !== "local-overlay" && (
        <span className="file-viewer-live-dot" data-watching={state.watching} aria-hidden="true" />
      )}
      <span className={showLabel || state.kind !== "local" ? "type-meta-default" : "sr-only"}>{label}</span>
    </span>
  );
}
