import type { GitStatusResult } from "@shared/api-types";
import { getParentFilePath } from "@shared/file-paths";
import { abbreviateHomePath } from "@/lib/display-path";
import { formatNumber } from "@/lib/locale-format";
import { isPersonalSpace, spaceDisplayName } from "@/lib/space-identity";
import { useI18n } from "@/i18n";
import { CircleCheckIcon, Icon } from "../chat-input/icons";
import { GitBranchGlyph } from "../chat-input/workspace-chrome";
import { FolderIcon } from "../FileIcons";

export type WatchState = "connecting" | "live" | "static";

const CHANGE_KINDS = [
  { kind: "staged", color: "var(--fx-status-success)" },
  { kind: "modified", color: "var(--fx-status-warning)" },
  { kind: "untracked", color: "var(--fx-text-faint)" },
  { kind: "conflicted", color: "var(--fx-status-danger)" },
] as const;

type ChangeKind = (typeof CHANGE_KINDS)[number];

export function WorkspaceSummary({
  cwd,
  personalCwd,
  homeDir,
  watch,
  gitStatus,
  loading,
}: {
  cwd: string;
  personalCwd: string | null;
  homeDir: string;
  watch: WatchState;
  gitStatus: GitStatusResult | null;
  loading: boolean;
}) {
  return (
    <div className="flex flex-col gap-[8px]">
      <WorkspaceTitle
        cwd={cwd}
        personalCwd={personalCwd}
        homeDir={homeDir}
        watch={watch}
        isGit={gitStatus ? gitStatus.isGit : null}
      />
      {loading ? (
        <GitCard gitStatus={null} />
      ) : gitStatus === null ? null : !gitStatus.isGit ? (
        <NotGitNotice />
      ) : (
        <GitCard gitStatus={gitStatus} />
      )}
    </div>
  );
}

function WorkspaceTitle({
  cwd,
  personalCwd,
  homeDir,
  watch,
  isGit,
}: {
  cwd: string;
  personalCwd: string | null;
  homeDir: string;
  watch: WatchState;
  isGit: boolean | null;
}) {
  const { t } = useI18n();
  const personal = isPersonalSpace(cwd, personalCwd, homeDir);
  const name = spaceDisplayName(cwd, personalCwd, homeDir, t("personalSpace", "Personal space"));
  const location = abbreviateHomePath(personal ? cwd : getParentFilePath(cwd), homeDir);
  return (
    <div className="flex h-[24px] items-center gap-[8px] pr-[4px] pl-[8px]">
      {isGit === false ? (
        <span className="flex shrink-0 [&_svg]:[stroke:var(--fx-text-secondary)]">
          <FolderIcon size={14} />
        </span>
      ) : (
        <span className="flex shrink-0 text-[var(--fx-text-secondary)]">
          <FolderGitIcon />
        </span>
      )}
      <span className="type-body-medium max-w-[60%] shrink-0 truncate text-[var(--fx-text-primary)]">{name}</span>
      <span className="type-mono-meta min-w-0 flex-1 truncate text-[var(--fx-text-tertiary)]" title={cwd}>
        {location}
      </span>
      <span
        className="flex shrink-0 items-center gap-[6px]"
        title={
          watch === "live"
            ? t("projectChangesMonitored", "Project changes are monitored")
            : t("projectWatcherUnavailable", "Project watcher unavailable")
        }
      >
        <span
          className={`size-[6px] shrink-0 rounded-[3px] ${
            watch === "live" ? "bg-[var(--fx-status-success)]" : "bg-[var(--fx-text-faint)]"
          }`}
        />
        <span className="type-meta-default text-[var(--fx-text-tertiary)]">
          {watch === "live"
            ? t("live", "live")
            : watch === "connecting"
              ? t("explorerConnecting", "Connecting")
              : t("static", "static")}
        </span>
      </span>
    </div>
  );
}

function FolderGitIcon() {
  return (
    <Icon size={14} strokeWidth={1.75}>
      <path d="M18 19a5 5 0 0 1-5-5v8" />
      <path d="M9 20H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h3.9a2 2 0 0 1 1.69.9l.81 1.2a2 2 0 0 0 1.67.9H20a2 2 0 0 1 2 2v5" />
      <circle cx="13" cy="12" r="2" />
      <circle cx="20" cy="19" r="2" />
    </Icon>
  );
}

function GitCard({ gitStatus }: { gitStatus: GitStatusResult | null }) {
  const { language, t } = useI18n();
  const branch = gitStatus ? (gitStatus.branch ?? "detached") : null;
  const labels = {
    staged: t("gitStaged", "Staged"),
    modified: t("gitModified", "Modified"),
    untracked: t("gitUntracked", "Untracked"),
    conflicted: t("gitConflicted", "Conflicted"),
  };
  return (
    <div className="flex flex-col overflow-hidden rounded-[var(--radius-card)] border border-solid border-[var(--fx-line-default)] bg-[var(--fx-surface-raised)]">
      <div className="flex h-[36px] items-center gap-[8px] px-[12px]">
        <span className="flex shrink-0 text-[var(--fx-text-secondary)]">
          <GitBranchGlyph size={14} />
        </span>
        {gitStatus && branch !== null ? (
          <>
            <span className="type-mono-label min-w-0 flex-1 truncate text-[var(--fx-text-primary)]" title={branch}>
              {branch}
            </span>
            {!gitStatus.clean && (
              <span className="type-meta-default shrink-0 text-[var(--fx-text-tertiary)]">
                {t("changedPathCount", "{count} changes").replace(
                  "{count}",
                  formatNumber(gitStatus.entries.length, language),
                )}
              </span>
            )}
          </>
        ) : (
          <span
            aria-hidden
            className="h-[9px] w-[120px] shrink-0 rounded-[var(--radius-skeleton)] bg-[var(--fx-surface-subtle)] motion-safe:animate-pulse"
          />
        )}
      </div>
      {gitStatus && !gitStatus.clean && (
        <>
          <Distribution gitStatus={gitStatus} />
          <Stats gitStatus={gitStatus} labels={labels} />
        </>
      )}
      {gitStatus && gitStatus.clean && <CleanRow />}
    </div>
  );
}

function Distribution({ gitStatus }: { gitStatus: GitStatusResult }) {
  return (
    <div aria-hidden className="flex items-center gap-[2px] px-[12px] pb-[10px]">
      {CHANGE_KINDS.filter(({ kind }) => gitStatus[kind] > 0).map(({ kind, color }) => (
        <span
          key={kind}
          className="h-[4px] min-w-0 rounded-[var(--radius-bar)]"
          style={{ flex: `${gitStatus[kind]} 1 0`, background: color }}
        />
      ))}
    </div>
  );
}

function Stats({ gitStatus, labels }: { gitStatus: GitStatusResult; labels: Record<ChangeKind["kind"], string> }) {
  const { language } = useI18n();
  const columns: readonly ChangeKind[] = CHANGE_KINDS.filter(
    ({ kind }) => kind !== "conflicted" || gitStatus.conflicted > 0,
  );
  return (
    <dl className="m-0 flex border-0 border-t border-solid border-[var(--fx-line-subtle)]">
      {columns.map(({ kind, color }, index) => (
        <div
          key={kind}
          className={`flex min-w-0 flex-1 flex-col-reverse gap-[4px] px-[12px] py-[10px] ${
            index > 0 ? "border-0 border-l border-solid border-[var(--fx-line-subtle)]" : ""
          }`}
        >
          <dt className="type-meta-default m-0 flex items-center gap-[6px] text-[var(--fx-text-secondary)]">
            <span className="size-[6px] shrink-0 rounded-[var(--radius-bar)]" style={{ background: color }} />
            {labels[kind]}
          </dt>
          <dd
            className={`type-mono-body m-0 ${
              kind === "conflicted" ? "text-[var(--fx-status-danger-text)]" : "text-[var(--fx-text-primary)]"
            }`}
          >
            {formatNumber(gitStatus[kind], language)}
          </dd>
        </div>
      ))}
    </dl>
  );
}

function CleanRow() {
  const { t } = useI18n();
  return (
    <div className="flex h-[40px] items-center gap-[8px] border-0 border-t border-solid border-[var(--fx-line-subtle)] px-[12px]">
      <span className="flex shrink-0 text-[var(--fx-status-success)]">
        <CircleCheckIcon size={14} />
      </span>
      <span className="type-label-medium shrink-0 text-[var(--fx-text-primary)]">
        {t("gitClean", "Working tree clean")}
      </span>
      <span className="type-meta-default min-w-0 flex-1 truncate text-right text-[var(--fx-text-tertiary)]">
        {t("gitCleanHint", "No uncommitted changes")}
      </span>
    </div>
  );
}

function NotGitNotice() {
  const { t } = useI18n();
  return (
    <div className="flex h-[36px] items-center gap-[8px] rounded-[var(--radius-card)] bg-[var(--fx-surface-inset)] px-[12px]">
      <span className="flex shrink-0 text-[var(--fx-text-faint)]">
        <GitBranchGlyph size={14} />
      </span>
      <span className="type-label-default min-w-0 flex-1 truncate text-[var(--fx-text-secondary)]">
        {t("notGitRepository", "Not a Git repository")}
      </span>
      <span className="type-meta-default shrink-0 text-[var(--fx-text-tertiary)]">
        {t("notGitFilesOnly", "Showing files only")}
      </span>
    </div>
  );
}
