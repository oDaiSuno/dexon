import type { ReactNode } from "react";
import { useI18n } from "@/i18n";
import type { ProjectActivity } from "@/lib/sidebar-activity";
import { COUNTED_ACTIVITIES, type CountedActivity } from "@/lib/session-tree-status";
import {
  ACTIVITY_TONE,
  activityCountsPhrase,
  AlertGlyph,
  LoaderGlyph,
  QuestionGlyph,
} from "../session-sidebar/session-status-indicators";

export type ProjectRowFace =
  | { readonly kind: "missing" }
  | { readonly kind: "open"; readonly totalSessions: number }
  | { readonly kind: "closed-quiet"; readonly totalSessions: number }
  | { readonly kind: "closed-unread"; readonly totalSessions: number; readonly unreadCount: number }
  | {
      readonly kind: "closed-live";
      readonly status: CountedActivity;
      readonly count: number;
      readonly totalSessions: number;
    };

export function projectRowFace(input: {
  open: boolean;
  missing: boolean;
  totalSessions: number;
  activity: ProjectActivity;
}): ProjectRowFace {
  const { open, missing, totalSessions, activity } = input;
  if (missing) return { kind: "missing" };
  if (open) return { kind: "open", totalSessions };
  const status = COUNTED_ACTIVITIES.find((candidate) => activity.sessionCounts[candidate] > 0);
  if (status) return { kind: "closed-live", status, count: activity.sessionCounts[status], totalSessions };
  if (activity.unread > 0) return { kind: "closed-unread", totalSessions, unreadCount: activity.unread };
  return { kind: "closed-quiet", totalSessions };
}

export function faceEmphasized(face: ProjectRowFace): boolean {
  return face.kind === "closed-unread" || face.kind === "closed-live";
}

export function projectRowStatusPhrase(face: ProjectRowFace, t: (key: string, fallback: string) => string): string {
  if (face.kind === "closed-unread") {
    return t("sessionCountUnread", "{count} unread").replace("{count}", String(face.unreadCount));
  }
  if (face.kind !== "closed-live") return "";
  return activityCountsPhrase({ awaiting_input: 0, error: 0, running: 0, [face.status]: face.count }, t);
}

export function ProjectRowTrail({
  face,
  countLabel,
  countId,
  statusId,
  revealed,
}: {
  face: ProjectRowFace;
  countLabel: string;
  countId: string;
  statusId: string;
  revealed: boolean;
}): ReactNode {
  const { t } = useI18n();
  if (face.kind === "missing") return null;
  const phrase = projectRowStatusPhrase(face, t);
  return (
    <>
      <span
        aria-hidden="true"
        style={{
          display: "inline-flex",
          alignItems: "center",
          flexShrink: 0,
          gap: revealed ? 0 : "var(--space-2)",
          paddingRight: revealed ? 28 : 0,
        }}
      >
        {face.kind === "closed-unread" && (
          <span
            data-activity="unread"
            style={{ width: 6, height: 6, flexShrink: 0, borderRadius: 3, background: ACTIVITY_TONE.unread.dot }}
          />
        )}
        {face.kind === "closed-live" ? (
          <ProjectLiveBadge status={face.status} count={face.count} />
        ) : (
          <span
            className="type-label-default"
            aria-hidden="true"
            style={{
              flexShrink: 0,
              color: "var(--fx-text-tertiary)",
              width: revealed ? 0 : undefined,
              overflow: "hidden",
              opacity: revealed ? 0 : 1,
              transition: "opacity var(--duration-quick) var(--ease-smooth-out)",
            }}
          >
            {face.totalSessions}
          </span>
        )}
      </span>
      <span id={countId} className="sr-only">
        {` ${countLabel}`}
      </span>
      {phrase && (
        <span id={statusId} className="sr-only">
          {phrase}
        </span>
      )}
    </>
  );
}

function ProjectLiveBadge({ status, count }: { status: CountedActivity; count: number }) {
  const tone = ACTIVITY_TONE[status];
  const running = status === "running";
  return (
    <span
      data-activity={status}
      style={{
        display: "inline-flex",
        alignItems: "center",
        height: running ? 20 : 19,
        gap: running ? 4 : 3,
        flexShrink: 0,
        padding: running ? undefined : "1px 6px 1px 5px",
        border: running ? undefined : `1px solid ${tone.border}`,
        borderRadius: running ? undefined : "var(--radius-status)",
        background: running ? undefined : tone.fill,
        whiteSpace: "nowrap",
      }}
    >
      <span
        className={running ? "session-status-spin" : status === "awaiting_input" ? "session-status-pulse" : undefined}
        style={{ display: "inline-flex", color: tone.icon }}
      >
        {running ? (
          <LoaderGlyph size={13} />
        ) : status === "awaiting_input" ? (
          <QuestionGlyph size={11} />
        ) : (
          <AlertGlyph size={11} />
        )}
      </span>
      <span className="type-mono-meta" aria-hidden="true" style={{ color: tone.text }}>
        {count}
      </span>
    </span>
  );
}
