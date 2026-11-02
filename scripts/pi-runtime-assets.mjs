import path from "node:path";
import { extractFile, listPackage } from "@electron/asar";

const piPackages = ["pi-ai", "pi-agent-core", "pi-coding-agent", "pi-codemode", "pi-mcp", "pi-telemetry", "pi-tui"];
const packageRoots = [
  ...piPackages.map((name) => `node_modules/@earendil-works/${name}`),
  "node_modules/grok-mermaid",
  "node_modules/quickjs-wasi",
  "node_modules/typebox",
];

export function verifyPiRuntimeAssets(resources, platform, arch, expectedPiVersion, lockfile) {
  const asarPath = path.join(resources, "app.asar");
  const entries = new Set(listPackage(asarPath).map((entry) => entry.replace(/^[/\\]+/u, "").replaceAll("\\", "/")));
  const required = packageRoots.flatMap((root) => [
    `${root}/package.json`,
    `${root}/${root === "node_modules/typebox" ? "build/index.mjs" : "dist/index.js"}`,
  ]);
  required.push(...piPackages.map((name) => `node_modules/@earendil-works/${name}/dist/index.d.ts`));
  required.push("node_modules/quickjs-wasi/quickjs.wasm", "node_modules/quickjs-wasi/dist/index.d.ts");
  required.push(
    ...["crypto", "encoding", "headers", "structured-clone", "url"].map(
      (name) => `node_modules/quickjs-wasi/extensions/${name}/${name}.so`,
    ),
  );
  required.push("node_modules/@earendil-works/pi-ai/dist/providers/data/amazon-bedrock.json");
  required.push("node_modules/@earendil-works/pi-mcp/LICENSES/modelcontextprotocol-typescript-sdk.txt");
  const nativeName = platform === "linux" ? "linux-platform-x11" : `${platform}-platform`;
  required.push(
    `node_modules/@earendil-works/pi-tui/native/${platform}/prebuilds/${platform}-${arch}/${nativeName}.node`,
  );
  const missing = required.filter((entry) => !entries.has(entry));
  if (missing.length > 0) throw new Error(`Packaged Pi runtime/authoring assets are missing: ${missing.join(", ")}`);

  for (const packageRoot of packageRoots) {
    const packaged = JSON.parse(extractFile(asarPath, path.join(packageRoot, "package.json")).toString("utf8"));
    const locked = lockfile.packages?.[packageRoot]?.version;
    if (!locked || packaged.version !== locked) {
      throw new Error(
        `Packaged ${packaged.name ?? packageRoot} version ${packaged.version ?? "unknown"} does not match lockfile ${locked ?? "missing"}`,
      );
    }
    if (packageRoot.includes("/@earendil-works/") && packaged.version !== expectedPiVersion) {
      throw new Error(`Packaged Pi version ${packaged.version ?? "unknown"} does not match ${expectedPiVersion}`);
    }
  }
}
