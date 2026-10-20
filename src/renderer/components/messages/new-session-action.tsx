import { scaledChatFont } from "@/lib/chat-appearance";

export function NewSessionAction({
  entryId,
  onFork,
  forking,
  hovered,
}: {
  entryId: string;
  onFork: (entryId: string) => void;
  forking?: boolean;
  hovered?: boolean;
}) {
  return (
    <button
      type="button"
      className="message-hover-action"
      onClick={() => onFork(entryId)}
      disabled={forking}
      title={forking ? "Creating new session…" : "New session — continue in a new session that includes this answer"}
      style={{
        display: "flex",
        alignItems: "center",
        gap: 4,
        padding: "2px 7px",
        height: 24,
        background: "none",
        border: "none",
        borderRadius: "var(--bui-r-chip)",
        color: forking ? "var(--bui-accent)" : "var(--bui-ink-3)",
        cursor: forking ? "not-allowed" : "pointer",
        fontSize: scaledChatFont(11),
        fontWeight: 400,
        whiteSpace: "nowrap",
        opacity: hovered || forking ? 1 : 0,
        pointerEvents: hovered || forking ? "auto" : "none",
        transition: "opacity var(--duration-quick) var(--ease-out), color var(--duration-quick) var(--ease-out)",
      }}
      onMouseEnter={(e) => {
        if (!forking) e.currentTarget.style.color = "var(--bui-accent)";
      }}
      onMouseLeave={(e) => {
        if (!forking) e.currentTarget.style.color = "var(--bui-ink-3)";
      }}
    >
      <svg
        width="12"
        height="12"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <line x1="6" y1="3" x2="6" y2="15" />
        <circle cx="18" cy="6" r="3" />
        <circle cx="6" cy="18" r="3" />
        <path d="M18 9a9 9 0 0 1-9 9" />
      </svg>
      {forking ? "Creating…" : "New session"}
    </button>
  );
}
