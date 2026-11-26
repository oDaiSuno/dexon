import { useRef } from "react";
import type { Json } from "@shared/automation/spec";
import type { HostedInbox } from "./automation-context";

export function drawerError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function inboxEntryKey(entry: HostedInbox): string {
  return JSON.stringify([entry.environmentId, entry.item.runId, entry.item.stepIndex, entry.item.kind]);
}

export function useDrawerRequestId() {
  const requests = useRef(new Map<string, string>());
  return (value: unknown): string => {
    const key = JSON.stringify(value);
    const existing = requests.current.get(key);
    if (existing) return existing;
    const id = `automation-page-${crypto.randomUUID()}`;
    requests.current.set(key, id);
    return id;
  };
}

export function parseDrawerJson(text: string, fallback: Json = null): Json {
  if (!text.trim()) return fallback;
  const parsed: unknown = JSON.parse(text);
  const valid = (value: unknown): value is Json => {
    if (value === null || typeof value === "string" || typeof value === "boolean") return true;
    if (typeof value === "number") return Number.isFinite(value);
    if (Array.isArray(value)) return value.every(valid);
    return typeof value === "object" && Object.values(value).every(valid);
  };
  if (!valid(parsed)) throw new Error("Invalid JSON value");
  return parsed;
}
