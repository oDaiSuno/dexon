import { useState, useCallback, useEffect, useMemo, useRef } from "react";
import { PRIMARY_ENVIRONMENT_ID, type EnvironmentId } from "@contract/environment";
import { useEnvironments } from "@/lib/environment-registry";
import { subscribeFileWatch } from "@/lib/file-watch-subscription";
import { getEnvironmentApiClient } from "@/lib/api-client";
import type { GitStatusResult } from "@shared/api-types";
import { useI18n } from "@/i18n";
import { FileTreeSkeleton, FilesSectionHeader } from "./file-explorer/files-section";
import { WorkspaceSummary, type WatchState } from "./file-explorer/workspace-summary";
import { gitChangeGroups, gitTreeMarks } from "./file-explorer/git-marks";
import { ChangesList, useChangesOnlyPreference } from "./file-explorer/changes-list";
import { fetchEntries, TreeNode, type FileNode, type TreeShared } from "./file-explorer/tree-node";

interface Props {
  environmentId: EnvironmentId;
  cwd: string;
  personalCwd: string | null;
  homeDir: string;
  activeFilePath: string | null;
  onOpenFile: (filePath: string, fileName: string) => void;
  refreshKey?: number;
  onAtMention?: (relativePath: string, isDir: boolean) => void;
}

export function FileExplorer(props: Props) {
  const { environmentId } = props;
  return (
    <EnvironmentFileExplorer
      key={JSON.stringify([environmentId, props.cwd])}
      {...props}
      environmentId={environmentId}
    />
  );
}

function EnvironmentFileExplorer({
  environmentId,
  cwd,
  personalCwd,
  homeDir,
  activeFilePath = null,
  onOpenFile,
  refreshKey,
  onAtMention,
}: Props & { environmentId: EnvironmentId }) {
  const { t } = useI18n();
  const serverLabel = useEnvironments().find(
    (view) => view.id === environmentId && view.id !== PRIMARY_ENVIRONMENT_ID,
  )?.label;
  const [roots, setRoots] = useState<FileNode[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [expandedPaths, setExpandedPaths] = useState<Set<string>>(new Set());
  const [gitStatus, setGitStatus] = useState<GitStatusResult | null>(null);
  const [gitError, setGitError] = useState<string | null>(null);
  const [quickBranch, setQuickBranch] = useState<{ cwd: string; branch: string } | null>(null);
  const [watch, setWatch] = useState<WatchState>("connecting");
  const [liveRefreshKey, setLiveRefreshKey] = useState(0);
  const [changesOnly, toggleChangesOnly] = useChangesOnlyPreference();
  const prevCwdRef = useRef<string | null>(null);
  const loadGenerationRef = useRef(0);

  const handleToggleExpanded = useCallback((fullPath: string, open: boolean) => {
    setExpandedPaths((prev) => {
      const next = new Set(prev);
      if (open) next.add(fullPath);
      else next.delete(fullPath);
      return next;
    });
  }, []);

  const handleCollapseAll = useCallback(() => setExpandedPaths(new Set()), []);

  const marks = useMemo(() => gitTreeMarks(gitStatus), [gitStatus]);
  const changeGroups = useMemo(() => gitChangeGroups(gitStatus), [gitStatus]);
  const isGit = !error && !gitError && gitStatus?.isGit === true;
  const showingChanges = changesOnly && isGit;

  const loadProject = useCallback(
    async (showLoading: boolean) => {
      const generation = ++loadGenerationRef.current;
      if (showLoading) {
        setLoading(true);
        void getEnvironmentApiClient(environmentId)
          .call("git.branch", { path: cwd })
          .then((result) => {
            if (generation === loadGenerationRef.current && result.isGit) {
              setQuickBranch({ cwd, branch: result.branch ?? "detached" });
            }
          })
          .catch(() => undefined);
      }
      setError(null);
      try {
        const [entries, status] = await Promise.all([
          fetchEntries(environmentId, cwd, t),
          getEnvironmentApiClient(environmentId)
            .call("git.status", { path: cwd })
            .then(
              (value) => ({ status: "ready" as const, value }),
              (error: unknown) => ({ status: "unavailable" as const, error }),
            ),
        ]);
        if (generation !== loadGenerationRef.current) return;
        setRoots(entries);
        setGitStatus(status.status === "ready" ? status.value : null);
        setGitError(status.status === "unavailable" ? String(status.error) : null);
      } catch (error) {
        if (generation === loadGenerationRef.current) {
          setError(error instanceof Error ? error.message : String(error));
        }
      } finally {
        if (generation === loadGenerationRef.current) setLoading(false);
      }
    },
    [environmentId, cwd, t],
  );

  useEffect(() => {
    const cwdChanged = prevCwdRef.current !== cwd;
    prevCwdRef.current = cwd;

    if (cwdChanged) setExpandedPaths(new Set());

    void loadProject(cwdChanged);
    return () => {
      loadGenerationRef.current += 1;
    };
  }, [cwd, refreshKey, loadProject]);

  useEffect(() => {
    setWatch("connecting");
    let timer: ReturnType<typeof setTimeout> | null = null;
    const refresh = () => {
      setLiveRefreshKey((key) => key + 1);
      void loadProject(false);
    };
    const unsubscribe = subscribeFileWatch({
      environmentId,
      path: cwd,
      onOpen: () => setWatch("live"),
      onGap: refresh,
      onEvent: (event) => {
        if (event.event === "connected") setWatch("live");
        if (event.event !== "change") return;
        if (timer) clearTimeout(timer);
        timer = setTimeout(refresh, 200);
      },
      onError: (error) => {
        setWatch("static");
        setGitStatus(null);
        setGitError(String(error));
      },
    });
    return () => {
      if (timer) clearTimeout(timer);
      unsubscribe();
    };
  }, [environmentId, cwd, loadProject]);

  const tree = useMemo<TreeShared>(
    () => ({
      environmentId,
      cwd,
      activeFilePath,
      onOpenFile,
      onAtMention,
      expandedPaths,
      onToggleExpanded: handleToggleExpanded,
      refreshKey: (refreshKey ?? 0) + liveRefreshKey,
      marks,
    }),
    [
      environmentId,
      cwd,
      activeFilePath,
      onOpenFile,
      onAtMention,
      expandedPaths,
      handleToggleExpanded,
      refreshKey,
      liveRefreshKey,
      marks,
    ],
  );

  return (
    <div className="flex flex-col gap-[16px] px-[8px] pt-[12px] pb-[16px]">
      <WorkspaceSummary
        serverLabel={serverLabel}
        cwd={cwd}
        personalCwd={personalCwd}
        homeDir={homeDir}
        watch={watch}
        gitStatus={error ? null : gitStatus}
        loading={loading}
        loadingBranch={quickBranch?.cwd === cwd ? quickBranch.branch : null}
      />
      {gitError && (
        <div role="status" className="type-meta-default text-[var(--fx-text-secondary)]">
          {gitError}
        </div>
      )}
      <div className="flex flex-col gap-[4px]">
        <FilesSectionHeader
          remote={environmentId !== PRIMARY_ENVIRONMENT_ID}
          onCollapseAll={handleCollapseAll}
          filterable={isGit}
          showingChanges={showingChanges}
          onToggleChangesOnly={toggleChangesOnly}
        />
        {loading ? (
          <FileTreeSkeleton />
        ) : error ? (
          <div role="alert" className="type-meta-default px-[12px] py-[8px] text-[var(--fx-status-danger)]">
            {error}
          </div>
        ) : (
          <>
            <div className="flex flex-col gap-[1px]" hidden={showingChanges}>
              {roots.map((node) => (
                <TreeNode key={node.fullPath} node={node} depth={0} tree={tree} />
              ))}
              {roots.length === 0 && (
                <div className="type-meta-default px-[12px] py-[8px] text-[var(--fx-text-tertiary)]">
                  {t("noFilesFound", "No files found")}
                </div>
              )}
            </div>
            {showingChanges && (
              <ChangesList cwd={cwd} groups={changeGroups} activeFilePath={activeFilePath} onOpenFile={onOpenFile} />
            )}
          </>
        )}
      </div>
    </div>
  );
}
