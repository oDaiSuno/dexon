import assert from "node:assert/strict";
import test from "node:test";
import path from "node:path";
import { importTestBundle } from "#test-bundle";

const { suggestSlash, groupSlashSuggestions, parseSlashQuery, toSkillName, resolveActiveIndex, slashKeyIntent } =
  await importTestBundle("chat-input-slash-commands", {
    stdin: {
      contents:
        'export * from "./chat-input/slash-commands.ts"; export * from "./chat-input/command-slot.ts"; export {resolveActiveIndex, slashKeyIntent} from "./chat-input/use-slash-palette.ts";',
      resolveDir: import.meta.dirname,
      sourcefile: "slash-commands-entry.ts",
      loader: "ts",
    },
    tsconfig: path.join(import.meta.dirname, "../../../tsconfig.renderer.json"),
    external: ["react", "react-dom", "react-dom/*"],
  });
const skill = (name) => ({ name: toSkillName(name), description: "Installed skill" });
const query = (raw) => parseSlashQuery({ before: `/${raw}`, after: "" });
const sources = {
  builtins: [
    { name: "assist", description: "Choose a mode" },
    { name: "xmode", description: "" },
    { name: "alpha-mode", description: "" },
    { name: "model", description: "" },
    { name: "mode", description: "" },
  ],
  session: { commands: [], loading: false },
  skills: { entries: [skill("poteto-mode")], loading: false },
};

test("recommendations rank exact, prefix, word-prefix, substring and description matches in that order", () => {
  const { items } = suggestSlash(sources, query("mode"));
  assert.deepEqual(
    items.map((item) => item.label),
    ["mode", "model", "alpha-mode", "skill:poteto-mode", "xmode", "assist"],
  );
  assert.deepEqual(items.find((item) => item.source === "skill").highlights, [{ start: 13, end: 17 }]);
  assert.deepEqual(items.at(-1).highlights, []);
});

test("bare and scoped skill searches rank and highlight the bare name, while full-label searches still work", () => {
  const entries = [skill("poteto-mode"), skill("poteto-help"), skill("poteto-help")];
  const input = { ...sources, skills: { entries, loading: false } };
  for (const raw of ["potet", "skill:potet"]) {
    const items = suggestSlash(input, query(raw)).items;
    assert.deepEqual(
      items.map((item) => item.label),
      ["skill:poteto-help", "skill:poteto-mode"],
    );
    assert.deepEqual(items[0].highlights, [{ start: 6, end: 11 }]);
    assert.deepEqual(items[0].completion, { kind: "skill", name: "poteto-help" });
  }
  const full = suggestSlash(input, query("ski")).items;
  assert.deepEqual(full[0].highlights, [{ start: 0, end: 3 }]);
  assert.deepEqual(suggestSlash(input, query("pmode")).items, []);
});

test("groups include all four sources and keep each item's flattened keyboard index", () => {
  const input = {
    ...sources,
    session: {
      commands: [
        { name: "extension", source: "extension" },
        { name: "prompt", source: "prompt" },
      ],
      loading: true,
    },
  };
  const { items, pending } = suggestSlash(input, query(""));
  assert.equal(pending, true);
  const groups = groupSlashSuggestions(items);
  assert.deepEqual(
    groups.map((group) => group.source),
    ["builtin", "extension", "prompt", "skill"],
  );
  assert.deepEqual(
    groups.at(-1).items.map(({ item, index }) => [item.label, index]),
    [["skill:poteto-mode", 7]],
  );
});

test("selection follows an item ID within a query and otherwise returns to the best match", () => {
  const items = suggestSlash(
    { ...sources, skills: { entries: [skill("poteto-help"), skill("poteto-mode")], loading: false } },
    query("potet"),
  ).items;
  const selection = { queryKey: "potet", id: items[1].id };
  assert.equal(resolveActiveIndex([...items].reverse(), selection, "potet"), 0);
  assert.equal(resolveActiveIndex(items, selection, "poteto"), 0);
  assert.equal(resolveActiveIndex([items[0]], selection, "potet"), 0);
  assert.equal(resolveActiveIndex(items, selection, "potet"), 1);
});

test("completion keys act on the visible item even while loading and block every empty result", () => {
  const items = suggestSlash(sources, query("mode")).items;
  for (const key of ["Enter", "Tab"]) {
    assert.deepEqual(slashKeyIntent(key, false, { items, activeIndex: 1, pending: true }), {
      type: "apply",
      item: items[1],
    });
    for (const pending of [true, false]) {
      assert.deepEqual(slashKeyIntent(key, false, { items: [], activeIndex: 0, pending }), { type: "swallow" });
    }
  }
  assert.deepEqual(slashKeyIntent("Escape", false, { items, activeIndex: 0, pending: false }), { type: "dismiss" });
  assert.deepEqual(slashKeyIntent("Enter", true, { items, activeIndex: 0, pending: false }), { type: "pass" });
});
