#!/usr/bin/env node
/**
 * Blocking design contracts: token schema, contrast, shared fonts, motion
 * policy and theme boot ordering. UI behavior belongs at its public boundary;
 * equivalent JSX spelling, component extraction and DOM wrappers are allowed.
 */
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { readRendererCssSources, readStylePartial } from "./css-sources.mjs";
import { APP_MONO_FONT_FAMILY, APP_SANS_FONT_FAMILY } from "../src/shared/font-stack.ts";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const failures = [];
const read = (relative) => readFileSync(path.join(root, relative), "utf8");
const exists = (relative) => existsSync(path.join(root, relative));

function requireFile(relative) {
  if (!exists(relative)) failures.push(`缺少必备文件: ${relative}`);
  return exists(relative);
}

const FORBIDDEN_STATUS_HEX = ["#f87171", "#ef4444", "#4ade80", "#22c55e", "#f59e0b", "#d97706", "#16a34a", "#1f2937"];

function checkComponentStatusColors() {
  const componentFiles = [
    "src/renderer/components/FileViewer.tsx",
    "src/renderer/components/channels/ChannelsConfig.tsx",
    "src/renderer/components/ChatInput.tsx",
    "src/renderer/components/PluginsConfig.tsx",
    "src/renderer/components/ToolchainsConfig.tsx",
    "src/renderer/components/MessageView.tsx",
  ];
  for (const relative of componentFiles) {
    if (!requireFile(relative)) continue;
    const source = read(relative);
    for (const hex of FORBIDDEN_STATUS_HEX) {
      if (new RegExp(hex, "i").test(source)) failures.push(`${relative} 使用裸状态色 ${hex}，必须走语义令牌`);
    }
  }
}

// ---------------------------------------------------------------------------
// D. 亮暗主题语义色契约完整；E. accent 对比度满足 WCAG AA
//    （原 semantic-colors.test.mjs）
// ---------------------------------------------------------------------------
const SEMANTIC_TOKENS = [
  "--success",
  "--success-soft",
  "--success-border",
  "--danger",
  "--danger-soft",
  "--danger-border",
  "--warning",
  "--warning-soft",
  "--warning-border",
  "--info",
  "--info-soft",
  "--info-border",
  "--accent-contrast",
  "--on-accent",
];

function checkSemanticContract() {
  const css = readStylePartial("tokens.css");
  const roots = [
    ["light", css.slice(css.indexOf(":root {"), css.indexOf("html.dark"))],
    ["dark", css.slice(css.indexOf("html.dark"))],
  ];
  for (const [theme, rootBlock] of roots) {
    if (!rootBlock) {
      failures.push(`tokens.css 缺少 ${theme} 主题区块`);
      continue;
    }
    for (const token of SEMANTIC_TOKENS) {
      if (!new RegExp(`${token}:`).test(rootBlock)) failures.push(`tokens.css ${theme} 主题缺少语义令牌: ${token}`);
    }
  }
}

function cssHexToken(rootBlock, token) {
  const match = rootBlock.match(new RegExp(`${token}:\\s*(#[0-9a-f]{6})`, "i"));
  if (!match) {
    failures.push(`${token} 必须是具体六位十六进制色值`);
    return null;
  }
  return match[1];
}

function relativeLuminance(hex) {
  const channels = hex
    .slice(1)
    .match(/../g)
    .map((channel) => Number.parseInt(channel, 16) / 255)
    .map((channel) => (channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4));
  return 0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2];
}

function contrastRatio(first, second) {
  const luminances = [relativeLuminance(first), relativeLuminance(second)].sort((a, b) => b - a);
  return (luminances[0] + 0.05) / (luminances[1] + 0.05);
}

function checkAccentContrast() {
  // 期望值来源：WCAG 2.x AA 正文对比度 ≥ 4.5（独立判据，非项目自定）。
  const css = readStylePartial("tokens.css");
  const roots = [
    ["light", css.slice(css.indexOf(":root {"), css.indexOf("html.dark"))],
    ["dark", css.slice(css.indexOf("html.dark"))],
  ];
  for (const [theme, rootBlock] of roots) {
    const accent = cssHexToken(rootBlock, "--accent");
    const accentContrast = cssHexToken(rootBlock, "--accent-contrast");
    if (accent && accentContrast && contrastRatio(accent, accentContrast) < 4.5) {
      failures.push(`${theme} 主题 --accent/--accent-contrast 对比度低于 WCAG AA (4.5)`);
    }
    if (!/--on-accent:\s*var\(--accent-contrast\)/.test(rootBlock)) {
      failures.push(`${theme} 主题 --on-accent 必须引用 --accent-contrast`);
    }
  }
}

// ---------------------------------------------------------------------------
// F. 已删令牌禁令（原 theme-tokens.test.mjs）
// ---------------------------------------------------------------------------
function checkRemovedTokens() {
  const css = readRendererCssSources();
  for (const token of [
    "--font-mono-font",
    "--font-sans-font",
    "--font-size-caption",
    "--font-size-control",
    "--font-size-body",
    "--control-height-compact",
  ]) {
    if (new RegExp(token).test(css)) failures.push(`已删除的未用令牌回归了全局契约: ${token}`);
  }
}

// ---------------------------------------------------------------------------
// G. 字体栈一致性（原 src/shared/font-stack.test.mjs）
// ---------------------------------------------------------------------------
function checkFontStack() {
  const css = readStylePartial("tokens.css");
  const customProperty = (property) => {
    const match = css.match(new RegExp(`${property}:\\s*([^;]+);`));
    if (!match) {
      failures.push(`tokens.css 缺少 ${property}`);
      return null;
    }
    return match[1].replace(/\s+/g, " ").trim();
  };
  const sans = customProperty("--font-sans");
  const mono = customProperty("--font-mono");
  if (sans !== null && sans !== APP_SANS_FONT_FAMILY) failures.push("tokens.css --font-sans 与共享字体栈常量不一致");
  if (mono !== null && mono !== APP_MONO_FONT_FAMILY) failures.push("tokens.css --font-mono 与共享字体栈常量不一致");
  for (const required of ["Microsoft YaHei", "PingFang SC", "Noto Sans CJK SC"]) {
    if (!APP_SANS_FONT_FAMILY.includes(required)) failures.push(`共享无衬线字体栈缺少 CJK 字族: ${required}`);
  }
}

// ---------------------------------------------------------------------------
// H. nav.css 降级动效与 motion-only 边界（原 nav-motion.test.mjs）
// ---------------------------------------------------------------------------
function checkNavMotion() {
  const relative = "src/renderer/styles/nav.css";
  if (!requireFile(relative)) return;
  const css = read(relative);
  const reducedBlock = css.match(/@media \(prefers-reduced-motion: reduce\)\s*\{([\s\S]*)\}/);
  if (!reducedBlock) {
    failures.push("nav.css 必须包含 prefers-reduced-motion 区块");
    return;
  }
  if (!/\.app-nav\b/.test(reducedBlock[1])) failures.push("reduced-motion 回退必须覆盖应用导航 (.app-nav)");
  if (!/\.app-nav-resource\b/.test(reducedBlock[1])) {
    failures.push("reduced-motion 回退必须覆盖导航内资源页 (.app-nav-resource)");
  }
  if (
    !/transition[^;]*0(\.0)?0?1ms|animation[^;]*0(\.0)?0?1ms|transition[^;]*none|animation[^;]*none/.test(
      reducedBlock[1],
    )
  ) {
    failures.push("reduced-motion 回退必须把 transition/animation 计时归零");
  }
  if (/#[0-9a-fA-F]{3,8}\b/.test(css)) failures.push("nav.css 不得引入裸十六进制色值");
  if (/font-size/.test(css)) failures.push("nav.css 不得引入字号（motion-only 局部）");
  if (/@keyframes/.test(css)) failures.push("nav.css 必须复用系统 keyframes，不得新增");
}

// Appearance controls, effective widths and font scaling are observed through
// GeneralSettings behavior and the real Chromium chat-layout check. Source
// spelling and occurrence counts are not design contracts.

// ---------------------------------------------------------------------------
// M. 主题启动顺序（原 theme-init.test.mjs 第 4 条的构建顺序部分；
//    colorScheme 同步为行为规则，已转写为 theme-init / use-theme 行为测试）
// ---------------------------------------------------------------------------
function checkThemeBootOrder() {
  const relative = "src/renderer/index.html";
  if (!requireFile(relative)) return;
  const html = read(relative);
  const initAt = html.indexOf("./theme-init.ts");
  const mainAt = html.indexOf("./main.tsx");
  if (initAt < 0 || mainAt < 0) {
    failures.push("index.html 必须同时引用 theme-init.ts 与 main.tsx");
    return;
  }
  if (initAt >= mainAt) failures.push("index.html: theme-init.ts 必须先于 main.tsx 加载（防主题闪烁）");
}

function main() {
  checkComponentStatusColors();
  checkSemanticContract();
  checkAccentContrast();
  checkRemovedTokens();
  checkFontStack();
  checkNavMotion();
  checkThemeBootOrder();

  if (failures.length > 0) {
    for (const failure of failures) console.error(`FAIL: ${failure}`);
    console.error(`Design constraints: ${failures.length} 处违反`);
    process.exitCode = 1;
    return;
  }
  console.log("Design constraints OK: 7 组设计契约满足（令牌/对比度/字体栈/动效降级/启动顺序）");
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
