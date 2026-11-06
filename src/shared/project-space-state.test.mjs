import assert from "node:assert/strict";
import test from "node:test";
import {
  fromLegacyOpenProjects,
  toLegacyOpenProjects,
  parseProjectSpacesState,
  projectKeyOf,
  isAbsoluteInAnyStyle,
} from "./project-space-state.ts";
import { compareSemver, satisfiesNodeRange, REQUIRED_NODE_RANGE } from "./node-version.ts";

test("legacy folders become primary spaces and downgrade lists never expose remote paths as local folders", () => {
  const state = fromLegacyOpenProjects(["/code/app", "/code/app/", "relative", "C:\\Code\\App", null]);
  assert.deepEqual(state, {
    version: 2,
    spaces: [
      { environmentId: "primary", path: "/code/app" },
      { environmentId: "primary", path: "C:\\Code\\App" },
    ],
    seeded: [],
  });
  state.spaces.push({ environmentId: "gpu", path: "/code/app" });
  assert.deepEqual(toLegacyOpenProjects(state), ["/code/app", "C:\\Code\\App"]);
  assert.notEqual(projectKeyOf(state.spaces[0]), projectKeyOf(state.spaces[2]));
});

test("project identity respects Windows path spelling without treating POSIX backslashes as separators", () => {
  const key = (path) => projectKeyOf({ environmentId: "gpu", path });
  assert.equal(key("C:\\CODE\\App\\"), key("c:/code/app"));
  assert.equal(key("C:\\"), key("c:/"));
  assert.equal(key("\\\\SERVER\\Share\\App"), key("\\\\server\\share\\app"));
  assert.notEqual(key("/code/a\\b"), key("/code/a/b"));
  for (const value of ["/home/dev", "C:\\code", "\\\\server\\share\\code"])
    assert.equal(isAbsoluteInAnyStyle(value), true);
  for (const value of ["relative", "C:relative", "~/code", "/code\u0000", "/code\n"])
    assert.equal(isAbsoluteInAnyStyle(value), false);
});

test("saved spaces reject invalid versions, duplicate identities and unbounded input", () => {
  const valid = {
    version: 2,
    spaces: [{ environmentId: "gpu", path: "/code", displayPath: "~/code" }],
    seeded: ["gpu", "gpu"],
  };
  assert.deepEqual(parseProjectSpacesState(valid).seeded, ["gpu"]);
  for (const value of [
    null,
    {},
    { ...valid, version: 1 },
    { ...valid, spaces: [...valid.spaces, valid.spaces[0]] },
    { ...valid, spaces: [{ environmentId: "", path: "/code" }] },
    { ...valid, spaces: [{ environmentId: "gpu", path: "relative" }] },
    { ...valid, spaces: Array.from({ length: 201 }, (_, i) => ({ environmentId: "gpu", path: `/code/${i}` })) },
  ])
    assert.throws(() => parseProjectSpacesState(value));
});

test("remote Node accepts stable 22.19 and newer 22 releases but excludes other majors and prereleases", () => {
  assert.equal(REQUIRED_NODE_RANGE, ">=22.19.0 <23");
  for (const version of ["22.19.0", "v22.23.3", "22.100.0", "22.19.0+build.2"])
    assert.equal(satisfiesNodeRange(version), true, version);
  for (const version of ["22.18.9", "21.99.9", "23.0.0", "24.1.0", "22.19.0-rc.1", "22.19", "garbage", "022.19.0"])
    assert.equal(satisfiesNodeRange(version), false, version);
  assert.equal(compareSemver("22.9.0", "22.19.0"), -1);
  assert.equal(compareSemver("v22.19.0", "22.19.0"), 0);
  assert.equal(compareSemver("22.23.3", "22.23.2"), 1);
  assert.throws(() => compareSemver("invalid", "22.19.0"));
});
