import fs from "node:fs";
import path from "node:path";

/** Called only after a native scenario and its owned resources have finished. */
export function writeNativeCompletion(check: string): void {
  const output = process.env.DEXON_ELECTRON_RESULT;
  if (!output || !path.isAbsolute(output)) throw new Error("Native check requires a private completion path");
  fs.writeFileSync(output, JSON.stringify({ completed: true, pid: process.pid, check, pass: true }));
}
