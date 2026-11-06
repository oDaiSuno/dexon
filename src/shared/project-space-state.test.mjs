import assert from "node:assert/strict";
import test from "node:test";
import {
  fromLegacyOpenProjects,
  toLegacyOpenProjects,
  parseProjectSpacesState,
  recoverProjectSpacesState,
  MAX_PROJECT_SPACES,
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

test("saved project recovery skips malformed rows and canonical duplicates before limiting valid spaces", () => {
  assert.equal(MAX_PROJECT_SPACES, 200);
  const windows = { environmentId: "gpu", path: "C:\\CODE\\App\\", displayPath: "App" };
  const unc = { environmentId: "gpu", path: "\\\\SERVER\\Share\\App" };
  const other = { environmentId: "other", path: "c:/code/app" };
  const folders = Array.from({ length: 201 }, (_, i) => ({ environmentId: "gpu", path: `/code/${i}` }));
  const state = recoverProjectSpacesState(
    {
      version: 2,
      spaces: [
        null,
        [],
        { environmentId: "", path: "/code/bad" },
        { environmentId: "gpu", path: "relative" },
        { environmentId: "gpu", path: "/code/bad", displayPath: 42 },
        windows,
        { environmentId: "gpu", path: "c:/code/app" },
        unc,
        { environmentId: "gpu", path: "\\\\server\\share\\app\\" },
        other,
        ...folders,
      ],
      seeded: ["gpu"],
    },
    ["/code/legacy"],
  );
  assert.deepEqual(state, {
    version: 2,
    spaces: [windows, unc, other, ...folders.slice(0, 197)],
    seeded: ["gpu"],
  });
});

test("saved project recovery retains at most 100 valid unique seeded environment ids", () => {
  const boundary = "x".repeat(1024);
  const ids = Array.from({ length: 101 }, (_, i) => `environment-${i}`);
  assert.deepEqual(
    recoverProjectSpacesState({
      version: 2,
      spaces: [{ environmentId: "gpu", path: "/code/valid" }],
      seeded: [null, {}, false, "", "bad\u0000id", "bad\rid", "bad\nid", "x".repeat(1025), boundary, boundary, ...ids],
    }),
    {
      version: 2,
      spaces: [{ environmentId: "gpu", path: "/code/valid" }],
      seeded: [boundary, ...ids.slice(0, 99)],
    },
  );
});

test("saved project recovery preserves explicit null or valid focus and omits invalid focus", () => {
  const state = { version: 2, spaces: [{ environmentId: "gpu", path: "/code/valid" }], seeded: ["gpu"] };
  const focus = { environmentId: "gpu", path: "/code/focus", displayPath: "~/focus" };
  assert.deepEqual(recoverProjectSpacesState({ ...state, lastFocusedSpace: null }), {
    ...state,
    lastFocusedSpace: null,
  });
  assert.deepEqual(recoverProjectSpacesState({ ...state, lastFocusedSpace: { ...focus, extra: true } }), {
    ...state,
    lastFocusedSpace: focus,
  });
  assert.deepEqual(recoverProjectSpacesState(state), state);
  for (const lastFocusedSpace of [
    undefined,
    false,
    [],
    "gpu",
    { environmentId: "", path: "/code/invalid" },
    { environmentId: "gpu", path: "relative" },
    { ...focus, displayPath: 42 },
  ])
    assert.deepEqual(recoverProjectSpacesState({ ...state, lastFocusedSpace }), state);
});

test("saved project recovery uses legacy folders only when there is no version 2 object", () => {
  const legacy = ["/code/legacy", "relative"];
  for (const value of [undefined, null, false, [], "invalid", {}, { version: 1 }, { version: "2" }])
    assert.deepEqual(recoverProjectSpacesState(value, legacy), {
      version: 2,
      spaces: [{ environmentId: "primary", path: "/code/legacy" }],
      seeded: [],
    });
  const focus = { environmentId: "gpu", path: "/code/focus" };
  for (const spaces of [undefined, null, {}, "invalid", [null, { environmentId: "", path: "/code/bad" }]])
    assert.deepEqual(
      recoverProjectSpacesState({ version: 2, spaces, seeded: ["gpu"], lastFocusedSpace: focus }, legacy),
      {
        version: 2,
        spaces: [],
        seeded: ["gpu"],
        lastFocusedSpace: focus,
      },
    );
  for (const seeded of [undefined, null, {}, "gpu"])
    assert.deepEqual(recoverProjectSpacesState({ version: 2, spaces: [focus], seeded }, legacy), {
      version: 2,
      spaces: [focus],
      seeded: [],
    });
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
