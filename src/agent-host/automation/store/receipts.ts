import type { AutomationDatabase } from "./db";
import { requestDigest } from "../spec/grant";

export class CommandDigestMismatch extends Error {
  readonly code = "COMMAND_DIGEST_MISMATCH";
  constructor() {
    super("Request ID was already used with different command content");
  }
}
export function withReceipt<T>(
  adb: AutomationDatabase,
  scope: string,
  requestId: string | undefined,
  body: object,
  apply: () => T,
): T {
  if (requestId === undefined) return apply();
  if (!requestId.trim()) throw new Error("Request ID cannot be empty");
  const digest = requestDigest(body);
  const row = adb.db
    .prepare("SELECT request_digest, result_json FROM command_receipts WHERE scope = ? AND request_id = ?")
    .get(scope, requestId) as { request_digest: string; result_json: string } | undefined;
  if (row) {
    if (row.request_digest !== digest) throw new CommandDigestMismatch();
    return JSON.parse(row.result_json) as T;
  }
  const result = apply();
  adb.db
    .prepare(
      "INSERT INTO command_receipts (scope, request_id, request_digest, result_json, committed_ms) VALUES (?, ?, ?, ?, ?)",
    )
    .run(scope, requestId, digest, JSON.stringify(result), adb.clock.now());
  return result;
}
