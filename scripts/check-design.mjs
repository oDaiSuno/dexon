#!/usr/bin/env node
/**
 * Blocking design contracts: Framer is the only source of colors and text
 * styles, the generated CSS matches its export, retired names and direct
 * typography only shrink, contrast, shared fonts, motion policy and theme boot
 * ordering. UI behavior belongs at its public boundary.
 */
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import postcss from "postcss";
import { readRendererCssSources, readStylePartial, rendererCssImportOrder } from "./css-sources.mjs";
import { APP_MONO_FONT_FAMILY, APP_SANS_FONT_FAMILY } from "../src/shared/font-stack.ts";
import { parseColor, readFramerTokens } from "./framer-tokens.mjs";
import { staleFramerOutputs } from "./sync-framer-tokens.mjs";
import { checkColorLedger } from "./design-debt/color-ledger.mjs";
import { checkDesignDebt, readDebtLedgers, remainingDebt } from "./design-debt/ledger.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const failures = [];
const read = (relative) => readFileSync(path.join(root, relative), "utf8");
const exists = (relative) => existsSync(path.join(root, relative));

function requireFile(relative) {
  if (!exists(relative)) failures.push(`缺少必备文件: ${relative}`);
  return exists(relative);
}

function checkColorLiterals() {
  failures.push(...checkColorLedger());
}

// ---------------------------------------------------------------------------
// D. 生成物与 Framer 导出一致；tokens.css 手写区不出现裸色值
// ---------------------------------------------------------------------------
function checkFramerMirror() {
  for (const stale of staleFramerOutputs()) {
    failures.push(
      `${stale} 与 framer-tokens.json 不一致：运行 node --experimental-strip-types scripts/sync-framer-tokens.mjs`,
    );
  }
  const css = readStylePartial("tokens.css");
  const handWritten = css.replace(
    /\/\* FRAMER-MIRROR:(light|dark):start \*\/[\s\S]*?\/\* FRAMER-MIRROR:\1:end \*\//g,
    "",
  );
  for (const [, token, value] of handWritten.matchAll(/\n\s*(--[a-z0-9-]+):\s*([^;]+);/g)) {
    if (/#[0-9a-f]{3,8}\b|rgba?\(/i.test(value)) {
      failures.push(`tokens.css ${token} 写了裸色值 ${value.trim()}：颜色只能来自 Framer（var(--fx-*)）`);
    }
  }
}

function checkDebt() {
  failures.push(...checkDesignDebt());
  for (const ledger of readDebtLedgers().filter((entry) => entry.permanent)) {
    for (const entry of ledger.typography ?? []) {
      if (!entry.reason?.trim()) failures.push(`${entry.file} 的 ${entry.property} 是永久豁免，必须写明 reason`);
    }
  }
}

// ---------------------------------------------------------------------------
// E. 文字与底色对比度满足 WCAG AA（独立判据：WCAG 2.x 正文 ≥ 4.5）
//    取值来自 framer-tokens.json，即设计稿本身
// ---------------------------------------------------------------------------
const CONTRAST_PAIRS = [
  ["/Text/Primary", "/Surface/Main"],
  ["/Text/Secondary", "/Surface/Main"],
  ["/Text/Tertiary", "/Surface/Main"],
  ["/Text/Tertiary", "/Surface/Sidebar"],
  ["/Text/On Accent", "/Accent/Blue Fill"],
  ["/Text/On Accent", "/Accent/Blue Fill Hover"],
  ["/Accent/Blue Text", "/Surface/Main"],
  ["/Accent/Blue Text", "/Accent/Blue Soft"],
  ["/Status/Success Text", "/Surface/Raised"],
  ["/Status/Warning Text", "/Surface/Raised"],
  ["/Status/Danger Text", "/Surface/Raised"],
  ["/Text/Inverse", "/Surface/Inverse"],
  ["/Text/Inverse", "/Surface/Inverse Hover"],
  ["/Text/On Danger", "/Status/Danger"],
];

function relativeLuminance({ r, g, b }) {
  const linear = [r, g, b]
    .map((channel) => channel / 255)
    .map((channel) => (channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4));
  return 0.2126 * linear[0] + 0.7152 * linear[1] + 0.0722 * linear[2];
}

function contrastRatio(first, second) {
  const luminances = [relativeLuminance(first), relativeLuminance(second)].sort((a, b) => b - a);
  return (luminances[0] + 0.05) / (luminances[1] + 0.05);
}

function checkContrast() {
  const { colors } = readFramerTokens();
  for (const [foreground, background] of CONTRAST_PAIRS) {
    for (const theme of ["light", "dark"]) {
      if (!colors[foreground] || !colors[background]) {
        failures.push(`framer-tokens.json 缺少颜色 ${colors[foreground] ? background : foreground}`);
        continue;
      }
      const ratio = contrastRatio(parseColor(colors[foreground][theme]), parseColor(colors[background][theme]));
      if (ratio < 4.5) {
        failures.push(`${theme} 主题 ${foreground} 在 ${background} 上对比度 ${ratio.toFixed(2)} 低于 WCAG AA (4.5)`);
      }
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
  const families = new Set(Object.values(readFramerTokens().textStyles).map((style) => style.family));
  const framerMono = [...families].find((family) => /mono/i.test(family));
  const framerSans = [...families].find((family) => !/mono/i.test(family));
  if (framerSans && !APP_SANS_FONT_FAMILY.startsWith(`"${framerSans}"`)) {
    failures.push(`共享无衬线字体栈必须以 Framer 文字样式的 ${framerSans} 打头`);
  }
  if (framerMono && !APP_MONO_FONT_FAMILY.startsWith(`"${framerMono}"`)) {
    failures.push(`共享等宽字体栈必须以 Framer 文字样式的 ${framerMono} 打头`);
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

function checkDuplicateCustomProperties() {
  for (const file of rendererCssImportOrder()) {
    const relative = `src/renderer/${file}`;
    postcss.parse(read(relative), { from: relative }).walkRules((rule) => {
      const firstLine = new Map();
      rule.each((node) => {
        if (node.type !== "decl" || !node.prop.startsWith("--")) return;
        const line = node.source?.start?.line ?? 0;
        if (firstLine.has(node.prop)) {
          failures.push(
            `${relative}:${firstLine.get(node.prop)},${line} 的 ${rule.selector} 里 ${node.prop} 定义了两次，后一次会覆盖前一次：给其中一个改名`,
          );
        } else firstLine.set(node.prop, line);
      });
    });
  }
}

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
  checkColorLiterals();
  checkFramerMirror();
  checkDebt();
  checkContrast();
  checkRemovedTokens();
  checkFontStack();
  checkNavMotion();
  checkDuplicateCustomProperties();
  checkThemeBootOrder();

  if (failures.length > 0) {
    for (const failure of failures) console.error(`FAIL: ${failure}`);
    console.error(`Design constraints: ${failures.length} 处违反`);
    process.exitCode = 1;
    return;
  }
  console.log(
    "Design constraints OK: 9 组设计契约满足（写死颜色/Framer 生成物/旧名字与直写字体只减不增/对比度/字体栈/动效降级/令牌不重名/启动顺序）",
  );
  const remaining = remainingDebt();
  if (remaining.length > 0) {
    console.log(
      `待迁移：${remaining.map((row) => `${row.lane} 旧名字 ${row.legacy} 处、直写字体 ${row.typography} 处`).join("；")}`,
    );
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
