import { useEffect, useId, useRef, useState, type Dispatch } from "react";
import type { RemoteBrowseResult } from "@contract/workspace";
import { formatSshHostLabel, keyOf, normalizePosixPath } from "@shared/workspace-ref";
import { useI18n } from "@/i18n";
import { GlideHighlight } from "../chat-input/GlideHighlight";
import { useSwitcherKeyboard } from "./use-switcher-keyboard";
import { ELLIPSIS, FOLDER_PATH, MenuIcon, ROW_STYLE } from "./project-switcher-parts";
import { SshConnectButton, SshConnectNote } from "./ssh-connect-parts";
import type { SshConnectEvent } from "./ssh-connect-state";

export function SshConnectDirectory({
  result,
  filter,
  selectedPath,
  dispatch,
  onOpenFolder,
}: {
  result: Extract<RemoteBrowseResult, { status: "ready" }>;
  filter: string;
  selectedPath: string;
  dispatch: Dispatch<SshConnectEvent>;
  onOpenFolder: (folder: string) => void;
}) {
  const { t } = useI18n();
  const inputRef = useRef<HTMLInputElement>(null);
  const [cursor, setCursor] = useState(-1);
  const baseId = useId();
  useEffect(() => inputRef.current?.focus(), []);
  const needle = filter.trim().toLocaleLowerCase();
  const entries = result.entries
    .filter((entry) => entry.name.toLocaleLowerCase().includes(needle))
    .sort((a, b) => Number(b.isGitRepo) - Number(a.isGitRepo) || a.name.localeCompare(b.name));
  const active = cursor >= 0 && cursor < entries.length ? cursor : -1;
  const choose = (index: number, enterFolder = false) => {
    const entry = entries[index];
    if (!entry) return;
    if (!entry.isGitRepo || enterFolder) dispatch({ type: "browse", path: entry.path });
    else dispatch({ type: "select", path: entry.path });
  };
  const openPath = (path: string) =>
    onOpenFolder(keyOf({ kind: "ssh", target: result.target, root: normalizePosixPath(path) }));
  const runKey = (key: string) => {
    if ((key === "ArrowDown" || key === "ArrowUp") && entries.length) {
      setCursor(key === "ArrowDown" ? (active + 1) % entries.length : (active <= 0 ? entries.length : active) - 1);
      return true;
    }
    if ((key === "Enter" || key === "ArrowRight") && active >= 0) {
      if (key === "Enter" && entries[active].isGitRepo) openPath(entries[active].path);
      else choose(active, key === "ArrowRight");
      return true;
    }
    if (key === "Enter") {
      openPath(selectedPath);
      return true;
    }
    return false;
  };
  useSwitcherKeyboard(runKey);
  const segments = result.currentPath.split("/").filter(Boolean);
  const crumbs = [
    { label: "/", path: "/" },
    ...segments.map((label, index) => ({ label, path: `/${segments.slice(0, index + 1).join("/")}` })),
  ];
  return (
    <>
      <p role="status" className="type-meta-default" style={{ color: "var(--fx-status-success-text)" }}>
        {t("sshConnectConnected", "● {host} connected · {rtt}ms")
          .replace("{host}", formatSshHostLabel(result.target))
          .replace("{rtt}", String(result.rttMs))}
      </p>
      <nav
        aria-label={t("sshConnectBreadcrumbs", "Remote folder path")}
        style={{ display: "flex", alignItems: "center", flexWrap: "wrap", gap: 4 }}
      >
        {crumbs.map((crumb, index) => (
          <span key={crumb.path} style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
            {index > 0 && (
              <span aria-hidden="true" style={{ color: "var(--fx-text-tertiary)" }}>
                ›
              </span>
            )}
            <button
              type="button"
              className="type-mono-label"
              aria-current={crumb.path === result.currentPath ? "location" : undefined}
              onClick={() => dispatch({ type: "browse", path: crumb.path })}
              style={{ padding: "4px 2px", color: "var(--fx-text-secondary)" }}
            >
              {crumb.label}
            </button>
          </span>
        ))}
      </nav>
      <input
        ref={inputRef}
        role="searchbox"
        className="type-body-default"
        aria-label={t("sshConnectFilter", "Filter this directory…")}
        placeholder={t("sshConnectFilter", "Filter this directory…")}
        value={filter}
        aria-activedescendant={active >= 0 ? `${baseId}-${active}` : undefined}
        onChange={(event) => {
          dispatch({ type: "filter", filter: event.target.value });
          setCursor(-1);
        }}
        onKeyDown={(event) => {
          if (event.nativeEvent.isComposing || !runKey(event.key)) return;
          event.preventDefault();
          event.stopPropagation();
        }}
        style={{
          width: "100%",
          padding: "8px 10px",
          color: "var(--fx-text-primary)",
          background: "var(--fx-surface-inset)",
          border: "1px solid var(--fx-line-default)",
          borderRadius: "var(--radius-control)",
        }}
      />
      <div style={{ position: "relative", maxHeight: 240, overflowY: "auto" }}>
        {entries.map((entry, index) => (
          <button
            type="button"
            key={entry.path}
            id={`${baseId}-${index}`}
            role="menuitemradio"
            tabIndex={-1}
            aria-label={entry.name}
            aria-checked={selectedPath === entry.path}
            onMouseEnter={() => setCursor(index)}
            onClick={() => choose(index)}
            onDoubleClick={() => choose(index, true)}
            onKeyDown={(event) => {
              if (event.nativeEvent.isComposing) return;
              setCursor(index);
              if (event.key === "ArrowRight") {
                choose(index, true);
                event.preventDefault();
              } else if (runKey(event.key)) {
                event.preventDefault();
                event.stopPropagation();
              }
            }}
            style={{
              ...ROW_STYLE,
              height: 48,
              borderRadius: "var(--radius-control)",
              color: "var(--fx-text-body)",
              position: "relative",
              zIndex: 1,
              background: selectedPath === entry.path ? "var(--fx-accent-blue-soft)" : ROW_STYLE.background,
            }}
          >
            <MenuIcon style={{ flexShrink: 0 }}>
              <path d={FOLDER_PATH} />
            </MenuIcon>
            <span style={{ display: "flex", flexDirection: "column", gap: 2, flex: 1, minWidth: 0 }}>
              <span className="type-body-medium" style={ELLIPSIS}>
                {entry.name}
              </span>
              {entry.gitBranch && (
                <span className="type-mono-meta" style={{ ...ELLIPSIS, color: "var(--fx-text-tertiary)" }}>
                  {entry.gitBranch}
                </span>
              )}
            </span>
            <span
              className="type-meta-default"
              style={{
                flexShrink: 0,
                color: entry.isGitRepo ? "var(--fx-accent-blue-text)" : "var(--fx-text-tertiary)",
              }}
            >
              {entry.isGitRepo ? t("sshConnectGitRepo", "Git repo") : t("sshConnectSubdirectory", "Subdirectory ›")}
            </span>
          </button>
        ))}
        <GlideHighlight
          rowSelector='[role="menuitemradio"]'
          activeIndex={active}
          visible={active >= 0}
          layoutKey={entries.map((entry) => entry.path).join("|")}
          insetX={0}
        />
      </div>
      {!entries.length && (
        <SshConnectNote>{t("sshConnectNoFolders", "No matching folders in this directory")}</SshConnectNote>
      )}
      <SshConnectNote>
        {t("sshConnectSafeDefault", "First open defaults to safe read-only browsing; local keys are never uploaded")}
      </SshConnectNote>
      <SshConnectButton primary enter onClick={() => openPath(selectedPath)}>
        {t("sshConnectOpenSelected", "Open {path}").replace("{path}", selectedPath)}
      </SshConnectButton>
    </>
  );
}
