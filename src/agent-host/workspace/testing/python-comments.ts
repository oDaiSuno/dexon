import { spawnSync } from "node:child_process";
import { helperScript } from "../host/ssh/python-helper.ts";

const CHECKER = [
  "import sys, tokenize, io",
  "source = sys.stdin.read()",
  "compile(source, 'helper', 'exec')",
  "comments = [t.start[0] for t in tokenize.generate_tokens(io.StringIO(source).readline) if t.type == tokenize.COMMENT]",
  "print(','.join(str(n) for n in comments))",
].join("\n");

export interface HelperSourceReport {
  readonly compiles: boolean;
  readonly commentLines: number[];
  readonly stderr: string;
}

export function inspectHelperSource(python = "/usr/bin/python3"): HelperSourceReport {
  const result = spawnSync(python, ["-c", CHECKER], { input: helperScript(), encoding: "utf8" });
  const commentLines = result.stdout
    .trim()
    .split(",")
    .filter(Boolean)
    .map((line) => Number(line));
  return { compiles: result.status === 0, commentLines, stderr: result.stderr };
}
