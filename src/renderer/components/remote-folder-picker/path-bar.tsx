import { useEffect, useId, useState } from "react";
import type { EnvironmentView } from "@contract/environment";
import { useI18n } from "@/i18n";
import { Button } from "../form-controls";
import { folderBreadcrumbs } from "./breadcrumb";
import type { FolderBrowserState } from "./folder-browser-state";
import { FolderPickerIcon, useFolderErrorLabel } from "./folder-picker-ui";

export interface PathBarProps {
  state: FolderBrowserState;
  server: EnvironmentView | undefined;
  disabled?: boolean;
  onOpenPath: (path: string) => void;
}

export function PathBar({ state, server, disabled = false, onOpenPath }: PathBarProps) {
  const { t } = useI18n();
  const errorId = useId();
  const path =
    state.kind === "ready"
      ? state.current.listing.displayPath
      : state.kind === "loading"
        ? state.request.path
        : state.kind === "path-error"
          ? state.path
          : "~";
  const home =
    (state.kind === "ready" ? state.current.listing.home : "base" in state ? state.base?.home : null) ??
    server?.descriptor?.platform.home ??
    "";
  const [draft, setDraft] = useState(path);
  const serverId = server?.id;
  useEffect(() => {
    setDraft(path);
  }, [path, serverId]);
  const error = useFolderErrorLabel(state.kind === "path-error" ? state.error : null);
  const unavailable = disabled || state.kind === "server-unavailable" || state.kind === "no-servers";
  const crumbs = folderBreadcrumbs(path, home);
  const jump = () => {
    if (!unavailable) onOpenPath(draft);
  };
  return (
    <div style={{ display: "grid", gridTemplateColumns: "minmax(0, 1fr)", minWidth: 0, gap: "var(--space-2-5)" }}>
      <div style={{ display: "flex", alignItems: "center", gap: "var(--space-2)" }}>
        <span className="type-label-medium" style={{ flex: 1, color: "var(--fx-text-secondary)" }}>
          {t("remoteFolderBrowse", "Browse folders or enter a path")}
        </span>
        <Button
          disabled={unavailable}
          onClick={() => onOpenPath("~")}
          style={{ minHeight: "var(--space-6)", height: "var(--space-6)", padding: "0 var(--space-2)" }}
        >
          <FolderPickerIcon kind="home" size={12} />
          <span className="type-meta-default">{t("remoteFolderHome", "Home (~)")}</span>
        </Button>
      </div>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          jump();
        }}
        style={{
          display: "flex",
          alignItems: "center",
          minWidth: 0,
          gap: "var(--space-2)",
          minHeight: 36,
          padding: "0 var(--space-1-5) 0 var(--space-2-5)",
          borderRadius: "var(--radius-control)",
          border: error ? "1px solid var(--fx-status-danger)" : "1px solid var(--fx-accent-blue-border)",
          background: error ? "var(--fx-status-danger-soft)" : "var(--fx-surface-inset)",
        }}
      >
        <span
          className="type-mono-meta"
          style={{
            flexShrink: 1,
            maxWidth: "25%",
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
            color: "var(--fx-accent-blue-text)",
            background: "var(--fx-accent-blue-soft)",
            padding: "var(--space-1) var(--space-1-5)",
            borderRadius: "var(--radius-segment)",
          }}
        >
          {server?.label}:
        </span>
        <input
          className="type-mono-label"
          aria-label={t("remoteFolderPath", "Remote folder path")}
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? errorId : undefined}
          autoComplete="off"
          spellCheck={false}
          disabled={unavailable}
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              jump();
            }
          }}
          style={{
            flex: 1,
            minWidth: 0,
            minHeight: "var(--space-8)",
            border: 0,
            padding: 0,
            background: "var(--fx-surface-hover-clear)",
            color: "var(--fx-text-primary)",
          }}
        />
        <Button type="submit" disabled={unavailable} style={{ minHeight: 26, height: 26, padding: "0 var(--space-2)" }}>
          <span className="type-meta-default">{t("remoteFolderGo", "Go ↵")}</span>
        </Button>
      </form>
      {error && (
        <p
          id={errorId}
          role="alert"
          className="type-label-medium"
          style={{ margin: 0, color: "var(--fx-status-danger-text)" }}
        >
          {error}
        </p>
      )}
      <nav aria-label={t("remoteFolderBreadcrumbs", "Folder breadcrumb")} style={{ overflowX: "auto" }}>
        <ol
          style={{
            listStyle: "none",
            display: "flex",
            alignItems: "center",
            gap: "var(--space-1-5)",
            margin: 0,
            padding: 0,
          }}
        >
          {crumbs.map((crumb, index) => (
            <li
              key={crumb.path}
              style={{ display: "flex", alignItems: "center", gap: "var(--space-1-5)", flexShrink: 0 }}
            >
              {index > 0 && (
                <span aria-hidden="true" style={{ color: "var(--fx-text-tertiary)" }}>
                  ›
                </span>
              )}
              <Button
                variant="ghost"
                disabled={unavailable}
                title={crumb.title}
                aria-current={index === crumbs.length - 1 ? "location" : undefined}
                onClick={() => onOpenPath(crumb.path)}
                style={{
                  minHeight: "var(--space-6)",
                  height: "var(--space-6)",
                  padding: "0 var(--space-1-5)",
                  background: index === crumbs.length - 1 ? "var(--fx-accent-blue-soft)" : "var(--fx-surface-card)",
                  color: index === crumbs.length - 1 ? "var(--fx-accent-blue-text)" : "var(--fx-text-secondary)",
                }}
              >
                <span className="type-mono-meta">{crumb.label}</span>
              </Button>
            </li>
          ))}
        </ol>
      </nav>
    </div>
  );
}
