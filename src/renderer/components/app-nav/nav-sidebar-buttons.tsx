import type { ReactNode } from "react";
import type { CountedActivity } from "@/lib/session-tree-status";
import { ACTIVITY_TONE } from "../session-sidebar/session-status-indicators";
import { CircleArrowUpIcon, SettingsIcon } from "./nav-icons";

const NAV_ICON_SIZE = 18;

const BUTTON_TRANSITION =
  "background var(--duration-quick, 150ms) var(--ease-smooth-out, ease), color var(--duration-quick, 150ms) var(--ease-smooth-out, ease)";

export function RailButton({
  label,
  onClick,
  active = false,
  status,
  children,
}: {
  label: string;
  onClick: () => void;
  active?: boolean;
  status?: { activity: CountedActivity; label?: string } | null;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={label}
      aria-label={label}
      aria-current={active ? "page" : undefined}
      aria-description={status?.label}
      style={{
        position: "relative",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        width: 36,
        height: 36,
        padding: 0,
        flexShrink: 0,
        background: active ? "var(--fx-surface-selected)" : "transparent",
        border: `1px solid ${active ? "var(--fx-line-strong)" : "transparent"}`,
        borderRadius: "var(--radius-control)",
        color: active ? "var(--fx-text-primary)" : "var(--fx-text-secondary)",
        cursor: "pointer",
        transition: BUTTON_TRANSITION,
      }}
      onMouseEnter={(e) => {
        if (!active) e.currentTarget.style.background = "var(--fx-surface-hover)";
        e.currentTarget.style.color = "var(--fx-text-primary)";
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.background = active ? "var(--fx-surface-selected)" : "transparent";
        e.currentTarget.style.color = active ? "var(--fx-text-primary)" : "var(--fx-text-secondary)";
      }}
    >
      {children}
      {status && (
        <CornerDot
          color={ACTIVITY_TONE[status.activity].dot}
          activity={status.activity}
          pulse={status.activity === "running"}
        />
      )}
    </button>
  );
}

export function SettingsButton({ label, active, onClick }: { label: string; active: boolean; onClick: () => void }) {
  const restingBackground = active ? "var(--fx-surface-selected)" : "var(--fx-surface-hover-clear)";
  return (
    <button
      type="button"
      onClick={onClick}
      title={label}
      aria-label={label}
      aria-current={active ? "page" : undefined}
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        width: 32,
        height: 32,
        padding: 0,
        flexShrink: 0,
        background: restingBackground,
        border: `1px solid ${active ? "var(--fx-line-strong)" : "transparent"}`,
        borderRadius: "var(--radius-control)",
        color: active ? "var(--fx-text-primary)" : "var(--fx-text-secondary)",
        cursor: "pointer",
        transition: BUTTON_TRANSITION,
      }}
      onMouseEnter={(e) => {
        if (!active) e.currentTarget.style.background = "var(--fx-surface-hover-overlay)";
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.background = restingBackground;
      }}
    >
      <SettingsIcon size={NAV_ICON_SIZE} />
    </button>
  );
}

export function UpdateButton({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={label}
      aria-label={label}
      style={{
        position: "relative",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        width: 32,
        height: 32,
        padding: 0,
        flexShrink: 0,
        background: "var(--fx-surface-hover-clear)",
        border: "none",
        borderRadius: "var(--radius-control)",
        color: "var(--fx-accent-blue-text)",
        cursor: "pointer",
        transition: BUTTON_TRANSITION,
      }}
      onMouseEnter={(e) => {
        e.currentTarget.style.background = "var(--fx-surface-hover-overlay)";
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.background = "var(--fx-surface-hover-clear)";
      }}
    >
      <CircleArrowUpIcon size={NAV_ICON_SIZE} />
      <CornerDot color="var(--fx-accent-blue)" inset={4} />
    </button>
  );
}

function CornerDot({
  color,
  inset = 3,
  activity,
  pulse = false,
}: {
  color: string;
  inset?: number;
  activity?: CountedActivity;
  pulse?: boolean;
}) {
  return (
    <span
      aria-hidden="true"
      data-activity={activity}
      className={pulse ? "session-status-pulse" : undefined}
      style={{
        position: "absolute",
        top: inset,
        right: inset,
        width: 9,
        height: 9,
        borderRadius: "50%",
        background: color,
        border: "1.5px solid var(--fx-surface-sidebar)",
        pointerEvents: "none",
      }}
    />
  );
}
