import { useEffect, useRef, useState } from "react";
import { useI18n } from "@/i18n";
import { subscribeSessionSearchFocus } from "@/lib/session-search-focus";
import appIconUrl from "../../../../build/icon.png";
import { PanelLeftIcon } from "./nav-space-menu";

const TOP_BAR_HEIGHT = 38;

function SearchGlyph() {
  return (
    <svg
      width={16}
      height={16}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      style={{
        position: "absolute",
        left: 12,
        top: "50%",
        transform: "translateY(-50%)",
        color: "var(--fx-text-tertiary)",
        pointerEvents: "none",
      }}
    >
      <circle cx="11" cy="11" r="8" />
      <path d="m21 21-4.3-4.3" />
    </svg>
  );
}

function ProductToggle({ label, onClick }: { label: string; onClick: () => void }) {
  const [active, setActive] = useState(false);
  return (
    <button
      type="button"
      onClick={onClick}
      title={label}
      aria-label={label}
      onMouseEnter={() => setActive(true)}
      onMouseLeave={() => setActive(false)}
      onFocus={() => setActive(true)}
      onBlur={() => setActive(false)}
      style={{
        position: "relative",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        width: TOP_BAR_HEIGHT,
        height: TOP_BAR_HEIGHT,
        padding: 0,
        flexShrink: 0,
        background: active ? "var(--fx-surface-hover)" : "transparent",
        border: "none",
        borderRadius: "var(--radius-card)",
        color: "var(--fx-text-secondary)",
        cursor: "pointer",
        transition: "background var(--duration-quick) var(--ease-smooth-out)",
      }}
    >
      <img
        src={appIconUrl}
        alt=""
        aria-hidden="true"
        width={TOP_BAR_HEIGHT}
        height={TOP_BAR_HEIGHT}
        style={{
          width: TOP_BAR_HEIGHT,
          height: TOP_BAR_HEIGHT,
          objectFit: "cover",
          borderRadius: "var(--radius-card)",
          opacity: active ? 0 : 1,
          transition: "opacity var(--duration-quick) var(--ease-smooth-out)",
        }}
      />
      <span
        aria-hidden="true"
        style={{
          position: "absolute",
          inset: 0,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          opacity: active ? 1 : 0,
          transition: "opacity var(--duration-quick) var(--ease-smooth-out)",
        }}
      >
        <PanelLeftIcon size={18} />
      </span>
    </button>
  );
}

function SessionSearch({ query, onQueryChange }: { query: string; onQueryChange: (value: string) => void }) {
  const { t } = useI18n();
  const inputRef = useRef<HTMLInputElement>(null);
  const mac = window.piBridge?.platform === "darwin";
  const label = t("searchSessions", "Search sessions");

  useEffect(
    () =>
      subscribeSessionSearchFocus(() => {
        inputRef.current?.focus();
        inputRef.current?.select();
      }),
    [],
  );

  return (
    <div style={{ position: "relative", flex: 1, minWidth: 0 }}>
      <SearchGlyph />
      <input
        ref={inputRef}
        type="search"
        value={query}
        onChange={(event) => onQueryChange(event.target.value)}
        onKeyDown={(event) => {
          if (event.key !== "Escape") return;
          event.preventDefault();
          event.stopPropagation();
          if (query) onQueryChange("");
          else event.currentTarget.blur();
        }}
        placeholder={label}
        aria-label={label}
        aria-keyshortcuts={mac ? "Meta+K" : "Control+K"}
        className="ui-input type-body-large"
        style={{
          height: TOP_BAR_HEIGHT,
          padding: "0 44px 0 38px",
          border: "1px solid var(--fx-line-subtle)",
          borderRadius: "var(--radius-card)",
          background: "var(--fx-surface-raised)",
          color: "var(--fx-text-primary)",
        }}
      />
      {query ? (
        <button
          type="button"
          onClick={() => {
            onQueryChange("");
            inputRef.current?.focus();
          }}
          title={t("clearSessionSearch", "Clear session search")}
          aria-label={t("clearSessionSearch", "Clear session search")}
          style={{
            position: "absolute",
            right: 6,
            top: "50%",
            transform: "translateY(-50%)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            width: 26,
            height: 26,
            padding: 0,
            border: "none",
            borderRadius: "var(--radius-chip)",
            background: "transparent",
            color: "var(--fx-text-tertiary)",
            cursor: "pointer",
          }}
        >
          <svg
            width={14}
            height={14}
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth={2}
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <path d="M18 6 6 18" />
            <path d="m6 6 12 12" />
          </svg>
        </button>
      ) : (
        <span
          aria-hidden="true"
          className="type-mono-meta"
          style={{
            position: "absolute",
            right: 8,
            top: "50%",
            transform: "translateY(-50%)",
            padding: "2px 6px",
            border: "1px solid var(--fx-line-strong)",
            borderRadius: "var(--radius-kbd)",
            color: "var(--fx-text-tertiary)",
            pointerEvents: "none",
            whiteSpace: "nowrap",
          }}
        >
          {mac ? "⌘K" : "Ctrl K"}
        </span>
      )}
    </div>
  );
}

export function NavTopBar({
  query,
  onQueryChange,
  onToggleExpanded,
}: {
  query: string;
  onQueryChange: (value: string) => void;
  onToggleExpanded: () => void;
}) {
  const { t } = useI18n();
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: "var(--space-2)",
        padding: "var(--space-3) var(--space-3) var(--space-2)",
        flexShrink: 0,
      }}
    >
      <ProductToggle label={t("hideSidebar", "Hide sidebar")} onClick={onToggleExpanded} />
      <SessionSearch query={query} onQueryChange={onQueryChange} />
    </div>
  );
}
