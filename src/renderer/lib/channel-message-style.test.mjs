import { importTestBundle } from "#test-bundle";
import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";
const { getUserBubbleStyle, USER_BUBBLE_COLORS } = await importTestBundle("src/renderer/lib/channel-message-style", {
  packages: "external",
  entryPoints: [path.join(import.meta.dirname, "channel-message-style.ts")],
});

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

test("channel bubbles keep distinct light/dark brand palettes; local follows the chat surface", () => {
  assert.deepEqual(Object.keys(USER_BUBBLE_COLORS).sort(), ["dark", "light"]);
  assert.deepEqual(Object.keys(USER_BUBBLE_COLORS.light).sort(), ["feishu", "telegram", "weixin"]);
  assert.deepEqual(Object.keys(USER_BUBBLE_COLORS.dark).sort(), ["feishu", "telegram", "weixin"]);

  for (const source of Object.keys(USER_BUBBLE_COLORS.light)) {
    const light = getUserBubbleStyle(source, false);
    const dark = getUserBubbleStyle(source, true);
    assert.notEqual(light.background, dark.background, `${source} should respond to theme changes`);
    assert.equal(light.foreground, "#faf9f7");
    assert.equal(dark.foreground, "#faf9f7");
  }

  // local bubble: theme-aware through chat.css tokens (field bg + ink text)
  const localLight = getUserBubbleStyle(undefined, false);
  const localDark = getUserBubbleStyle(undefined, true);
  assert.equal(localLight.background, "var(--bui-field)");
  assert.equal(localLight.foreground, "var(--bui-ink)");
  assert.equal(localDark.background, "var(--bui-field)");
  assert.equal(localDark.foreground, "var(--bui-ink)");
  assert.deepEqual(localLight, localDark);
});

test("every channel bubble palette meets WCAG AA text contrast", () => {
  for (const isDark of [false, true]) {
    for (const source of Object.keys(USER_BUBBLE_COLORS.light)) {
      const style = getUserBubbleStyle(source, isDark);
      assert.ok(contrastRatio(style.background, style.foreground) >= 4.5, `${isDark ? "dark" : "light"}/${source}`);
    }
  }
});

test("the local bubble tokens meet WCAG AA text contrast in both themes", () => {
  // field/ink pairs from chat.css (Beautiful UI palette)
  const pairs = [
    { background: "#f2f2f3", foreground: "#1f2124" }, // light field / ink
    { background: "#2b2c2f", foreground: "#f2f3f4" }, // dark field / ink
  ];
  for (const { background, foreground } of pairs) {
    assert.ok(contrastRatio(background, foreground) >= 4.5, `${background}/${foreground}`);
  }
});
