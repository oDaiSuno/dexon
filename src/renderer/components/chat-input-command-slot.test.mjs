import assert from "node:assert/strict";
import test from "node:test";
import path from "node:path";
import { importTestBundle } from "#test-bundle";

const { toSkillName, parseSlashQuery, fillSerializedCommandSlot } = await importTestBundle("chat-input-command-slot", {
  entryPoints: [path.join(import.meta.dirname, "chat-input/command-slot.ts")],
  tsconfig: path.join(import.meta.dirname, "../../../tsconfig.renderer.json"),
});

const completion = { kind: "skill", name: toSkillName("poteto-mode") };

test("only valid round-trippable skill names can become completions", () => {
  assert.equal(completion.name, "poteto-mode");
  for (const name of ["", "Poteto", "poteto--mode", "poteto-", "../mode", "x".repeat(65)]) {
    assert.equal(toSkillName(name), null);
  }
});

test("a slash query belongs to the caret at the end of the leading command only", () => {
  assert.deepEqual(parseSlashQuery({ before: "/Potet", after: " explain @file" }), {
    key: "potet",
    raw: "Potet",
    needle: "potet",
    scope: "all",
  });
  assert.deepEqual(parseSlashQuery({ before: "/skill:pot", after: "\nexplain" }), {
    key: "skill:pot",
    raw: "skill:pot",
    needle: "pot",
    scope: "skill",
  });
  assert.equal(parseSlashQuery({ before: "/pot", after: "eto" }), null);
  assert.equal(parseSlashQuery({ before: "/etc/hosts", after: "" }), null);
  assert.equal(parseSlashQuery({ before: "explain /pot", after: "" }), null);
  assert.equal(parseSlashQuery(null), null);
  assert.ok(parseSlashQuery({ before: "/", after: "" }));
  assert.ok(parseSlashQuery({ before: "/pot", after: "\uFFFC\uFFFC" }));
});

test("serialized completion changes only the leading command and preserves draft separators", () => {
  for (const [input, expected] of [
    ["/potet", "/skill:poteto-mode "],
    ["/potet explain @/tmp/a.ts", "/skill:poteto-mode explain @/tmp/a.ts"],
    ["/potet\n\texplain @/tmp/a.ts", "/skill:poteto-mode\n\texplain @/tmp/a.ts"],
    ["/skill:other  body", "/skill:poteto-mode  body"],
    ["body", "/skill:poteto-mode body"],
    ["/etc/hosts", "/skill:poteto-mode /etc/hosts"],
  ]) {
    assert.equal(fillSerializedCommandSlot(input, completion), expected);
    assert.equal(fillSerializedCommandSlot(expected, completion), expected);
  }
  assert.equal(
    fillSerializedCommandSlot("/co\nkeep this", { kind: "command", name: "compact" }),
    "/compact\nkeep this",
  );
});
