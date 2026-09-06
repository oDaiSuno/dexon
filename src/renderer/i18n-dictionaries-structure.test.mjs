import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import test from "node:test";
import { dictionaries, enUS, zhCN } from "./i18n-dictionaries.ts";

const partialDir = new URL("./i18n/", import.meta.url);

function partialFiles() {
  return readdirSync(partialDir)
    .filter((name) => name.endsWith(".ts"))
    .sort();
}

test("every dictionary partial is wired into the composition root", () => {
  const root = readFileSync(new URL("./i18n-dictionaries.ts", import.meta.url), "utf8");
  const files = partialFiles();
  assert.ok(files.length > 0, "dictionary partial directory must not be empty");
  for (const file of files) {
    assert.ok(root.includes(`./i18n/${file}`), `composition root must import ./i18n/${file}`);
  }
});

test("partial key sets are disjoint and together cover the composed dictionaries", async () => {
  const seen = new Map();
  const mergedEN = {};
  const mergedZH = {};
  for (const file of partialFiles()) {
    const mod = await import(`./i18n/${file}`);
    assert.ok(mod.enUS && mod.zhCN, `${file} must export enUS and zhCN`);
    for (const [language, map, merged] of [
      ["en", mod.enUS, mergedEN],
      ["zh", mod.zhCN, mergedZH],
    ]) {
      for (const [key, value] of Object.entries(map)) {
        const marker = `${language}:${key}`;
        assert.ok(!seen.has(marker), `${language} key ${key} is defined in both ${seen.get(marker)} and ${file}`);
        seen.set(marker, file);
        merged[key] = value;
      }
    }
  }
  assert.deepEqual(enUS, mergedEN, "composed en-US must equal the merged partial values");
  assert.deepEqual(zhCN, mergedZH, "composed zh-CN must equal the merged partial values");
});

// Value fingerprints pin the composed dictionaries to the content verified
// key-for-key against the pre-split original (1015 keys × 2 languages).
// Any value drift — not just key drift — fails this test.
function fingerprint(record) {
  return createHash("sha256")
    .update(
      Object.keys(record)
        .sort()
        .map((key) => `${key}\u0000${record[key]}`)
        .join("\u0001"),
    )
    .digest("hex");
}

test("composed dictionary values match the verified pre-split baseline", () => {
  assert.equal(
    fingerprint(enUS),
    "a0f49b4ce5c9f7c436cfd6c67f9e8d575475ff9aabe7d55840bc2e681cfa22c1",
    "en-US values drifted from the verified pre-split dictionary",
  );
  assert.equal(
    fingerprint(zhCN),
    "b63505953caceb84039315255d010fefcbfcf8deccb692dc8908a9c11092f52b",
    "zh-CN values drifted from the verified pre-split dictionary",
  );
});

test("composition root keeps the historical export contract", () => {
  assert.equal(dictionaries["en-US"], enUS);
  assert.equal(dictionaries["zh-CN"], zhCN);
  assert.equal(Object.keys(enUS).length, Object.keys(zhCN).length);
});

test("dictionary files stay within the 500-line budget", () => {
  for (const file of ["i18n-dictionaries.ts", ...partialFiles()]) {
    const prefix = file === "i18n-dictionaries.ts" ? "./" : "./i18n/";
    const source = readFileSync(new URL(`${prefix}${file}`, import.meta.url), "utf8");
    const lines = source.split("\n").length;
    assert.ok(lines <= 500, `${file} has ${lines} lines (budget 500)`);
  }
});
