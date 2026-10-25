import { useEffect, useId, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { useI18n } from "@/i18n";
import { abbreviateHomePath } from "@/lib/display-path";
import { getParentFilePath } from "@shared/file-paths";
import { GlideHighlight } from "../chat-input/GlideHighlight";
import { useFolderSuggestion } from "./use-folder-suggestion";
import {
  ACTION_ROW_HEIGHT,
  ELLIPSIS,
  FOLDER_PATH,
  HOUSE_PATHS,
  MenuIcon,
  ROW_STYLE,
  SwitcherKeyHints,
  SwitcherSearchRow,
  iconBox,
} from "./project-switcher-parts";

export interface SwitcherProject {
  root: string;
  name: string;
}

interface SwitcherRow {
  key: string;
  label: string;
  icon: ReactNode;
  detail?: string;
  title?: string;
  shortcut?: { label: string; aria: string };
  run: () => void;
}

function folderIcon(size?: number, strokeWidth?: number) {
  return (
    <MenuIcon size={size} strokeWidth={strokeWidth}>
      <path d={FOLDER_PATH} />
    </MenuIcon>
  );
}

export function ProjectSwitcherCard({
  spaceName,
  folderPath,
  homeDir,
  projects,
  inspectFolder,
  onOpenFolder,
  onChooseFolder,
  onBackToPersonalSpace,
  onChoose,
}: {
  spaceName: string;
  folderPath: string;
  homeDir: string;
  projects: readonly SwitcherProject[];
  inspectFolder?: (typed: string) => Promise<string | null>;
  onOpenFolder?: (folder: string) => void;
  onChooseFolder: () => void;
  onBackToPersonalSpace: () => void;
  onChoose: (run: () => void) => void;
}) {
  const { t } = useI18n();
  const mac = window.piBridge?.platform === "darwin";
  const [query, setQuery] = useState("");
  const [cursor, setCursor] = useState(-1);
  const inputRef = useRef<HTMLInputElement>(null);
  const baseId = useId();

  useEffect(() => inputRef.current?.focus(), []);

  const typed = query.trim();
  const needle = typed.toLocaleLowerCase();
  const folder = useFolderSuggestion(query, inspectFolder);
  const matches = typed
    ? projects.filter((project) =>
        [project.name, project.root, abbreviateHomePath(project.root, homeDir)].some((value) =>
          value.toLocaleLowerCase().includes(needle),
        ),
      )
    : [];

  const lead: SwitcherRow[] = [];
  if (folder && onOpenFolder) {
    lead.push({
      key: "open-folder",
      label: t("openFolderPath", "Open {path}").replace("{path}", typed),
      icon: folderIcon(),
      run: () => onOpenFolder(folder),
    });
  }
  if (typed && onOpenFolder) {
    for (const project of matches) {
      lead.push({
        key: project.root,
        label: project.name,
        detail: abbreviateHomePath(getParentFilePath(project.root), homeDir),
        title: project.root,
        icon: folderIcon(),
        run: () => onOpenFolder(project.root),
      });
    }
  }

  const actions: SwitcherRow[] = [
    {
      key: "add-folder",
      label: t("addProjectSpace", "Add project space from folder…"),
      icon: (
        <MenuIcon>
          <path d={FOLDER_PATH} />
          <path d="M12 11v6" />
          <path d="M9 14h6" />
        </MenuIcon>
      ),
      shortcut: mac ? { label: "⌘O", aria: "Meta+O" } : { label: "Ctrl O", aria: "Control+O" },
      run: onChooseFolder,
    },
    {
      key: "personal-space",
      label: t("backToPersonalSpace", "Back to personal space"),
      icon: (
        <MenuIcon>
          {HOUSE_PATHS.map((d) => (
            <path key={d} d={d} />
          ))}
        </MenuIcon>
      ),
      run: onBackToPersonalSpace,
    },
  ];

  const rows = [...lead, ...actions];
  const active = cursor >= 0 && cursor < rows.length ? cursor : typed !== "" && lead.length > 0 ? 0 : -1;

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.nativeEvent.isComposing) return;
    if (event.key === "ArrowDown") {
      event.preventDefault();
      event.stopPropagation();
      setCursor(active < 0 ? 0 : (active + 1) % rows.length);
      return;
    }
    if (event.key === "ArrowUp") {
      event.preventDefault();
      event.stopPropagation();
      setCursor(active <= 0 ? rows.length - 1 : active - 1);
      return;
    }
    if (event.key === "Enter" && active >= 0) {
      event.preventDefault();
      event.stopPropagation();
      onChoose(rows[active].run);
    }
  };

  const row = (entry: SwitcherRow, index: number) => (
    <button
      key={entry.key}
      id={`${baseId}-${index}`}
      type="button"
      role="menuitem"
      tabIndex={-1}
      aria-label={entry.label}
      aria-keyshortcuts={entry.shortcut?.aria}
      title={entry.title}
      className="type-body-default"
      onMouseEnter={() => setCursor(index)}
      onClick={() => onChoose(entry.run)}
      style={{
        ...ROW_STYLE,
        height: ACTION_ROW_HEIGHT,
        borderRadius: "var(--radius-control)",
        color: "var(--fx-text-body)",
        cursor: "pointer",
        position: "relative",
        zIndex: 1,
      }}
    >
      {iconBox(entry.icon)}
      <span
        style={{
          flex: 1,
          minWidth: 0,
          overflow: "hidden",
          textOverflow: "ellipsis",
          whiteSpace: "nowrap",
        }}
      >
        {entry.label}
      </span>
      {entry.detail && (
        <span
          aria-hidden="true"
          className="type-mono-meta"
          style={{ ...ELLIPSIS, maxWidth: "45%", flexShrink: 1, color: "var(--fx-text-tertiary)" }}
        >
          {entry.detail}
        </span>
      )}
      {entry.shortcut && (
        <span aria-hidden="true" className="type-mono-meta" style={{ flexShrink: 0, color: "var(--fx-text-tertiary)" }}>
          {entry.shortcut.label}
        </span>
      )}
    </button>
  );

  return (
    <>
      <SwitcherSearchRow
        inputRef={inputRef}
        value={query}
        label={t("projectSwitcherSearch", "Search or open a project…")}
        shortcut={mac ? "⌘P" : "Ctrl P"}
        activeId={active >= 0 ? `${baseId}-${active}` : undefined}
        onChange={(value) => {
          setQuery(value);
          setCursor(-1);
        }}
        onKeyDown={onKeyDown}
      />

      {typed === "" ? (
        <>
          <div style={{ display: "flex", alignItems: "center", padding: "10px 10px 4px 10px", flexShrink: 0 }}>
            <span className="type-meta-caps" style={{ color: "var(--fx-text-tertiary)" }}>
              {t("currentProjectGroup", "Current project")}
            </span>
          </div>

          <div style={{ ...ROW_STYLE, height: 46, borderRadius: "var(--radius-icon-box)" }}>
            {iconBox(folderIcon(18, 1.5))}
            <span style={{ display: "flex", flexDirection: "column", gap: 1, flex: 1, minWidth: 0 }}>
              <span className="type-body-large-medium" style={{ ...ELLIPSIS, color: "var(--fx-text-primary)" }}>
                {spaceName}
              </span>
              <span className="type-mono-meta" style={{ ...ELLIPSIS, color: "var(--fx-text-tertiary)" }}>
                {folderPath}
              </span>
            </span>
            <MenuIcon style={{ flexShrink: 0, color: "var(--fx-accent-blue-text)" }}>
              <polyline points="20 6 9 17 4 12" />
            </MenuIcon>
          </div>
        </>
      ) : (
        lead.length === 0 && (
          <div
            className="type-meta-default"
            style={{ padding: "10px 10px 4px 10px", color: "var(--fx-text-tertiary)" }}
          >
            {t("noMatchingProjects", "No matching projects")}
          </div>
        )
      )}

      <div
        style={{
          position: "relative",
          display: "flex",
          flexDirection: "column",
          gap: 2,
          maxHeight: 320,
          overflowY: "auto",
        }}
      >
        {lead.map((entry, index) => row(entry, index))}

        {(typed === "" || lead.length > 0) && (
          <div aria-hidden="true" style={{ padding: "5px 4px", flexShrink: 0 }}>
            <div style={{ height: 1, background: "var(--fx-line-default)" }} />
          </div>
        )}

        {actions.map((entry, index) => row(entry, lead.length + index))}

        <GlideHighlight
          rowSelector='[role="menuitem"]'
          activeIndex={active}
          visible={active >= 0}
          layoutKey={rows.map((entry) => entry.key).join("|")}
          insetX={0}
        />
      </div>

      <SwitcherKeyHints
        hints={[
          { keyLabel: "↑↓", label: t("menuKeySelect", "Select") },
          { keyLabel: "↵", label: t("projectSwitcherKeyOpen", "Open") },
          { keyLabel: "esc", label: t("menuKeyClose", "Close") },
        ]}
      />
    </>
  );
}
