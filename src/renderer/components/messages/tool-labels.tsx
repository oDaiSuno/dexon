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
  strokeWidth: 1.75,
  strokeLinecap: "round",
  strokeLinejoin: "round",
} as const;

export function ToolGlyph({ toolName }: { toolName: string }): ReactNode {
  if (/^(read|less)/i.test(toolName)) {
    return (
      <svg width="14" height="14" viewBox="0 0 24 24" {...ICON_STROKE}>
        <path d="M6 22a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h8a2.4 2.4 0 0 1 1.704.706l3.588 3.588A2.4 2.4 0 0 1 20 8v12a2 2 0 0 1-2 2z" />
        <path d="M14 2v5a1 1 0 0 0 1 1h5" />
        <path d="M10 9H8" />
        <path d="M16 13H8" />
        <path d="M16 17H8" />
      </svg>
    );
  }
  if (/^(edit|write|str_replace|replace|multiedit|notebook|apply|save)/i.test(toolName)) {
    return (
      <svg width="14" height="14" viewBox="0 0 24 24" {...ICON_STROKE}>
        <path d="M13 21h8" />
        <path d="m15 5 4 4" />
        <path d="M21.174 6.812a1 1 0 0 0-3.986-3.987L3.842 16.174a2 2 0 0 0-.5.83l-1.321 4.352a.5.5 0 0 0 .623.622l4.353-1.32a2 2 0 0 0 .83-.497z" />
      </svg>
    );
  }
  if (/^(bash|run|terminal|command|process|exec)/i.test(toolName)) {
    return (
      <svg width="14" height="14" viewBox="0 0 24 24" {...ICON_STROKE}>
        <path d="m7 11 2-2-2-2" />
        <path d="M11 13h4" />
        <rect width="18" height="18" x="3" y="3" rx="2" ry="2" />
      </svg>
    );
  }
  if (/^(grep|glob|search|find|list|ls)/i.test(toolName)) {
    return (
      <svg width="14" height="14" viewBox="0 0 24 24" {...ICON_STROKE}>
        <path d="m21 21-4.34-4.34" />
        <circle cx="11" cy="11" r="8" />
      </svg>
    );
  }
  if (/^browser/i.test(toolName)) {
    return (
      <svg width="14" height="14" viewBox="0 0 24 24" {...ICON_STROKE}>
        <circle cx="12" cy="12" r="10" />
        <path d="M12 2a14.5 14.5 0 0 0 0 20 14.5 14.5 0 0 0 0-20" />
        <path d="M2 12h20" />
      </svg>
    );
  }
  if (/^(task|agent|subagent|dispatch)/i.test(toolName)) {
    return (
      <svg width="14" height="14" viewBox="0 0 24 24" {...ICON_STROKE}>
        <path d="M12 8V4H8" />
        <rect width="16" height="12" x="4" y="8" rx="2" />
        <path d="M2 14h2" />
        <path d="M20 14h2" />
        <path d="M15 13v2" />
        <path d="M9 13v2" />
      </svg>
    );
  }
  if (/^(todo|plan|track)/i.test(toolName)) {
    return (
      <svg width="14" height="14" viewBox="0 0 24 24" {...ICON_STROKE}>
        <path d="M13 5h8" />
        <path d="M13 12h8" />
        <path d="M13 19h8" />
        <path d="m3 17 2 2 4-4" />
        <rect x="3" y="4" width="6" height="6" rx="1" />
      </svg>
    );
  }
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" {...ICON_STROKE}>
      <path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.106-3.105c.32-.322.863-.22.983.218a6 6 0 0 1-8.259 7.057l-7.91 7.91a1 1 0 0 1-2.999-3l7.91-7.91a6 6 0 0 1 7.057-8.259c.438.12.54.662.219.984z" />
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
