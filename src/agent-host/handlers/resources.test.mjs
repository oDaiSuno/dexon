import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { captureHandlers, isolatedAgentDirectory } from "../handlers-test-support.mjs";

const skillText = (body) => `---\nname: editable\ndescription: Editable fixture skill\n---\n${body}\n`;

async function setup(t) {
  const cwd = await fs.mkdtemp(path.join(isolatedAgentDirectory, "resource-project-"));
  t.after(() => fs.rm(cwd, { recursive: true, force: true }));
  const filePath = path.join(cwd, ".pi", "skills", "editable", "SKILL.md");
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, skillText("original"));
  const { handlers } = await captureHandlers();
  return { cwd, filePath, handlers };
}

test("skill edits can be read back and unloaded paths remain forbidden", async (t) => {
  const { cwd, filePath, handlers } = await setup(t);
  assert.deepEqual(await handlers["skills.getContent"]({ cwd, filePath }), { content: skillText("original") });
  assert.deepEqual(await handlers["skills.set"]({ cwd, filePath, content: skillText("changed") }), { ok: true });
  assert.deepEqual(await handlers["skills.getContent"]({ cwd, filePath }), { content: skillText("changed") });
  const outside = path.join(cwd, "outside.md");
  await fs.writeFile(outside, "outside");
  await assert.rejects(handlers["skills.set"]({ cwd, filePath: outside, content: "must not write" }), {
    code: "FORBIDDEN",
  });
  assert.equal(await fs.readFile(outside, "utf8"), "outside");
});

test("concurrent skill saves each finish without sharing a temporary file", async (t) => {
  const { cwd, filePath, handlers } = await setup(t);
  const rename = fs.rename.bind(fs);
  const ready = Promise.withResolvers();
  let arrivals = 0;
  t.mock.method(fs, "rename", async (source, target) => {
    if (target === filePath) {
      arrivals += 1;
      if (arrivals === 2) ready.resolve();
      await ready.promise;
    }
    return rename(source, target);
  });
  const first = skillText("first complete edit");
  const second = skillText("second complete edit");
  assert.deepEqual(
    await Promise.all([
      handlers["skills.set"]({ cwd, filePath, content: first }),
      handlers["skills.set"]({ cwd, filePath, content: second }),
    ]),
    [{ ok: true }, { ok: true }],
  );
  const saved = await handlers["skills.getContent"]({ cwd, filePath });
  assert.ok(saved.content === first || saved.content === second);
  assert.deepEqual(await fs.readdir(path.dirname(filePath)), ["SKILL.md"]);
});
