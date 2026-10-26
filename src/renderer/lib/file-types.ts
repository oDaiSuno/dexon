import { getFileExt } from "@shared/file-types";

export * from "@shared/file-types";

const LANGUAGE_NAMES_BY_EXT: Readonly<Record<string, string>> = {
  ts: "TypeScript",
  tsx: "TypeScript JSX",
  js: "JavaScript",
  jsx: "JavaScript JSX",
  mjs: "JavaScript",
  cjs: "JavaScript",
  py: "Python",
  rb: "Ruby",
  go: "Go",
  rs: "Rust",
  java: "Java",
  kt: "Kotlin",
  swift: "Swift",
  c: "C",
  h: "C",
  cpp: "C++",
  hpp: "C++",
  cs: "C#",
  html: "HTML",
  htm: "HTML",
  css: "CSS",
  scss: "SCSS",
  less: "Less",
  json: "JSON",
  jsonl: "JSON Lines",
  yaml: "YAML",
  yml: "YAML",
  toml: "TOML",
  xml: "XML",
  md: "Markdown",
  mdx: "MDX",
  sh: "Shell",
  bash: "Bash",
  zsh: "Zsh",
  fish: "Fish",
  sql: "SQL",
};

const LANGUAGE_NAMES_BY_ID: Readonly<Record<string, string>> = {
  bash: "Shell",
  dockerfile: "Dockerfile",
  makefile: "Makefile",
};

export function getLanguageDisplayName(filePath: string, language: string): string | null {
  const byExt = LANGUAGE_NAMES_BY_EXT[getFileExt(filePath)];
  if (byExt) return byExt;
  if (language === "text") return null;
  return LANGUAGE_NAMES_BY_ID[language] ?? language;
}
