import assert from "node:assert/strict";
import test from "node:test";
import YAML from "yaml";
import { findMissingPiAuthoringAssets } from "./pi-authoring-assets.mjs";

function configurationWithout(omittedPackage) {
  const files = ["pi-coding-agent", "pi-ai", "pi-agent-core", "pi-codemode", "pi-mcp", "pi-telemetry", "pi-tui"].map(
    (name) => ({
      from: `node_modules/@earendil-works/${name}`,
      to: `node_modules/@earendil-works/${name}`,
      filter: [
        ...(name === omittedPackage ? [] : ["README.md"]),
        "dist/**/*.d.ts",
        ...(name === "pi-coding-agent" ? ["docs/**/*", "examples/**/*"] : []),
        ...(name === "pi-mcp" ? ["LICENSES/**/*"] : []),
      ],
    }),
  );
  files.push(
    {
      from: "node_modules/quickjs-wasi/dist",
      to: "node_modules/quickjs-wasi/dist",
      filter: ["**/*.d.ts"],
    },
    {
      from: "node_modules/@earendil-works/pi-coding-agent/node_modules/@silvia-odwyer/photon-node",
      to: "node_modules/@silvia-odwyer/photon-node",
      filter: ["LICENSE.md"],
    },
  );
  return YAML.stringify({ files });
}

test("a configuration retaining every Pi package's authoring assets passes", () => {
  assert.deepEqual(findMissingPiAuthoringAssets(configurationWithout()), []);
});

test("another package's README does not cover a missing Pi core README", () => {
  assert.deepEqual(findMissingPiAuthoringAssets(configurationWithout("pi-agent-core")), [
    "node_modules/@earendil-works/pi-agent-core: README.md",
  ]);
});
