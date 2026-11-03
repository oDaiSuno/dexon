import { spawnSync } from "node:child_process";
import { helperScript } from "../host/ssh/python-helper.ts";

const CHECKER = [
  "import sys, tokenize, io",
  "source = sys.stdin.read()",
  "compile(source, 'helper', 'exec')",
  "comments = [t.start[0] for t in tokenize.generate_tokens(io.StringIO(source).readline) if t.type == tokenize.COMMENT]",
  "print(','.join(str(n) for n in comments))",
].join("\n");

export function resolveLocalPythonBinary(): string {
  for (const candidate of ["/usr/bin/python3", "python3", "python"]) {
    const check = spawnSync(candidate, ["-c", "import sys; assert sys.version_info >= (3, 8)"], {
      stdio: "ignore",
    });
    if (check.status === 0) return candidate;
  }
  return "python3";
}

export interface HelperSourceReport {
  readonly compiles: boolean;
  readonly commentLines: number[];
  readonly stderr: string;
}

export function inspectHelperSource(python = resolveLocalPythonBinary()): HelperSourceReport {
  const result = spawnSync(python, ["-c", CHECKER], { input: helperScript(), encoding: "utf8" });
  const stdout = typeof result.stdout === "string" ? result.stdout : "";
  const stderr = typeof result.stderr === "string" ? result.stderr : String(result.error ?? "");
  const commentLines = stdout
    .trim()
    .split(",")
    .filter(Boolean)
    .map((line) => Number(line));
  return { compiles: result.status === 0, commentLines, stderr };
}
