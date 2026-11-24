import { useEffect, useId, useState } from "react";
import { useI18n } from "@/i18n";
import { useConnectionLabel } from "@/lib/connection-labels";
import { useSpaceAttribution, type RemoteSpaceAttribution } from "@/lib/space-attribution";
import { requestSettings } from "@/lib/settings-request";
import { useAnchoredPopover } from "../app-nav/use-anchored-popover";
import { ChevronDownIcon } from "../chat-input/icons";
import { RemoteControlPopover } from "./remote-control-popover";
import { RemoteFolderPickerDialog } from "../remote-folder-picker/remote-folder-picker-dialog";

export function ServerGlyph() {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.75"
      aria-hidden="true"
    >
      <rect x="3" y="3" width="18" height="7" rx="2" />
      <rect x="3" y="14" width="18" height="7" rx="2" />
      <path d="M7 6.5h.01M7 17.5h.01M11 6.5h6M11 17.5h6" />
    </svg>
  );
}

function ServerStatus({ attribution }: { attribution: RemoteSpaceAttribution }) {
  const { t } = useI18n();
  const connectionLabel = useConnectionLabel(attribution.presentation);
  const label =
    attribution.presentation.countdown !== null
      ? t("schemeCRemoteRetryIn", "Reconnecting in {seconds}s").replace(
          "{seconds}",
          String(attribution.presentation.countdown),
        )
      : connectionLabel;
  const popover = useAnchoredPopover(320);
  const id = useId();
  const [folderOpen, setFolderOpen] = useState(false);
  const closeFolder = () => {
    setFolderOpen(false);
    popover.triggerRef.current?.focus({ preventScroll: true });
  };

  useEffect(() => {
    if (!popover.open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      event.stopPropagation();
      popover.close();
    };
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as Node;
      if (!popover.triggerRef.current?.contains(target) && !popover.popoverRef.current?.contains(target)) {
        popover.close();
      }
    };
    document.addEventListener("keydown", onKeyDown);
    document.addEventListener("pointerdown", onPointerDown);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      document.removeEventListener("pointerdown", onPointerDown);
    };
  }, [popover]);

  return (
    <>
      <button
        ref={popover.triggerRef}
        type="button"
        className="top-bar-server-status remote-connection remote-control-trigger"
        aria-haspopup="dialog"
        aria-label={`${attribution.label} · ${label}`}
        aria-expanded={popover.open}
        aria-controls={popover.open ? id : undefined}
        data-tone={attribution.presentation.tone}
        onClick={() => (popover.open ? popover.close() : popover.show())}
      >
        <span
          className="remote-control-status"
          role="status"
          aria-label={t("remoteAttributionServerConnection", "Server connection")}
        >
          <span className="remote-attribution-dot" aria-hidden="true" />
          <span className="type-mono-meta">{attribution.label}</span>
          <span className="type-meta-default">· {label}</span>
        </span>
        <ChevronDownIcon size={12} />
      </button>
      {popover.position && (
        <RemoteControlPopover
          id={id}
          attribution={attribution}
          statusLabel={label}
          popoverRef={popover.popoverRef}
          position={popover.position}
          onClose={popover.close}
          onOpenFolder={() => {
            popover.close();
            setFolderOpen(true);
          }}
        />
      )}
      {folderOpen && (
        <RemoteFolderPickerDialog
          initialEnvironmentId={attribution.environmentId}
          onClose={closeFolder}
          onOpenSettings={() => {
            closeFolder();
            requestSettings("servers", { environmentId: attribution.environmentId });
          }}
        />
      )}
    </>
  );
}

export function TopBarServerStatus() {
  const attribution = useSpaceAttribution();
  return attribution.kind === "remote" ? (
    <ServerStatus key={attribution.environmentId} attribution={attribution} />
  ) : null;
}
