/**
 * 测试卫生守卫 —— 新套件「宪法」的机器部分。
 *
 * 改名关由人工评审与重构实验判断。机器只拦截可识别的反模式：
 *   1) 测试文件把自家生产源码当文本读取后做断言（源码快照/结构正则）；
 *   2) 测试以虚拟模块替换自家实现（不依赖命名），或记录内部调用轨迹；
 *   3) 读取测试专用内部状态，或断言 React 组件的实现标记。
 * 入口还会跟随相对导入，检查测试使用的 .mjs 辅助文件。
 *
 * 宪法第二、三条（造句关、独立关）无法可靠地机器判定，见 tests/README.md，由评审执行。
 *
 * 存量豁免账本已清空；完成标准还包括入口覆盖、行为覆盖和完整验证。
 * 已知盲区：动态导入路径、动态生成构建插件与复杂读取转发无法普遍静态识别。守卫会把「检测不再命中」的豁免条目单独报告——那可能是真清账，
 * 也可能是盲区，必须人工认后才可移除。守卫是减速带与进度表，不是完美监狱。
 */
import { globSync, readFileSync } from "node:fs";
import path from "node:path";
import { allowlist } from "./test-hygiene-allowlist.mjs";

import { findTestHygieneViolations, relativeTestImports } from "./test-hygiene-rules.mjs";
export { findTestHygieneViolations };

function listTestFiles(root, fileSystem) {
  return [
    ...fileSystem.globSync("src/**/*.test.mjs", { cwd: root }),
    ...fileSystem.globSync("scripts/**/*.test.mjs", { cwd: root }),
    ...fileSystem.globSync("tests/**/*.test.mjs", { cwd: root }),
  ]
    .map((file) => file.replaceAll("\\", "/"))
    .sort();
}

export function collectTestHygiene(root, fileSystem = { globSync, readFileSync }) {
  const exemptFiles = new Set(allowlist.map((entry) => entry.file));
  const detected = [];
  const queue = listTestFiles(root, fileSystem);
  const seen = new Set();
  while (queue.length > 0) {
    const file = queue.shift();
    if (seen.has(file)) continue;
    seen.add(file);
    const source = fileSystem.readFileSync(path.join(root, file), "utf8");
    const rules = findTestHygieneViolations(source);
    if (rules.length > 0) detected.push({ file, rules });
    for (const imported of relativeTestImports(source)) {
      const helper = path.posix.normalize(path.posix.join(path.posix.dirname(file), imported));
      // Static-check programs are products with their own public behavior, not
      // renderer test doubles. Only follow the application's test-support graph.
      if (helper.startsWith("src/") || helper.startsWith("tests/")) queue.push(helper);
    }
  }
  detected.sort((a, b) => a.file.localeCompare(b.file));
  const blocking = detected.filter((entry) => !exemptFiles.has(entry.file));
  const exempted = detected.filter((entry) => exemptFiles.has(entry.file));
  const undetected = allowlist.filter((entry) => !detected.some((hit) => hit.file === entry.file));
  return { detected, blocking, exempted, undetected };
}

export function assertTestHygiene(root, fileSystem) {
  const { blocking, exempted, undetected } = collectTestHygiene(root, fileSystem);
  if (blocking.length > 0) {
    const lines = blocking.map((entry) => `  ${entry.file}（${entry.rules.join(", ")}）`);
    throw new Error(
      [
        "测试卫生违规：以下文件包含源码断言、内部替换、调用轨迹或内部状态窥探，",
        "新套件宪法禁止此模式（见 tests/README.md 与 docs/test-spec-inventory.md）：",
        ...lines,
      ].join("\n"),
    );
  }
  if (undetected.length > 0) {
    console.log(
      `test hygiene: ${exempted.length} 个存量豁免，其中 ${undetected.length} 个检测不再命中（需人工确认后移除）：`,
    );
    for (const entry of undetected) console.log(`  ${entry.file}`);
  }
}
