import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { fileURLToPath, pathToFileURL } from "node:url";
import { build } from "esbuild";
import { create as createTar } from "tar";
import { copyProductionPackages, productionPackageClosure } from "./remote-payload-closure.mjs";
export const REMOTE_PAYLOAD_TARGETS = [
  { os: "linux", arch: "x64" },
  { os: "linux", arch: "arm64" },
  { os: "darwin", arch: "arm64" },
];
export function sortedPayloadEntries(directory) {
  const entries = [];
  const walk = (relative) => {
    for (const entry of fs
      .readdirSync(path.join(directory, relative), { withFileTypes: true })
      .sort((a, b) => a.name.localeCompare(b.name, "en"))) {
      const name = path.posix.join(relative, entry.name);
      entries.push(name);
      if (entry.isDirectory()) walk(name);
    }
  };
  walk("");
  return entries;
}
export async function buildRemotePayload(root) {
  const output = path.join(root, "out", "remote-payload");
  const stage = fs.mkdtempSync(path.join(root, "out", ".remote-payload-"));
  try {
    const pkg = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));
    const hash = createHash("sha256");
    for (const file of [
      ...fs.globSync("src/**/*.ts", { cwd: root }),
      "package-lock.json",
      "scripts/build-remote-payload.mjs",
      "scripts/remote-payload-closure.mjs",
      "build/toolchains/runtime-catalog.json",
      "build/toolchains/core-catalog.json",
    ].sort()) {
      hash.update(file);
      hash.update(fs.readFileSync(path.join(root, file)));
    }
    const version = `${pkg.version}-${hash.digest("hex").slice(0, 12)}`;
    const common = path.join(stage, "common");
    const result = await build({
      absWorkingDir: root,
      entryPoints: {
        "agent-host": "src/agent-host/index.ts",
        "plugin-worker": "src/agent-host/plugin-worker.ts",
        "managed-process-worker": "src/agent-host/managed-process/worker.ts",
      },
      bundle: true,
      platform: "node",
      format: "esm",
      target: "node22",
      packages: "external",
      outdir: path.join(common, "out", "main"),
      outExtension: { ".js": ".mjs" },
      metafile: true,
      legalComments: "none",
      define: {
        "process.env.PI_DESKTOP_EXPECTED_PI_VERSION": JSON.stringify(
          pkg.dependencies["@earendil-works/pi-coding-agent"],
        ),
        "process.env.DEXON_REMOTE_PAYLOAD_VERSION": JSON.stringify(version),
      },
    });
    fs.writeFileSync(path.join(common, "index.mjs"), 'import "./out/main/agent-host.mjs";\n');
    fs.writeFileSync(
      path.join(common, "package.json"),
      JSON.stringify({ name: "dexon-remote", version: pkg.version, type: "module", dependencies: pkg.dependencies }),
    );
    fs.mkdirSync(path.join(common, "build", "toolchains"), { recursive: true });
    for (const name of ["runtime-catalog.json", "core-catalog.json"])
      fs.copyFileSync(path.join(root, "build", "toolchains", name), path.join(common, "build", "toolchains", name));
    const imports = Object.values(result.metafile.outputs).flatMap((entry) =>
      entry.imports.filter((item) => item.external).map((item) => item.path),
    );
    const packages = productionPackageClosure(root, imports);
    fs.mkdirSync(output, { recursive: true });
    const payloads = [];
    for (const target of REMOTE_PAYLOAD_TARGETS) {
      const directory = path.join(stage, `${target.os}-${target.arch}`);
      fs.cpSync(common, directory, { recursive: true });
      copyProductionPackages(packages, directory, target);
      const core = path.join(root, "build", "toolchains", "core", `${target.os}-${target.arch}`);
      if (fs.existsSync(core))
        fs.cpSync(core, path.join(directory, "build", "toolchains", "core", `${target.os}-${target.arch}`), {
          recursive: true,
        });
      const file = `dexon-remote-${version}-${target.os}-${target.arch}.tar.gz`;
      const entries = sortedPayloadEntries(directory);
      await createTar(
        {
          cwd: directory,
          file: path.join(output, file),
          gzip: { level: 9, mtime: 0 },
          portable: true,
          mtime: new Date(0),
          noMtime: false,
          jobs: 1,
          noDirRecurse: true,
        },
        entries,
      );
      const bytes = fs.readFileSync(path.join(output, file));
      payloads.push({ ...target, file, sha256: createHash("sha256").update(bytes).digest("hex"), bytes: bytes.length });
    }
    const manifest = { version, payloads };
    fs.writeFileSync(path.join(output, "manifest.json"), JSON.stringify(manifest, null, 2) + "\n");
    const keep = new Set(["manifest.json", ...payloads.map((payload) => payload.file)]);
    for (const file of fs.readdirSync(output))
      if (!keep.has(file)) fs.rmSync(path.join(output, file), { recursive: true, force: true });
    console.log(JSON.stringify(manifest, null, 2));
    return manifest;
  } finally {
    fs.rmSync(stage, { recursive: true, force: true });
  }
}
if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
  fs.mkdirSync(path.join(root, "out"), { recursive: true });
  await buildRemotePayload(root);
}
