import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import test from "node:test";

const project = path.resolve(import.meta.dirname, "..");
const script = path.join(import.meta.dirname, "nsis-file-list.mjs");
const sevenZip = await locate7za();

const PACKAGED_FILES = ["Dexon.exe", "resources/app.asar", "locales/en-US.pak", "$weird/a.txt"];
const PACKAGED_FOLDERS = ["swiftshader"];
const LEGACY_FILES = [
  "ffmpeg.dll",
  "resources/managed-process/win32-x64/pi-managed-process-helper.exe",
  "locales/en-US.pak",
];

async function locate7za() {
  const fromElectronBuilder = createRequire(
    createRequire(path.join(project, "package.json")).resolve("electron-builder"),
  );
  const fromAppBuilderLib = createRequire(fromElectronBuilder.resolve("app-builder-lib"));
  return fromAppBuilderLib("builder-util").getPath7za();
}

function createPackage(t, { files, folders }) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "dexon-nsis-file-list-"));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const app = path.join(directory, "app");
  for (const folder of folders) fs.mkdirSync(path.join(app, folder), { recursive: true });
  for (const file of files) {
    fs.mkdirSync(path.dirname(path.join(app, file)), { recursive: true });
    fs.writeFileSync(path.join(app, file), "fixture");
  }
  const entries = [...new Set([...files, ...folders].map((entry) => entry.split("/")[0]))];
  const archive = path.join(directory, "Dexon-0.1.2-x64.nsis.7z");
  execFileSync(sevenZip, ["a", "-t7z", archive, ...entries], { cwd: app, stdio: "pipe" });
  return { directory, archive };
}

function writeLegacyList(directory, lines) {
  const file = path.join(directory, "legacy-file-list.txt");
  fs.writeFileSync(file, [...lines, ""].join("\n"), "utf8");
  return file;
}

function runFileList(directory, archive, legacy) {
  const generated = path.join(directory, "generated.nsh");
  const result = spawnSync(process.execPath, [script, archive, legacy, generated], {
    cwd: directory,
    encoding: "utf8",
  });
  return { result, generated };
}

function quotedItems(text, macro) {
  const body = text.split(`!macro ${macro} CB\n`)[1]?.split("!macroend")[0] ?? "";
  return body
    .split("\n")
    .filter(Boolean)
    .map((line) => line.trim().slice("!insertmacro ${CB} ".length));
}

test("the uninstall list holds every packaged file plus every old-version file and nothing else", (t) => {
  const { directory, archive } = createPackage(t, { files: PACKAGED_FILES, folders: PACKAGED_FOLDERS });
  const { result, generated } = runFileList(directory, archive, writeLegacyList(directory, LEGACY_FILES));

  assert.equal(result.status, 0, result.stderr);
  const expected = [
    "!macro dexonFiles CB",
    '  !insertmacro ${CB} "$$weird\\a.txt"',
    '  !insertmacro ${CB} "Dexon.exe"',
    '  !insertmacro ${CB} "ffmpeg.dll"',
    '  !insertmacro ${CB} "locales\\en-US.pak"',
    '  !insertmacro ${CB} "resources\\app.asar"',
    '  !insertmacro ${CB} "resources\\managed-process\\win32-x64\\pi-managed-process-helper.exe"',
    "!macroend",
    "!macro dexonDirs CB",
    '  !insertmacro ${CB} "resources\\managed-process\\win32-x64"',
    '  !insertmacro ${CB} "resources\\managed-process"',
    '  !insertmacro ${CB} "$$weird"',
    '  !insertmacro ${CB} "locales"',
    '  !insertmacro ${CB} "resources"',
    '  !insertmacro ${CB} "swiftshader"',
    "!macroend",
    "",
  ].join("\n");
  assert.equal(fs.readFileSync(generated, "utf8"), expected);
});

test("folders are removed after everything inside them, deepest first, including empty packaged folders", (t) => {
  const { directory, archive } = createPackage(t, { files: PACKAGED_FILES, folders: PACKAGED_FOLDERS });
  const { result, generated } = runFileList(directory, archive, writeLegacyList(directory, LEGACY_FILES));

  assert.equal(result.status, 0, result.stderr);
  const folders = quotedItems(fs.readFileSync(generated, "utf8"), "dexonDirs");
  assert.deepEqual(folders, [
    '"resources\\managed-process\\win32-x64"',
    '"resources\\managed-process"',
    '"$$weird"',
    '"locales"',
    '"resources"',
    '"swiftshader"',
  ]);
  assert.ok(folders.indexOf('"resources\\managed-process"') < folders.indexOf('"resources"'));
  assert.ok(
    folders.indexOf('"resources\\managed-process\\win32-x64"') < folders.indexOf('"resources\\managed-process"'),
  );
});

test("a folder is never handed to the per-file step", (t) => {
  const { directory, archive } = createPackage(t, { files: PACKAGED_FILES, folders: PACKAGED_FOLDERS });
  const { result, generated } = runFileList(directory, archive, writeLegacyList(directory, LEGACY_FILES));

  assert.equal(result.status, 0, result.stderr);
  const files = quotedItems(fs.readFileSync(generated, "utf8"), "dexonFiles");
  for (const folder of ['"resources"', '"locales"', '"swiftshader"', '"$$weird"', '"resources\\managed-process"']) {
    assert.equal(files.includes(folder), false, `${folder} must not be staged as a file`);
  }
});

test("a dollar sign in a path is written as a doubled dollar sign so NSIS keeps it literal", (t) => {
  const { directory, archive } = createPackage(t, { files: PACKAGED_FILES, folders: PACKAGED_FOLDERS });
  const { result, generated } = runFileList(directory, archive, writeLegacyList(directory, LEGACY_FILES));

  assert.equal(result.status, 0, result.stderr);
  const text = fs.readFileSync(generated, "utf8");
  assert.ok(text.includes('"$$weird\\a.txt"'));
  assert.ok(text.includes('"$$weird"'));
  assert.equal(text.includes('"$weird'), false);
});

test("the uninstaller itself is not in the per-file list even when the old list mentions it", (t) => {
  const { directory, archive } = createPackage(t, { files: PACKAGED_FILES, folders: PACKAGED_FOLDERS });
  const { result, generated } = runFileList(
    directory,
    archive,
    writeLegacyList(directory, [...LEGACY_FILES, "Uninstall Dexon.exe", "uninstall dexon.exe"]),
  );

  assert.equal(result.status, 0, result.stderr);
  const files = quotedItems(fs.readFileSync(generated, "utf8"), "dexonFiles");
  assert.deepEqual(
    files.filter((entry) => /uninstall/iu.test(entry)),
    [],
  );
});

test("the build stops when the old file list contains a folder", (t) => {
  const { directory, archive } = createPackage(t, { files: PACKAGED_FILES, folders: PACKAGED_FOLDERS });
  const { result } = runFileList(
    directory,
    archive,
    writeLegacyList(directory, ["resources/managed-process", ...LEGACY_FILES]),
  );

  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /legacy list must contain files only: resources\\managed-process/u);
});

test("the build stops when the package has no Dexon.exe", (t) => {
  const { directory, archive } = createPackage(t, { files: ["resources/app.asar"], folders: [] });
  const { result } = runFileList(directory, archive, writeLegacyList(directory, ["ffmpeg.dll"]));

  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /must contain Dexon\.exe/u);
});

test("the build stops when a path tries to leave the install folder", (t) => {
  const { directory, archive } = createPackage(t, { files: PACKAGED_FILES, folders: PACKAGED_FOLDERS });
  for (const escaping of ["../escape.txt", "..\\escape.txt", "C:\\Windows\\escape.txt", "\\escape.txt"]) {
    const { result } = runFileList(directory, archive, writeLegacyList(directory, ["ffmpeg.dll", escaping]));
    assert.notEqual(result.status, 0, `${escaping} must be rejected`);
    assert.match(result.stderr, /must stay inside the install folder/u);
  }
});
