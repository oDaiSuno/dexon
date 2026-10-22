import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

export function readFramerTokens() {
  return JSON.parse(readFileSync(path.join(root, "src/renderer/styles/framer-tokens.json"), "utf8"));
}

function slug(framerPath) {
  return framerPath
    .slice(1)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-");
}

export function framerColorVariable(framerPath) {
  return `--fx-${slug(framerPath)}`;
}

export function framerTypeClass(framerPath) {
  return `type-${slug(framerPath)}`;
}

export function parseColor(value) {
  const hex = value.match(/^#([0-9a-f]{6})$/i);
  if (hex) {
    const [r, g, b] = hex[1].match(/../g).map((channel) => Number.parseInt(channel, 16));
    return { r, g, b, a: 1 };
  }
  const rgb = value.match(/^rgba?\(([^)]+)\)$/);
  if (!rgb) throw new Error(`unsupported color: ${value}`);
  const [r, g, b, a = 1] = rgb[1].split(",").map((part) => Number(part.trim()));
  return { r, g, b, a };
}

export function framerCssColor(value) {
  const { r, g, b, a } = parseColor(value);
  if (a === 1) return `#${[r, g, b].map((channel) => channel.toString(16).padStart(2, "0")).join("")}`;
  return `rgba(${r}, ${g}, ${b}, ${a})`;
}

function unitless(lineHeight) {
  const em = lineHeight.match(/^([\d.]+)em$/);
  if (!em) throw new Error(`unsupported line height: ${lineHeight}`);
  return em[1];
}

function letterSpacing(value) {
  return /^-?0(?:px|em)?$/.test(value) ? null : value;
}

export function framerTypeRule(framerPath, style, fontFamily) {
  const size = style.size.match(/^([\d.]+)px$/);
  if (!size) throw new Error(`unsupported font size: ${style.size}`);
  const declarations = [
    `font-family: ${fontFamily};`,
    `font-size: calc(${size[1]}px * var(--type-scale, 1));`,
    `font-weight: ${style.weight};`,
    `line-height: ${unitless(style.lineHeight)};`,
  ];
  const spacing = letterSpacing(style.letterSpacing);
  if (spacing) declarations.push(`letter-spacing: ${spacing};`);
  return `.${framerTypeClass(framerPath)} {\n${declarations.map((line) => `  ${line}`).join("\n")}\n}`;
}
