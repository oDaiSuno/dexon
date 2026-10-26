import { importTestBundle } from "#test-bundle";
import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

const { Check, Field, NumInput, SecretTextInput, Select, TextInput } = await importTestBundle(
  "src/renderer/components/form-controls",
  {
    stdin: {
      contents: 'export { Check, Field, NumInput, SecretTextInput, Select, TextInput } from "./form-controls.tsx";',
      resolveDir: import.meta.dirname,
      sourcefile: "form-controls-test-entry.tsx",
      loader: "tsx",
    },
    tsconfig: path.join(import.meta.dirname, "../../../tsconfig.renderer.json"),
    external: ["react", "react-dom", "react-dom/*"],
  },
);

function assertFieldAssociation(Control, props, tagName) {
  const html = renderToStaticMarkup(createElement(Field, { label: "Accessible field" }, createElement(Control, props)));
  const labelMatch = html.match(/<label[^>]*for="([^"]+)"/);
  assert.ok(labelMatch, html);
  const controlId = labelMatch[1].replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  assert.match(html, new RegExp(`<${tagName}[^>]*id="${controlId}"`));
}

test("Field associates its label with every shared input type", () => {
  assertFieldAssociation(TextInput, { value: "name", onChange() {} }, "input");
  assertFieldAssociation(SecretTextInput, { value: "secret", onChange() {} }, "input");
  assertFieldAssociation(NumInput, { value: "42", onChange() {} }, "input");
  assertFieldAssociation(Select, { value: "one", onChange() {}, options: ["one"] }, "select");
});

test("compact shared controls expose at least a 32px pointer target", () => {
  const secretHtml = renderToStaticMarkup(
    createElement(Field, { label: "API key" }, createElement(SecretTextInput, { value: "secret", onChange() {} })),
  );
  assert.match(secretHtml, /aria-label="Show API key"/);
  assert.match(secretHtml, /width:32px;height:32px/);

  const checkHtml = renderToStaticMarkup(createElement(Check, { label: "Reasoning", checked: true, onChange() {} }));
  assert.match(checkHtml, /min-height:32px/);
});

test("a shared check is announced as a switch that carries its label and on state", () => {
  const on = renderToStaticMarkup(createElement(Check, { label: "Reasoning", checked: true, onChange() {} }));
  const off = renderToStaticMarkup(createElement(Check, { label: "Reasoning", checked: false, onChange() {} }));
  assert.match(on, /<label[^>]*><input[^>]*type="checkbox"[^>]*role="switch"[^>]*checked=""[^>]*\/>Reasoning<\/label>/);
  assert.doesNotMatch(off, /checked=""/);
});
