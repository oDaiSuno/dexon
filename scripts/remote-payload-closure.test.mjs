import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { copyProductionPackages, packageNameOf, productionPackageClosure } from "./remote-payload-closure.mjs";
import { sortedPayloadEntries } from "./build-remote-payload.mjs";

test("remote package closure follows production dependencies and ignores Node builtins and absent optional packages", (t) => {
  const root = mkdtempSync(path.join(tmpdir(), "dexon-payload-packages-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  for (const [name, manifest] of [
    ["a", { dependencies: { b: "1" }, optionalDependencies: { absent: "1" } }],
    ["b", {}],
  ]) {
    const directory = path.join(root, "node_modules", name);
    mkdirSync(directory, { recursive: true });
    writeFileSync(path.join(directory, "package.json"), JSON.stringify({ name, version: "1.0.0", ...manifest }));
    writeFileSync(path.join(directory, "index.js"), "export default 1;\n");
    writeFileSync(path.join(directory, ".runtime-data.json"), "{}\n");
  }
  const packages = productionPackageClosure(root, ["a", "a/subpath", "node:fs"]);
  assert.deepEqual(
    packages.map((entry) => entry.manifest.name),
    ["a", "b"],
  );
  const destination = path.join(root, "copied");
  copyProductionPackages(packages, destination, { os: "linux", arch: "x64" });
  assert.equal(readFileSync(path.join(destination, "node_modules", "a", ".runtime-data.json"), "utf8"), "{}\n");
  assert.deepEqual(readdirSync(path.join(destination, "node_modules")), ["a", "b"]);
  assert.equal(packageNameOf("@scope/package/subpath"), "@scope/package");
  assert.equal(packageNameOf("node:crypto"), null);
});

test("archive enumeration includes hidden runtime manifests in repeatable order", (t) => {
  const root = mkdtempSync(path.join(tmpdir(), "dexon-payload-files-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  mkdirSync(path.join(root, "data"));
  writeFileSync(path.join(root, "data", ".manifest.json"), "{}");
  writeFileSync(path.join(root, "index.mjs"), "export {};\n");
  assert.deepEqual(sortedPayloadEntries(root), ["data", "data/.manifest.json", "index.mjs"]);
});
