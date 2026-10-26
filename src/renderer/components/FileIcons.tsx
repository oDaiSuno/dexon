import type { ReactNode } from "react";

interface IconProps {
  size?: number;
}

type FileKind = "code" | "json" | "text" | "plain";

const FILE_OUTLINE =
  "M6 22a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h8a2.4 2.4 0 0 1 1.704.706l3.588 3.588A2.4 2.4 0 0 1 20 8v12a2 2 0 0 1-2 2z";
const FILE_FOLD = "M14 2v5a1 1 0 0 0 1 1h5";

const FILE_MARKS: Record<FileKind, string[]> = {
  code: ["M10 12.5 8 15l2 2.5", "m14 12.5 2 2.5-2 2.5"],
  json: [
    "M10 12a1 1 0 0 0-1 1v1a1 1 0 0 1-1 1 1 1 0 0 1 1 1v1a1 1 0 0 0 1 1",
    "M14 18a1 1 0 0 0 1-1v-1a1 1 0 0 1 1-1 1 1 0 0 1-1-1v-1a1 1 0 0 0-1-1",
  ],
  text: ["M10 9H8", "M16 13H8", "M16 17H8"],
  plain: [],
};

const CODE_EXTENSIONS = new Set([
  "ts",
  "tsx",
  "mts",
  "cts",
  "js",
  "jsx",
  "mjs",
  "cjs",
  "css",
  "scss",
  "less",
  "html",
  "htm",
  "vue",
  "svelte",
  "py",
  "rs",
  "go",
  "java",
  "kt",
  "swift",
  "c",
  "h",
  "cpp",
  "hpp",
  "cs",
  "rb",
  "php",
  "sh",
  "bash",
  "zsh",
  "fish",
  "sql",
  "graphql",
  "gql",
  "tf",
  "hcl",
  "yaml",
  "yml",
  "toml",
  "xml",
]);
const JSON_EXTENSIONS = new Set(["json", "jsonc", "jsonl", "json5"]);
const TEXT_EXTENSIONS = new Set(["md", "mdx", "txt", "rst", "log", "doc", "docx", "pdf", "rtf"]);
const CODE_FILE_NAMES = new Set(["dockerfile", "makefile", ".gitignore", ".gitattributes", ".gitmodules"]);

function LineIcon({ size, color, children }: { size: number; color: string; children: ReactNode }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke={color}
      strokeWidth="1.75"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {children}
    </svg>
  );
}

export function FolderIcon({
  size = 14,
  open = false,
  color = "var(--fx-text-tertiary)",
}: IconProps & { open?: boolean; color?: string }) {
  return (
    <LineIcon size={size} color={color}>
      {open ? (
        <path d="m6 14 1.5-2.9A2 2 0 0 1 9.24 10H20a2 2 0 0 1 1.94 2.5l-1.54 6a2 2 0 0 1-1.95 1.5H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h3.9a2 2 0 0 1 1.69.9l.81 1.2a2 2 0 0 0 1.67.9H18a2 2 0 0 1 2 2v2" />
      ) : (
        <path d="M20 20a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9L9.6 3.9A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2Z" />
      )}
    </LineIcon>
  );
}

function FileIcon({ kind, size }: { kind: FileKind; size: number }) {
  return (
    <LineIcon size={size} color="var(--fx-text-tertiary)">
      <path d={FILE_OUTLINE} />
      <path d={FILE_FOLD} />
      {FILE_MARKS[kind].map((d) => (
        <path key={d} d={d} />
      ))}
    </LineIcon>
  );
}

function fileKind(name: string): FileKind {
  const lower = name.toLowerCase();
  if (CODE_FILE_NAMES.has(lower) || lower.startsWith("dockerfile.") || lower.startsWith(".env")) return "code";
  const ext = lower.includes(".") ? (lower.split(".").pop() ?? "") : "";
  if (JSON_EXTENSIONS.has(ext)) return "json";
  if (TEXT_EXTENSIONS.has(ext)) return "text";
  if (CODE_EXTENSIONS.has(ext)) return "code";
  return "plain";
}

export function getFileIcon(name: string, size = 14): ReactNode {
  return <FileIcon kind={fileKind(name)} size={size} />;
}
