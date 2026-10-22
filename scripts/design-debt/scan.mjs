import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import postcss from "postcss";
import ts from "typescript";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const SCAN_ROOT = "src/renderer";
const SCANNED_FILE = /\.(?:ts|tsx|css)$/;
const SKIPPED_FILE = /\.(?:test|harness)\.|\.d\.ts$/;
const GENERATED = new Set(["src/renderer/styles/tokens.css", "src/renderer/styles/typography.css"]);
const STANDALONE_PAGES = new Set(["src/renderer/lib/docx-preview-html.ts"]);

const VARIABLE_USE = /var\(\s*(--[\w-]+)/g;
const TYPOGRAPHY_CSS = new Set(["font-size", "font-weight", "line-height", "letter-spacing"]);
const TYPOGRAPHY_JS = new Set(["fontSize", "fontWeight", "lineHeight", "letterSpacing"]);

function collect(directory, files = []) {
  for (const name of readdirSync(directory)) {
    const absolute = path.join(directory, name);
    if (statSync(absolute).isDirectory()) collect(absolute, files);
    else if (SCANNED_FILE.test(name) && !SKIPPED_FILE.test(name)) files.push(path.relative(root, absolute));
  }
  return files;
}

export function interfaceFiles() {
  return collect(path.join(root, SCAN_ROOT))
    .filter((relative) => !GENERATED.has(relative) && !STANDALONE_PAGES.has(relative))
    .sort();
}

function lineOf(source, index) {
  return source.slice(0, index).split("\n").length;
}

export function variableUses(relative, source) {
  return [...source.matchAll(VARIABLE_USE)].map((match) => ({
    file: relative,
    line: lineOf(source, match.index),
    name: match[1],
  }));
}

export function locallyDefinedVariables(relative, source) {
  const names = new Set();
  if (relative.endsWith(".css")) {
    postcss.parse(source, { from: relative }).walkDecls((decl) => {
      if (decl.prop.startsWith("--")) names.add(decl.prop);
    });
    return names;
  }
  for (const match of source.matchAll(/["'`](--[\w-]+)["'`]\s*[:,)]/g)) names.add(match[1]);
  for (const match of source.matchAll(/setProperty\(\s*["'`](--[\w-]+)/g)) names.add(match[1]);
  return names;
}

function propertyName(node) {
  if (ts.isIdentifier(node) || ts.isStringLiteral(node)) return node.text;
  return null;
}

function cssTypography(relative, source) {
  const findings = [];
  postcss.parse(source, { from: relative }).walkDecls((decl) => {
    if (decl.parent?.type === "atrule" && decl.parent.name === "font-face") return;
    if (TYPOGRAPHY_CSS.has(decl.prop)) {
      findings.push({ file: relative, line: decl.source?.start?.line ?? 0, property: decl.prop });
    }
  });
  return findings;
}

function scriptTypography(relative, source) {
  const kind = relative.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS;
  const file = ts.createSourceFile(relative, source, ts.ScriptTarget.Latest, true, kind);
  const findings = [];
  const visit = (node) => {
    if (ts.isPropertyAssignment(node)) {
      const name = propertyName(node.name);
      if (name && TYPOGRAPHY_JS.has(name)) {
        const line = file.getLineAndCharacterOfPosition(node.getStart(file)).line + 1;
        findings.push({ file: relative, line, property: name });
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(file);
  return findings;
}

export function typographyLiterals(relative, source) {
  return relative.endsWith(".css") ? cssTypography(relative, source) : scriptTypography(relative, source);
}

export function readSource(relative) {
  return readFileSync(path.join(root, relative), "utf8");
}
