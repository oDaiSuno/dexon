import type { TaskSpec } from "@shared/automation/spec";
import { editorRecord } from "./editor-model";

const text = (value: unknown): boolean =>
  typeof value === "string" || (editorRecord(value) && typeof value.$tmpl === "string");
const optionalText = (value: unknown): boolean => value === undefined || text(value);
const optionalString = (value: unknown): boolean => value === undefined || typeof value === "string";
const optionalNumber = (value: unknown): boolean =>
  value === undefined || (typeof value === "number" && Number.isFinite(value));
const strings = (value: unknown): boolean =>
  Array.isArray(value) && value.every((entry: unknown) => typeof entry === "string");
const target = (value: unknown): boolean =>
  editorRecord(value) && typeof value.accountId === "string" && typeof value.peerId === "string";
const effect = (value: unknown): boolean =>
  value === undefined ||
  value === "read" ||
  value === "unsafe" ||
  (editorRecord(value) && editorRecord(value.idempotent) && typeof value.idempotent.window === "string");
const textMap = (value: unknown): boolean =>
  value === undefined || (editorRecord(value) && Object.values(value).every(text));
const stringMap = (value: unknown): boolean =>
  value === undefined || (editorRecord(value) && Object.values(value).every((entry) => typeof entry === "string"));

function action(value: unknown, probe = false): boolean {
  if (!editorRecord(value) || !editorRecord(value.with)) return false;
  const options = value.with;
  if (!optionalString(options.timeout) || !effect(options.effect)) return false;
  if (value.action === "http.request")
    return (
      editorRecord(options.url) &&
      typeof options.url.origin === "string" &&
      optionalText(options.url.path) &&
      textMap(options.url.query) &&
      textMap(options.headers) &&
      stringMap(options.secretHeaders) &&
      optionalString(options.method) &&
      (options.expectStatus === undefined ||
        (Array.isArray(options.expectStatus) &&
          options.expectStatus.every((status: unknown) => typeof status === "number")))
    );
  if (value.action === "script.run")
    return typeof options.path === "string" && (options.secrets === undefined || strings(options.secrets));
  return (
    !probe &&
    value.action === "channel.send" &&
    target(options.to) &&
    text(options.text) &&
    optionalString(options.format)
  );
}

function step(value: unknown): boolean {
  if (
    !editorRecord(value) ||
    typeof value.id !== "string" ||
    !optionalString(value.title) ||
    !optionalString(value.timeout)
  )
    return false;
  if (value.kind === "agent")
    return (
      text(value.prompt) &&
      strings(value.tools) &&
      effect(value.effect) &&
      editorRecord(value.output) &&
      editorRecord(value.output.schema)
    );
  if (value.kind === "action") return action(value.call);
  if (value.kind !== "wait" || !editorRecord(value.wait) || !optionalString(value.expiresIn)) return false;
  const wait = value.wait;
  if (wait.kind === "duration") return typeof wait.duration === "string";
  if (wait.kind === "signal") return typeof wait.signal === "string" && text(wait.key) && optionalString(wait.history);
  return (
    wait.kind === "approval" &&
    text(wait.title) &&
    optionalText(wait.prompt) &&
    (wait.notify === undefined ||
      (editorRecord(wait.notify) && target(wait.notify.to) && optionalText(wait.notify.text)))
  );
}

function trigger(value: unknown): boolean {
  if (!editorRecord(value) || typeof value.id !== "string") return false;
  if (value.kind === "manual") return true;
  if (value.kind === "schedule")
    return (
      (typeof value.cron === "string" || typeof value.every === "string") &&
      optionalString(value.tz) &&
      optionalString(value.catchupWindow)
    );
  if (
    value.kind !== "watch" ||
    typeof value.every !== "string" ||
    !action(value.probe, true) ||
    !editorRecord(value.mode)
  )
    return false;
  const mode = value.mode;
  if (mode.type === "threshold")
    return (
      typeof mode.consecutive === "number" &&
      editorRecord(mode.healthy) &&
      optionalString(mode.cooldown) &&
      optionalString(mode.staleResetGap)
    );
  return (
    mode.type === "items" &&
    typeof mode.itemsPath === "string" &&
    typeof mode.keyPath === "string" &&
    optionalString(mode.cursorPath) &&
    optionalString(mode.dedupeWindow) &&
    editorRecord(mode.emit) &&
    (editorRecord(mode.emit.startRun) || typeof mode.emit.emitSignal === "string")
  );
}

export function editorParseDraft(raw: string): TaskSpec | null {
  try {
    const value: unknown = JSON.parse(raw);
    if (
      !editorRecord(value) ||
      value.schema !== "dexon.automation/v1" ||
      typeof value.id !== "string" ||
      typeof value.name !== "string" ||
      typeof value.cwd !== "string" ||
      !optionalString(value.description)
    )
      return null;
    if (
      !Array.isArray(value.steps) ||
      !value.steps.every(step) ||
      !Array.isArray(value.triggers) ||
      !value.triggers.every(trigger)
    )
      return null;
    if (value.concurrency !== undefined) {
      if (!editorRecord(value.concurrency) || !optionalNumber(value.concurrency.maxExecuting)) return null;
      const lane = value.concurrency.lane;
      if (
        lane !== undefined &&
        (!editorRecord(lane) ||
          typeof lane.capacity !== "number" ||
          typeof lane.overflow !== "string" ||
          !optionalText(lane.key) ||
          !optionalNumber(lane.maxPending))
      )
        return null;
    }
    return value as unknown as TaskSpec;
  } catch {
    return null;
  }
}
