import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { assertCleanUserInstallState, uninstall } from "./windows-nsis-harness.mjs";

export async function runNsisScenario({ label, slug, name, body }) {
  assertCleanUserInstallState(20_000);
  const root = fs.mkdtempSync(path.join(os.tmpdir(), `Pi NSIS upgrade ${slug} `));
  const installs = new Set();
  const cleanups = [];
  const uninstallQuietly = (directory) => {
    try {
      uninstall(directory);
    } catch (error) {
      console.error(`[${label}] could not uninstall ${directory}: ${describe(error)}`);
    }
  };
  const drain = async (onError) => {
    for (const dispose of cleanups.splice(0).reverse()) {
      try {
        await dispose();
      } catch (error) {
        onError(error);
      }
    }
  };
  try {
    const details =
      (await body({
        root,
        track: (value) => installs.add(value),
        untrack: (value) => installs.delete(value),
        cleanup: (dispose) => cleanups.push(dispose),
      })) ?? {};
    for (const directory of installs) uninstallQuietly(directory);
    const cleanupErrors = [];
    await drain((error) => cleanupErrors.push(error));
    assertCleanUserInstallState(20_000);
    if (cleanupErrors.length > 0) throw cleanupErrors[0];
    fs.rmSync(root, { recursive: true, force: true, maxRetries: 20, retryDelay: 500 });
    console.log(`[${label}] passed: ${name}`);
    return { scenario: name, ...details };
  } catch (error) {
    for (const directory of installs) uninstallQuietly(directory);
    await drain((cleanupError) => console.error(`[${label}] cleanup failed: ${describe(cleanupError)}`));
    console.error(`[${label}] retained failed fixture for inspection: ${root}`);
    throw error;
  }
}

function describe(error) {
  return error instanceof Error ? error.message : String(error);
}
