import { useState } from "react";
import { getFileName } from "@/lib/file-paths";
import { useI18n } from "@/i18n";

export function DownloadLink({ filePath, sourceSessionId }: { filePath: string; sourceSessionId?: string | null }) {
  const { t } = useI18n();
  const [busy, setBusy] = useState(false);
  return (
    <button
      type="button"
      title={t("downloadFile", "Download file")}
      aria-label={t("downloadFile", "Download file")}
      disabled={busy}
      onClick={() => {
        setBusy(true);
        void import("@/lib/file-blob")
          .then(({ downloadFileViaRpc }) => downloadFileViaRpc(filePath, getFileName(filePath), sourceSessionId))
          .catch((e) => console.error("download failed", e))
          .finally(() => setBusy(false));
      }}
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        width: 32,
        height: 32,
        padding: 0,
        background: "var(--fx-surface-raised)",
        border: "1px solid var(--fx-line-default)",
        borderRadius: "var(--radius-chip)",
        color: "var(--fx-text-secondary)",
        cursor: busy ? "wait" : "pointer",
        flexShrink: 0,
      }}
    >
      <svg
        width="11"
        height="11"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2.2"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
      >
        <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
        <polyline points="7 10 12 15 17 10" />
        <line x1="12" y1="15" x2="12" y2="3" />
      </svg>
    </button>
  );
}
