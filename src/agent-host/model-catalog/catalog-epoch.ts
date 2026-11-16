import { createHash } from "node:crypto";
import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import type { CatalogEpoch } from "./catalog-protocol.ts";

const PREFERENCE_ONLY_SETTINGS = new Set([
  "enabledModels",
  "defaultProvider",
  "defaultModel",
  "defaultThinkingLevel",
  "modelThinkingLevels",
]);

export function catalogInputs(cwd: string, agentDir: string): readonly string[] {
  return [
    ...["models.json", "models-store.json", "auth.json", "settings.json", "extensions"].map((name) =>
      path.join(agentDir, name),
    ),
    ...["models.json", "auth.json", "settings.json", "extensions"].map((name) => path.join(cwd, ".pi", name)),
  ];
}

function normalizedContent(file: string): string {
  const raw = readFileSync(file, "utf8").trim();
  if (path.basename(file) !== "settings.json") return raw;
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return raw;
    return JSON.stringify(
      Object.fromEntries(
        Object.entries(parsed as Record<string, unknown>)
          .filter(([key]) => !PREFERENCE_ONLY_SETTINGS.has(key))
          .sort(([a], [b]) => a.localeCompare(b)),
      ),
    );
  } catch {
    return raw;
  }
}

function digest(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function fingerprint(file: string): string {
  const contentBased = ["auth.json", "models-store.json", "settings.json"].includes(path.basename(file));
  try {
    const info = statSync(file);
    const own = `${file}:${info.size}:${info.mtimeMs}:${info.ctimeMs}:${info.ino}`;
    if (contentBased) return `${file}:${digest(normalizedContent(file))}`;
    if (!info.isDirectory()) return own;
    const children = readdirSync(file, { withFileTypes: true })
      .filter((child) => child.name !== "node_modules" && child.name !== ".git" && !child.isSymbolicLink())
      .sort((a, b) => a.name.localeCompare(b.name));
    return [own, ...children.map((child) => fingerprint(path.join(file, child.name)))].join("|");
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (contentBased && (code === "ENOENT" || code === "ENOTDIR")) {
      return `${file}:${digest("{}")}`;
    }
    return `${file}:${code ?? "unavailable"}`;
  }
}

export function catalogEpoch(cwd: string, agentDir: string, offline: boolean): CatalogEpoch {
  const inputs = catalogInputs(cwd, agentDir);
  const fingerprints = inputs.map(fingerprint);
  return {
    key: digest(JSON.stringify([agentDir, offline, fingerprints])),
    credentials: digest(
      JSON.stringify(fingerprints.filter((_, index) => /^(?:models|auth)\.json$/.test(path.basename(inputs[index])))),
    ),
  };
}
