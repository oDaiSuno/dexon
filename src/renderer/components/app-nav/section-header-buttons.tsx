import type { ReactNode, Ref } from "react";

export function PlusGlyph() {
  return (
    <svg
      width={15}
      height={15}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M5 12h14" />
      <path d="M12 5v14" />
    </svg>
  );
}

export function ChevronsGlyph({ inward }: { inward: boolean }) {
  return (
    <svg
      width={15}
      height={15}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {inward ? (
        <>
          <path d="m7 20 5-5 5 5" />
          <path d="m7 4 5 5 5-5" />
        </>
      ) : (
        <>
          <path d="m7 15 5 5 5-5" />
          <path d="m7 9 5-5 5 5" />
        </>
      )}
    </svg>
  );
}

export function HeaderButton({
  ref,
  label,
  pressed = false,
  hasPopup = false,
  disabled = false,
  onClick,
  children,
}: {
  ref?: Ref<HTMLButtonElement>;
  label: string;
  pressed?: boolean;
  hasPopup?: boolean;
  disabled?: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      ref={ref}
      type="button"
      onClick={onClick}
      title={label}
      aria-label={label}
      aria-haspopup={hasPopup ? "menu" : undefined}
      aria-expanded={hasPopup ? pressed : undefined}
      disabled={disabled}
      onMouseEnter={(event) => {
        if (pressed || disabled) return;
        event.currentTarget.style.background = "var(--fx-surface-hover)";
        event.currentTarget.style.color = "var(--fx-text-primary)";
      }}
      onMouseLeave={(event) => {
        if (pressed) return;
        event.currentTarget.style.background = "transparent";
        event.currentTarget.style.color = "var(--fx-text-tertiary)";
      }}
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        width: 22,
        height: 22,
        padding: 0,
        border: "none",
        borderRadius: "var(--radius-chip)",
        background: pressed ? "var(--fx-surface-selected)" : "transparent",
        color: pressed ? "var(--fx-text-primary)" : "var(--fx-text-tertiary)",
        cursor: disabled ? "default" : "pointer",
        opacity: disabled ? 0.5 : 1,
        transition:
          "background var(--duration-quick) var(--ease-smooth-out), color var(--duration-quick) var(--ease-smooth-out)",
      }}
    >
      {children}
    </button>
  );
}
