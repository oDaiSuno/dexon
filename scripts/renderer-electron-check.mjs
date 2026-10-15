import fs from "node:fs";
import path from "node:path";
import { build } from "esbuild";
import postcss from "postcss";
import tailwindcss from "@tailwindcss/postcss";
import { runElectronCheck } from "./electron-test-run.mjs";
import { createProjectBuildTemp } from "./process-utils.mjs";

// Shared build/lifetime only: scenes own their real components and assertions.
export async function runRendererElectronCheck({ name, renderer, main, output, requiredScenes }) {
  const root = path.resolve(import.meta.dirname, "..");
  const directory = createProjectBuildTemp(root, `dexon-${name}-build-`);
  try {
    fs.mkdirSync(output, { recursive: true });
    const evidence = path.join(output, "evidence.json");
    fs.rmSync(evidence, { force: true });
    await build({
      absWorkingDir: root,
      entryPoints: [renderer],
      bundle: true,
      platform: "browser",
      format: "iife",
      tsconfig: "tsconfig.renderer.json",
      outfile: path.join(directory, "renderer.js"),
      loader: { ".png": "dataurl", ".woff2": "file", ".woff": "file", ".ttf": "file" },
      define: {
        "import.meta.env.DEV": "false",
        "import.meta.env.PROD": "true",
        "import.meta.env.MODE": '"production"',
      },
      plugins: [
        {
          name: "production-tailwind-css",
          setup(builder) {
            const globals = path.join(root, "src/renderer/globals.css");
            builder.onLoad({ filter: /globals\.css$/ }, async ({ path: file }) => {
              if (file !== globals) return undefined;
              const css = await postcss([tailwindcss()]).process(fs.readFileSync(file, "utf8"), {
                from: file,
                map: false,
              });
              return { contents: css.css, resolveDir: path.dirname(file), loader: "css" };
            });
          },
        },
      ],
    });
    await build({
      absWorkingDir: root,
      entryPoints: [main],
      bundle: true,
      platform: "node",
      format: "esm",
      packages: "external",
      outfile: path.join(directory, "main.mjs"),
    });
    fs.writeFileSync(
      path.join(directory, "index.html"),
      '<!doctype html><html lang="en-US"><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src \'self\'; script-src \'self\'; style-src \'self\' \'unsafe-inline\'; font-src \'self\'; img-src \'self\' data:"><link rel="stylesheet" href="renderer.css"></head><body><div id="root"></div><script src="renderer.js"></script></body></html>',
    );
    await runElectronCheck({
      name,
      root,
      main: path.join(directory, "main.mjs"),
      env: { DEXON_RENDERER_OUT: output },
      evidence,
      requiredScenes,
    });
    console.log(`${name}: verified ${requiredScenes.length} required scenes; evidence: ${output}`);
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
}
