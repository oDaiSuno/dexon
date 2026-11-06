import assert from "node:assert/strict";
import test from "node:test";
import { importTestBundle } from "#test-bundle";

const { folderBreadcrumbs } = await importTestBundle("folder-browser-breadcrumb", {
  entryPoints: ["src/renderer/components/remote-folder-picker/breadcrumb.ts"],
  tsconfig: "tsconfig.renderer.json",
});

const destinations = (path, home) => folderBreadcrumbs(path, home).map(({ label, path }) => ({ label, path }));

test("home breadcrumbs stay clickable as ~ and POSIX paths retain their root without mistaking a home-prefix sibling", () => {
  assert.deepEqual(destinations("~/workspace/app", "/home/dev"), [
    { label: "~", path: "~" },
    { label: "workspace", path: "~/workspace" },
    { label: "app", path: "~/workspace/app" },
  ]);
  assert.equal(folderBreadcrumbs("~/workspace", "/home/dev")[0].title, "/home/dev");
  assert.deepEqual(destinations("/home/dev/workspace", "/home/dev"), [
    { label: "~", path: "~" },
    { label: "workspace", path: "~/workspace" },
  ]);
  assert.deepEqual(destinations("/home/developer", "/home/dev"), [
    { label: "/", path: "/" },
    { label: "home", path: "/home" },
    { label: "developer", path: "/home/developer" },
  ]);
  assert.deepEqual(destinations("/", "/home/dev"), [{ label: "/", path: "/" }]);
});

test("Windows breadcrumbs retain drive and UNC share roots and recognize home without case sensitivity", () => {
  assert.deepEqual(destinations("C:\\work\\app", "C:\\Users\\dev"), [
    { label: "C:\\", path: "C:\\" },
    { label: "work", path: "C:\\work" },
    { label: "app", path: "C:\\work\\app" },
  ]);
  assert.deepEqual(destinations("C:\\", "C:\\Users\\dev"), [{ label: "C:\\", path: "C:\\" }]);
  assert.deepEqual(destinations("c:/users/DEV/code", "C:\\Users\\dev"), [
    { label: "~", path: "~" },
    { label: "code", path: "~/code" },
  ]);
  assert.deepEqual(destinations("\\\\nas\\share\\projects\\app"), [
    { label: "\\\\nas\\share", path: "\\\\nas\\share\\" },
    { label: "projects", path: "\\\\nas\\share\\projects" },
    { label: "app", path: "\\\\nas\\share\\projects\\app" },
  ]);
  assert.deepEqual(destinations("\\\\nas\\share\\"), [{ label: "\\\\nas\\share", path: "\\\\nas\\share\\" }]);
});
