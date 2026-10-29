import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { locate7za } from "./seven-zip.mjs";

const REQUIRED_EXECUTABLE = "Dexon.exe";
const UNINSTALLER = "Uninstall Dexon.exe";

export function parseArchiveListing(listing) {
  return listing
    .split(/\r?\n\r?\n/u)
    .filter((block) => /^Path = /mu.test(block))
    .slice(1)
    .map((block) => ({
      path: normalisePath(/^Path = (.*)$/mu.exec(block)[1]),
      dir: /^Attributes = D/mu.test(block),
    }));
}

export function parseLegacyList(text) {
  return text
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .filter(Boolean)
    .map(normalisePath);
}

export function mergeFileList(archiveEntries, legacyFiles) {
  const legacy = new Set(legacyFiles);
  for (const file of legacyFiles) {
    for (const folder of ancestors(file)) {
      if (legacy.has(folder)) throw new Error(`legacy list must contain files only: ${folder}`);
    }
  }

  const files = new Set();
  const folders = new Set();
  for (const entry of archiveEntries) (entry.dir ? folders : files).add(entry.path);
  for (const file of legacyFiles) files.add(file);
  for (const file of [...files]) {
    if (file.toLowerCase() === UNINSTALLER.toLowerCase()) files.delete(file);
  }

  for (const file of files) for (const folder of ancestors(file)) folders.add(folder);
  for (const file of files) {
    if (folders.has(file)) throw new Error(`path is both a file and a folder: ${file}`);
  }
  return { files: [...files].sort(), folders: sortFolders(folders) };
}

export function renderNsisMacros({ files, folders }) {
  return renderMacro("dexonFiles", files) + renderMacro("dexonDirs", folders);
}

function renderMacro(name, items) {
  return [
    `!macro ${name} CB`,
    ...items.map((item) => `  !insertmacro \${CB} ${quoteNsis(item)}`),
    "!macroend",
    "",
  ].join("\n");
}

function quoteNsis(item) {
  return `"${item.replaceAll("$", () => "$$")}"`;
}

function normalisePath(value) {
  const trimmed = value.trim();
  if (trimmed === "") throw new Error("path must not be empty");
  if (/["\r\n]/u.test(trimmed)) throw new Error(`path must not contain quotes or line breaks: ${trimmed}`);
  const windowsPath = trimmed.replaceAll("/", "\\").replace(/\\+$/u, "");
  if (/^(?:\\|[A-Za-z]:)/u.test(windowsPath)) {
    throw new Error(`path must stay inside the install folder: ${trimmed}`);
  }
  const segments = windowsPath.split("\\");
  if (segments.includes("..")) throw new Error(`path must stay inside the install folder: ${trimmed}`);
  if (segments.includes("")) throw new Error(`path must not contain empty segments: ${trimmed}`);
  return segments.join("\\");
}

function ancestors(file) {
  const segments = file.split("\\");
  const parents = [];
  for (let index = segments.length - 1; index > 0; index -= 1) parents.push(segments.slice(0, index).join("\\"));
  return parents;
}

function sortFolders(folders) {
  return [...folders].sort((left, right) => {
    const depth = right.split("\\").length - left.split("\\").length;
    if (depth !== 0) return depth;
    if (left === right) return 0;
    return left < right ? -1 : 1;
  });
}

async function generate([archiveArgument, legacyArgument, outputArgument, ...extra]) {
  if (!archiveArgument || !legacyArgument || !outputArgument || extra.length > 0) {
    throw new Error("Usage: nsis-file-list.mjs <app-package.7z> <legacy-file-list.txt> <out.nsh>");
  }
  const archive = path.resolve(archiveArgument);
  const legacyList = path.resolve(legacyArgument);
  const archiveEntries = parseArchiveListing(listArchive(await locate7za(), archive));
  if (!archiveEntries.some((entry) => !entry.dir && entry.path === REQUIRED_EXECUTABLE)) {
    throw new Error(`app package must contain ${REQUIRED_EXECUTABLE}: ${archive}`);
  }
  const merged = mergeFileList(archiveEntries, parseLegacyList(fs.readFileSync(legacyList, "utf8")));
  fs.writeFileSync(path.resolve(outputArgument), renderNsisMacros(merged), "utf8");
}

function listArchive(sevenZip, archive) {
  return execFileSync(sevenZip, ["l", "-slt", "-sccUTF-8", archive], {
    encoding: "utf8",
    maxBuffer: 32 * 1024 * 1024,
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  try {
    await generate(process.argv.slice(2));
  } catch (error) {
    console.error(`nsis-file-list: ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  }
}
