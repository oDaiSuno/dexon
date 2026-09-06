import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { checkRendererI18n } from "./renderer-i18n-checker.mjs";

function fixture(component, dictionaryFiles, componentPath = "Component.tsx") {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "pi-renderer-i18n-"));
  const rendererRoot = path.join(root, "src/renderer");
  fs.mkdirSync(rendererRoot, { recursive: true });
  const target = path.join(rendererRoot, componentPath);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, component);
  const dictionaryPaths = [];
  for (const { file, content } of dictionaryFiles) {
    const absolute = path.join(rendererRoot, file);
    fs.mkdirSync(path.dirname(absolute), { recursive: true });
    fs.writeFileSync(absolute, content);
    dictionaryPaths.push(absolute);
  }
  return {
    cleanup: () => fs.rmSync(root, { recursive: true, force: true }),
    options: { root, rendererRoot, dictionaryPaths },
  };
}

const singleDictionary = (content) => [{ file: "i18n-dictionaries.ts", content }];

test("accepts static calls with exact bilingual dictionary and placeholder parity", () => {
  const entry = fixture(
    'export const value = t("greeting", "Hello {name}");',
    singleDictionary(
      'export const enUS = { greeting: "Hello {name}" }; export const zhCN = { greeting: "你好 {name}" };',
    ),
  );
  try {
    assert.deepEqual(checkRendererI18n(entry.options), { failures: [], keyCount: 1 });
  } finally {
    entry.cleanup();
  }
});

test("rejects visible literals and hardcoded session notification sinks in migrated owners", () => {
  const component = fixture(
    'export function AppShell() { return <button aria-label="Open panel">Open panel</button>; }',
    singleDictionary("export const enUS = {}; export const zhCN = {};"),
    "components/AppShell.tsx",
  );
  const hook = fixture(
    'addNotice({ type: "error", message: "Queue failed" }); complete({ handled: true, error: "No session" });',
    singleDictionary("export const enUS = {}; export const zhCN = {};"),
    "hooks/useAgentSession.ts",
  );
  try {
    const componentOutput = checkRendererI18n(component.options).failures.join("\n");
    assert.match(componentOutput, /visible English JSX literal: Open panel/);
    const hookOutput = checkRendererI18n(hook.options).failures.join("\n");
    assert.match(hookOutput, /hardcoded session message: Queue failed/);
    assert.match(hookOutput, /hardcoded session error: No session/);
  } finally {
    component.cleanup();
    hook.cleanup();
  }
});

test("rejects dynamic calls, fallback drift, missing and duplicate entries, orphan keys, and placeholder mismatch", () => {
  const entry = fixture(
    `
      const dynamicKey = "dynamic";
      t(dynamicKey, "Dynamic");
      t("fallback", "Source fallback");
      t("missing", "Missing");
      t("inconsistent", "First");
      t("inconsistent", "Second");
    `,
    singleDictionary(`
      export const enUS = {
        fallback: "Registered fallback",
        inconsistent: "First",
        duplicate: "one",
        duplicate: "two",
        orphan: "Orphan",
        placeholder: "Hello {name}",
      };
      export const zhCN = {
        fallback: "回退",
        inconsistent: "第一",
        duplicate: "重复",
        orphan: "孤儿",
        placeholder: "你好",
      };
    `),
  );
  try {
    const { failures } = checkRendererI18n(entry.options);
    const output = failures.join("\n");
    assert.match(output, /dynamic translation key or fallback/);
    assert.match(output, /fallback.*does not match the registered en-US value/);
    assert.match(output, /zh-CN is missing missing/);
    assert.match(output, /enUS contains duplicate key duplicate/);
    assert.match(output, /inconsistent uses inconsistent fallbacks/);
    assert.match(output, /dictionary key orphan has no static Renderer translation call/);
    assert.match(output, /placeholder placeholder mismatch/);
  } finally {
    entry.cleanup();
  }
});

test("merges bilingual partials across dictionary files with a spread composition root", () => {
  const entry = fixture('export const a = t("greet", "Hello"); export const b = t("bye", "Bye");', [
    {
      file: "i18n-dictionaries.ts",
      content:
        'import { enUS as chatEN, zhCN as chatZH } from "./i18n/chat.ts";\n' +
        "export const enUS = { ...chatEN };\nexport const zhCN = { ...chatZH };",
    },
    {
      file: "i18n/chat.ts",
      content: 'export const enUS = { greet: "Hello" };\nexport const zhCN = { greet: "你好" };',
    },
    { file: "i18n/nav.ts", content: 'export const enUS = { bye: "Bye" };\nexport const zhCN = { bye: "再见" };' },
  ]);
  try {
    assert.deepEqual(checkRendererI18n(entry.options), { failures: [], keyCount: 2 });
  } finally {
    entry.cleanup();
  }
});

test("rejects the same dictionary key defined in two partial files", () => {
  const entry = fixture('export const a = t("hi", "Hello");', [
    { file: "i18n-dictionaries.ts", content: "export const enUS = {};\nexport const zhCN = {};" },
    { file: "i18n/chat.ts", content: 'export const enUS = { hi: "Hello" };\nexport const zhCN = { hi: "你好" };' },
    {
      file: "i18n/nav.ts",
      content: 'export const enUS = { hi: "Hello again" };\nexport const zhCN = { hi: "你好2" };',
    },
  ]);
  try {
    const output = checkRendererI18n(entry.options).failures.join("\n").split(path.sep).join("/");
    assert.match(output, /dictionary key hi is defined in both .*i18n\/chat\.ts and .*i18n\/nav\.ts/);
  } finally {
    entry.cleanup();
  }
});

test("rejects spread entries inside dictionary partials while allowing them in the composition root", () => {
  const entry = fixture('export const a = t("hi", "Hello");', [
    { file: "i18n-dictionaries.ts", content: "export const enUS = {};\nexport const zhCN = {};" },
    {
      file: "i18n/chat.ts",
      content: 'const extra = { hi: "Hello" };\nexport const enUS = { ...extra };\nexport const zhCN = { hi: "你好" };',
    },
  ]);
  try {
    const output = checkRendererI18n(entry.options).failures.join("\n");
    assert.match(output, /enUS contains a non-static dictionary entry/);
  } finally {
    entry.cleanup();
  }
});

test("accepts legal type-only imports in the composition root without crashing", () => {
  const typedImport = fixture('export const a = t("hi", "Hello");', [
    {
      file: "i18n-dictionaries.ts",
      content:
        'import { enUS as chatEN, zhCN as chatZH, type Dictionary } from "./i18n/chat.ts";\n' +
        "export const enUS: Dictionary = { ...chatEN };\nexport const zhCN: Dictionary = { ...chatZH };",
    },
    {
      file: "i18n/chat.ts",
      content:
        'export type Dictionary = Record<string, string>;\nexport const enUS = { hi: "Hello" };\nexport const zhCN = { hi: "你好" };',
    },
  ]);
  try {
    const typedResult = checkRendererI18n(typedImport.options);
    assert.deepEqual(typedResult.failures, [], "legal type imports must not crash the checker");
    assert.equal(typedResult.keyCount, 1);
  } finally {
    typedImport.cleanup();
  }
});

test("rejects a root spreading a non-renamed binding that is not a dictionary language", () => {
  const nonRenamedUnknown = fixture('export const a = t("hi", "Hello");', [
    {
      file: "i18n-dictionaries.ts",
      content:
        'import { overrides } from "./i18n/chat.ts";\n' +
        "export const enUS = { ...overrides };\nexport const zhCN = {};",
    },
    {
      file: "i18n/chat.ts",
      content:
        'export const overrides = { hi: "Hello" };\nexport const enUS = { hi: "Hello" };\nexport const zhCN = { hi: "你好" };',
    },
  ]);
  try {
    const unknownOutput = checkRendererI18n(nonRenamedUnknown.options).failures.join("\n");
    assert.match(unknownOutput, /enUS contains a non-static dictionary entry/);
  } finally {
    nonRenamedUnknown.cleanup();
  }
});

test("rejects composition-root spreads from unknown sources or wrong languages", () => {
  const unknown = fixture('export const a = t("hi", "Hello");', [
    {
      file: "i18n-dictionaries.ts",
      content:
        'import { enUS as chatEN, zhCN as chatZH } from "./i18n/chat.ts";\n' +
        'const overrides = { hi: "Changed" };\n' +
        "export const enUS = { ...chatEN, ...overrides };\nexport const zhCN = { ...chatZH };",
    },
    { file: "i18n/chat.ts", content: 'export const enUS = { hi: "Hello" };\nexport const zhCN = { hi: "你好" };' },
  ]);
  const wrongLanguage = fixture('export const a = t("hi", "Hello");', [
    {
      file: "i18n-dictionaries.ts",
      content:
        'import { enUS as chatEN, zhCN as chatZH } from "./i18n/chat.ts";\n' +
        "export const enUS = { ...chatZH };\nexport const zhCN = { ...chatZH };",
    },
    { file: "i18n/chat.ts", content: 'export const enUS = { hi: "Hello" };\nexport const zhCN = { hi: "你好" };' },
  ]);
  try {
    const unknownOutput = checkRendererI18n(unknown.options).failures.join("\n");
    assert.match(unknownOutput, /enUS contains a non-static dictionary entry/);
    const wrongLanguageOutput = checkRendererI18n(wrongLanguage.options).failures.join("\n");
    assert.match(wrongLanguageOutput, /enUS contains a non-static dictionary entry/);
  } finally {
    unknown.cleanup();
    wrongLanguage.cleanup();
  }
});

test("enforces bilingual parity across partial files", () => {
  const entry = fixture('export const a = t("solo", "Only here");', [
    { file: "i18n-dictionaries.ts", content: "export const enUS = {};\nexport const zhCN = {};" },
    {
      file: "i18n/chat.ts",
      content: 'export const enUS = { solo: "Only here" };\nexport const zhCN = { other: "别的" };',
    },
  ]);
  try {
    const output = checkRendererI18n(entry.options).failures.join("\n");
    assert.match(output, /zh-CN is missing solo/);
    assert.match(output, /en-US is missing other/);
  } finally {
    entry.cleanup();
  }
});

test("fails closed when no dictionary file declares a language", () => {
  const entry = fixture('export const a = t("hi", "Hello");', [
    { file: "i18n-dictionaries.ts", content: "export const zhCN = {};" },
  ]);
  try {
    const output = checkRendererI18n(entry.options).failures.join("\n");
    assert.match(output, /dictionary enUS was not found/);
  } finally {
    entry.cleanup();
  }
});
