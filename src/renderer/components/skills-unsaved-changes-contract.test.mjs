import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const detailSource = readFileSync(new URL("./skills/skill-detail.tsx", import.meta.url), "utf8");
const rootSource = readFileSync(new URL("./SkillsConfig.tsx", import.meta.url), "utf8");
const guardSource = readFileSync(new URL("./skills/use-skill-leave-guard.ts", import.meta.url), "utf8");
const promptSource = readFileSync(new URL("./skills/unsaved-skill-prompt.tsx", import.meta.url), "utf8");
const listSource = readFileSync(new URL("./skills/skill-list.tsx", import.meta.url), "utf8");
const settingsSource = readFileSync(new URL("./SettingsConfig.tsx", import.meta.url), "utf8");

test("SkillDetail exposes dirty state and a fallible save operation", () => {
  assert.match(detailSource, /hasUnsavedChanges: \(\) => content !== savedContent/);
  assert.match(detailSource, /save: saveContent/);
  assert.match(detailSource, /const saveContent = useCallback\(async \(\): Promise<boolean>/);
  assert.match(detailSource, /setSavedContent\(content\);\s*onSaved\(\);\s*return true/);
  assert.match(detailSource, /catch \(error\) \{[\s\S]*?setContentError[\s\S]*?return false/);
});

test("SkillsConfig gates switching, adding, closing, and reload", () => {
  assert.match(rootSource, /requestLeave: requestTransition/);
  assert.match(rootSource, /requestTransition\(\(\) => \{\s*directory\.setSelected\(filePath\)/);
  assert.match(rootSource, /requestTransition\(\(\) => setAddMode\(true\)\)/);
  assert.equal((rootSource.match(/requestTransition\(onClose\)/g) ?? []).length >= 3, true);
  assert.match(guardSource, /window\.addEventListener\("beforeunload", preventReload\)/);
});

test("the unsaved prompt offers save, discard, and cancel", () => {
  assert.match(promptSource, /onClick=\{onDiscard\}/);
  assert.match(promptSource, /onClick=\{onCancel\}/);
  assert.match(promptSource, /onClick=\{\(\) => void onSave\(\)\}/);
  assert.match(guardSource, /if \(!saved\) return/);
});

test("the root binds the prompt to the real guard operations", () => {
  assert.match(rootSource, /onDiscard=\{guard\.discardAndContinue\}/);
  assert.match(rootSource, /onCancel=\{guard\.cancelTransition\}/);
  assert.match(rootSource, /onSave=\{guard\.saveAndContinue\}/);
  assert.match(guardSource, /const cancelTransition = useCallback\(\(\) => setPendingTransition\(null\), \[\]\)/);
});

test("the list routes skill selection and add through the root guard", () => {
  assert.match(listSource, /onSelectSkill\(skill\.filePath\)/);
  assert.match(listSource, /onClick=\{onAddSkill\}/);
  assert.match(rootSource, /onSelectSkill=\{selectSkill\}/);
  assert.match(rootSource, /onAddSkill=\{\(\) => requestTransition\(\(\) => setAddMode\(true\)\)\}/);
});

test("Settings routes every close and tab transition through SkillsConfig", () => {
  assert.match(settingsSource, /skillsConfigRef\.current\.requestLeave\(action\)/);
  assert.match(settingsSource, /event\.target === event\.currentTarget\) requestSettingsTransition\(onClose\)/);
  assert.match(settingsSource, /event\.key === "Escape"[\s\S]*?requestSettingsTransition\(onClose\)/);
  assert.match(settingsSource, /onClick=\{\(\) => requestSettingsTransition\(onClose\)\}/);
  assert.match(settingsSource, /if \(!active\) requestSettingsTransition\(\(\) => setActiveTab\(tab\.id\)\)/);
  assert.match(settingsSource, /<SkillsConfig ref=\{skillsConfigRef\}/);
});
