#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { checkRendererI18n } from "./renderer-i18n-checker.mjs";
import {
  CRITICAL_SCENARIO_OWNERS,
  CRITICAL_SCENARIOS,
  INTENTIONAL_REWRITES,
  criticalScenarioFailures,
  dictionaryBaselineFailures,
  dictionaryCompositionFailures,
  dictionaryExportContractFailures,
  dictionaryWiringFailures,
} from "./renderer-i18n-structure.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const rendererRoot = path.join(root, "src/renderer");
const partialNames = fs
  .globSync("src/renderer/i18n/*.ts", { cwd: root })
  .sort()
  .map((file) => path.basename(file));
const compositionRootPath = path.join(rendererRoot, "i18n-dictionaries.ts");
const dictionaryPaths = [compositionRootPath, ...partialNames.map((name) => path.join(rendererRoot, "i18n", name))];

const { failures, keyCount } = checkRendererI18n({ root, rendererRoot, dictionaryPaths });

// 词典组合结构检查（原 i18n-dictionaries-structure / i18n-critical-ui 迁入，切片四批）。
// 词典是纯数据模块：直接导入真实数据做校验，比解析源码文本更接近被保护的事实。
const composition = await import(pathToFileURL(compositionRootPath).href);
const interactive = await import(pathToFileURL(path.join(rendererRoot, "i18n/interactive-tools.ts")).href);
const partials = [];
for (const name of partialNames) {
  const module = await import(pathToFileURL(path.join(rendererRoot, "i18n", name)).href);
  partials.push({ file: name, enUS: module.enUS, zhCN: module.zhCN });
}
const ownerSources = Object.fromEntries(
  Object.entries(CRITICAL_SCENARIO_OWNERS).map(([owner, files]) => [
    owner,
    files.map((file) => fs.readFileSync(path.join(rendererRoot, file), "utf8")).join("\n"),
  ]),
);
const interactiveKeys = new Set([...Object.keys(interactive.enUS), ...Object.keys(interactive.zhCN)]);
const structureFailures = [
  ...dictionaryWiringFailures({ partialNames, rootSource: fs.readFileSync(compositionRootPath, "utf8") }),
  ...dictionaryCompositionFailures({ partials, enUS: composition.enUS, zhCN: composition.zhCN }),
  ...dictionaryBaselineFailures({
    enUS: composition.enUS,
    zhCN: composition.zhCN,
    interactiveKeys,
    rewrittenKeys: INTENTIONAL_REWRITES,
  }),
  ...dictionaryExportContractFailures({
    dictionaries: composition.dictionaries,
    enUS: composition.enUS,
    zhCN: composition.zhCN,
  }),
  ...criticalScenarioFailures({
    scenarios: CRITICAL_SCENARIOS,
    enUS: composition.enUS,
    zhCN: composition.zhCN,
    ownerSources,
  }),
];

const allFailures = [...failures, ...structureFailures];
if (allFailures.length) {
  console.error(`[renderer-i18n] ${allFailures.length} invariant(s) failed`);
  for (const failure of allFailures) console.error(`- ${failure}`);
  process.exit(1);
}
console.log(
  `[renderer-i18n] ${keyCount} static keys have en-US/zh-CN parity, registered fallbacks, guarded user-facing literals, ` +
    `and ${partialNames.length} dictionary partials compose the verified baseline`,
);
