import assert from "node:assert/strict";
import test from "node:test";
import { workflowViolations } from "./desktop-workflow-policy.mjs";

function workflows() {
  const targets = [
    { tool_target: "darwin-arm64", runner: "macos-15" },
    { tool_target: "darwin-x64", runner: "macos-15-intel" },
    { tool_target: "win32-x64", runner: "windows-2025" },
    { tool_target: "linux-x64", runner: "ubuntu-24.04" },
  ];
  const aggregate = (name, needs) => ({
    name,
    if: "always()",
    needs,
    steps: [{ run: `node scripts/check-ci-results.mjs ${needs.join(" ")}`, env: { CI_NEEDS: "${{ toJSON(needs) }}" } }],
  });
  return {
    packaging: {
      mac: { identity: "-", notarize: false },
      win: { artifactName: "Dexon-Unsigned-Beta-Setup-${version}.${ext}" },
    },
    ci: {
      on: { pull_request: {}, push: { branches: ["main"] }, workflow_call: {} },
      permissions: { contents: "read" },
      jobs: {
        quality: { steps: [] },
        "test-platforms": { strategy: { matrix: { include: structuredClone(targets) } }, steps: [] },
        "windows-frameworks": { steps: [] },
        "rust-security": { steps: [] },
        package: { strategy: { matrix: { include: structuredClone(targets) } }, steps: [] },
        "ci-required": aggregate("CI required", [
          "quality",
          "test-platforms",
          "windows-frameworks",
          "rust-security",
          "package",
        ]),
      },
    },
    release: {
      on: { push: { tags: ["v*"] }, workflow_dispatch: {} },
      permissions: { contents: "read" },
      jobs: {
        ci: { uses: "./.github/workflows/ci.yml" },
        "release-contract": { needs: ["ci"], steps: [] },
        "release-macos": { needs: ["release-contract"], environment: "release", steps: [] },
        "verify-macos": { needs: ["release-macos"], strategy: { matrix: { include: targets.slice(0, 2) } }, steps: [] },
        "release-windows": { needs: ["release-contract"], steps: [] },
        "release-linux": { needs: ["release-contract"], steps: [] },
        release: {
          ...aggregate("Create desktop draft release", [
            "release-contract",
            "release-macos",
            "verify-macos",
            "release-windows",
            "release-linux",
          ]),
          environment: "release",
          permissions: { contents: "write" },
        },
      },
    },
  };
}

test("a skipped aggregate cannot masquerade as the required merge gate", () => {
  const { ci, release, packaging } = workflows();
  ci.jobs["ci-required"].if = "success()";
  assert.match(workflowViolations(ci, release, packaging).join("\n"), /ci-required.*always/);
});

test("missing required work, a skipped required job or a missing native desktop target blocks the configuration", () => {
  for (const mutate of [
    ({ ci }) => {
      ci.jobs["ci-required"].needs.pop();
    },
    ({ ci }) => {
      ci.jobs["ci-required"].steps[0].run = "echo success";
    },
    ({ ci }) => {
      ci.jobs.quality.if = "false";
    },
    ({ ci }) => {
      ci.jobs["test-platforms"].strategy.matrix.include.pop();
    },
    ({ ci }) => {
      ci.jobs.package.strategy.matrix.include[0].runner = "ubuntu-24.04";
    },
    ({ ci }) => {
      delete ci.jobs["windows-frameworks"];
    },
    ({ release }) => {
      release.jobs["verify-macos"].strategy.matrix.include.pop();
    },
  ]) {
    const fixture = workflows();
    mutate(fixture);
    assert.notDeepEqual(workflowViolations(fixture.ci, fixture.release, fixture.packaging), []);
  }
});

test("PRs cannot omit checks, receive publishing credentials or use mutable external actions", () => {
  for (const mutate of [
    ({ ci }) => {
      delete ci.on.pull_request;
    },
    ({ ci }) => {
      ci.on.pull_request.paths = ["src/**"];
    },
    ({ ci }) => {
      ci.on.pull_request_target = {};
    },
    ({ ci }) => {
      ci.permissions.contents = "write";
    },
    ({ ci }) => {
      ci.jobs.quality.permissions = { contents: "write" };
    },
    ({ ci }) => {
      ci.jobs.quality.continue_on_error = true;
      ci.jobs.quality["continue-on-error"] = true;
    },
    ({ ci }) => {
      ci.jobs.quality.steps.push({ run: "npm test", "continue-on-error": true });
    },
    ({ ci }) => {
      ci.jobs.quality.env = { TOKEN: "${{ secrets.RELEASE_TOKEN }}" };
    },
    ({ ci }) => {
      ci.jobs.quality.steps.push({ uses: "actions/checkout@v7" });
    },
    ({ ci }) => {
      ci.jobs.quality.steps.push({ uses: `actions/checkout@${"a".repeat(40)}` });
    },
  ]) {
    const fixture = workflows();
    mutate(fixture);
    assert.notDeepEqual(workflowViolations(fixture.ci, fixture.release, fixture.packaging), []);
  }
});

test("release publication must wait for CI and every final-package acceptance job", () => {
  for (const mutate of [
    ({ release }) => {
      release.jobs.release.needs.pop();
    },
    ({ release }) => {
      release.jobs.release.if = "!failure()";
    },
    ({ release }) => {
      release.jobs["release-contract"].needs = [];
    },
    ({ release }) => {
      release.jobs["release-macos"].needs = [];
    },
    ({ release }) => {
      release.jobs["release-macos"].environment = undefined;
    },
    ({ release }) => {
      release.jobs["verify-macos"].env = { TOKEN: "${{ secrets.MAC_CSC_LINK }}" };
    },
    ({ release }) => {
      release.jobs.ci.secrets = "inherit";
    },
    ({ release }) => {
      release.jobs.ci.uses = "./another.yml";
    },
  ]) {
    const fixture = workflows();
    mutate(fixture);
    assert.notDeepEqual(workflowViolations(fixture.ci, fixture.release, fixture.packaging), []);
  }
});

test("unsigned releases never receive signing secrets, including in the macOS build", () => {
  for (const location of ["workflow", "job", "step"]) {
    const { ci, release, packaging } = workflows();
    const env = { CSC_LINK: "${{ secrets.MAC_CSC_LINK }}" };
    if (location === "workflow") release.env = env;
    else if (location === "job") release.jobs["release-macos"].env = env;
    else release.jobs["release-macos"].steps.push({ run: "package", env });
    assert.match(workflowViolations(ci, release, packaging).join("\n"), /unsigned releases.*secrets/i);
  }
});

test("complete read-only CI and isolated publication are accepted without depending on step labels or matrix order", () => {
  const { ci, release, packaging } = workflows();
  ci.jobs.package.strategy.matrix.include.reverse();
  ci.jobs["ci-required"].steps[0].name = "An independently renamed summary step";
  ci.jobs.quality.steps.push({ uses: `actions/checkout@${"a".repeat(40)}`, with: { "persist-credentials": false } });
  assert.deepEqual(workflowViolations(ci, release, packaging), []);
});

test("macOS packaging stays ad-hoc signed even when the build machine has a certificate", () => {
  for (const mac of [
    {},
    { identity: "Developer ID Application: Example", notarize: false },
    { identity: null, notarize: false },
    { identity: "-" },
    { identity: "-", notarize: true },
  ]) {
    const { ci, release, packaging } = workflows();
    packaging.mac = mac;
    assert.match(workflowViolations(ci, release, packaging).join("\n"), /macOS.*identity.*notarization/i);
  }
});
