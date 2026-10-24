import type { ChannelPairingRequest, ChannelsSnapshot } from "@shared/channel-types";
import { call } from "@/lib/api-client";
import { useI18n } from "@/i18n";
import { Button } from "../../form-controls";
import { ChannelBrandMark } from "../channel-brand-mark";
import { channelLabel } from "./channel-labels";
import { formatPairingCode, initialOf } from "./channel-presentation";

function PairingRow({
  pairing,
  snapshot,
  divider,
  busy,
  run,
}: {
  pairing: ChannelPairingRequest;
  snapshot: ChannelsSnapshot;
  divider: boolean;
  busy: boolean;
  run: (task: () => Promise<unknown>) => Promise<void>;
}) {
  const { language, t } = useI18n();
  const name = pairing.displayName?.trim() || pairing.peerId;
  const domain = snapshot.accounts.find((account) => account.id === pairing.accountId)?.domain;
  const app = channelLabel(pairing.channel, t, domain);
  const expires = new Date(pairing.expiresAt).toLocaleTimeString(language);
  return (
    <li
      data-testid="channel-pairing-request"
      style={{
        display: "flex",
        alignItems: "center",
        gap: 12,
        padding: "12px 12px 12px 16px",
        borderTop: divider ? "1px solid var(--fx-status-warning-border)" : undefined,
      }}
    >
      <span
        aria-hidden="true"
        className="type-body-medium"
        style={{
          width: 32,
          height: 32,
          flexShrink: 0,
          display: "inline-flex",
          alignItems: "center",
          justifyContent: "center",
          border: "1px solid var(--fx-line-default)",
          borderRadius: "var(--radius-pill)",
          background: "var(--fx-surface-raised)",
          color: "var(--fx-text-secondary)",
        }}
      >
        {initialOf(name)}
      </span>
      <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: 2 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, minWidth: 0 }}>
          <span className="type-body-medium" style={{ color: "var(--fx-text-primary)" }} title={pairing.peerId}>
            {t("pairingRequestTitle", "{name} wants to chat with Dexon via {app}")
              .replace("{name}", name)
              .replace("{app}", app)}
          </span>
          <ChannelBrandMark channel={pairing.channel} size={14} />
        </div>
        <span className="type-label-default" style={{ color: "var(--fx-text-secondary)" }}>
          {t(
            "pairingRequestHint",
            "Allow only if the pairing code matches the one they show you. Once allowed, they can have the Agent read and write your projects.",
          )}
        </span>
      </div>
      <span
        className="type-mono-label"
        aria-label={`${t("pairingCode", "Code")} ${pairing.code}`}
        title={`${t("expiresAt", "expires")} ${expires}`}
        style={{
          flexShrink: 0,
          padding: "4px 8px",
          border: "1px solid var(--fx-status-warning-border)",
          borderRadius: "var(--radius-chip)",
          background: "var(--fx-surface-raised)",
          color: "var(--fx-text-primary)",
          whiteSpace: "nowrap",
        }}
      >
        {formatPairingCode(pairing.code)}
      </span>
      <Button
        variant="ghost"
        disabled={busy}
        onClick={() => void run(() => call("channels.pairingReject", { pairingId: pairing.id }))}
      >
        {t("reject", "Reject")}
      </Button>
      <Button
        variant="primary"
        disabled={busy}
        onClick={() => void run(() => call("channels.pairingApprove", { pairingId: pairing.id }))}
      >
        {t("approve", "Allow")}
      </Button>
    </li>
  );
}

export function PairingSection({
  snapshot,
  busy,
  run,
}: {
  snapshot: ChannelsSnapshot;
  busy: boolean;
  run: (task: () => Promise<unknown>) => Promise<void>;
}) {
  const { t } = useI18n();
  if (snapshot.pairings.length === 0) return null;
  return (
    <section
      aria-label={t("pairingRequests", "Pairing requests")}
      style={{
        width: "100%",
        border: "1px solid var(--fx-status-warning-border)",
        borderRadius: "var(--radius-pairing-card)",
        background: "var(--fx-status-warning-soft)",
      }}
    >
      <ul style={{ margin: 0, padding: 0, listStyle: "none" }}>
        {snapshot.pairings.map((pairing, index) => (
          <PairingRow
            key={pairing.id}
            pairing={pairing}
            snapshot={snapshot}
            divider={index > 0}
            busy={busy}
            run={run}
          />
        ))}
      </ul>
    </section>
  );
}
