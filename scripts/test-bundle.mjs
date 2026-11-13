import { globSync as fsGlobSync, readFileSync, rmSync } from "node:fs";
import path from "node:path";
import { after } from "node:test";
import { pathToFileURL } from "node:url";
import { build } from "esbuild";
import { createProjectBuildTemp } from "./process-utils.mjs";

// Tests should import Node-compatible .ts modules directly through Node 22 type
// stripping. Use this bundle path only for JSX, path aliases, virtual mocks, or
// module graphs whose extension resolution requires esbuild.

const bundleCleanups = new Set();
function cleanupBundles() {
  for (const cleanup of bundleCleanups) cleanup();
  bundleCleanups.clear();
}
if (process.env.NODE_TEST_CONTEXT) after(cleanupBundles);
else process.once("exit", cleanupBundles);

function safeBundleName(name) {
  const normalized = name.replace(/[^a-zA-Z0-9._-]+/g, "-").replace(/^-+|-+$/g, "");
  if (!normalized) throw new Error("Test bundle name must contain a safe character");
  return normalized.slice(-80);
}

export async function importTestBundle(name, buildOptions, runtimeOptions = {}) {
  if (!buildOptions || typeof buildOptions !== "object" || Array.isArray(buildOptions)) {
    throw new TypeError("Test bundle options must be an object");
  }
  for (const forbidden of ["outfile", "outdir", "write"]) {
    if (forbidden in buildOptions) throw new Error(`Test bundles cannot override ${forbidden}`);
  }

  const projectRoot = runtimeOptions.projectRoot ?? path.resolve(import.meta.dirname, "..");
  const directory = createProjectBuildTemp(projectRoot, `pi-test-bundle-${safeBundleName(name)}-`, {
    ...(runtimeOptions.temporaryRoot ? { temporaryRoot: runtimeOptions.temporaryRoot } : {}),
  });
  const outputFile = path.join(directory, "module.mjs");
  try {
    await build({
      bundle: true,
      format: "esm",
      platform: "node",
      sourcemap: false,
      logLevel: "silent",
      ...buildOptions,
      outfile: outputFile,
    });
    for (const [fileName, entry] of Object.entries(runtimeOptions.companions ?? {})) {
      if (path.basename(fileName) !== fileName) throw new Error("Companion must be a sibling file");
      await build({
        bundle: true,
        format: "esm",
        platform: "node",
        packages: "external",
        sourcemap: false,
        logLevel: "silent",
        entryPoints: [path.resolve(projectRoot, entry)],
        outfile: path.join(directory, fileName),
      });
    }
    const module = await import(`${pathToFileURL(outputFile).href}?bundle=${Date.now()}`);
    (runtimeOptions.registerCleanup ?? ((cleanup) => bundleCleanups.add(cleanup)))(() =>
      rmSync(directory, { recursive: true, force: true }),
    );
    return module;
  } catch (error) {
    rmSync(directory, { recursive: true, force: true });
    throw error;
  }
}

export function findLegacyTestBundleUsage(source) {
  const violations = [];
  if (/\bfrom\s+["']esbuild["']|\bimport\s*\(\s*["']esbuild["']\s*\)/.test(source)) {
    violations.push("direct esbuild import");
  }
  if (/\.artifacts[\\/"'`,\s]+test-modules|test-modules[\\/"'`,\s]/.test(source)) {
    violations.push("repository test-modules output");
  }
  return violations;
}

export function assertNoLegacyTestBundleUsage(root, fileSystem = { globSync: fsGlobSync, readFileSync }) {
  const failures = [];
  for (const file of fileSystem.globSync("src/**/*.test.mjs", { cwd: root })) {
    const violations = findLegacyTestBundleUsage(fileSystem.readFileSync(path.join(root, file), "utf8"));
    if (violations.length) failures.push(`${file}: ${violations.join(", ")}`);
  }
  if (failures.length) throw new Error(`Legacy test bundle usage is forbidden:\n${failures.join("\n")}`);
}
