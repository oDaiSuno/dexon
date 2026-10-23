import { useI18n } from "@/i18n";
import { BrowserIcon } from "./browser-icons";
import type { BrowserTabInfo } from "../../../contract/browser";

export function BrowserTabStrip({
  tabs,
  activeTabId,
  onActivate,
  onClose,
  onCreate,
}: {
  tabs: BrowserTabInfo[];
  activeTabId: string | null;
  onActivate: (tabId: string) => void;
  onClose: (tabId: string) => void;
  onCreate: () => void;
}) {
  const { t } = useI18n();
  return (
    <div
      style={{
        display: "flex",
        flexShrink: 0,
        alignItems: "center",
        gap: 2,
        height: 36,
        padding: "0 var(--space-2)",
        overflowX: "auto",
        scrollbarWidth: "none",
        background: "var(--fx-surface-sidebar)",
      }}
    >
      {tabs.map((tab) => (
        <BrowserTab
          key={tab.id}
          tab={tab}
          active={tab.id === activeTabId}
          onActivate={() => onActivate(tab.id)}
          onClose={() => onClose(tab.id)}
        />
      ))}
      <button
        type="button"
        className="browser-icon-button"
        style={{ ...iconButtonStyle, width: 24, height: 24, color: "var(--fx-text-tertiary)" }}
        title={t("browserNewTab", "New tab")}
        aria-label={t("browserNewTab", "New tab")}
        onClick={onCreate}
      >
        <BrowserIcon name="plus" size={14} />
      </button>
    </div>
  );
}

function BrowserTab({
  tab,
  active,
  onActivate,
  onClose,
}: {
  tab: BrowserTabInfo;
  active: boolean;
  onActivate: () => void;
  onClose: () => void;
}) {
  const { t } = useI18n();
  const title = tab.title || t("browserNewTab", "New tab");
  const titleColor = tab.crashed
    ? "var(--fx-status-danger-text)"
    : active
      ? "var(--fx-text-primary)"
      : "var(--fx-text-secondary)";
  return (
    <div
      className="browser-tab"
      data-active={active}
      style={{
        display: "flex",
        flex: "0 1 auto",
        alignItems: "center",
        gap: 6,
        minWidth: 64,
        maxWidth: 168,
        height: 28,
        padding: "0 var(--space-1) 0 var(--space-2)",
        borderRadius: "var(--radius-chip)",
      }}
    >
      <button
        type="button"
        title={tab.url}
        aria-current={active ? "page" : undefined}
        onClick={onActivate}
        style={{
          display: "flex",
          flex: 1,
          alignItems: "center",
          gap: 6,
          minWidth: 0,
          height: "100%",
          padding: 0,
          border: "none",
          background: "none",
          color: titleColor,
          textAlign: "left",
          cursor: "pointer",
        }}
      >
        <span
          style={{
            display: "flex",
            flexShrink: 0,
            alignItems: "center",
            justifyContent: "center",
            width: 14,
            height: 14,
            borderRadius: "var(--radius-xs)",
            background: "var(--fx-surface-inset)",
            color: "var(--fx-text-tertiary)",
          }}
        >
          {tab.loading ? (
            <span role="img" aria-label={t("browserLoading", "Loading")}>
              <BrowserIcon name="loader" size={10} strokeWidth={2} className="browser-spin" />
            </span>
          ) : (
            <BrowserIcon name="globe" size={10} strokeWidth={2} />
          )}
        </span>
        {tab.control === "agent" && (
          <span
            role="img"
            aria-label={t("browserAgentControl", "Agent is controlling this tab — click or type to take over")}
            style={{ color: "var(--fx-accent-blue-text)" }}
          >
            <BrowserIcon name="bot" size={12} strokeWidth={2} />
          </span>
        )}
        <span
          className={active ? "type-label-medium" : "type-label-default"}
          style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}
        >
          {title}
        </span>
        {(tab.advanced || tab.advancedProfile) && (
          <span
            role="img"
            aria-label={t("browserAdvancedModeBadge", "Advanced Browser Mode")}
            title={t("browserAdvancedModeBadge", "Advanced Browser Mode")}
            style={{ color: "var(--fx-status-danger)" }}
          >
            <BrowserIcon name="triangle-alert" size={12} strokeWidth={2} />
          </span>
        )}
      </button>
      <button
        type="button"
        className="browser-tab-close"
        aria-label={t("browserCloseTab", "Close tab")}
        title={t("browserCloseTab", "Close tab")}
        onClick={onClose}
        style={{
          display: "flex",
          flexShrink: 0,
          alignItems: "center",
          justifyContent: "center",
          width: 16,
          height: 16,
          padding: 0,
          border: "none",
          borderRadius: "var(--radius-xs)",
          color: "var(--fx-text-secondary)",
          cursor: "pointer",
        }}
      >
        <BrowserIcon name="x" size={11} strokeWidth={2} />
      </button>
    </div>
  );
}

export const iconButtonStyle = {
  display: "flex",
  flexShrink: 0,
  alignItems: "center",
  justifyContent: "center",
  width: 28,
  height: 28,
  padding: 0,
  border: "none",
  borderRadius: "var(--radius-chip)",
  color: "var(--fx-text-secondary)",
  cursor: "pointer",
} as const;
