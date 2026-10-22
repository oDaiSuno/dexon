import { useEffect, useState } from "react";
import type { ChannelBinding, ChannelsSnapshot } from "@shared/channel-types";
import type { SessionInfo } from "@contract/types";
import { call } from "@/lib/api-client";
import { useI18n } from "@/i18n";
import { channelLabel } from "./channel-labels";
import { buttonStyle, inputStyle } from "./control-styles";
import { EmptyLine, Section } from "./section-layout";

export function BindingsSection({
  snapshot,
  sessions,
  busy,
  run,
}: {
  snapshot: ChannelsSnapshot;
  sessions: SessionInfo[];
  busy: boolean;
  run: (task: () => Promise<unknown>) => Promise<void>;
}) {
  const { t } = useI18n();
  return (
    <Section title={`${t("conversationBindings", "Conversation bindings")} (${snapshot.bindings.length})`}>
      {snapshot.bindings.length === 0 ? (
        <EmptyLine>
          {t("noConversationBindings", "A binding is created after an approved user sends the first message.")}
        </EmptyLine>
      ) : (
        snapshot.bindings.map((binding) => (
          <BindingRow key={binding.id} binding={binding} sessions={sessions} busy={busy} run={run} />
        ))
      )}
    </Section>
  );
}

function BindingRow({
  binding,
  sessions,
  busy,
  run,
}: {
  binding: ChannelBinding;
  sessions: SessionInfo[];
  busy: boolean;
  run: (task: () => Promise<unknown>) => Promise<void>;
}) {
  const { t } = useI18n();
  const [sessionId, setSessionId] = useState(binding.sessionId ?? "");
  useEffect(() => setSessionId(binding.sessionId ?? ""), [binding.sessionId]);
  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: "minmax(150px,1fr) minmax(220px,2fr) auto",
        alignItems: "center",
        gap: 8,
        padding: "8px 0",
        borderBottom: "1px solid var(--fx-line-default)",
      }}
    >
      <div
        style={{
          fontSize: "var(--text-meta)",
          color: "var(--fx-text-secondary)",
          overflow: "hidden",
          textOverflow: "ellipsis",
        }}
      >
        {channelLabel(binding.channel, t)} · {binding.peerId}
        {binding.threadId ? ` · ${t("topic", "topic")} ${binding.threadId}` : ""}
      </div>
      <select style={inputStyle} value={sessionId} onChange={(event) => setSessionId(event.target.value)}>
        <option value="">{t("dedicatedImSession", "Dedicated IM session")}</option>
        {sessions.map((session) => (
          <option key={session.id} value={session.id}>
            {session.name || session.firstMessage || session.id}
          </option>
        ))}
      </select>
      <div style={{ display: "flex", gap: 4 }}>
        <button
          disabled={busy}
          style={buttonStyle()}
          onClick={() =>
            void run(() =>
              call("channels.bindingUpsert", {
                binding: { ...binding, sessionId: sessionId || undefined, lastUsedAt: new Date().toISOString() },
              }),
            )
          }
        >
          {t("save", "Save")}
        </button>
        <button
          disabled={busy}
          style={{ ...buttonStyle(), color: "var(--fx-status-danger)" }}
          onClick={() => void run(() => call("channels.bindingDelete", { bindingId: binding.id }))}
          title={t("deleteBinding", "Delete binding")}
          aria-label={t("deleteBinding", "Delete binding")}
        >
          ×
        </button>
      </div>
    </div>
  );
}
