import { useState } from "react";
import type { ChannelBinding, ChannelsSnapshot } from "@shared/channel-types";
import type { SessionInfo } from "@contract/types";
import { call } from "@/lib/api-client";
import { useI18n } from "@/i18n";
import { bindingMatches } from "./binding-presentation";
import { BindingRow } from "./binding-row";
import { EmptyLine, SectionCard, SectionHeader } from "./section-layout";

export function BindingsSection({
  snapshot,
  sessions,
  currentSessionId,
  busy,
  run,
}: {
  snapshot: ChannelsSnapshot;
  sessions: SessionInfo[];
  currentSessionId?: string | null;
  busy: boolean;
  run: (task: () => Promise<unknown>) => Promise<void>;
}) {
  const { t } = useI18n();
  const [query, setQuery] = useState("");
  const sessionOf = (binding: ChannelBinding) => sessions.find((session) => session.id === binding.sessionId);
  const visible = snapshot.bindings.filter((binding) => bindingMatches(binding, sessionOf(binding), query));
  const searchLabel = t("searchConversations", "Search conversations…");

  const attach = (binding: ChannelBinding, sessionId: string | undefined) =>
    void run(() =>
      call("channels.bindingUpsert", {
        binding: { ...binding, sessionId, lastUsedAt: new Date().toISOString() },
      }),
    );

  return (
    <section style={{ display: "flex", flexDirection: "column", gap: 12, width: "100%" }}>
      <SectionHeader
        title={t("conversationBindings", "Connected conversations")}
        count={snapshot.bindings.length}
        aside={
          <input
            type="search"
            className="ui-input type-body-default"
            aria-label={searchLabel}
            placeholder={searchLabel}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            style={{ width: 200, flexShrink: 0 }}
          />
        }
      />
      <SectionCard>
        {snapshot.bindings.length === 0 || visible.length === 0 ? (
          <EmptyLine>
            {snapshot.bindings.length === 0
              ? t("noConversationBindings", "A binding is created after an approved user sends the first message.")
              : t("noMatchingConversations", "No matching conversations")}
          </EmptyLine>
        ) : (
          <ul style={{ margin: 0, padding: 0, listStyle: "none" }}>
            {visible.map((binding, index) => (
              <BindingRow
                key={binding.id}
                binding={binding}
                snapshot={snapshot}
                session={sessionOf(binding)}
                sessions={sessions}
                currentSessionId={currentSessionId}
                divider={index > 0}
                busy={busy}
                onAttach={(sessionId) => attach(binding, sessionId)}
                onDisconnect={() => void run(() => call("channels.bindingDelete", { bindingId: binding.id }))}
              />
            ))}
          </ul>
        )}
      </SectionCard>
    </section>
  );
}
