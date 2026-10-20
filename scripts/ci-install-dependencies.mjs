#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { retry } from "./ci-retry.mjs";
import { npmInvocation } from "./npm-invocation.mjs";

const repositoryRoot = path.resolve(import.meta.dirname, "..");
const defaultRetryDelaysMs = [10_000, 30_000];

export function parseRetryDelaysMs(raw) {
  if (raw === undefined) return defaultRetryDelaysMs;
  const delays = String(raw)
    .split(",")
    .map((part) => (/^\d+$/.test(part) ? Number(part) : Number.NaN));
  if (delays.length > defaultRetryDelaysMs.length)
    throw new Error(
      `DEXON_CI_INSTALL_RETRY_DELAYS_MS must keep the retry budget at ${defaultRetryDelaysMs.length + 1} attempts, received "${raw}"`,
    );
  if (!delays.every(Number.isSafeInteger))
    throw new Error(
      `DEXON_CI_INSTALL_RETRY_DELAYS_MS must be a comma-separated list of whole milliseconds, received "${raw}"`,
    );
  return delays;
}

function runNpmCiOnce(args, spawn) {
  const invocation = npmInvocation();
  const result = spawn(invocation.command, [...invocation.args, "ci", ...args], {
    cwd: repositoryRoot,
    stdio: "inherit",
    shell: invocation.shell,
  });
  if (result.error)
    throw Object.assign(new Error(`npm ci could not start: ${result.error.message}`), { exitStatus: 1 });
  if (result.signal)
    throw Object.assign(new Error(`npm ci was terminated by signal ${result.signal}`), { exitStatus: 1 });
  if (result.status !== 0)
    throw Object.assign(new Error(`npm ci exited with status ${result.status}`), { exitStatus: result.status });
  return result.status;
}

export async function installDependencies(args, options = {}) {
  const spawn = options.spawn ?? spawnSync;
  return retry("npm ci", () => runNpmCiOnce(args, spawn), {
    retryDelaysMs: options.retryDelaysMs ?? defaultRetryDelaysMs,
    warn: options.warn,
  });
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href;
if (isMain) {
  try {
    await installDependencies(process.argv.slice(2), {
      retryDelaysMs: parseRetryDelaysMs(process.env.DEXON_CI_INSTALL_RETRY_DELAYS_MS),
    });
  } catch (error) {
    console.error(`Dependency installation failed: ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = error?.exitStatus ?? 1;
  }
}
