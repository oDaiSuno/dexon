import { useCallback, useEffect, useRef, useState } from "react";
import { useI18n } from "@/i18n";
import { abbreviateHomePath } from "@/lib/display-path";
import { AnimatedDropdown } from "./animated-dropdown";
import { PathLabel } from "./path-label";
import type { WorkspaceSelectResult } from "./project-workspace";

// Split from SessionSidebar.tsx in Phase 2. Renders the project picker button
// and dropdown; dropdown visibility, the project filter, and the custom path
// entry are view-local state owned here. Directory resolution/validation is
// delegated to the workspace hook via callbacks. The outside-click listener
// now lives per dropdown — combined with the worktree switcher's own listener
// this preserves the previous cross-closing behavior.

export function ProjectPicker({
  selectedCwd,
  selectedProject,
  homeDir,
  recentProjects,
  suppressPlaceholder,
  onSelectProject,
  selectCustomCwd,
  selectDefaultCwd,
  selectDirectoryFromPicker,
  deferFocus,
}: {
  selectedCwd: string | null;
  selectedProject: string | null;
  homeDir: string;
  recentProjects: string[];
  suppressPlaceholder: boolean;
  onSelectProject: (project: string) => void;
  selectCustomCwd: (path: string) => Promise<WorkspaceSelectResult>;
  selectDefaultCwd: () => Promise<boolean>;
  selectDirectoryFromPicker: () => Promise<WorkspaceSelectResult>;
  deferFocus: (focus: () => void) => void;
}) {
  const { t } = useI18n();
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const [projectFilter, setProjectFilter] = useState("");
  const [customPathOpen, setCustomPathOpen] = useState(false);
  const [customPathValue, setCustomPathValue] = useState("");
  const [customPathError, setCustomPathError] = useState<string | null>(null);
  const [customPathValidating, setCustomPathValidating] = useState(false);
  const customPathInputRef = useRef<HTMLInputElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);

  const showProjectFilter = recentProjects.length > 8;
  const visibleProjects = projectFilter.trim()
    ? recentProjects.filter((p) => p.toLowerCase().includes(projectFilter.trim().toLowerCase()))
    : recentProjects;

  // Close dropdown on outside click
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setDropdownOpen(false);
        setProjectFilter("");
        setCustomPathOpen(false);
        setCustomPathValue("");
        setCustomPathError(null);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  const commitCustomPath = useCallback(async () => {
    const path = customPathValue.trim();
    if (!path || customPathValidating) return;

    setCustomPathValidating(true);
    setCustomPathError(null);
    try {
      const result = await selectCustomCwd(path);
      if (result.status === "invalid") {
        setCustomPathError(result.error);
        return;
      }
      setCustomPathOpen(false);
      setCustomPathValue("");
      setDropdownOpen(false);
    } finally {
      setCustomPathValidating(false);
    }
  }, [customPathValue, customPathValidating, selectCustomCwd]);

  const applyDefaultCwd = useCallback(async () => {
    const applied = await selectDefaultCwd();
    if (applied) {
      setCustomPathOpen(false);
      setCustomPathValue("");
      setCustomPathError(null);
      setDropdownOpen(false);
    }
  }, [selectDefaultCwd]);

  const applyPickedDirectory = useCallback(async () => {
    const result = await selectDirectoryFromPicker();
    if (result.status === "cancelled") return;
    if (result.status === "invalid") {
      setCustomPathError(result.error);
      return;
    }
    setCustomPathOpen(false);
    setCustomPathValue("");
    setCustomPathError(null);
    setDropdownOpen(false);
  }, [selectDirectoryFromPicker]);

  const selectProject = useCallback(
    (project: string) => {
      onSelectProject(project);
      setProjectFilter("");
      setCustomPathOpen(false);
      setCustomPathValue("");
      setCustomPathError(null);
      setDropdownOpen(false);
    },
    [onSelectProject],
  );

  return (
    <div ref={dropdownRef} style={{ position: "relative" }}>
      <button
        onClick={() => setDropdownOpen((v) => !v)}
        title={selectedProject ?? selectedCwd ?? ""}
        style={{
          width: "100%",
          display: "flex",
          alignItems: "center",
          padding: "8px 12px",
          background: selectedCwd ? "var(--bg-hover)" : "var(--accent-soft)",
          border: selectedCwd ? "1px solid var(--border)" : "1px solid var(--accent-soft-border)",
          borderRadius: "var(--radius-card)",
          cursor: "pointer",
          fontSize: "var(--text-label)",
          color: "var(--text)",
          textAlign: "left",
          transition:
            "border-color var(--duration-quick, 150ms) var(--ease-smooth-out, ease), background var(--duration-quick, 150ms) var(--ease-smooth-out, ease)",
        }}
      >
        {selectedCwd ? (
          <PathLabel
            text={abbreviateHomePath(selectedProject ?? selectedCwd, homeDir)}
            style={{
              flex: 1,
              fontFamily: "var(--font-mono)",
              fontSize: "var(--text-meta)",
              color: "var(--text)",
            }}
          />
        ) : (
          <span
            style={{
              flex: 1,
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
              fontFamily: "var(--font-mono)",
              fontSize: "var(--text-meta)",
              color: "var(--text-dim)",
            }}
          >
            {suppressPlaceholder ? "" : t("selectProjectEllipsis", "Select project…")}
          </span>
        )}
      </button>

      <AnimatedDropdown
        open={dropdownOpen}
        style={{
          position: "absolute",
          top: "calc(100% + 4px)",
          left: 0,
          right: 0,
          zIndex: 100,
          background: "var(--bg)",
          border: "1px solid var(--border)",
          borderRadius: "var(--radius-card)",
          boxShadow: "0 6px 20px rgba(0,0,0,0.10)",
          overflow: "hidden",
        }}
      >
        {showProjectFilter && (
          <div style={{ padding: "8px 8px", borderBottom: "1px solid var(--border)" }}>
            <input
              value={projectFilter}
              onChange={(e) => setProjectFilter(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Escape") {
                  setProjectFilter("");
                  setDropdownOpen(false);
                }
              }}
              placeholder={t("filterProjects", "Filter projects…")}
              autoFocus
              style={{
                width: "100%",
                fontSize: "var(--text-meta)",
                fontFamily: "var(--font-mono)",
                padding: "4px 8px",
                border: "1px solid var(--border)",
                borderRadius: "var(--radius-control)",
                outline: "none",
                background: "var(--bg)",
                color: "var(--text)",
                boxSizing: "border-box",
              }}
            />
          </div>
        )}
        <div style={{ maxHeight: "min(50vh, 380px)", overflowY: "auto" }}>
          {visibleProjects.map((project) => (
            <button
              key={project}
              onClick={() => selectProject(project)}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 8,
                width: "100%",
                padding: "8px 12px",
                background: "var(--bg)",
                border: "none",
                borderBottom: "1px solid var(--border)",
                color: project === selectedProject ? "var(--text)" : "var(--text-muted)",
                cursor: "pointer",
                textAlign: "left",
                fontSize: "var(--text-meta)",
                fontFamily: "var(--font-mono)",
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
              }}
              title={project}
            >
              {project === selectedProject && (
                <svg
                  width="10"
                  height="10"
                  viewBox="0 0 10 10"
                  fill="none"
                  stroke="var(--accent)"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  style={{ flexShrink: 0 }}
                >
                  <polyline points="1.5 5 4 7.5 8.5 2.5" />
                </svg>
              )}
              {project !== selectedProject && <span style={{ width: 10, flexShrink: 0 }} />}
              <PathLabel text={abbreviateHomePath(project, homeDir)} style={{ flex: 1 }} />
            </button>
          ))}
          {visibleProjects.length === 0 && projectFilter.trim() && (
            <div style={{ padding: "8px 12px", fontSize: "var(--text-meta)", color: "var(--text-dim)" }}>
              {t("noMatchingProjects", "No matching projects")}
            </div>
          )}
        </div>

        {/* Default cwd shortcut */}
        {!customPathOpen && (
          <button
            onClick={(e) => {
              e.stopPropagation();
              void applyDefaultCwd();
            }}
            style={{
              display: "flex",
              alignItems: "center",
              gap: 8,
              width: "100%",
              padding: "8px 12px",
              background: "none",
              border: "none",
              borderTop: visibleProjects.length > 0 ? "1px solid var(--border)" : "none",
              color: "var(--text-muted)",
              cursor: "pointer",
              textAlign: "left",
              fontSize: "var(--text-meta)",
            }}
          >
            <svg
              width="10"
              height="10"
              viewBox="0 0 10 10"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.1"
              strokeLinecap="round"
              strokeLinejoin="round"
              style={{ flexShrink: 0 }}
            >
              <path d="M1 3A1 1 0 0 1 2 2H4L5 3.5H8.5a.5.5 0 0 1 .5.5v4a.5.5 0 0 1-.5.5h-7A.5.5 0 0 1 1 8V3Z" />
            </svg>
            <span>{t("useDefaultDirectory", "Use default directory")}</span>
          </button>
        )}

        {/* Native directory picker (desktop) */}
        {!customPathOpen && typeof window !== "undefined" && !!window.piBridge && (
          <button
            onClick={(e) => {
              e.stopPropagation();
              void applyPickedDirectory();
            }}
            style={{
              display: "flex",
              alignItems: "center",
              gap: 8,
              width: "100%",
              padding: "8px 12px",
              background: "none",
              border: "none",
              color: "var(--text-muted)",
              cursor: "pointer",
              textAlign: "left",
              fontSize: "var(--text-meta)",
            }}
          >
            <svg
              width="10"
              height="10"
              viewBox="0 0 10 10"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.1"
              strokeLinecap="round"
              strokeLinejoin="round"
              style={{ flexShrink: 0 }}
            >
              <path d="M1 3A1 1 0 0 1 2 2H4L5 3.5H8.5a.5.5 0 0 1 .5.5v4a.5.5 0 0 1-.5.5h-7A.5.5 0 0 1 1 8V3Z" />
            </svg>
            <span>{t("browseFolder", "Browse folder…")}</span>
          </button>
        )}

        {/* Custom path entry */}
        {!customPathOpen ? (
          <button
            onClick={(e) => {
              e.stopPropagation();
              setCustomPathOpen(true);
              setCustomPathError(null);
              deferFocus(() => customPathInputRef.current?.focus());
            }}
            style={{
              display: "flex",
              alignItems: "center",
              gap: 8,
              width: "100%",
              padding: "8px 12px",
              background: "none",
              border: "none",
              color: "var(--text-muted)",
              cursor: "pointer",
              textAlign: "left",
              fontSize: "var(--text-meta)",
            }}
          >
            <svg
              width="10"
              height="10"
              viewBox="0 0 10 10"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.1"
              strokeLinecap="round"
              style={{ flexShrink: 0 }}
            >
              <line x1="5" y1="1" x2="5" y2="9" />
              <line x1="1" y1="5" x2="9" y2="5" />
            </svg>
            <span>{t("customPath", "Custom path…")}</span>
          </button>
        ) : (
          <div style={{ padding: "8px 8px", borderTop: visibleProjects.length > 0 ? "none" : undefined }}>
            <input
              ref={customPathInputRef}
              value={customPathValue}
              onChange={(e) => {
                setCustomPathValue(e.target.value);
                setCustomPathError(null);
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  void commitCustomPath();
                }
                if (e.key === "Escape") {
                  setCustomPathOpen(false);
                  setCustomPathValue("");
                  setCustomPathError(null);
                }
              }}
              placeholder="/path/to/project"
              style={{
                width: "100%",
                fontSize: "var(--text-meta)",
                fontFamily: "var(--font-mono)",
                padding: "4px 8px",
                border: "1px solid var(--accent)",
                borderRadius: "var(--radius-control)",
                outline: "none",
                background: "var(--bg)",
                color: "var(--text)",
                boxSizing: "border-box",
              }}
            />
            {customPathError && (
              <div
                style={{
                  marginTop: 4,
                  color: "var(--danger)",
                  fontSize: "var(--text-meta)",
                  lineHeight: 1.35,
                  overflowWrap: "anywhere",
                }}
              >
                {customPathError}
              </div>
            )}
            <div style={{ display: "flex", gap: 4, marginTop: 4 }}>
              <button
                onClick={() => void commitCustomPath()}
                disabled={customPathValidating || !customPathValue.trim()}
                style={{
                  flex: 1,
                  padding: "4px 0",
                  background: "var(--btn-bg)",
                  border: "none",
                  borderRadius: "var(--radius-control)",
                  color: "var(--btn-fg)",
                  fontSize: "var(--text-meta)",
                  fontWeight: 600,
                  cursor: customPathValidating || !customPathValue.trim() ? "not-allowed" : "pointer",
                  opacity: customPathValidating || !customPathValue.trim() ? 0.65 : 1,
                }}
              >
                {customPathValidating ? t("checking", "Checking…") : t("open", "Open")}
              </button>
              <button
                onClick={() => {
                  setCustomPathOpen(false);
                  setCustomPathValue("");
                  setCustomPathError(null);
                }}
                style={{
                  flex: 1,
                  padding: "4px 0",
                  background: "var(--bg-hover)",
                  border: "1px solid var(--border)",
                  borderRadius: "var(--radius-control)",
                  color: "var(--text-muted)",
                  fontSize: "var(--text-meta)",
                  cursor: "pointer",
                }}
              >
                {t("cancel", "Cancel")}
              </button>
            </div>
          </div>
        )}
      </AnimatedDropdown>
    </div>
  );
}
