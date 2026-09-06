import { type NoticeItem } from "@/hooks/useAgentSession";
import { scaledChatFont } from "@/lib/chat-appearance";
export function ExtensionStatusBar({ statuses }: { statuses: Array<{ key: string; text: string }> }) {
  if (statuses.length === 0) return null;
  return (
    <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginBottom: 12 }}>
      {statuses.map((status) => (
        <div
          key={status.key}
          style={{
            display: "flex",
            alignItems: "center",
            gap: 8,
            maxWidth: "100%",
            padding: "4px 8px",
            border: "1px solid color-mix(in srgb, var(--accent) 24%, var(--border))",
            borderRadius: "var(--radius-control)",
            background: "color-mix(in srgb, var(--accent) 7%, var(--bg))",
            color: "var(--text-muted)",
            fontSize: scaledChatFont(12),
          }}
        >
          <span style={{ color: "var(--accent)", fontFamily: "var(--font-mono)", fontSize: scaledChatFont(11) }}>
            {status.key}
          </span>
          <span style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {status.text}
          </span>
        </div>
      ))}
    </div>
  );
}
export function ExtensionWidgets({ widgets }: { widgets: Array<{ key: string; lines: string[] }> }) {
  if (widgets.length === 0) return null;
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8, marginBottom: 12 }}>
      {widgets.map((widget) => (
        <div
          key={widget.key}
          style={{
            border: "1px solid var(--border)",
            borderRadius: "var(--radius-card)",
            background: "var(--bg-panel)",
            overflow: "hidden",
          }}
        >
          <div
            style={{
              padding: "4px 8px",
              borderBottom: "1px solid var(--border)",
              color: "var(--text-dim)",
              fontSize: scaledChatFont(11),
              fontFamily: "var(--font-mono)",
            }}
          >
            {widget.key}
          </div>
          <pre
            style={{
              margin: 0,
              padding: "8px 8px",
              color: "var(--text-muted)",
              fontSize: scaledChatFont(12),
              lineHeight: 1.5,
              whiteSpace: "pre-wrap",
              wordBreak: "break-word",
              fontFamily: "var(--font-mono)",
            }}
          >
            {widget.lines.join("\n")}
          </pre>
        </div>
      ))}
    </div>
  );
}
export function NoticeShelf({
  notices,
  floating = false,
  align = "left",
}: {
  notices: NoticeItem[];
  floating?: boolean;
  align?: "left" | "right" | "center";
}) {
  if (notices.length === 0) return null;
  const alignItems = align === "right" ? "flex-end" : align === "center" ? "center" : "stretch";
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems,
        marginBottom: floating ? 0 : 10,
      }}
    >
      {notices.map((notice, index) => {
        const color =
          notice.type === "error"
            ? "var(--bui-red)"
            : notice.type === "warning"
              ? "var(--bui-orange)"
              : notice.type === "success"
                ? "var(--bui-green)"
                : "var(--bui-accent)";
        return (
          <div
            key={notice.id}
            className="notice-shelf-item"
            style={{
              display: "flex",
              alignItems: "center",
              gap: 12,
              minHeight: 60,
              height: 60,
              maxHeight: 60,
              marginBottom: index === notices.length - 1 ? 0 : 6,
              overflow: "hidden",
              borderRadius: "var(--bui-r-card)",
              border: "1px solid var(--bui-line)",
              background: "var(--bui-surface)",
              color: "var(--bui-ink-2)",
              width: "fit-content",
              maxWidth: "min(100%, 620px)",
              boxShadow: floating ? "var(--bui-shadow-card)" : "var(--bui-shadow-btn)",
              fontSize: "var(--text-heading-lg)",
              lineHeight: 1.45,
              transformOrigin: "top center",
              animation: notice.exiting
                ? "notice-shelf-out var(--duration-pop, 180ms) var(--ease-in-out) forwards"
                : "notice-shelf-in var(--duration-pop, 180ms) var(--ease-smooth-out) both",
              padding: "0 12px",
            }}
          >
            <span
              style={{
                width: 7,
                height: 7,
                borderRadius: "50%",
                background: color,
                flexShrink: 0,
              }}
            />
            <span
              style={{
                padding: "16px 0",
                minWidth: 0,
                maxWidth: "100%",
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
              }}
            >
              {notice.message}
            </span>
          </div>
        );
      })}
    </div>
  );
}
