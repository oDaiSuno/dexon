import { useState } from "react";
import type { ChannelsSnapshot } from "@shared/channel-types";
import { useI18n } from "@/i18n";
import { Button } from "../../form-controls";
import { ActivityRow } from "./activity-row";
import { EmptyLine, SectionHeader } from "./section-layout";

const LATEST_COUNT = 12;

export function ActivitySection({ snapshot }: { snapshot: ChannelsSnapshot }) {
  const { t } = useI18n();
  const [showAll, setShowAll] = useState(false);
  const visibleActivities = showAll ? snapshot.activities : snapshot.activities.slice(0, LATEST_COUNT);

  return (
    <section style={{ display: "flex", flexDirection: "column", gap: 12, width: "100%" }}>
      <SectionHeader
        title={t("recentActivity", "Recent activity")}
        count={t("recentActivityDescription", "Message content isn't logged; only the latest 100 are kept")}
      />
      <div
        data-testid="channel-activity-log"
        style={{
          width: "100%",
          border: "1px solid var(--fx-line-default)",
          borderRadius: "var(--radius-resource-card)",
          background: "var(--fx-surface-inset)",
          padding: "6px 0",
        }}
      >
        {snapshot.activities.length === 0 ? (
          <EmptyLine>{t("noChannelActivity", "No channel activity yet.")}</EmptyLine>
        ) : (
          <ul style={{ margin: 0, padding: 0, listStyle: "none" }}>
            {visibleActivities.map((activity) => (
              <ActivityRow key={activity.id} activity={activity} snapshot={snapshot} />
            ))}
          </ul>
        )}
      </div>
      {snapshot.activities.length > LATEST_COUNT && (
        <Button variant="ghost" onClick={() => setShowAll((value) => !value)} style={{ alignSelf: "flex-start" }}>
          {showAll
            ? t("showLatestTwelve", "Show latest 12")
            : `${t("showAllActivity", "Show all")} (${snapshot.activities.length})`}
        </Button>
      )}
    </section>
  );
}
