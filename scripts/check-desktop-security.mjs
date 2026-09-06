#!/usr/bin/env node
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");

import { managedProcessSecurityChecks } from "./desktop-security/managed-process.mjs";
import { desktopSecurityChecks } from "./desktop-security/desktop.mjs";
import { browserSecurityChecks } from "./desktop-security/browser.mjs";
const checks = [...managedProcessSecurityChecks(read), ...desktopSecurityChecks(read), ...browserSecurityChecks(read)];
const failures = checks.filter(([ok]) => !ok).map(([, message]) => message);
if (failures.length > 0) {
  for (const failure of failures) console.error(`FAIL: ${failure}`);
  process.exit(1);
}

console.log(`OK: ${checks.length} desktop security invariants hold`);
