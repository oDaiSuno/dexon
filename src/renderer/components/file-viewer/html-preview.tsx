import { useEffect, useState } from "react";
import { useI18n } from "@/i18n";

export function HtmlPreview({
  content,
  filePath,
  sourceSessionId,
}: {
  content: string;
  filePath: string;
  sourceSessionId?: string | null;
}) {
  const { t } = useI18n();
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [previewError, setPreviewError] = useState<string | null>(null);

  useEffect(() => {
    let disposed = false;
    let activeUrl: string | null = null;
    setPreviewUrl(null);
    setPreviewError(null);

    void window.piBridge
      .createHtmlPreview(content, filePath, sourceSessionId)
      .then((url) => {
        if (disposed) {
          void window.piBridge.releaseHtmlPreview(url).catch(() => {});
          return;
        }
        activeUrl = url;
        setPreviewUrl(url);
      })
      .catch((error) => {
        if (!disposed) setPreviewError(error instanceof Error ? error.message : String(error));
      });

    return () => {
      disposed = true;
      if (activeUrl) void window.piBridge.releaseHtmlPreview(activeUrl).catch(() => {});
    };
  }, [content, filePath, sourceSessionId]);

  if (previewError) {
    return (
      <div
        role="alert"
        style={{
          height: "100%",
          display: "grid",
          placeItems: "center",
          padding: 20,
          color: "var(--fx-status-danger)",
          fontSize: "var(--text-body)",
          textAlign: "center",
        }}
      >
        {t("htmlPreviewFailed", "HTML preview could not be created: {error}").replace("{error}", previewError)}
      </div>
    );
  }

  if (!previewUrl) return null;

  return (
    <iframe
      key={previewUrl}
      src={previewUrl}
      sandbox="allow-scripts"
      referrerPolicy="no-referrer"
      style={{ display: "block", width: "100%", height: "100%", border: "none", background: "var(--fx-surface-main)" }}
      title={t("htmlPreview", "HTML preview")}
    />
  );
}
