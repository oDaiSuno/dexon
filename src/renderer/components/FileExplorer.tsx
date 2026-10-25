import { useState, useCallback, useEffect, useMemo, useRef } from "react";
import { encodeFilePathForApi } from "@/lib/file-paths";
import type { GitStatusResult } from "@shared/api-types";
import { useI18n } from "@/i18n";
import { FileTreeSkeleton, FilesSectionHeader } from "./file-explorer/files-section";
import { WorkspaceSummary, type WatchState } from "./file-explorer/workspace-summary";
import { gitChangeGroups, gitTreeMarks } from "./file-explorer/git-marks";
import { ChangesList, useChangesOnlyPreference } from "./file-explorer/changes-list";
import { fetchEntries, TreeNode, type FileNode, type TreeShared } from "./file-explorer/tree-node";

interface Props {
  cwd: string;
  personalCwd: string | null;
  homeDir: string;
  activeFilePath: string | null;
  onOpenFile: (filePath: string, fileName: string) => void;
  refreshKey?: number;
  onAtMention?: (relativePath: string, isDir: boolean) => void;
}

export function FileExplorer({
  cwd,
  personalCwd,
  homeDir,
  activeFilePath = null,
  onOpenFile,
  refreshKey,
  onAtMention,
}: Props) {
  const { t } = useI18n();
  const [roots, setRoots] = useState<FileNode[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [expandedPaths, setExpandedPaths] = useState<Set<string>>(new Set());
  const [gitStatus, setGitStatus] = useState<GitStatusResult | null>(null);
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
  const isGit = !error && gitStatus?.isGit === true;
  const showingChanges = changesOnly && isGit;

  const loadProject = useCallback(
    async (showLoading: boolean) => {
      const generation = ++loadGenerationRef.current;
      if (showLoading) setLoading(true);
      setError(null);
      try {
        const [entries, statusResponse] = await Promise.all([
          fetchEntries(cwd, t),
          fetch(`/api/git-status?cwd=${encodeURIComponent(cwd)}`),
        ]);
        const status = statusResponse.ok ? ((await statusResponse.json()) as GitStatusResult) : null;
        if (generation !== loadGenerationRef.current) return;
        setRoots(entries);
        setGitStatus(status);
      } catch (error) {
        if (generation === loadGenerationRef.current) {
          setError(error instanceof Error ? error.message : String(error));
        }
      } finally {
        if (generation === loadGenerationRef.current) setLoading(false);
      }
    },
    [cwd, t],
  );

  useEffect(() => {
    const cwdChanged = prevCwdRef.current !== cwd;
    prevCwdRef.current = cwd;

    // Reset expanded state only when cwd changes, not on refreshKey bumps
    if (cwdChanged) setExpandedPaths(new Set());

    void loadProject(cwdChanged);
  }, [cwd, refreshKey, loadProject]);

  useEffect(() => {
    setWatch("connecting");
    const encoded = encodeFilePathForApi(cwd);
    const events = new EventSource(`/api/files/${encoded}?type=watch`);
    let timer: ReturnType<typeof setTimeout> | null = null;
    events.addEventListener("connected", () => setWatch("live"));
    events.addEventListener("change", () => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => {
        setLiveRefreshKey((key) => key + 1);
        void loadProject(false);
      }, 200);
    });
    events.addEventListener("error", () => setWatch("static"));
    events.onerror = () => setWatch("static");
    return () => {
      if (timer) clearTimeout(timer);
      events.close();
    };
  }, [cwd, loadProject]);

  const tree = useMemo<TreeShared>(
    () => ({
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
        cwd={cwd}
        personalCwd={personalCwd}
        homeDir={homeDir}
        watch={watch}
        gitStatus={error ? null : gitStatus}
        loading={loading}
      />
      <div className="flex flex-col gap-[4px]">
        <FilesSectionHeader
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
