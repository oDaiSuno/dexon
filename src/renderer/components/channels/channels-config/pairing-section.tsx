import type { ChannelsSnapshot } from "@shared/channel-types";
import { call } from "@/lib/api-client";
import { useI18n } from "@/i18n";
import { channelLabel } from "./channel-labels";
import { buttonStyle } from "./control-styles";
import { EmptyLine, Section } from "./section-layout";

export function PairingSection({
  snapshot,
  busy,
  run,
}: {
  snapshot: ChannelsSnapshot;
  busy: boolean;
  run: (task: () => Promise<unknown>) => Promise<void>;
}) {
  const { language, t } = useI18n();
  return (
    <Section title={`${t("pairingRequests", "Pairing requests")} (${snapshot.pairings.length})`}>
      {snapshot.pairings.length === 0 ? (
        <EmptyLine>{t("noPairingRequests", "No pending requests.")}</EmptyLine>
      ) : (
        snapshot.pairings.map((pairing) => (
          <div
            key={pairing.id}
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              gap: 12,
              padding: "8px 0",
              borderBottom: "1px solid var(--fx-line-default)",
            }}
          >
            <div style={{ fontSize: "var(--text-label)", color: "var(--fx-text-secondary)" }}>
              <div>
                {channelLabel(
                  pairing.channel,
                  t,
                  snapshot.accounts.find((account) => account.id === pairing.accountId)?.domain,
                )}{" "}
                · {pairing.peerId}
              </div>
              <div style={{ color: "var(--fx-text-tertiary)", marginTop: 4 }}>
                {t("pairingCode", "Code")} {pairing.code} · {t("expiresAt", "expires")}{" "}
                {new Date(pairing.expiresAt).toLocaleTimeString(language)}
              </div>
            </div>
            <div style={{ display: "flex", gap: 8 }}>
              <button
                disabled={busy}
                style={buttonStyle(true)}
                onClick={() => void run(() => call("channels.pairingApprove", { pairingId: pairing.id }))}
              >
                {t("approve", "Approve")}
              </button>
              <button
                disabled={busy}
                style={buttonStyle()}
                onClick={() => void run(() => call("channels.pairingReject", { pairingId: pairing.id }))}
              >
                {t("reject", "Reject")}
              </button>
            </div>
          </div>
        ))
      )}
    </Section>
  );
}
