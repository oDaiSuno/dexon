import type { ReactNode } from "react";
import { useI18n } from "@/i18n";
import { Button } from "../form-controls";
import { BrowserIcon, type BrowserIconName } from "./browser-icons";

export function BrowserEmptyState({
  icon,
  iconColor = "var(--fx-text-faint)",
  spinning,
  title,
  description,
  action,
  note,
}: {
  icon: BrowserIconName;
  iconColor?: string;
  spinning?: boolean;
  title: string;
  description?: ReactNode;
  action?: ReactNode;
  note?: string;
}) {
  return (
    <div
      style={{
        flex: 1,
        minHeight: 0,
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        gap: 12,
        padding: "0 40px",
        background: "var(--fx-surface-main)",
        textAlign: "center",
      }}
    >
      <span style={{ color: iconColor }}>
        <BrowserIcon name={icon} size={28} strokeWidth={1.5} className={spinning ? "browser-spin" : undefined} />
      </span>
      <div className="type-heading" style={{ color: "var(--fx-text-primary)" }}>
        {title}
      </div>
      {description ? (
        <div
          className="type-label-default"
          style={{ alignSelf: "stretch", color: "var(--fx-text-tertiary)", textWrap: "balance" }}
        >
          {description}
        </div>
      ) : null}
      {action}
      {note ? (
        <div style={{ display: "flex", alignItems: "center", gap: 6, color: "var(--fx-text-tertiary)" }}>
          <BrowserIcon name="shield-check" size={12} strokeWidth={2} />
          <span className="type-meta-default">{note}</span>
        </div>
      ) : null}
    </div>
  );
}

export function BrowserNoTabState({ onCreate }: { onCreate: () => void }) {
  const { t } = useI18n();
  return (
    <BrowserEmptyState
      icon="globe"
      title={t("browserEmptyTitle", "No pages open yet")}
      description={t(
        "browserEmptyDescription",
        "Pages the Agent opens show up here too, and you can take over anytime.",
      )}
      action={
        <Button onClick={onCreate}>
          <BrowserIcon name="plus" size={14} strokeWidth={2} />
          {t("browserOpenNewTab", "Open a new tab")}
        </Button>
      }
      note={t("browserRemotePageSecurity", "Remote pages can't access your local files or Node")}
    />
  );
}

export function BrowserCrashedState({ onReload }: { onReload: () => void }) {
  const { t } = useI18n();
  return (
    <BrowserEmptyState
      icon="triangle-alert"
      iconColor="var(--fx-status-danger)"
      title={t("browserTabCrashed", "This tab's renderer process crashed")}
      description={t(
        "browserTabCrashedDescription",
        "Nothing is lost. Reload to recover; if it repeats, export diagnostics for us.",
      )}
      action={
        <Button onClick={onReload}>
          <BrowserIcon name="rotate-cw" size={14} strokeWidth={2} />
          {t("browserReload", "Reload")}
        </Button>
      }
      note={t("browserCrashStaysInTab", "A crash doesn't affect other tabs")}
    />
  );
}
