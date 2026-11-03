import { useEffect, useRef, useState } from "react";
import { useI18n } from "@/i18n";
import { useWorkspaceFacts } from "./remote-workspaces-context";
import { LockKeyholeGlyph } from "../chat-input/workspace-glyphs";

import { RuleLensPopover } from "./rule-lens-popover";

export function SshConnectionPill({ workspace, dismissed }: { workspace: string | null; dismissed: boolean }) {
  const { t } = useI18n();
  const facts = useWorkspaceFacts(workspace);
  const [open, setOpen] = useState(false);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const popoverRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = () => {
      setOpen(false);
      buttonRef.current?.focus();
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      event.stopPropagation();
      close();
    };
    const onMouseDown = (event: MouseEvent) => {
      if (buttonRef.current?.contains(event.target as Node) || popoverRef.current?.contains(event.target as Node))
        return;
      close();
    };
    document.addEventListener("keydown", onKeyDown, true);
    document.addEventListener("mousedown", onMouseDown);
    return () => {
      document.removeEventListener("keydown", onKeyDown, true);
      document.removeEventListener("mousedown", onMouseDown);
    };
  }, [open]);
  if (facts.kind !== "ssh") return null;
  const lock = dismissed && facts.trust === "read-only";
  const label =
    facts.connection === "connected"
      ? t("sshLensConnected", "SSH connected · {rtt}ms").replace("{rtt}", String(facts.rttMs ?? "?"))
      : facts.connection === "reconnecting"
        ? t("sshLensReconnecting", "SSH reconnecting…")
        : t("sshLensOffline", "SSH offline");
  return (
    <>
      <button
        ref={buttonRef}
        type="button"
        aria-expanded={open}
        aria-haspopup="dialog"
        onClick={() => setOpen((current) => !current)}
        aria-label={lock ? t("sshLensReadOnlyLabel", "{label}, read-only").replace("{label}", label) : label}
        className="type-mono-meta"
        style={{
          display: "flex",
          alignItems: "center",
          gap: 5,
          height: 30,
          padding: "0 8px",
          border: `1px ${facts.connection === "offline" ? "dashed" : "solid"} var(--fx-line-default)`,
          borderRadius: "var(--radius-pill)",
          background: "var(--fx-surface-hover-clear)",
          color: facts.connection === "reconnecting" ? "var(--fx-status-warning-text)" : "var(--fx-text-secondary)",
          cursor: "pointer",
          minWidth: 0,
          maxWidth: "min(250px, 40vw)",
        }}
      >
        <span
          aria-hidden="true"
          className={facts.connection === "reconnecting" ? "motion-safe:animate-pulse" : undefined}
        >
          {facts.connection === "reconnecting" ? "◌" : "●"}
        </span>
        <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{label}</span>
        {lock && <LockKeyholeGlyph size={11} />}
        <span aria-hidden="true">▾</span>
      </button>
      {open && <RuleLensPopover workspace={facts.key} popoverRef={popoverRef} />}
    </>
  );
}
