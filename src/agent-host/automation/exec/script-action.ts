import { spawn, type ChildProcess } from "node:child_process";
import { createHash } from "node:crypto";
import { readFile, mkdtemp, writeFile, chmod, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import type { Json } from "../../../shared/automation/spec";
import type { EffectObservation } from "../../effect-observation";
import { terminateProcessTree } from "../../process-tree";
import type { ScriptActionPlan } from "../core/plan";
import type { AttemptContext, SecretReader } from "./types";
import { readSecret, secretValue, SecretError } from "./secrets";
import { interrupted, rejected, parseOutput } from "./observations";

function observeStdout(
  text: string,
  code: number | null,
  call: ScriptActionPlan,
  limit: number,
): EffectObservation<Json> {
  if (code === 78 || code === 75) return rejected("provider_rejected", `Script exited with code ${code}`, code === 75);
  try {
    const output = parseOutput(text.trim(), limit);
    if (output !== null && typeof output === "object" && !Array.isArray(output) && "__dexonEffect" in output) {
      if (output.__dexonEffect === "applied") return { kind: "applied", output: output.output ?? null };
      const error = {
        code: "provider_rejected" as const,
        message: typeof output.message === "string" ? output.message : "Script reported an unsuccessful effect",
      };
      if (output.__dexonEffect === "not_applied")
        return { kind: "not_applied", transient: output.transient === true, error };
      if (output.__dexonEffect === "maybe_applied") return { kind: "maybe_applied", error };
      return interrupted(call.effect, { code: "invalid_input", message: "Invalid script effect envelope" });
    }
    if (code === 0) return { kind: "applied", output };
  } catch {
    if (code === 0)
      return interrupted(call.effect, { code: "invalid_input", message: "Script stdout is not valid JSON" });
  }
  return interrupted(call.effect, { code: "transport", message: `Script exited with code ${code}` });
}
export function createScriptAction(secrets: SecretReader) {
  const active = new Set<ChildProcess>();
  async function execute(call: ScriptActionPlan, ctx: AttemptContext): Promise<EffectObservation<Json>> {
    if (!ctx.grant.scripts.some((script) => script.path === call.path && script.sha256 === call.sha256))
      return rejected("grant_violation", "Script is not approved");
    let bytes: Buffer;
    try {
      bytes = await readFile(path.resolve(ctx.cwd, call.path));
      if (createHash("sha256").update(bytes).digest("hex") !== call.sha256)
        return rejected("script_changed", "Approved script contents changed");
    } catch {
      return rejected("script_changed", "Approved script is missing");
    }
    const env: NodeJS.ProcessEnv = {};
    for (const name of ["PATH", "HOME", "USERPROFILE", "SYSTEMROOT", "SystemRoot", "TEMP", "TMP", "LANG"])
      if (process.env[name]) env[name] = process.env[name];
    env.ELECTRON_RUN_AS_NODE = "1";
    env.DEXON_EFFECT_KEY = ctx.effectKey;
    env.DEXON_RUN_ID = ctx.runId;
    let args: Json;
    try {
      args = await secretValue(call.argsTmpl, ctx, secrets);
      for (const name of call.secrets) env[`DEXON_SECRET_${name}`] = await readSecret(name, ctx, secrets);
    } catch (error) {
      return rejected(
        error instanceof SecretError ? error.code : "invalid_input",
        "Script input could not be prepared",
      );
    }
    if (ctx.signal.aborted) return rejected("aborted", "Script cancelled before launch", true);
    const directory = await mkdtemp(path.join(tmpdir(), "dexon-script-"));
    const snapshot = path.join(directory, `entry${path.extname(call.path) || ".mjs"}`);
    try {
      await writeFile(snapshot, bytes, { mode: 0o400, flag: "wx" });
      await chmod(snapshot, 0o400);
      return await new Promise<EffectObservation<Json>>((resolve) => {
        const child = spawn(process.execPath, [snapshot], {
          cwd: ctx.cwd,
          env,
          shell: false,
          windowsHide: true,
          stdio: ["pipe", "pipe", "pipe"],
          detached: process.platform !== "win32",
        });
        active.add(child);
        let stdout = "";
        let size = 0;
        let stopped: "timeout" | "aborted" | "output_too_large" | null = null;
        let killing: Promise<void> | null = null;
        const stop = (reason: NonNullable<typeof stopped>) => {
          stopped ??= reason;
          killing ??= terminateProcessTree(child, 250);
          void killing.catch(() => undefined);
        };
        const abort = () => stop("aborted");
        const timer = setTimeout(() => stop("timeout"), call.timeoutMs);
        ctx.signal.addEventListener("abort", abort, { once: true });
        if (ctx.signal.aborted) abort();
        child.stdout.on("data", (chunk: Buffer) => {
          size += chunk.length;
          if (size > ctx.maxOutputBytes) stop("output_too_large");
          else stdout += chunk.toString("utf8");
        });
        child.stderr.resume();
        child.stdin.on("error", () => undefined);
        child.stdin.end(JSON.stringify({ args, effectKey: ctx.effectKey, attemptNo: ctx.attemptNo, runId: ctx.runId }));
        let spawnError = false;
        child.once("error", () => {
          spawnError = true;
        });
        child.once("close", (code) => {
          clearTimeout(timer);
          ctx.signal.removeEventListener("abort", abort);
          active.delete(child);
          resolve(
            spawnError
              ? rejected("unreachable", "Script process could not start", true)
              : stopped
                ? interrupted(call.effect, { code: stopped, message: "Script stopped before producing a result" })
                : observeStdout(stdout, code, call, ctx.maxOutputBytes),
          );
        });
      });
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  }
  return {
    execute,
    async shutdown() {
      await Promise.all([...active].map((child) => terminateProcessTree(child, 250)));
    },
  };
}
