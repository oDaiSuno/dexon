const requiredCiJobs = ["quality", "test-platforms", "windows-frameworks", "rust-security", "package"];
const requiredReleaseJobs = ["release-contract", "release-macos", "verify-macos", "release-windows", "release-linux"];
const desktopTargets = ["darwin-arm64", "darwin-x64", "win32-x64", "linux-x64"];
const expression = (value) => (typeof value === "string" ? value.replace(/\$\{\{|}}|\s/g, "") : "");
const sameMembers = (left, right) =>
  Array.isArray(left) &&
  left.length === right.length &&
  [...left].sort().every((value, index) => value === [...right].sort()[index]);

export function workflowViolations(ci, release) {
  const failures = [];
  const check = (condition, message) => {
    if (!condition) failures.push(message);
  };
  const aggregate = (workflow, id, required) => {
    const job = workflow.jobs?.[id];
    check(expression(job?.if) === "always()", `${id} must use always() so skipped dependencies cannot bypass the gate`);
    check(sameMembers(job?.needs, required), `${id} must depend on every required job`);
    const command = job?.steps?.find((step) => /^node scripts\/check-ci-results\.mjs\s/.test(step.run ?? ""));
    check(
      sameMembers(command?.run.trim().split(/\s+/).slice(2), required) &&
        expression(command?.env?.CI_NEEDS) === "toJSON(needs)",
      `${id} must check every required result through check-ci-results.mjs`,
    );
  };
  const matrix = (workflow, id, targets) => {
    const entries = workflow.jobs?.[id]?.strategy?.matrix?.include;
    check(
      sameMembers(
        entries?.map((entry) => entry.tool_target),
        targets,
      ),
      `${id} must cover the required native desktop targets`,
    );
    for (const entry of entries ?? []) {
      const runner = String(entry.runner);
      const native =
        entry.tool_target === "darwin-arm64"
          ? /^macos-\d+$/.test(runner)
          : entry.tool_target === "darwin-x64"
            ? /^macos-\d+-intel$/.test(runner)
            : entry.tool_target === "win32-x64"
              ? /^windows-\d+$/.test(runner)
              : entry.tool_target === "linux-x64" && /^ubuntu-\d+\.\d+$/.test(runner);
      check(native, `${id}: ${entry.tool_target} must execute on a matching native runner`);
    }
  };
  aggregate(ci, "ci-required", requiredCiJobs);
  check(
    ci.jobs?.["ci-required"]?.name === "CI required",
    "The required check must retain its configured server-side name",
  );
  for (const id of requiredCiJobs) {
    check(
      ci.jobs?.[id] && ci.jobs[id].if === undefined,
      `${id} must exist and must not conditionally skip required work`,
    );
  }
  matrix(ci, "test-platforms", desktopTargets);
  matrix(ci, "package", desktopTargets);
  matrix(release, "verify-macos", desktopTargets.slice(0, 2));
  check(
    ci.on && "pull_request" in ci.on && "workflow_call" in ci.on && ci.on.push?.branches?.includes("main"),
    "CI must run for pull requests, main and release callers",
  );
  check(
    !ci.on?.pull_request?.paths && !ci.on?.pull_request?.["paths-ignore"],
    "Required PR checks cannot use path filters",
  );
  check(!/secrets\s*[.[]/.test(JSON.stringify(ci)), "PR CI cannot access release secrets");
  for (const [workflowName, workflow] of [
    ["ci", ci],
    ["release", release],
  ]) {
    check(!workflow.on?.pull_request_target, `${workflowName}: privileged PR triggers are forbidden`);
    check(
      workflow.permissions?.contents === "read" &&
        Object.values(workflow.permissions).every((value) => value === "read" || value === "none"),
      `${workflowName}: workflow permissions must be read-only`,
    );
    for (const [id, job] of Object.entries(workflow.jobs ?? {})) {
      const publisher = workflowName === "release" && id === "release";
      for (const [scope, permission] of Object.entries(job.permissions ?? {})) {
        check(
          permission !== "write" || (publisher && scope === "contents"),
          `${workflowName}/${id}: write permissions belong only to publication`,
        );
      }
      check(!job["continue-on-error"], `${workflowName}/${id}: job failure must propagate`);
      check(workflowName !== "ci" || !job.environment, `${id}: PR jobs cannot enter a credential environment`);
      for (const step of job.steps ?? []) {
        check(!step["continue-on-error"], `${workflowName}/${id}: step failure must propagate`);
        if (!step.uses) continue;
        check(
          /^[\w.-]+\/[\w./-]+@[a-f0-9]{40}$/.test(step.uses),
          `${workflowName}/${id}: external actions must use immutable commit IDs`,
        );
        if (step.uses.startsWith("actions/checkout@"))
          check(
            step.with?.["persist-credentials"] === false,
            `${workflowName}/${id}: checkout must not retain Git credentials`,
          );
      }
    }
  }
  aggregate(release, "release", requiredReleaseJobs);
  check(
    release.jobs?.ci?.uses === "./.github/workflows/ci.yml" && !release.jobs.ci.secrets,
    "Release must call the same read-only CI without inheriting secrets",
  );
  const ancestors = (id, seen = new Set()) => {
    if (seen.has(id)) return seen;
    seen.add(id);
    const needs = release.jobs?.[id]?.needs ?? [];
    for (const parent of Array.isArray(needs) ? needs : [needs]) ancestors(parent, seen);
    return seen;
  };
  check(ancestors("release-contract").has("ci"), "The release contract must depend on CI");
  for (const id of ["release-macos", "release-windows", "release-linux"]) {
    check(ancestors(id).has("release-contract"), `${id} must depend on the validated release contract`);
  }
  check(ancestors("verify-macos").has("release-macos"), "macOS acceptance must depend on the final signed packages");
  for (const id of ["release-macos", "release"]) {
    const environment = release.jobs?.[id]?.environment;
    check(
      (typeof environment === "string" ? environment : environment?.name) === "release",
      `${id} must use the protected release environment`,
    );
  }
  for (const [id, job] of Object.entries(release.jobs ?? {})) {
    if (id !== "release-macos")
      check(!/secrets\s*[.[]/.test(JSON.stringify(job)), `${id} must not receive signing credentials`);
  }
  return failures;
}
