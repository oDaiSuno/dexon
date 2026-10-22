import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { framerColorVariable, readFramerTokens } from "../framer-tokens.mjs";
import { interfaceFiles, locallyDefinedVariables, readSource, typographyLiterals, variableUses } from "./scan.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const LEDGER_DIR = path.join(root, "scripts/design-debt/ledger");
const DESIGN_SOURCES = ["src/renderer/styles/tokens.css", "src/renderer/styles/motion-tokens.css"];

const LEGACY_START = "/* legacy";

function readJson(name) {
  return JSON.parse(readFileSync(path.join(LEDGER_DIR, name), "utf8"));
}

export function readDebtLedgers() {
  return readdirSync(LEDGER_DIR)
    .filter((name) => name.endsWith(".json"))
    .sort()
    .map((name) => ({ name, ...readJson(name) }));
}

export function legacyNames() {
  const tokens = readFileSync(path.join(root, DESIGN_SOURCES[0]), "utf8");
  const from = tokens.indexOf(LEGACY_START);
  if (from < 0) return new Set();
  const block = tokens.slice(from, tokens.indexOf("\n}", from));
  return new Set([...block.matchAll(/^\s*(--[\w-]+)\s*:/gm)].map((match) => match[1]));
}

function designNames() {
  const names = new Set(Object.keys(readFramerTokens().colors).map(framerColorVariable));
  for (const relative of DESIGN_SOURCES) {
    const css = readFileSync(path.join(root, relative), "utf8");
    for (const match of css.matchAll(/^\s*(--[\w-]+)\s*:/gm)) names.add(match[1]);
  }
  return names;
}

function tally(findings, keyOf) {
  const counts = new Map();
  for (const finding of findings) {
    const key = keyOf(finding);
    const entry = counts.get(key) ?? { ...finding, lines: [] };
    entry.lines.push(finding.line);
    counts.set(key, entry);
  }
  return counts;
}

function compareToLedger(found, allowance, describe, failures) {
  for (const [key, entry] of found) {
    const registered = allowance.get(key);
    if (!registered) failures.push(describe.unregistered(entry));
    else if (entry.lines.length > registered.count) failures.push(describe.grew(entry, registered));
  }
  for (const [key, registered] of allowance) {
    const seen = found.get(key)?.lines.length ?? 0;
    if (seen < registered.count) failures.push(describe.shrank(registered, seen));
  }
}

function allowanceOf(ledgers, field, keyOf, failures) {
  const allowance = new Map();
  for (const ledger of ledgers) {
    for (const entry of ledger[field] ?? []) {
      const key = keyOf(entry);
      if (allowance.has(key)) {
        failures.push(
          `${entry.file} 的 ${entry.name ?? entry.property} 在 ${allowance.get(key).owner} 和 ${ledger.lane} 重复登记`,
        );
        continue;
      }
      allowance.set(key, { ...entry, owner: ledger.lane, ledger: ledger.name });
    }
  }
  return allowance;
}

const legacyKey = (entry) => `${entry.file}\u0000${entry.name}`;
const typographyKey = (entry) => `${entry.file}\u0000${entry.property}`;

export function scanDesignDebt() {
  const legacy = legacyNames();
  const known = designNames();
  const sources = interfaceFiles().map((file) => ({ file, source: readSource(file) }));
  const runtime = new Set(sources.flatMap(({ file, source }) => [...locallyDefinedVariables(file, source)]));
  const uses = sources.flatMap(({ file, source }) => variableUses(file, source));
  return {
    unknown: uses.filter((use) => !known.has(use.name) && !runtime.has(use.name) && !use.name.startsWith("--tw-")),
    legacy: uses.filter((use) => legacy.has(use.name)),
    typography: sources.flatMap(({ file, source }) => typographyLiterals(file, source)),
  };
}

export function checkDesignDebt() {
  const failures = [];
  const ledgers = readDebtLedgers();
  const { unknown, legacy, typography } = scanDesignDebt();

  for (const use of unknown) {
    failures.push(
      `${use.file}:${use.line} 用了不存在的设计名 ${use.name}：改用 Framer 颜色 --fx-*（见 framer-tokens.json）或 tokens.css 里的阴影/圆角/间距`,
    );
  }

  compareToLedger(
    tally(legacy, legacyKey),
    allowanceOf(ledgers, "legacy", legacyKey, failures),
    {
      unregistered: (entry) =>
        `${entry.file}:${entry.lines.join(",")} 用了已退役的名字 ${entry.name}：颜色改用 Framer 的 --fx-*，文字改用 .type-* 类`,
      grew: (entry, registered) =>
        `${entry.file}:${entry.lines.join(",")} 的 ${entry.name} 用了 ${entry.lines.length} 次，清单（${registered.ledger}）只允许 ${registered.count} 次：新增的必须改用 Framer 名字`,
      shrank: (registered, seen) =>
        `${registered.file} 的 ${registered.name} 已从 ${registered.count} 处减到 ${seen} 处：把 ${registered.ledger} 里这条改成 ${seen}${seen === 0 ? "（或删掉这条）" : ""}`,
    },
    failures,
  );

  compareToLedger(
    tally(typography, typographyKey),
    allowanceOf(ledgers, "typography", typographyKey, failures),
    {
      unregistered: (entry) =>
        `${entry.file}:${entry.lines.join(",")} 直接写了 ${entry.property}：改用 typography.css 里与 Framer 文字样式同名的 .type-* 类`,
      grew: (entry, registered) =>
        `${entry.file}:${entry.lines.join(",")} 的 ${entry.property} 写了 ${entry.lines.length} 次，清单（${registered.ledger}）只允许 ${registered.count} 次：新增的必须改用 .type-* 类`,
      shrank: (registered, seen) =>
        `${registered.file} 的 ${registered.property} 已从 ${registered.count} 处减到 ${seen} 处：把 ${registered.ledger} 里这条改成 ${seen}${seen === 0 ? "（或删掉这条）" : ""}`,
    },
    failures,
  );

  for (const name of legacyNames()) {
    if (!legacy.some((use) => use.name === name)) {
      failures.push(`tokens.css 的退役名 ${name} 已经没人用了：从 legacy 区块删掉`);
    }
  }
  return failures;
}

export function remainingDebt() {
  return readDebtLedgers()
    .filter((ledger) => !ledger.permanent)
    .map((ledger) => ({
      lane: ledger.lane,
      legacy: (ledger.legacy ?? []).reduce((sum, entry) => sum + entry.count, 0),
      typography: (ledger.typography ?? []).reduce((sum, entry) => sum + entry.count, 0),
    }))
    .filter((row) => row.legacy + row.typography > 0);
}
