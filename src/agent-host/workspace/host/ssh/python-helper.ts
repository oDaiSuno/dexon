import { CORE_SOURCE } from "./helper/core.ts";
import { EXEC_OPS_SOURCE } from "./helper/exec-ops.ts";
import { FS_OPS_SOURCE } from "./helper/fs-ops.ts";
import { GIT_OPS_SOURCE } from "./helper/git-ops.ts";
import { PROBE_OPS_SOURCE } from "./helper/probe-ops.ts";
import { RECONCILE_OPS_SOURCE } from "./helper/reconcile-ops.ts";
import { SEARCH_OPS_SOURCE } from "./helper/search-ops.ts";
import { WATCH_OPS_SOURCE } from "./helper/watch-ops.ts";

const SERVE_SOURCE = "serve()";

export function helperScript(): string {
  return [
    CORE_SOURCE,
    EXEC_OPS_SOURCE,
    FS_OPS_SOURCE,
    PROBE_OPS_SOURCE,
    SEARCH_OPS_SOURCE,
    GIT_OPS_SOURCE,
    WATCH_OPS_SOURCE,
    RECONCILE_OPS_SOURCE,
    SERVE_SOURCE,
  ]
    .map((chunk) => chunk.trim())
    .join("\n\n")
    .concat("\n");
}
