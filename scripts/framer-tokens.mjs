import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

export function readFramerTokens() {
  return JSON.parse(readFileSync(path.join(root, "src/renderer/styles/framer-tokens.json"), "utf8"));
}

export function framerColorVariable(framerPath) {
  return `--fx-${framerPath
    .slice(1)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")}`;
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
