import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { scanColorLiterals } from "./scan.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const LEDGER_DIR = path.join(root, "scripts/design-colors/ledger");
const EXEMPTIONS_FILE = "exemptions.json";
const SCAN_ROOTS = ["src/renderer", "src/main", "src/shared"];
const TOKEN_SOURCE = "src/renderer/styles/tokens.css";
const SCANNED_FILE = /\.(?:ts|tsx|css|html)$/;
const SKIPPED_FILE = /\.(?:test|harness)\.|\.d\.ts$/;

const keyOf = (file, color) => `${file}\u0000${color}`;

function collectFiles(directory, files = []) {
  for (const name of readdirSync(directory)) {
    const absolute = path.join(directory, name);
    if (statSync(absolute).isDirectory()) collectFiles(absolute, files);
    else if (SCANNED_FILE.test(name) && !SKIPPED_FILE.test(name)) files.push(path.relative(root, absolute));
  }
  return files;
}

export function scanInterfaceColors() {
  return SCAN_ROOTS.flatMap((directory) => collectFiles(path.join(root, directory)))
    .filter((relative) => relative !== TOKEN_SOURCE)
    .sort()
    .flatMap((relative) => scanColorLiterals(relative, readFileSync(path.join(root, relative), "utf8")));
}

export function readLedgers() {
  return readdirSync(LEDGER_DIR)
    .filter((name) => name.endsWith(".json"))
    .sort()
    .map((name) => ({ name, ...JSON.parse(readFileSync(path.join(LEDGER_DIR, name), "utf8")) }));
}

function registeredAllowance(ledgers, failures) {
  const allowance = new Map();
  for (const ledger of ledgers) {
    const owner = ledger.name === EXEMPTIONS_FILE ? "永久豁免" : ledger.lane;
    for (const entry of ledger.entries) {
      const key = keyOf(entry.file, entry.color);
      if (allowance.has(key)) {
        failures.push(`${entry.file} 的 ${entry.color} 在 ${allowance.get(key).owner} 和 ${owner} 重复登记`);
        continue;
      }
      if (ledger.name === EXEMPTIONS_FILE && !entry.reason?.trim()) {
        failures.push(`${entry.file} 的 ${entry.color} 是永久豁免，必须写明 reason`);
      }
      allowance.set(key, { ...entry, owner, ledger: ledger.name });
    }
  }
  return allowance;
}

export function checkColorLedger() {
  const failures = [];
  const allowance = registeredAllowance(readLedgers(), failures);
  const found = new Map();
  for (const finding of scanInterfaceColors()) {
    const key = keyOf(finding.file, finding.color);
    const lines = found.get(key) ?? [];
    lines.push(finding.line);
    found.set(key, lines);
  }

  for (const [key, lines] of found) {
    const [file, color] = key.split("\u0000");
    const registered = allowance.get(key);
    if (!registered) {
      failures.push(
        `${file}:${lines.join(",")} 写死了颜色 ${color}：改用 tokens.css 的语义令牌（var(--…)）；读不到 CSS 变量的地方从 framer-tokens.json 取值`,
      );
    } else if (lines.length > registered.count) {
      failures.push(
        `${file}:${lines.join(",")} 的 ${color} 出现 ${lines.length} 次，清单（${registered.ledger}）只登记了 ${registered.count} 次：新增的必须改用语义令牌`,
      );
    }
  }

  for (const [key, registered] of allowance) {
    const seen = found.get(key)?.length ?? 0;
    if (seen < registered.count) {
      failures.push(
        `${registered.file} 的 ${registered.color} 已从 ${registered.count} 处减到 ${seen} 处：请把 ${registered.ledger} 里这条的 count 改成 ${seen}${seen === 0 ? "（或直接删掉这条）" : ""}`,
      );
    }
  }
  return failures;
}
