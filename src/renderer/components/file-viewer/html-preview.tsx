import { useEffect, useState } from "react";
import { useI18n } from "@/i18n";
import { PRIMARY_ENVIRONMENT_ID, type EnvironmentId } from "@contract/environment";
import { useFileEnvironment } from "@/lib/use-file-environment";

export function HtmlPreview({
  content,
  environmentId: requestedEnvironmentId,
  filePath,
  sourceSessionId,
}: {
  content: string;
  environmentId: EnvironmentId;
  filePath: string;
  sourceSessionId?: string | null;
}) {
  const { t } = useI18n();
  const environmentId = useFileEnvironment(requestedEnvironmentId);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [previewError, setPreviewError] = useState<string | null>(null);

  useEffect(() => {
    if (environmentId !== PRIMARY_ENVIRONMENT_ID) return;
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
  }, [environmentId, content, filePath, sourceSessionId]);

  if (environmentId !== PRIMARY_ENVIRONMENT_ID) {
    return (
      <div style={{ display: "flex", flexDirection: "column", height: "100%" }}>
        <p className="type-meta-default" style={{ padding: "6px 10px", color: "var(--fx-text-tertiary)" }}>
          {t(
            "remoteHtmlPreviewInlineOnly",
            "Remote HTML preview shows inline content only. Linked assets and scripts are not loaded.",
          )}
        </p>
        <iframe
          srcDoc={`<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; img-src data:; base-uri 'none'; form-action 'none'">${content}`}
          sandbox=""
          referrerPolicy="no-referrer"
          style={{ display: "block", width: "100%", flex: 1, border: "none", background: "var(--fx-surface-main)" }}
          title={t("htmlPreview", "HTML preview")}
        />
      </div>
    );
  }

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
