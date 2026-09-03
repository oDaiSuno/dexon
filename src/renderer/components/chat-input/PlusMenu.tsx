import { useI18n } from "@/i18n";
import { scaledChatFont } from "@/lib/chat-appearance";
import { ImageIcon, PaperclipIcon } from "./icons";

/** "＋" expand menu above the composer: one row per attachment entry
 *  point. Flat card tokens shared with the @ and / menus. */
export function PlusMenu({ onPickImages, onPickFiles }: { onPickImages: () => void; onPickFiles: () => void }) {
  const { t } = useI18n();
  const rows = [
    {
      key: "images",
      name: t("plusAttachImages", "Add photos"),
      desc: t("plusAttachImagesDesc", "Attach images from this computer"),
      icon: <ImageIcon size={15} />,
      action: onPickImages,
    },
    {
      key: "files",
      name: t("plusAttachFiles", "Add files"),
      desc: t("plusAttachFilesDesc", "Reference local files by path"),
      icon: <PaperclipIcon size={15} />,
      action: onPickFiles,
    },
  ];
  return (
    <div
      className="composer-pop-in"
      role="menu"
      style={{
        position: "absolute",
        left: 0,
        bottom: "calc(100% + 8px)",
        zIndex: 120,
        width: 264,
        background: "var(--bg)",
        border: "1px solid var(--border)",
        borderRadius: "var(--radius-card)",
        boxShadow: "0 -6px 20px rgba(0,0,0,0.12)",
        padding: 4,
        transformOrigin: "bottom left",
      }}
    >
      {rows.map((row) => (
        <button
          key={row.key}
          type="button"
          role="menuitem"
          onMouseDown={(e) => {
            e.preventDefault();
            row.action();
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.background = "var(--bg-selected)";
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.background = "none";
          }}
          style={{
            width: "100%",
            display: "flex",
            alignItems: "center",
            gap: 10,
            padding: "7px 8px",
            border: "none",
            borderRadius: "var(--radius-control)",
            background: "none",
            cursor: "pointer",
            textAlign: "left",
          }}
        >
          <span
            style={{
              flexShrink: 0,
              width: 28,
              height: 28,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              borderRadius: "var(--radius-control)",
              background: "var(--bg-hover)",
              color: "var(--text-muted)",
            }}
          >
            {row.icon}
          </span>
          <span style={{ minWidth: 0 }}>
            <span
              style={{
                display: "block",
                fontSize: scaledChatFont(12.5),
                fontWeight: 500,
                color: "var(--text)",
              }}
            >
              {row.name}
            </span>
            <span
              style={{
                display: "block",
                fontSize: scaledChatFont(11),
                color: "var(--text-dim)",
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
              }}
            >
              {row.desc}
            </span>
          </span>
        </button>
      ))}
    </div>
  );
}
