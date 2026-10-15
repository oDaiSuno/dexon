#!/usr/bin/env node
import path from "node:path";
import { fileURLToPath } from "node:url";
import { assertTestHygiene } from "./test-hygiene.mjs";
import { runTests } from "./test-runner.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
try {
  // 宪法先于居民：卫生守卫在套件启动前拦截新增违规（存量豁免见 test-hygiene-allowlist.mjs）
  assertTestHygiene(root);
  runTests(root);
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}
