import { Fragment, type KeyboardEvent, type ReactNode } from "react";
import { normalizeCustomPanelLines, parseAnsiLine } from "@/lib/ansi";
import { useI18n } from "@/i18n";
import type { InteractiveToolStore, ToolCardEntry } from "@/lib/interactive-tool-store";
export function toTerminalKeyData(e: KeyboardEvent): string | null {
  if (e.ctrlKey && !e.metaKey && !e.altKey && e.key.length === 1) {
    const ch = e.key.toLowerCase();
    if (ch >= "a" && ch <= "z") {
      return String.fromCharCode(ch.charCodeAt(0) - 96);
    }
  }

  switch (e.key) {
    case "ArrowUp":
      return "\x1b[A";
    case "ArrowDown":
      return "\x1b[B";
    case "ArrowRight":
      return "\x1b[C";
    case "ArrowLeft":
      return "\x1b[D";
    case "Enter":
      return "\r";
    case "Escape":
    case "Tab":
      return null;
    case "Backspace":
      return "\x7f";

    case " ":
      return " ";
    default:
      if (!e.ctrlKey && !e.metaKey && !e.altKey && e.key.length === 1) return e.key;
      return null;
  }
}
function renderAnsiLine(line: string, keyPrefix: string): ReactNode[] {
  return parseAnsiLine(line).map((segment, index) =>
    Object.keys(segment.style).length > 0 ? (
      <span key={`${keyPrefix}-${index}`} style={segment.style}>
        {segment.text}
      </span>
    ) : (
      segment.text
    ),
  );
}

export function TerminalContent({ entry, store }: { entry: ToolCardEntry; store: InteractiveToolStore }) {
  const { t } = useI18n();
  const { request } = entry;
  if (request.method !== "custom") return null;
  const lines = normalizeCustomPanelLines(request.lines);
  return (
    <div className="tool-form-body">
      <p className="tool-subtle" id={`terminal-hint-${request.id}`}>
        {t("toolTerminalHint", "Focus the panel to use its keyboard controls. Escape only collapses the card.")}
      </p>
      <pre
        tabIndex={0}
        role="textbox"
        aria-readonly="true"
        aria-label={t("toolCustomPanel", "Interactive panel")}
        aria-describedby={`terminal-hint-${request.id}`}
        className="tool-terminal"
        onKeyDown={(event) => {
          if (event.nativeEvent.isComposing || event.keyCode === 229 || entry.status === "sending") return;
          const data = toTerminalKeyData(event);
          if (!data) return;
          event.preventDefault();
          event.stopPropagation();
          store.input(request.id, data);
        }}
        onCompositionEnd={(event) => {
          if (event.data) store.input(request.id, event.data);
        }}
        onPaste={(event) => {
          const text = event.clipboardData.getData("text/plain");
          if (text) {
            event.preventDefault();
            store.input(request.id, text);
          }
        }}
      >
        {(lines.length ? lines : [""]).map((line, index) => (
          <Fragment key={index}>
            {renderAnsiLine(line, `line-${index}`)}
            {index < lines.length - 1 ? "\n" : null}
          </Fragment>
        ))}
      </pre>
      <div className="tool-footer-actions">
        <button
          type="button"
          className="tool-pill"
          disabled={entry.status === "sending"}
          onClick={() => store.input(request.id, "\t")}
        >
          {t("toolPanelTab", "Send Tab to panel")}
        </button>
      </div>
    </div>
  );
}
