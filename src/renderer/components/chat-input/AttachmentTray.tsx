import { useI18n } from "@/i18n";
import { scaledChatFont } from "@/lib/chat-appearance";
import { localFilePathKey, type LocalFileReference } from "@/lib/file-url";
import type { AttachedImage } from "../ChatInput";
import { FileDocIcon, XIcon } from "./icons";

export interface FileInspection {
  exists: boolean;
  isFile: boolean;
  insideCwd: boolean;
}

/**
 * Images + local file references rendered INSIDE the composer shell, above
 * the input row. Pure presentation: removal, reveal-in-folder and the context
 * menu stay wired by the parent.
 */
export function AttachmentTray({
  images,
  files,
  fileInspectionByPath,
  onRemoveImage,
  onRemoveFile,
  onContextMenuUnavailable,
  cwd,
  language,
}: {
  images: AttachedImage[];
  files: LocalFileReference[];
  fileInspectionByPath: Map<string, FileInspection>;
  onRemoveImage: (index: number) => void;
  onRemoveFile: (index: number) => void;
  onContextMenuUnavailable: () => void;
  cwd?: string | null;
  language: "en-US" | "zh-CN";
}) {
  const { t } = useI18n();
  const hasContent = images.length > 0 || files.length > 0;
  if (!hasContent) return null;
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      {images.length > 0 && (
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          {images.map((img, i) => (
            <div key={i} className="composer-pop-in" style={{ position: "relative", flexShrink: 0 }}>
              <img
                src={img.previewUrl}
                alt=""
                style={{
                  width: 56,
                  height: 56,
                  objectFit: "cover",
                  borderRadius: "var(--radius-control)",
                  border: "1px solid var(--border)",
                  display: "block",
                }}
              />
              <button
                onClick={() => onRemoveImage(i)}
                title={t("remove", "Remove")}
                style={{
                  position: "absolute",
                  top: -4,
                  right: -4,
                  width: 16,
                  height: 16,
                  borderRadius: "50%",
                  background: "var(--bg-panel)",
                  border: "1px solid var(--border)",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  cursor: "pointer",
                  padding: 0,
                  color: "var(--text-muted)",
                }}
              >
                <XIcon size={8} strokeWidth={1.5} />
              </button>
            </div>
          ))}
        </div>
      )}

      {files.length > 0 && (
        <div>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            {files.map((file, i) => (
              <div
                key={`${file.path}-${i}`}
                className="composer-pop-in"
                title={`${file.path}${
                  fileInspectionByPath.get(localFilePathKey(file.path))?.insideCwd === false
                    ? ` — ${t("outsideProject", "Outside project")}`
                    : ""
                }`}
                onClick={() => void window.piBridge?.showItemInFolder?.(file.path)}
                onContextMenu={(event) => {
                  event.preventDefault();
                  const request = window.piBridge.showFileContextMenu({
                    href: file.path,
                    cwd: cwd ?? undefined,
                    source: "local-file-reference",
                    language,
                  });
                  void request
                    .then((result) => {
                      if (!result.shown) onContextMenuUnavailable();
                    })
                    .catch(() => {
                      onContextMenuUnavailable();
                    });
                }}
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 8,
                  maxWidth: 260,
                  padding: "4px 8px 4px 8px",
                  borderRadius: "var(--radius-control)",
                  border: `1px solid ${
                    fileInspectionByPath.get(localFilePathKey(file.path))?.exists === false
                      ? "var(--danger)"
                      : "var(--border)"
                  }`,
                  background: "var(--bg-panel)",
                  cursor: "pointer",
                  fontSize: scaledChatFont(12),
                }}
              >
                <FileDocIcon size={12} />
                <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{file.name}</span>
                {fileInspectionByPath.get(localFilePathKey(file.path))?.insideCwd === false && (
                  <span style={{ color: "var(--warning)", fontSize: scaledChatFont(10), whiteSpace: "nowrap" }}>
                    {t("outsideProject", "Outside project")}
                  </span>
                )}
                <button
                  onClick={(event) => {
                    event.stopPropagation();
                    onRemoveFile(i);
                  }}
                  title={t("remove", "Remove")}
                  style={{
                    width: 16,
                    height: 16,
                    borderRadius: "50%",
                    background: "transparent",
                    border: "none",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    cursor: "pointer",
                    padding: 0,
                    color: "var(--text-muted)",
                    flexShrink: 0,
                  }}
                >
                  <XIcon size={8} strokeWidth={1.5} />
                </button>
              </div>
            ))}
          </div>
          <div style={{ marginTop: 4, fontSize: scaledChatFont(10.5), color: "var(--text-dim)" }}>
            {t(
              "localFileDraftPrivacy",
              "Local file paths stay on this device and are saved with this session draft until it is sent or removed.",
            )}
          </div>
        </div>
      )}
    </div>
  );
}
