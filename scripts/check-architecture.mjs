#!/usr/bin/env node
/**
 * 架构约束检查 —— 静态约束的流放地（不属于行为测试套件）。
 *
 * 两级约束，执法强度不同：
 *
 *   不变量（阻断，退出码 1）：编码"结构契约"——必备模块与真实边界。
 *     理由：结构变更必须是有意识的行为；契约随结构变更同步更新
 *     （与 check:contract 的注册覆盖同一思路）。改一个名字就该改一行契约，
 *     这是"让架构决策显式化"，不是猜复杂度。
 *
 *   卫生指标（默认只报告，退出码 0）：行数预算。
 *     理由：行数只是复杂度的间接代理——好文件可能超长，坏文件可能很短。
 *     把它绝对化会诱发"为过检查而人为假拆分"（两个假模块比一个诚实的
 *     长文件更有害），因此默认只警告不阻断。它的价值是迫使对话：
 *     谁超出预算，谁来说明理由。
 *     - PI_ARCH_BUDGET_LINES 可临时调整预算（验证本脚本用）
 *     - --strict 或 PI_ARCH_STRICT=1 可临时强制阻断（重构运动期间防复发用）
 */
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { rendererCssImportOrder, stylePartialNames } from "./css-sources.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const BUDGET_LINES = Number(process.env.PI_ARCH_BUDGET_LINES ?? 500);
const STRICT = process.argv.includes("--strict") || process.env.PI_ARCH_STRICT === "1";

// 每组 = 一次原测试文件的搬迁。extensions 控制收集哪些源码文件（忠实原约束）。
const GROUPS = [
  {
    name: "shell 组合根与侧栏模块",
    dirs: ["src/renderer/components/app-shell", "src/renderer/components/session-sidebar"],
    files: ["src/renderer/components/AppShell.tsx"],
    requiredRoots: ["src/renderer/components/AppShell.tsx"],
    extensionRe: /\.(?:ts|tsx|mjs)$/,
  },
  {
    name: "settings/skills/plugins 组合根与模块",
    dirs: ["src/renderer/components/settings", "src/renderer/components/skills", "src/renderer/components/plugins"],
    files: [
      "src/renderer/components/SettingsConfig.tsx",
      "src/renderer/components/SkillsConfig.tsx",
      "src/renderer/components/PluginsConfig.tsx",
    ],
    requiredRoots: [
      "src/renderer/components/SettingsConfig.tsx",
      "src/renderer/components/SkillsConfig.tsx",
      "src/renderer/components/PluginsConfig.tsx",
    ],
    extensionRe: /\.(?:ts|tsx|mjs)$/,
  },
  {
    name: "ChatInput 组合根与输入区模块",
    dirs: ["src/renderer/components/chat-input"],
    files: ["src/renderer/components/ChatInput.tsx"],
    requiredRoots: [
      "src/renderer/components/chat-input/types.ts",
      "src/renderer/components/chat-input/use-composer-draft.ts",
      "src/renderer/components/chat-input/use-composer-attachments.ts",
      "src/renderer/components/chat-input/use-composer-suggestions.ts",
      "src/renderer/components/chat-input/use-composer-controls.ts",
      "src/renderer/components/chat-input/use-composer-skills.ts",
      "src/renderer/components/chat-input/composer-view.tsx",
    ],
    excludeTests: true,
    extensionRe: /\.(?:ts|tsx|mjs)$/,
  },
  {
    name: "应用导航与预览装配",
    dirs: ["src/renderer/components/app-nav"],
    files: [
      "src/smoke/ui-preview-data.mjs",
      "src/smoke/ui-preview-api-mock.mjs",
      "src/smoke/ui-preview-renderer.mjs",
      "src/smoke/ui-preview-harness.ts",
      "scripts/capture-ui-previews.mjs",
    ],
    minFiles: 6,
    excludeTests: true,
    extensionRe: /\.(?:ts|tsx|mjs)$/,
  },
  {
    name: "会话引擎组合",
    dirs: ["src/renderer/hooks/agent-session"],
    files: ["src/renderer/hooks/useAgentSession.ts"],
    minFiles: 13,
    excludeTests: true,
    extensionRe: /\.(?:ts|tsx)$/,
  },
  {
    // 行数卫生（建议级）：样式表。
    name: "样式表",
    dirs: ["src/renderer/styles"],
    files: ["src/renderer/globals.css"],
    extensionRe: /\.css$/,
  },
  {
    // 行数卫生（建议级）：i18n 词典。原 i18n-dictionaries-structure 的行数预算迁入
    // （切片四批）；接线不变量（每个分片必须入组合根）在 check:i18n 的结构检查里阻断。
    name: "i18n 词典",
    dirs: ["src/renderer/i18n"],
    files: ["src/renderer/i18n-dictionaries.ts"],
    extensionRe: /\.ts$/,
  },
];

// The old tool-card line-budget test belongs beside other size reports.
GROUPS.push({
  name: "交互卡片与集成属主",
  dirs: [
    "src/agent-host/agent-session",
    "src/renderer/components/chat-window",
    "src/renderer/components/interactive-tools",
    "scripts/desktop-security",
  ],
  files: [
    "src/agent-host/rpc-manager.ts",
    "src/renderer/components/ChatWindow.tsx",
    "src/renderer/lib/interactive-tool-store.ts",
    "src/shared/interactive-tools.ts",
    "src/shared/questionnaire.ts",
    "src/renderer/styles/tool-cards.css",
    "scripts/check-desktop-security.mjs",
    "scripts/test-interactive-tools-electron.mjs",
    "src/smoke/interactive-tools-harness.ts",
    "src/smoke/interactive-tools-renderer.mjs",
  ],
  excludeTests: true,
  extensionRe: /\.(?:ts|tsx|mjs|css)$/,
});

// 所有权禁令（阻断）：结构性规则，禁止在指定文件中重现特定形态。
// 本组来自原 session-sidebar-timer-contract.test.mjs 的 tripwire：侧栏子组件的
// 焦点延迟必须经属主 deferFocus（卸载时可整体取消），不得自建 setTimeout 焦点。
const PATTERN_BANS = [
  {
    name: "导航展示边界",
    files: collectCodeFiles(path.join(root, "src/renderer/components/app-nav"), /\.(?:ts|tsx)$/, true).map((file) =>
      path.relative(root, file),
    ),
    forbidden: /api-client/,
    message: "导航展示模块的数据必须由外层传入，不得直接导入通信客户端",
  },
  {
    name: "会话路由所有权",
    files: ["src/renderer/components/AppShell.tsx", "src/renderer/components/app-shell/use-workspace-navigation.ts"],
    forbidden: /useSearchParamsCompat|useRouterCompat/,
    message: "会话导航由外层统一处理，不得恢复旧的重复路由订阅",
  },
  {
    name: "焦点延迟属主（侧栏）",
    files: ["src/renderer/components/session-sidebar/worktree-switcher.tsx"],
    forbidden: /setTimeout\([^;]*\.focus\(/,
    message: "焦点请求必须经侧栏属主的 deferFocus，不得自建 setTimeout 焦点",
  },
];

function collectCodeFiles(entry, extensionRe, excludeTests, files = []) {
  const stat = statSync(entry);
  if (stat.isDirectory()) {
    for (const name of readdirSync(entry)) collectCodeFiles(path.join(entry, name), extensionRe, excludeTests, files);
    return files;
  }
  if (extensionRe.test(entry) && !(excludeTests && entry.endsWith(".test.mjs"))) files.push(entry);
  return files;
}

function physicalLineCount(content) {
  const lines = content.split("\n");
  return content.endsWith("\n") ? lines.length - 1 : lines.length;
}

function checkGroup(group) {
  // 不变量级：结构契约（缺失即 FAIL）
  const failures = [];
  for (const required of group.requiredRoots ?? []) {
    if (!existsSync(path.join(root, required))) failures.push(`缺少必备文件: ${required}`);
  }
  const files = [];
  for (const file of group.files) {
    const full = path.join(root, file);
    if (existsSync(full)) files.push(full);
    else failures.push(`缺少必备文件: ${file}`);
  }
  for (const dir of group.dirs) {
    const full = path.join(root, dir);
    if (existsSync(full)) collectCodeFiles(full, group.extensionRe, group.excludeTests, files);
    else failures.push(`缺少目录: ${dir}`);
  }
  // File count is an indirect complexity signal, not an architectural
  // relation. Merging modules must not fail a correct implementation.
  const warnings = [];
  if (group.minFiles !== undefined && files.length < group.minFiles) {
    warnings.push(`${group.name}: 文件数 ${files.length} 低于原拆分参考 ${group.minFiles}，请审视职责是否仍清晰`);
  }

  // 卫生级：行数预算（超出即 WARN，默认不阻断）
  for (const file of files) {
    const lines = physicalLineCount(readFileSync(file, "utf8"));
    if (lines > BUDGET_LINES) warnings.push(`${path.relative(root, file)}: ${lines} 行（预算 ${BUDGET_LINES}）`);
  }
  return { failures, warnings, fileCount: files.length };
}

// CSS 接线契约（阻断级）：原 css-structure.test.mjs 迁入（切片三批）。
// 导入顺序即级联顺序，是设计契约不是巧合；孤儿文件与缺口同样阻断。
const EXPECTED_CSS_IMPORT_ORDER = [
  "globals.css",
  "styles/tokens.css",
  "styles/typography.css",
  "styles/motion-tokens.css",
  "styles/base.css",
  "styles/controls.css",
  "styles/session-row.css",
  "styles/session-menu.css",
  "styles/composer.css",
  "styles/ref-chips.css",
  "styles/popover-motion.css",
  "styles/markdown.css",
  "styles/markdown-user.css",
  "styles/markdown-system.css",
  "styles/markdown-file-preview.css",
  "styles/motion.css",
  "styles/nav.css",
  "styles/sidebar-layout.css",
  "styles/right-panel.css",
  "styles/chat-scope.css",
  "styles/chat-motion.css",
  "styles/chat-window.css",
  "styles/notice-shelf.css",
  "styles/chat-shared.css",
  "styles/messages-process.css",
  "styles/messages-failure.css",
  "styles/messages-stream.css",
  "styles/tool-cards.css",
];

function checkCssWiring() {
  const failures = [];
  const rendererDir = path.join(root, "src/renderer");

  const imports = rendererCssImportOrder();
  if (JSON.stringify(imports) !== JSON.stringify(EXPECTED_CSS_IMPORT_ORDER)) {
    failures.push(
      `styles/index.ts 样式导入顺序必须匹配级联契约：\n    期望 ${JSON.stringify(EXPECTED_CSS_IMPORT_ORDER)}\n    实际 ${JSON.stringify(imports)}`,
    );
  }

  for (const file of imports) {
    if (!existsSync(path.join(rendererDir, file))) failures.push(`styles/index.ts 引用的样式文件不存在: ${file}`);
  }
  for (const name of stylePartialNames()) {
    if (!imports.includes(`styles/${name}`)) failures.push(`孤儿样式分片未被 styles/index.ts 引用: styles/${name}`);
  }

  // 渲染器树内只允许入口与已接线分片存在。
  const onDisk = [];
  const walk = (directory) => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const full = path.join(directory, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.name.endsWith(".css")) onDisk.push(path.relative(root, full));
    }
  };
  walk(rendererDir);
  const expected = new Set(imports.map((file) => path.join("src/renderer", file)));
  for (const file of onDisk) {
    if (!expected.has(file)) failures.push(`渲染器树内出现未接线的样式文件: ${file}`);
  }

  const entryPath = path.join(rendererDir, "globals.css");
  if (existsSync(entryPath)) {
    const entry = readFileSync(entryPath, "utf8");
    if (!/^@import "tailwindcss";/.test(entry)) failures.push("globals.css: tailwind 必须先于所有应用样式加载");
    if (!/@font-face/.test(entry)) failures.push("globals.css: @font-face 必须留在入口（相对字体路径）");
    if (!/url\("\.\/fonts\/InterLatin\.woff2"\)/.test(entry)) failures.push("globals.css: 缺少 Inter 字体文件引用");
    if (!/url\("\.\/fonts\/GeistMono\.woff2"\)/.test(entry)) failures.push("globals.css: 缺少 GeistMono 字体文件引用");
    if (/@import\s+"\.\//.test(entry))
      failures.push("globals.css: 应用样式分片必须由 styles/index.ts 引入，不得走 CSS @import");
  } else {
    failures.push("缺少必备文件: src/renderer/globals.css");
  }
  return failures;
}

function main() {
  const failures = [];
  for (const ban of PATTERN_BANS) {
    for (const file of ban.files) {
      const full = path.join(root, file);
      if (!existsSync(full)) {
        failures.push(`缺少必备文件: ${file}`);
        continue;
      }
      if (ban.forbidden.test(readFileSync(full, "utf8"))) failures.push(`${ban.name}: ${file} ${ban.message}`);
    }
  }
  const results = GROUPS.map(checkGroup);
  const cssWiringFailures = checkCssWiring();
  for (const failure of cssWiringFailures) console.error(`FAIL: ${failure}`);
  failures.push(...results.flatMap((result) => result.failures));
  if (failures.length > 0 || cssWiringFailures.length > 0) {
    for (const failure of failures) console.error(`FAIL: ${failure}`);
    process.exitCode = 1;
    return;
  }

  const warnedGroups = results
    .map((result, index) =>
      result.warnings.length > 0 ? { name: GROUPS[index].name, warnings: result.warnings } : null,
    )
    .filter(Boolean);
  if (warnedGroups.length > 0) {
    console.warn(`WARN: 结构与行数参考需审视（卫生指标，默认不阻断）：`);
    for (const group of warnedGroups) {
      console.warn(`  ${group.name}:`);
      for (const warning of group.warnings) console.warn(`    ${warning}`);
    }
    if (STRICT) {
      console.error("FAIL: strict 模式下卫生指标同样阻断");
      process.exitCode = 1;
      return;
    }
  }

  const totalFiles = results.reduce((sum, result) => sum + result.fileCount, 0);
  const warningNote = warnedGroups.length > 0 ? `，${warnedGroups.length} 组有卫生提示` : "，无警告";
  console.log(
    `Architecture invariants OK: ${GROUPS.length} 组、${totalFiles} 个文件结构契约满足；CSS 接线契约满足${warningNote}`,
  );
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
