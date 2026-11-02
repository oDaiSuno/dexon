import assert from "node:assert/strict";
import test from "node:test";
import { Type } from "typebox";
import { Value } from "typebox/value";
import { defineDexonTool } from "./tool-definition.ts";

test("Dexon tool definitions normalize activation by owner without changing their schema or execution result", async () => {
  for (const [dexonOwner, defaultActive] of [
    ["coding", true],
    ["browser", false],
    ["orchestration", false],
  ]) {
    const definition = Object.freeze({
      dexonOwner,
      name: "fixture_tool",
      label: "fixture tool",
      description: "Return the supplied message.",
      promptSnippet: "Return the supplied message.",
      exposure: "hidden",
      defaultActive: !defaultActive,
      parameters: Type.Object({ message: Type.String() }),
      async execute(_id, input) {
        return { content: [{ type: "text", text: input.message }], details: { accepted: true } };
      },
    });
    const tool = defineDexonTool(definition);
    assert.equal(tool.dexonOwner, dexonOwner);
    assert.equal(tool.defaultActive, defaultActive);
    assert.equal(tool.exposure, "direct");
    assert.equal(tool.promptSnippet, "Return the supplied message.");
    assert.equal(Value.Check(tool.parameters, { message: "captured" }), true);
    assert.equal(Value.Check(tool.parameters, { message: 7 }), false);
    const result = await tool.execute("fixture", { message: "captured" }, undefined, undefined, {});
    assert.deepEqual(result, {
      content: [{ type: "text", text: "captured" }],
      details: { accepted: true },
    });
    assert.equal(definition.exposure, "hidden");
    assert.equal(definition.defaultActive, !defaultActive);
  }
});
