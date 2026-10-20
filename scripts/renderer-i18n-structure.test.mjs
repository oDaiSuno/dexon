import assert from "node:assert/strict";
import test from "node:test";

import {
  CRITICAL_SCENARIOS,
  criticalScenarioFailures,
  dictionaryBaselineFailures,
  dictionaryCompositionFailures,
  dictionaryExportContractFailures,
  dictionaryFingerprint,
  dictionaryWiringFailures,
} from "./renderer-i18n-structure.mjs";

test("wiring flags unimported partials and rejects an empty partial directory", () => {
  const wired = dictionaryWiringFailures({
    partialNames: ["app.ts", "chat.ts"],
    rootSource: 'import { enUS } from "./i18n/app.ts";',
  });
  assert.deepEqual(wired, ["composition root must import ./i18n/chat.ts"]);

  assert.deepEqual(dictionaryWiringFailures({ partialNames: [], rootSource: "" }), [
    "dictionary partial directory must not be empty",
  ]);
});

test("composition rejects missing exports, duplicate keys, and mismatched merged values", () => {
  const partials = [
    { file: "a.ts", enUS: { orphans: "skipped" } },
    { file: "b.ts", enUS: { greeting: "Hello" }, zhCN: { greeting: "你好" } },
    { file: "c.ts", enUS: { greeting: "Hi" }, zhCN: { greeting: "你好" } },
    { file: "d.ts", enUS: { farewell: "Bye" }, zhCN: { farewell: "再见" } },
  ];
  // 组合根丢了 d.ts 的接线（farewell 未进入组合结果），且 c.ts 与 b.ts 键冲突。
  const failures = dictionaryCompositionFailures({
    partials,
    enUS: { greeting: "Hello" },
    zhCN: { greeting: "你好" },
  });
  assert.deepEqual(failures, [
    "a.ts must export enUS and zhCN",
    "en key greeting is defined in both b.ts and c.ts",
    "zh key greeting is defined in both b.ts and c.ts",
    "composed en-US must equal the merged partial values",
    "composed zh-CN must equal the merged partial values",
  ]);
});

test("composition accepts disjoint partials that the composed dictionaries reproduce exactly", () => {
  const partials = [
    { file: "app.ts", enUS: { greeting: "Hello" }, zhCN: { greeting: "你好" } },
    { file: "chat.ts", enUS: { send: "Send" }, zhCN: { send: "发送" } },
  ];
  assert.deepEqual(
    dictionaryCompositionFailures({
      partials,
      enUS: { greeting: "Hello", send: "Send" },
      zhCN: { greeting: "你好", send: "发送" },
    }),
    [],
  );
});

test("baseline fingerprints stay silent for excluded keys and catch any other drift", () => {
  const expected = {
    enUS: dictionaryFingerprint({ stable: "Pinned" }),
    zhCN: dictionaryFingerprint({ stable: "钉住" }),
  };
  const interactiveKeys = ["interactiveOnly"];
  const addedRegionNames = {
    chatWindow: "Any value",
    chatConversation: "Any value",
    earlierMessages: "Any value",
    conversationMinimap: "Any value",
    messageComposer: "Any value",
    mainNavigation: "Any value",
    workspaceControls: "Any value",
  };

  // 后加的模块、导航键与区域名不属于拆分前的历史指纹。
  // 新名称的注册和双语完整性仍由 CLI 的其他校验负责。
  assert.deepEqual(
    dictionaryBaselineFailures({
      enUS: { stable: "Pinned", interactiveOnly: "Any value", navPluginsSkills: "Any value", ...addedRegionNames },
      zhCN: { stable: "钉住", interactiveOnly: "任意", navPluginsSkills: "任意", ...addedRegionNames },
      interactiveKeys,
      expected,
    }),
    [],
  );

  // 排除键之外的漂移必须被点名，且两种语言各自精确报告。
  assert.deepEqual(
    dictionaryBaselineFailures({
      enUS: { stable: "Drifted", interactiveOnly: "Any value" },
      zhCN: { stable: "钉住", interactiveOnly: "任意" },
      interactiveKeys,
      expected,
    }),
    ["en-US values drifted from the verified pre-split dictionary"],
  );
  assert.deepEqual(
    dictionaryBaselineFailures({
      enUS: { stable: "Pinned", interactiveOnly: "Any value" },
      zhCN: { stable: "漂移", interactiveOnly: "任意" },
      interactiveKeys,
      expected,
    }),
    ["zh-CN values drifted from the verified pre-split dictionary"],
  );

  // 默认基准是拆分前逐键核对的真实指纹（CLI 路径），合成数据不可能碰巧命中。
  assert.equal(dictionaryBaselineFailures({ enUS: {}, zhCN: {}, interactiveKeys: [] }).length, 2);
});

test("an intentionally rewritten copy keeps the historical fingerprint while other drift still fails", () => {
  const expected = {
    enUS: dictionaryFingerprint({ stable: "Pinned", newSession: "new session" }),
    zhCN: dictionaryFingerprint({ stable: "钉住", newSession: "新建会话" }),
  };
  const rewrittenKeys = { newSession: { enUS: "new session", zhCN: "新建会话" } };

  assert.deepEqual(
    dictionaryBaselineFailures({
      enUS: { stable: "Pinned", newSession: "New session" },
      zhCN: { stable: "钉住", newSession: "新建会话" },
      interactiveKeys: [],
      expected,
      rewrittenKeys,
    }),
    [],
  );

  assert.deepEqual(
    dictionaryBaselineFailures({
      enUS: { stable: "Drifted", newSession: "New session" },
      zhCN: { stable: "钉住", newSession: "新建会话" },
      interactiveKeys: [],
      expected,
      rewrittenKeys,
    }),
    ["en-US values drifted from the verified pre-split dictionary"],
  );
});

test("export contract requires dictionary aliases and bilingual key parity", () => {
  const enUS = { a: "A" };
  const zhCN = { a: "甲" };
  assert.deepEqual(
    dictionaryExportContractFailures({ dictionaries: { "en-US": enUS, "zh-CN": zhCN }, enUS, zhCN }),
    [],
  );

  const aliasBroken = dictionaryExportContractFailures({
    dictionaries: { "en-US": { ...enUS }, "zh-CN": zhCN },
    enUS,
    zhCN,
  });
  assert.ok(aliasBroken.includes('dictionaries["en-US"] must be the exported en-US object'));

  const parityBroken = dictionaryExportContractFailures({
    dictionaries: { "en-US": enUS, "zh-CN": { ...zhCN, extra: "额外" } },
    enUS,
    zhCN: { ...zhCN, extra: "额外" },
  });
  assert.ok(parityBroken.includes("composed en-US and zh-CN must define the same number of keys"));
});

test("critical scenarios require exact bilingual values and owner consumption", () => {
  const [scenario] = CRITICAL_SCENARIOS;
  const enUS = { [scenario.key]: scenario.en };
  const zhCN = { [scenario.key]: scenario.zh };
  const ownerSources = { [scenario.owner]: `export const label = t("${scenario.key}", "fallback");` };
  assert.deepEqual(criticalScenarioFailures({ scenarios: [scenario], enUS, zhCN, ownerSources }), []);

  const failures = criticalScenarioFailures({
    scenarios: [scenario],
    enUS: { [scenario.key]: "Wrong" },
    zhCN: { [scenario.key]: scenario.zh },
    ownerSources: { [scenario.owner]: 'export const label = "hardcoded";' },
  });
  assert.deepEqual(failures, [
    `${scenario.key} en-US must read "${scenario.en}"`,
    `${scenario.key} owner usage is missing (${scenario.owner})`,
  ]);
});
