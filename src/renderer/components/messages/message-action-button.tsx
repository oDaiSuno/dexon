import type { ReactNode } from "react";
import { useCopyFeedback } from "@/hooks/useCopyFeedback";
import { useI18n } from "@/i18n";
import { RowIcon } from "../session-sidebar/session-relation-glyphs";

export function MessageActionButton({
  label,
  onClick,
  disabled,
  busy,
  revealed,
  className,
  children,
}: {
  label: string;
  onClick: () => void;
  disabled?: boolean;
  busy?: boolean;
  revealed?: boolean;
  className?: string;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      className={["message-action-button", className].filter(Boolean).join(" ")}
      title={label}
      aria-label={label}
      disabled={disabled}
      data-busy={busy ? "true" : undefined}
      onClick={onClick}
      style={
        revealed === undefined ? undefined : { opacity: revealed ? 1 : 0, pointerEvents: revealed ? "auto" : "none" }
      }
    >
      {children}
    </button>
  );
}

export function MessageCopyButton({
  text,
  className,
  revealed,
}: {
  text: string;
  className?: string;
  revealed?: boolean;
}) {
  const { t } = useI18n();
  const { copied, copy } = useCopyFeedback();
  const label = text ? t("copyMessage", "Copy message") : t("nothingToCopy", "Nothing to copy");

  return (
    <MessageActionButton
      label={label}
      onClick={() => void copy(text)}
      disabled={!text}
      revealed={revealed}
      className={["message-copy-action", copied && "message-copy-action-done", className].filter(Boolean).join(" ")}
    >
      {copied ? <CopiedGlyph /> : <CopyGlyph />}
    </MessageActionButton>
  );
}

export function EditMessageGlyph() {
  return (
    <RowIcon size={14}>
      <path d="M21.174 6.812a1 1 0 0 0-3.986-3.987L3.842 16.174a2 2 0 0 0-.5.83l-1.321 4.352a.5.5 0 0 0 .623.622l4.353-1.32a2 2 0 0 0 .83-.497z" />
      <path d="m15 5 4 4" />
    </RowIcon>
  );
}

function CopyGlyph() {
  return (
    <RowIcon size={14}>
      <rect width="14" height="14" x="8" y="8" rx="2" ry="2" />
      <path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2" />
    </RowIcon>
  );
}

function CopiedGlyph() {
  return (
    <RowIcon size={14}>
      <path d="M20 6 9 17l-5-5" />
    </RowIcon>
  );
}
