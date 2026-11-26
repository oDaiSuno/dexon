import { useI18n } from "@/i18n";
import { Button } from "../form-controls";
import type { useComposerAttachments } from "./use-composer-attachments";

export function RemoteUploadStatus({
  attachments,
}: {
  attachments: Pick<
    ReturnType<typeof useComposerAttachments>,
    "remoteUploads" | "remoteUploadDestination" | "retryRemoteUpload"
  >;
}) {
  const { t } = useI18n();
  if (!attachments.remoteUploads.length) return null;
  return (
    <div
      role="status"
      aria-live="polite"
      className="type-label-default"
      style={{
        display: "grid",
        gap: "var(--space-1)",
        padding: "var(--space-2) var(--space-3)",
        color: "var(--fx-text-secondary)",
      }}
    >
      {attachments.remoteUploads.map((upload) => (
        <div key={upload.id} style={{ display: "flex", alignItems: "center", gap: "var(--space-2)" }}>
          <span style={{ flex: 1, minWidth: 0, overflowWrap: "anywhere" }}>
            {upload.file.name} ·{" "}
            {(upload.status === "uploading"
              ? t("remoteAttachmentUploading", "Uploading to {environment}")
              : t("remoteAttachmentUploadFailed", "Upload to {environment} failed")
            ).replace("{environment}", attachments.remoteUploadDestination)}
            {upload.message && ` · ${upload.message}`}
          </span>
          {upload.status === "failed" && (
            <Button variant="ghost" onClick={() => attachments.retryRemoteUpload(upload.id)}>
              {t("retry", "Retry")}
            </Button>
          )}
        </div>
      ))}
    </div>
  );
}
