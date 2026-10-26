import { useEffect, useRef, type CSSProperties, type KeyboardEvent } from "react";
import { useI18n } from "@/i18n";
import { Button } from "../form-controls";
import { BrowserIcon } from "./browser-icons";
import { BrowserAuthorizationFacts, BrowserAuthorizationLadder } from "./browser-authorization-details";
import type { BrowserAgentAuthorizationDecision, BrowserAgentAuthorizationRequest } from "../../../contract/browser";

const ALLOW_SHORTCUT_ARM_MS = 600;

export function BrowserAuthorizationDialog({
  request,
  sessionTitle,
  onRespond,
  onManage,
}: {
  request: BrowserAgentAuthorizationRequest;
  sessionTitle: string;
  onRespond: (decision: BrowserAgentAuthorizationDecision) => void;
  onManage: () => void;
}) {
  const { t } = useI18n();
  const dialogRef = useRef<HTMLDivElement>(null);
  const openedAtRef = useRef(0);
  const returnFocusRef = useRef<HTMLElement | null>(
    document.activeElement instanceof HTMLElement ? document.activeElement : null,
  );

  useEffect(() => {
    openedAtRef.current = performance.now();
    dialogRef.current?.querySelector<HTMLElement>("[data-initial-focus]")?.focus();
    const returnFocus = returnFocusRef.current;
    return () => returnFocus?.focus();
  }, []);

  const advanced = request.minimumPermission === "advanced";
  const shortcutLabel = window.piBridge?.platform === "darwin" ? "⌘↵" : "Ctrl ↵";

  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    event.stopPropagation();
    if (event.key === "Escape") {
      event.preventDefault();
      onRespond("deny");
      return;
    }
    if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
      event.preventDefault();
      const armed = performance.now() - openedAtRef.current >= ALLOW_SHORTCUT_ARM_MS;
      if (armed && !event.repeat && !event.nativeEvent.isComposing && !event.altKey && !event.shiftKey) {
        onRespond("allow-session");
      }
      return;
    }
    if (event.key !== "Tab") return;
    const dialog = dialogRef.current;
    if (!dialog) return;
    const focusable = Array.from(
      dialog.querySelectorAll<HTMLElement>('button:not([disabled]), [tabindex]:not([tabindex="-1"])'),
    );
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (!first || !last) return;
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  };

  return (
    <div
      role="presentation"
      onClick={(event) => {
        if (event.target === event.currentTarget) onRespond("deny");
      }}
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 1200,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: "var(--space-5)",
        background: "var(--fx-surface-scrim)",
      }}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="browser-agent-authorization-title"
        aria-describedby="browser-agent-authorization-description"
        data-permission={request.minimumPermission}
        onKeyDown={handleKeyDown}
        style={{
          display: "flex",
          flexDirection: "column",
          width: 440,
          maxWidth: "100%",
          maxHeight: "calc(100dvh - 40px)",
          overflowY: "auto",
          border: "1px solid var(--fx-line-default)",
          borderRadius: "var(--radius-dialog)",
          background: "var(--fx-surface-raised)",
          boxShadow: "var(--shadow-dialog)",
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "flex-start",
            gap: "var(--space-3)",
            padding: "var(--space-5) var(--space-5) 0",
          }}
        >
          <span
            aria-hidden="true"
            style={{
              position: "relative",
              display: "flex",
              flexShrink: 0,
              alignItems: "center",
              justifyContent: "center",
              width: 36,
              height: 36,
              border: `1px solid ${advanced ? "var(--fx-status-danger-border)" : "var(--fx-line-subtle)"}`,
              borderRadius: "var(--radius-card)",
              background: advanced ? "var(--fx-status-danger-soft)" : "var(--fx-surface-inset)",
              color: advanced ? "var(--fx-status-danger-text)" : "var(--fx-text-primary)",
            }}
          >
            <BrowserIcon
              name={
                advanced ? "shield-alert" : request.minimumPermission === "interact" ? "mouse-pointer-click" : "globe"
              }
              size={18}
            />
            <span style={pauseBadgeStyle}>
              <BrowserIcon name="pause" size={9} strokeWidth={2.5} />
            </span>
          </span>
          <div style={{ display: "flex", flex: 1, flexDirection: "column", gap: "var(--space-1)", minWidth: 0 }}>
            <h2
              id="browser-agent-authorization-title"
              className="type-title-dialog"
              style={{ margin: 0, color: "var(--fx-text-primary)" }}
            >
              {advanced
                ? t("browserAuthorizationAdvancedTitle", "Allow the Agent to enter Advanced Browser Mode?")
                : t("browserAuthorizationTitle", "Allow the Agent to use the Browser?")}
            </h2>
            <p
              id="browser-agent-authorization-description"
              className="type-label-default"
              style={{ margin: 0, color: "var(--fx-text-tertiary)", textWrap: "pretty" }}
            >
              {t(
                "browserAuthorizationDescription",
                "The Browser tool paused before opening pages, going online, or typing, and is waiting for you.",
              )}
            </p>
          </div>
          <button
            type="button"
            className="right-panel-icon-button"
            aria-label={t("browserAuthorizationClose", "Close and deny")}
            title={t("browserAuthorizationClose", "Close and deny")}
            onClick={() => onRespond("deny")}
          >
            <BrowserIcon name="x" size={16} strokeWidth={2} />
          </button>
        </div>
        <BrowserAuthorizationFacts sessionTitle={sessionTitle} source={request.source} channel={request.channel} />
        <BrowserAuthorizationLadder permission={request.minimumPermission} />
        <div
          className="type-label-default"
          style={{ display: "flex", alignItems: "flex-start", gap: "var(--space-2)", padding: "14px var(--space-5) 0" }}
        >
          <span style={{ display: "flex", flexShrink: 0, color: "var(--fx-text-tertiary)" }}>
            <BrowserIcon name="clock" size={13} strokeWidth={2} />
          </span>
          <p style={{ flex: 1, minWidth: 0, margin: 0, textWrap: "pretty" }}>
            <span style={{ color: "var(--fx-text-secondary)" }}>
              {t("browserAuthorizationSessionOnly", "Only valid for this running Agent session.")}
            </span>
            <span style={{ color: "var(--fx-text-tertiary)" }}>
              {t("browserAuthorizationSavePermanent", " To allow it permanently, save it in Settings › Browser.")}
            </span>
          </p>
        </div>
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: "var(--space-2)",
            padding: "var(--space-4) var(--space-5)",
          }}
        >
          <button type="button" className="browser-authorization-manage type-label-medium" onClick={onManage}>
            {t("browserAuthorizationManage", "Manage permanent permissions")}
            <BrowserIcon name="chevron-right" size={12} strokeWidth={2} />
          </button>
          <span style={{ flex: 1 }} />
          <Button data-initial-focus="" onClick={() => onRespond("deny")}>
            {t("browserDeny", "Deny")}
          </Button>
          <button
            type="button"
            className="browser-authorization-allow type-body-medium"
            data-danger={advanced || undefined}
            aria-keyshortcuts={shortcutLabel === "⌘↵" ? "Meta+Enter" : "Control+Enter"}
            onClick={() => onRespond("allow-session")}
          >
            {advanced
              ? t("browserAuthorizationAllowAdvanced", "I understand the risk, allow")
              : t("browserAllowCurrentAgentSession", "Allow this session")}
            <kbd className="browser-authorization-key type-mono-meta" aria-hidden="true">
              {shortcutLabel}
            </kbd>
          </button>
        </div>
      </div>
    </div>
  );
}

const pauseBadgeStyle: CSSProperties = {
  position: "absolute",
  right: -4,
  bottom: -4,
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  width: 16,
  height: 16,
  border: "1px solid var(--fx-line-default)",
  borderRadius: "var(--radius-pill)",
  background: "var(--fx-surface-raised)",
  color: "var(--fx-status-warning-text)",
};
