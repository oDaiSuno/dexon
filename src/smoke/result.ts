export const SMOKE_RESULT_FILE = "smoke-result.json";

export interface SmokeProcessExit {
  code: number | null;
  signal: string | null;
  pid: number | undefined;
}

// This is the launcher-visible result protocol, not an inspection of the
// application's private state. The caller also needs evidence of completion.
export function assertSmokeCompletion(
  exit: SmokeProcessExit,
  completion: unknown,
  requiredScenes?: readonly string[],
): void {
  if (exit.signal) throw new Error(`Smoke Electron terminated by signal ${exit.signal}`);
  if (exit.code !== 0) throw new Error(`Smoke Electron exited with status ${exit.code}`);
  if (
    typeof completion !== "object" ||
    completion === null ||
    !("completed" in completion) ||
    completion.completed !== true
  )
    throw new Error("Smoke Electron exited without completing its checks");
  if (!("pid" in completion) || completion.pid !== exit.pid)
    throw new Error("Smoke completion evidence belongs to another process");
  if ("pass" in completion && completion.pass !== true) throw new Error("Smoke Electron reports a failed check");
  if (requiredScenes) {
    if (!("pass" in completion) || completion.pass !== true) throw new Error("Renderer check failed");
    const records = "records" in completion && Array.isArray(completion.records) ? completion.records : [];
    for (const name of requiredScenes) {
      if (
        !records.some(
          (record: unknown) =>
            typeof record === "object" &&
            record !== null &&
            "name" in record &&
            record.name === name &&
            "pass" in record &&
            record.pass === true,
        )
      ) {
        throw new Error(`Renderer check did not complete scene: ${name}`);
      }
    }
  }
}
