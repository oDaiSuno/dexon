import assert from "node:assert/strict";
import test from "node:test";

// Phase 4 adds the navigation copy to the app i18n domain. Both dictionaries
// must carry every new key with a real translation so the new nav works in
// English and Chinese (check:i18n enforces placeholders; this pins presence).

const { enUS, zhCN } = await import("../../i18n/app.ts");

const NEW_NAV_KEYS = [
  "navChat",
  "navPluginsSkills",
  "navHistory",
  "personalSpace",
  "openCurrentFolder",
  "chooseOtherFolder",
  "switchSpace",
  "backToPersonalSpace",
  "pluginsTab",
  "skillsTab",
];

test("every phase-4 navigation key exists in both dictionaries with distinct translations", () => {
  for (const key of NEW_NAV_KEYS) {
    const en = enUS[key];
    const zh = zhCN[key];
    assert.ok(typeof en === "string" && en.length > 0, `enUS must define ${key}`);
    assert.ok(typeof zh === "string" && zh.length > 0, `zhCN must define ${key}`);
    assert.notEqual(en, zh, `${key} must have a real Chinese translation, not the English string`);
  }
});
