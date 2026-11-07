import { defineConfig } from "tsup";
import { readFileSync } from "node:fs";
const packageJson = JSON.parse(readFileSync(new URL("./package.json", import.meta.url), "utf8")) as {
  dependencies?: Record<string, string>;
};
const expectedPiVersion = packageJson.dependencies?.["@earendil-works/pi-coding-agent"];
if (!expectedPiVersion || !/^\d+\.\d+\.\d+$/.test(expectedPiVersion)) {
  throw new Error("@earendil-works/pi-coding-agent must be an exact dependency");
}
const piVersionDefine = {
  "process.env.PI_DESKTOP_EXPECTED_PI_VERSION": JSON.stringify(expectedPiVersion),
};
export default defineConfig([
  {
    entry: {
      main: "src/main/main.ts",
    },
    format: ["cjs"],
    platform: "node",
    removeNodeProtocol: false,
    target: "node22",
    outDir: "out/main",
    clean: false,
    sourcemap: true,
    external: ["electron", "electron-updater"],
    splitting: false,
    treeshake: true,
    define: piVersionDefine,
    outExtension() {
      return { js: ".js" };
    },
  },
  {
    entry: {
      "agent-host": "src/agent-host/index.ts",
      "plugin-worker": "src/agent-host/plugin-worker.ts",
      "managed-process-worker": "src/agent-host/managed-process/worker.ts",
    },
    format: ["esm"],
    platform: "node",
    removeNodeProtocol: false,
    target: "node22",
    outDir: "out/main",
    clean: false,
    sourcemap: true,
    external: [
      "electron",
      "@earendil-works/pi-coding-agent",
      "@earendil-works/pi-ai",
      "@earendil-works/pi-agent-core",
      "@earendil-works/pi-tui",
      "silk-wasm",
    ],
    splitting: false,
    treeshake: true,
    define: piVersionDefine,
    outExtension() {
      return { js: ".mjs" };
    },
  },
  {
    entry: {
      preload: "src/preload/preload.ts",
    },
    format: ["cjs"],
    platform: "browser",
    target: "es2022",
    outDir: "out/preload",
    clean: false,
    sourcemap: true,
    external: ["electron"],
    splitting: false,
    treeshake: true,
    outExtension() {
      return { js: ".js" };
    },
  },
]);
