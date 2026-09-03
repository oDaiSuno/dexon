import { useI18n } from "@/i18n";
import { scaledChatFont } from "@/lib/chat-appearance";
import { FileDocIcon, ImageIcon, XIcon } from "./icons";

/**
 * Attachment token pill — the shared visual for `@path` references.
 *
 * Cursor-style compact chip: icon (or 14px thumbnail for images with a loaded
 * preview), short label, optional remove button. Used inside the composer
 * mirror overlay and in the transcript; the full path stays in the tooltip.
 */
export function AttachmentTokenPill({
  path,
  name,
  isImage,
  previewUrl,
  missing,
  size,
  onRemove,
  onClick,
}: {
  path: string;
  name: string;
  isImage: boolean;
  previewUrl: string | null;
  missing: boolean;
  size: "composer" | "transcript";
  /** Present only in the composer; clicking removes the token from the text. */
  onRemove?: () => void;
  /** Composer pills capture clicks to move the caret after the token. */
  onClick?: () => void;
}) {
  const { t } = useI18n();
  const fontSize = scaledChatFont(size === "composer" ? 11.5 : 11.5);
  const removeTitle = t("remove", "Remove");
  const missingTitle = missing ? t("attachmentTokenMissing", "File is missing or was cleared from temp storage") : "";
  return (
    <span
      title={`${path}${missingTitle ? ` — ${missingTitle}` : ""}`}
      onClick={onClick}
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 4,
        height: 19,
        maxWidth: 236,
        padding: "0 5px 0 4px",
        borderRadius: 6,
        border: `1px solid ${missing ? "var(--danger)" : "var(--border)"}`,
        background: "var(--bg-panel)",
        color: "var(--text-dim)",
        fontSize,
        lineHeight: "16px",
        whiteSpace: "nowrap",
        userSelect: "none",
        // Middle-align on the box midpoint: length-based values synthesize the
        // inline baseline from the first flex item, which differs between img
        // thumbnails and svg glyphs and staggered chips on one line.
        verticalAlign: "middle",
        position: "relative",
        top: "-0.05em",
        cursor: onClick ? "pointer" : undefined,
        pointerEvents: onRemove || onClick ? "auto" : undefined,
      }}
    >
      {isImage && previewUrl ? (
        <img
          src={previewUrl}
          alt=""
          style={{
            width: 14,
            height: 14,
            objectFit: "cover",
            borderRadius: 3,
            border: "1px solid var(--border)",
            display: "block",
            flexShrink: 0,
            background: "var(--bg-panel)",
          }}
        />
      ) : isImage ? (
        <ImageIcon size={11} />
      ) : (
        <FileDocIcon size={10} />
      )}
      <span style={{ overflow: "hidden", textOverflow: "ellipsis" }}>{name}</span>
      {onRemove && (
        <button
          onClick={(event) => {
            event.stopPropagation();
            onRemove();
          }}
          title={removeTitle}
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            width: 13,
            height: 13,
            padding: 0,
            borderRadius: "50%",
            border: "none",
            background: "transparent",
            color: "var(--text-muted)",
            opacity: 0.7,
            cursor: "pointer",
            flexShrink: 0,
          }}
        >
          <XIcon size={6} strokeWidth={1.8} />
        </button>
      )}
    </span>
  );
}
