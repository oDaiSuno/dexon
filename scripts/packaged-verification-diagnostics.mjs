import fs from "node:fs";
import path from "node:path";

const LOG_TAIL_LINES = 40;
const OUTPUT_CHARACTERS = 4_000;
const REPORT_ERROR_CHARACTERS = 400;
const SEARCH_DEPTH = 6;

export function describePackagedStartupFailure({ result, isolatedRoot, timeoutMs }) {
  return [
    `Packaged startup ${describeProcessOutcome(result, timeoutMs)}`,
    describeStartupReport(isolatedRoot),
    describeMainLog(isolatedRoot),
    describeProcessOutput(result),
  ]
    .filter(Boolean)
    .join("\n");
}

export function describeManagedProcessHelperIntegrationFailure({ result, timeoutMs }) {
  const details = [`last progress: ${lastProgressStep(result.stdout) ?? "no progress reported"}`];
  const stderr = (result.stderr ?? "").trim();
  if (stderr) details.push(`stderr: ${stderr.slice(-OUTPUT_CHARACTERS)}`);
  return `Packaged managed process helper integration ${describeProcessOutcome(result, timeoutMs)}; ${details.join("; ")}`;
}

export function lastProgressStep(stdout) {
  let step;
  for (const line of String(stdout ?? "").split(/\r?\n/u)) {
    const message = parseJsonObject(line.trim());
    if (typeof message?.progress === "string" && message.progress.length > 0) step = message.progress;
  }
  return step;
}

function describeProcessOutcome(result, timeoutMs) {
  if (result.error) {
    const limit = Number.isFinite(timeoutMs) ? ` after ${timeoutMs} ms` : "";
    return `failed to run${limit}: ${result.error.message}`;
  }
  const status = Number.isInteger(result.status) ? result.status : null;
  if (result.signal) {
    return status === null
      ? `was killed by signal ${result.signal}`
      : `exited ${status} after being killed by signal ${result.signal}`;
  }
  return status === null ? "exited without an exit status" : `exited ${status}`;
}

function describeStartupReport(isolatedRoot) {
  const reportPath = newestFile(isolatedRoot, "packaged-startup-check.json");
  if (!reportPath) return "startup report: packaged-startup-check.json was not written";
  const location = `startup report: packaged-startup-check.json at ${relativeTo(isolatedRoot, reportPath)}`;
  const content = readText(reportPath);
  if (content === undefined) return `${location} is unreadable`;
  let report;
  try {
    report = JSON.parse(content);
  } catch {
    return `${location} is unreadable (not valid JSON)`;
  }
  if (typeof report?.ok !== "boolean") return `${location} is malformed (no boolean "ok" field)`;
  if (report.ok) return `${location} says ok: true, so startup reached readiness and the app failed afterwards`;
  const recordedError =
    typeof report.error === "string" ? shorten(report.error, REPORT_ERROR_CHARACTERS) : "no error field";
  return `${location} says ok: false (error: ${recordedError})`;
}

function describeMainLog(isolatedRoot) {
  const logPath = newestFile(isolatedRoot, "main.log");
  if (!logPath) return "main process log: main.log not found under the isolated tree";
  const location = relativeTo(isolatedRoot, logPath);
  const content = readText(logPath);
  if (content === undefined) return `main process log: ${location} is unreadable`;
  const lines = content.split(/\r?\n/u);
  while (lines.length > 0 && lines.at(-1) === "") lines.pop();
  const tail = lines.slice(-LOG_TAIL_LINES);
  return `main process log (${location}, last ${tail.length} of ${lines.length} lines):\n${tail.join("\n")}`;
}

function describeProcessOutput(result) {
  const output = [result.stdout, result.stderr].filter(Boolean).join("\n").trim();
  if (!output) return "";
  return `process output (last ${OUTPUT_CHARACTERS} characters):\n${output.slice(-OUTPUT_CHARACTERS)}`;
}

function parseJsonObject(line) {
  if (!line.startsWith("{")) return undefined;
  try {
    return JSON.parse(line);
  } catch {
    return undefined;
  }
}

function newestFile(directory, name) {
  const files = findFiles(directory, name, SEARCH_DEPTH);
  files.sort((left, right) => modificationTime(right) - modificationTime(left));
  return files[0];
}

function modificationTime(file) {
  try {
    return fs.statSync(file).mtimeMs;
  } catch {
    return 0;
  }
}

function findFiles(directory, name, remainingDepth) {
  const found = [];
  let entries;
  try {
    entries = fs.readdirSync(directory, { withFileTypes: true });
  } catch {
    return found;
  }
  for (const entry of entries) {
    const entryPath = path.join(directory, entry.name);
    if (entry.isDirectory() && !entry.isSymbolicLink()) {
      if (remainingDepth > 0) found.push(...findFiles(entryPath, name, remainingDepth - 1));
    } else if (entry.isFile() && entry.name === name) {
      found.push(entryPath);
    }
  }
  return found;
}

function readText(file) {
  try {
    return fs.readFileSync(file, "utf8");
  } catch {
    return undefined;
  }
}

function relativeTo(directory, file) {
  return path.relative(directory, file).split(path.sep).join("/");
}

function shorten(text, limit) {
  return text.length > limit ? `${text.slice(0, limit)}...` : text;
}
