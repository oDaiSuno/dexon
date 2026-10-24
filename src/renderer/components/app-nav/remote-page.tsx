import { useEffect, useRef } from "react";
import type { ChannelsSnapshot } from "@shared/channel-types";
import { useI18n } from "@/i18n";
import { ChannelsConfig } from "../channels/ChannelsConfig";
import { PageTopBar } from "../page-top-bar";

export function RemotePage({
  isMobile,
  onOpenResources,
  onClose,
  onSnapshotChange,
  currentSessionId,
}: {
  isMobile: boolean;
  onOpenResources: () => void;
  onClose: () => void;
  onSnapshotChange?: (snapshot: ChannelsSnapshot) => void;
  currentSessionId?: string | null;
}) {
  const { t } = useI18n();
  const pageRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;

  useEffect(() => {
    const page = pageRef.current;
    if (page && !page.contains(document.activeElement)) page.focus();
  }, []);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || event.defaultPrevented) return;
      const target = event.target;
      const page = pageRef.current;
      if (target !== document.body && !(target instanceof Node && page?.contains(target))) return;
      event.preventDefault();
      closeRef.current();
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, []);

  return (
    <div
      ref={pageRef}
      role="region"
      aria-label={t("channels", "Remote chat")}
      tabIndex={-1}
      className="app-nav-resource"
      style={{
        flex: 1,
        minWidth: 0,
        minHeight: 0,
        height: "100%",
        display: "flex",
        flexDirection: "column",
        overflow: "hidden",
        background: "var(--fx-surface-main)",
        outline: "none",
      }}
    >
      <PageTopBar
        parent={t("navPluginsSkills", "Plugins & Skills")}
        current={t("channels", "Remote chat")}
        isMobile={isMobile}
        onParent={onOpenResources}
        onBack={() => closeRef.current()}
      />
      <div style={{ flex: 1, minHeight: 0, minWidth: 0, display: "flex", overflow: "hidden" }}>
        <ChannelsConfig onSnapshotChange={onSnapshotChange} currentSessionId={currentSessionId} />
      </div>
    </div>
  );
}
