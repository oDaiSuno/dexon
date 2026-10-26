import { useState } from "react";
import { Button } from "../form-controls";
import { useI18n } from "@/i18n";
import type { ProviderChannelState } from "@contract/types";
import { useChannelStatus } from "./channel-status";
import { StatusDot } from "./provider-tree";

function ZapIcon() {
  return (
    <svg
      aria-hidden="true"
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M4 14a1 1 0 0 1-.78-1.63l9.9-10.2a.5.5 0 0 1 .86.46l-1.92 6.02A1 1 0 0 0 13 10h7a1 1 0 0 1 .78 1.63l-9.9 10.2a.5.5 0 0 1-.86-.46l1.92-6.02A1 1 0 0 0 11 14z" />
    </svg>
  );
}

export function ChannelTestRow({
  channel,
  onTest,
  blockedReason,
}: {
  channel: ProviderChannelState | undefined;
  onTest: () => Promise<void>;
  blockedReason?: string;
}) {
  const { t } = useI18n();
  const { status, testSummary } = useChannelStatus();
  const [testing, setTesting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const lastTest = channel?.lastTest;
  const summary = testSummary(lastTest);

  const run = async () => {
    setTesting(true);
    setError(null);
    try {
      await onTest();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setTesting(false);
    }
  };

  return (
    <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
      <Button onClick={() => void run()} disabled={testing || !!blockedReason} busy={testing} title={blockedReason}>
        <ZapIcon />
        {testing ? t("testingConnection", "Testing…") : t("testConnection", "Test connection")}
      </Button>
      {summary && lastTest && (
        <>
          <StatusDot tone={status({ enabled: true, lastTest }).tone} />
          <span
            role="status"
            className="type-body-default"
            style={{
              flex: 1,
              minWidth: 0,
              color: "var(--fx-text-secondary)",
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
            }}
            title={summary}
          >
            {summary}
          </span>
        </>
      )}
      {error && (
        <span role="alert" className="type-body-default" style={{ color: "var(--fx-status-danger)" }}>
          {error}
        </span>
      )}
    </div>
  );
}
