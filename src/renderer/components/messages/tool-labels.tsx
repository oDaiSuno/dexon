import type { ReactNode } from "react";

/* Humanized tool labels + glyphs (Beautiful UI ToolChips pattern:
   verb label + mono argument chip). Unknown tools fall back to
   their raw name with a generic glyph. */

export function toolVerbLabel(toolName: string, t: (key: string, fallback: string) => string): string {
  if (/^(read|view|cat|less)/i.test(toolName)) return t("toolRead", "Read");
  if (/^(edit|write|str_replace|replace|multiedit|notebook|apply|save)/i.test(toolName)) return t("toolEdit", "Edit");
  if (/^(bash|run|terminal|command|process|exec)/i.test(toolName)) return t("toolRun", "Run");
  if (/^(grep|glob|search|find|list|ls)/i.test(toolName)) return t("toolSearch", "Search");
  if (/^browser/i.test(toolName)) return t("toolBrowse", "Browse");
  if (/^(task|agent|subagent|dispatch)/i.test(toolName)) return t("toolAgent", "Task");
  if (/^(todo|plan|track)/i.test(toolName)) return t("toolPlan", "Plan");
  return toolName;
}

const ICON_STROKE = {
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 2,
  strokeLinecap: "round",
  strokeLinejoin: "round",
} as const;

export function ToolGlyph({ toolName }: { toolName: string }): ReactNode {
  if (/^(read|less)/i.test(toolName)) {
    return (
      <svg width="13" height="13" viewBox="0 0 24 24" {...ICON_STROKE}>
        <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
        <path d="M14 2v6h6" />
      </svg>
    );
  }
  if (/^(edit|write|str_replace|replace|multiedit|notebook|apply|save)/i.test(toolName)) {
    return (
      <svg width="13" height="13" viewBox="0 0 24 24" {...ICON_STROKE}>
        <path d="M17 3a2.8 2.8 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5z" />
      </svg>
    );
  }
  if (/^(bash|run|terminal|command|process|exec)/i.test(toolName)) {
    return (
      <svg width="13" height="13" viewBox="0 0 24 24" {...ICON_STROKE}>
        <path d="M4 17l6-5-6-5M12 19h8" />
      </svg>
    );
  }
  if (/^(grep|glob|search|find|list|ls)/i.test(toolName)) {
    return (
      <svg width="13" height="13" viewBox="0 0 24 24" {...ICON_STROKE}>
        <circle cx="11" cy="11" r="7" />
        <path d="M21 21l-4.3-4.3" />
      </svg>
    );
  }
  if (/^browser/i.test(toolName)) {
    return (
      <svg width="13" height="13" viewBox="0 0 24 24" {...ICON_STROKE}>
        <circle cx="12" cy="12" r="9" />
        <path d="M3.5 12h17M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18" />
      </svg>
    );
  }
  if (/^(task|agent|subagent|dispatch)/i.test(toolName)) {
    return (
      <svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor">
        <path d="M12 2l2.4 7.2L22 12l-7.6 2.8L12 22l-2.4-7.2L2 12l7.6-2.8z" />
      </svg>
    );
  }
  if (/^(todo|plan|track)/i.test(toolName)) {
    return (
      <svg width="13" height="13" viewBox="0 0 24 24" {...ICON_STROKE}>
        <path d="M8 6h13M8 12h13M8 18h13" />
        <path d="M3 6h.01M3 12h.01M3 18h.01" />
      </svg>
    );
  }
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" {...ICON_STROKE}>
      <path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z" />
    </svg>
  );
}

export function countDiffLines(diffText: string): { added: number; removed: number } {
  let added = 0;
  let removed = 0;
  for (const line of diffText.split(/\r?\n/)) {
    if (line.startsWith("+") && !line.startsWith("+++")) added += 1;
    else if (line.startsWith("-") && !line.startsWith("---")) removed += 1;
  }
  return { added, removed };
}
