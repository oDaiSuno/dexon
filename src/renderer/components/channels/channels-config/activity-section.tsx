import { useState } from "react";
import type { ChannelsSnapshot } from "@shared/channel-types";
import { useI18n } from "@/i18n";
import { activityDirectionLabel, activityOutcomeLabel, channelLabel } from "./channel-labels";
import { buttonStyle } from "./control-styles";
import { EmptyLine } from "./section-layout";

export function ActivitySection({ snapshot }: { snapshot: ChannelsSnapshot }) {
  const { language, t } = useI18n();
  const [expanded, setExpanded] = useState(false);
  const [showAll, setShowAll] = useState(false);
  const visibleActivities = showAll ? snapshot.activities : snapshot.activities.slice(0, 12);
  return (
    <section
      style={{
        marginTop: 24,
        border: "1px solid var(--fx-line-default)",
        borderRadius: "var(--radius-card)",
        background: "var(--fx-surface-raised)",
        padding: "4px 16px",
      }}
    >
      <button
        type="button"
        data-testid="channel-activity-toggle"
        aria-expanded={expanded}
        onClick={() => setExpanded((value) => !value)}
        style={{
          width: "100%",
          minHeight: 50,
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 12,
          padding: 0,
          border: 0,
          background: "none",
          color: "var(--fx-text-primary)",
          cursor: "pointer",
          textAlign: "left",
        }}
      >
        <span>
          <span style={{ display: "block", fontSize: "var(--text-label)", fontWeight: 700 }}>
            {t("recentActivity", "Recent activity")} ({snapshot.activities.length})
          </span>
          <span
            style={{ display: "block", marginTop: 4, fontSize: "var(--text-micro)", color: "var(--fx-text-tertiary)" }}
          >
            {t("recentActivityDescription", "Message content is never logged; the latest 100 records are retained.")}
          </span>
        </span>
        <span
          aria-hidden="true"
          style={{
            color: "var(--fx-text-tertiary)",
            fontSize: "var(--text-title)",
            transform: expanded ? "rotate(180deg)" : "none",
            transition: "transform .15s ease",
          }}
        >
          ▾
        </span>
      </button>

      {expanded && (
        <div style={{ borderTop: "1px solid var(--fx-line-default)", paddingBottom: 8 }}>
          {snapshot.activities.length === 0 ? (
            <EmptyLine>{t("noChannelActivity", "No channel activity yet.")}</EmptyLine>
          ) : (
            visibleActivities.map((activity) => (
              <div
                key={activity.id}
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  gap: 12,
                  padding: "8px 0",
                  borderBottom: "1px solid var(--fx-line-default)",
                  fontSize: "var(--text-meta)",
                }}
              >
                <span
                  style={{
                    color: activity.outcome === "failed" ? "var(--fx-status-danger)" : "var(--fx-text-secondary)",
                  }}
                >
                  {channelLabel(activity.channel, t)} · {activityDirectionLabel(activity.direction, t)} ·{" "}
                  {activityOutcomeLabel(activity.outcome, t)}
                  {activity.peerId ? ` · ${activity.peerId}` : ""}
                  {activity.detail ? ` · ${activity.detail}` : ""}
                </span>
                <span style={{ color: "var(--fx-text-tertiary)", whiteSpace: "nowrap" }}>
                  {new Date(activity.at).toLocaleString(language)}
                </span>
              </div>
            ))
          )}
          {snapshot.activities.length > 12 && (
            <button
              type="button"
              style={{ ...buttonStyle(), marginTop: 8 }}
              onClick={() => setShowAll((value) => !value)}
            >
              {showAll
                ? t("showLatestTwelve", "Show latest 12")
                : `${t("showAllActivity", "Show all")} (${snapshot.activities.length})`}
            </button>
          )}
        </div>
      )}
    </section>
  );
}
