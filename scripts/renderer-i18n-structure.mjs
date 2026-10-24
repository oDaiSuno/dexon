/**
 * i18n 词典组合结构检查 —— 原 i18n-dictionaries-structure.test.mjs 与
 * i18n-critical-ui.test.mjs 的静态约束迁入（切片四批，2026-10-13）。
 *
 * 这里验证的是「数据与接线的静态完整性」，不是运行时行为：
 *   1) 每个词典分片必须接入组合根——不接入的分片永远不会生效，且无任何
 *      运行时症状可观察（这正是它们只能静态检查的原因）；
 *   2) 分片键集互斥，合并后与组合根导出严格相等（不丢键、不夹带）；
 *   3) 组合后的词典值钉在拆分前逐键核对过的基准指纹上（1015 键 × 2 语言）；
 *   4) 组合根保持历史导出契约（dictionaries 别名与双语键数一致）；
 *   5) 关键 UI 文案（空态、删除确认、冲突、更新失败）双语齐全且被属主消费。
 *
 * 词典文件 ≤500 行的行数预算并入 scripts/check-architecture.mjs 的卫生指标组。
 * 本模块是纯函数库：全部输入由调用方注入，测试用合成词典夹具
 * （scripts/renderer-i18n-structure.test.mjs），不读仓库源码。
 */
import { createHash } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

// Phase 4 的九个导航键是组合根之外显式追加、由 nav-language 行为测试单独核对的，
// 指纹基线必须排除它们——忠实原测试的豁免注释。
const PHASE_4_NAV_KEYS = new Set([
  "navPluginsSkills",
  "navHistory",
  "personalSpace",
  "openCurrentFolder",
  "chooseOtherFolder",
  "switchSpace",
  "backToPersonalSpace",
  "pluginsTab",
  "skillsTab",
]);

// 拆分后新增的可访问区域名称不属于历史基线。只逐键排除新增项，
// 不放宽旧聊天/导航文案；这些名称仍接受注册、双语对齐与组合校验。
const ACCESSIBLE_REGION_KEYS = new Set([
  "chatWindow",
  "chatConversation",
  "earlierMessages",
  "conversationMinimap",
  "messageComposer",
  "mainNavigation",
  "workspaceControls",
]);

const OLDER_HISTORY_KEYS = new Set(["loadEarlierMessages", "loadingEarlierMessages", "earlierMessagesLoadFailed"]);

const MESSAGE_VERSION_KEYS = new Set([
  "editMessage",
  "editMessageField",
  "previousVersion",
  "nextVersion",
  "removeImage",
  "versionFilesNotUndone",
  "copyMessage",
  "nothingToCopy",
  "messageEditFailed",
]);

const NAVIGATION_INTEGRATION_KEYS = new Set([
  "switchSpaceList",
  "noOtherSpaces",
  "spaceUnavailable",
  "personalSpaceUnavailable",
  "retry",
]);

const SETTINGS_MIGRATION_KEYS = new Set([
  "settingsDescription",
  "skillPickerEmpty",
  "projectRequiredDescription",
  "projectRequiredTitle",
]);

const SESSION_ORCHESTRATION_KEYS = new Set([
  "sessionStatusAwaitingInput",
  "sessionStatusError",
  "sessionRelationFork",
  "sessionRelationDelegate",
  "sessionCountAwaitingInput",
  "sessionCountRunning",
  "sessionCountError",
  "sessionPath",
  "sessionSourceFrom",
  "sessionTargetOpen",
  "sessionCollaboration",
  "sessionCollaborationDescription",
  "sessionCollaborationEnable",
  "sessionCollaborationMaxRunning",
  "sessionCollaborationModel",
  "sessionCollaborationThinking",
  "sessionCollaborationAllowUserSessions",
  "sessionCollaborationSameAsCreator",
  "sessionCollaborationSaveFailed",
  "sessionCollaborationLoadFailed",
]);

const REWRITES_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), "i18n-rewrites");

function readRewrites(dir) {
  const merged = {};
  for (const name of readdirSync(dir)
    .filter((file) => file.endsWith(".json"))
    .sort()) {
    for (const [key, values] of Object.entries(JSON.parse(readFileSync(path.join(dir, name), "utf8")))) {
      if (key in merged) throw new Error(`i18n-rewrites: ${key} is registered twice (${name})`);
      merged[key] = values;
    }
  }
  return merged;
}

export const INTENTIONAL_REWRITES = readRewrites(REWRITES_DIR);

const ADDED_KEYS_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), "i18n-added");

const ADDED_KEYS = new Set(
  readdirSync(ADDED_KEYS_DIR)
    .filter((file) => file.endsWith(".json"))
    .sort()
    .flatMap((name) => JSON.parse(readFileSync(path.join(ADDED_KEYS_DIR, name), "utf8"))),
);

const UPSTREAM_FAILURE_KEYS = new Set([
  "failureCollapse",
  "failureCopy",
  "failureExpand",
  "failureRetried",
  "retryInSeconds",
  "retryingNow",
  "upstreamErrorMissing",
]);

// interactive-tools 词典模块是显式追加、由组合/奇偶校验与行为测试单独核对的，
// 指纹基线同样排除。历史指纹本身保持不变。
export const PRE_SPLIT_BASELINE = {
  enUS: "656da398500b625d86308c42a8d26ca3a645b00b0d18fd4fa1b3bf93d9367683",
  zhCN: "5c88030aed7facb39e2b586ffe15950f0497f72958b565e050ec354316dda922",
};

// 关键 UI 场景：空态、不可逆删除、外部冲突、频道状态、更新失败。
// 规则 = 词典值与已核对文案逐字相等 + 属主源码确实以 t("key") 消费。
export const CRITICAL_SCENARIO_OWNERS = {
  session: [
    "components/session-sidebar/session-item-actions.tsx",
    "components/session-sidebar/worktree-remove-confirm.tsx",
  ],
  models: [
    "components/ModelsConfig.tsx",
    "components/models/add-provider-picker.tsx",
    "components/models/api-key-detail.tsx",
    "components/models/managed-models-control.tsx",
    "components/models/model-detail.tsx",
    "components/models/models-footer.tsx",
    "components/models/oauth-detail.tsx",
    "components/models/provider-detail.tsx",
    "components/models/provider-icon.tsx",
    "components/models/provider-tree.tsx",
    "components/models/selection-detail.tsx",
    "components/models/thinking-level-map-editor.tsx",
    "components/models/types.ts",
    "components/models/use-models-config.ts",
    "components/models/use-oauth-login.ts",
  ],
  channels: [
    "components/channels/ChannelsConfig.tsx",
    "components/channels/channels-config/account-actions.tsx",
    "components/channels/channels-config/account-card-header.tsx",
    "components/channels/channels-config/account-card.tsx",
    "components/channels/channels-config/account-credential-fields.tsx",
    "components/channels/channels-config/account-credentials.ts",
    "components/channels/channels-config/account-feedback.tsx",
    "components/channels/channels-config/account-settings-grid.tsx",
    "components/channels/channels-config/accounts-overview.tsx",
    "components/channels/channels-config/activity-section.tsx",
    "components/channels/channels-config/bindings-section.tsx",
    "components/channels/channels-config/channel-labels.ts",
    "components/channels/channels-config/channels-header.tsx",
    "components/channels/channels-config/constants.ts",
    "components/channels/channels-config/control-styles.ts",
    "components/channels/channels-config/feishu-credential-dialog.tsx",
    "components/channels/channels-config/feishu-dialog-error.tsx",
    "components/channels/channels-config/feishu-manual-form.tsx",
    "components/channels/channels-config/login-dialog.tsx",
    "components/channels/channels-config/pairing-section.tsx",
    "components/channels/channels-config/section-layout.tsx",
    "components/channels/channels-config/telegram-token-dialog.tsx",
    "components/channels/channels-config/use-channels-state.ts",
  ],
  updates: ["components/settings/software-update.tsx", "components/settings/update-presentations.tsx"],
  skills: ["components/skills/skill-list.tsx", "components/skills/add-skill-panel.tsx"],
};

export const CRITICAL_SCENARIOS = [
  { key: "noSkillsFound", owner: "skills", en: "No skills found", zh: "未找到技能" },
  { key: "deleteSessionConfirm", owner: "session", en: "Delete “{title}”?", zh: "删除“{title}”？" },
  {
    key: "worktreeForceRemoveConfirm",
    owner: "session",
    en: "Uncommitted changes. Force remove checkout?",
    zh: "存在未提交的更改，是否强制移除 checkout？",
  },
  {
    key: "modelConfigConflict",
    owner: "models",
    en: "models.json changed outside this editor. Your edits are preserved here; copy or compare them before reloading the disk version to merge manually.",
    zh: "models.json 已在此编辑器之外被修改。你的编辑仍保留在此处；重新加载磁盘版本前，请先复制或比较这些内容并手动合并。",
  },
  { key: "activityOutcome_failed", owner: "channels", en: "failed", zh: "失败" },
  {
    key: "updateErrorOffline",
    owner: "updates",
    en: "Unable to reach the update service. Check your network and try again.",
    zh: "当前无法连接更新服务，请检查网络后重试。",
  },
];

/** 指纹 = 排序键与值的规范化哈希。两条词典指纹相等 ⟺ 键集与值完全一致。 */
export function dictionaryFingerprint(record) {
  return createHash("sha256")
    .update(
      Object.keys(record)
        .sort()
        .map((key) => `${key}\u0000${record[key]}`)
        .join("\u0001"),
    )
    .digest("hex");
}

/** 组合根必须导入每个分片；分片目录不得为空。 */
export function dictionaryWiringFailures({ partialNames, rootSource }) {
  if (!partialNames || partialNames.length === 0) return ["dictionary partial directory must not be empty"];
  return partialNames
    .filter((name) => !rootSource.includes(`./i18n/${name}`))
    .map((name) => `composition root must import ./i18n/${name}`);
}

/** 每个分片必须导出双语词典；分片键集互斥；合并结果与组合根导出严格相等。 */
export function dictionaryCompositionFailures({ partials, enUS, zhCN }) {
  const failures = [];
  const seen = new Map();
  const mergedEN = {};
  const mergedZH = {};
  for (const partial of partials) {
    if (!partial.enUS || !partial.zhCN || typeof partial.enUS !== "object" || typeof partial.zhCN !== "object") {
      failures.push(`${partial.file} must export enUS and zhCN`);
      continue;
    }
    for (const [language, map, merged] of [
      ["en", partial.enUS, mergedEN],
      ["zh", partial.zhCN, mergedZH],
    ]) {
      for (const [key, value] of Object.entries(map)) {
        const marker = `${language}:${key}`;
        if (seen.has(marker)) {
          failures.push(`${language} key ${key} is defined in both ${seen.get(marker)} and ${partial.file}`);
          continue;
        }
        seen.set(marker, partial.file);
        merged[key] = value;
      }
    }
  }
  if (enUS && dictionaryFingerprint(enUS) !== dictionaryFingerprint(mergedEN)) {
    failures.push("composed en-US must equal the merged partial values");
  }
  if (zhCN && dictionaryFingerprint(zhCN) !== dictionaryFingerprint(mergedZH)) {
    failures.push("composed zh-CN must equal the merged partial values");
  }
  return failures;
}

/** 拆分前的历史键和值保持不变；显式追加的模块、导航键和区域名不进入历史指纹。 */
export function dictionaryBaselineFailures({
  enUS,
  zhCN,
  interactiveKeys,
  expected = PRE_SPLIT_BASELINE,
  rewrittenKeys = {},
}) {
  const excluded = new Set(interactiveKeys ?? []);
  for (const key of [
    ...PHASE_4_NAV_KEYS,
    ...ACCESSIBLE_REGION_KEYS,
    ...NAVIGATION_INTEGRATION_KEYS,
    ...SETTINGS_MIGRATION_KEYS,
    ...UPSTREAM_FAILURE_KEYS,
    ...OLDER_HISTORY_KEYS,
    ...MESSAGE_VERSION_KEYS,
    ...SESSION_ORCHESTRATION_KEYS,
    ...ADDED_KEYS,
  ])
    excluded.add(key);
  const withoutExcluded = (record) => Object.fromEntries(Object.entries(record).filter(([key]) => !excluded.has(key)));
  const historical = (record, language) => {
    const restored = { ...record };
    for (const [key, values] of Object.entries(rewrittenKeys)) if (key in restored) restored[key] = values[language];
    return withoutExcluded(restored);
  };
  const failures = [];
  if (dictionaryFingerprint(historical(enUS, "enUS")) !== expected.enUS) {
    failures.push("en-US values drifted from the verified pre-split dictionary");
  }
  if (dictionaryFingerprint(historical(zhCN, "zhCN")) !== expected.zhCN) {
    failures.push("zh-CN values drifted from the verified pre-split dictionary");
  }
  return failures;
}

/** 组合根必须保持历史导出契约：dictionaries 别名指向同一对象，双语键数一致。 */
export function dictionaryExportContractFailures({ dictionaries, enUS, zhCN }) {
  const failures = [];
  if (!dictionaries || dictionaries["en-US"] !== enUS) {
    failures.push('dictionaries["en-US"] must be the exported en-US object');
  }
  if (!dictionaries || dictionaries["zh-CN"] !== zhCN) {
    failures.push('dictionaries["zh-CN"] must be the exported zh-CN object');
  }
  if (!enUS || !zhCN || Object.keys(enUS).length !== Object.keys(zhCN).length) {
    failures.push("composed en-US and zh-CN must define the same number of keys");
  }
  return failures;
}

/** 关键场景的词典值必须与已核对文案逐字相等，且属主源码确实以 t("key") 消费。 */
export function criticalScenarioFailures({ scenarios, enUS, zhCN, ownerSources }) {
  const failures = [];
  for (const scenario of scenarios) {
    if (enUS[scenario.key] !== scenario.en) {
      failures.push(`${scenario.key} en-US must read "${scenario.en}"`);
    }
    if (zhCN[scenario.key] !== scenario.zh) {
      failures.push(`${scenario.key} zh-CN must read "${scenario.zh}"`);
    }
    const ownerSource = ownerSources[scenario.owner];
    if (!ownerSource || !new RegExp(`t\\(\\s*"${scenario.key}"`).test(ownerSource)) {
      failures.push(`${scenario.key} owner usage is missing (${scenario.owner})`);
    }
  }
  return failures;
}
