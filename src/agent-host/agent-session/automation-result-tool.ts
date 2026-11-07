import type { ToolDefinition } from "@earendil-works/pi-coding-agent";
import type { TSchema } from "typebox";
import { Value } from "typebox/value";
import type { AutomationResultContract } from "./execution-profile";

export const AUTOMATION_RESULT_TOOL_NAME = "automation_result" as const;

export type AutomationResultState<T = unknown> =
  | { readonly status: "empty" }
  | { readonly status: "submitted"; readonly value: T; readonly submittedAtMs: number }
  | { readonly status: "invalid"; readonly lastErrors: readonly string[]; readonly invalidAttempts: number };

export type AutomationResultValidation<T> =
  { readonly ok: true; readonly value: T } | { readonly ok: false; readonly errors: string[] };

type ResultReply = Awaited<ReturnType<ToolDefinition["execute"]>> & { readonly isError: boolean };

export interface AutomationResultSink<T = unknown> {
  readonly state: AutomationResultState<T>;
  onSealed?: () => void;
  onSeal(listener: () => void): () => void;
  submit(value: unknown): ResultReply;
}

function reply(text: string, isError: boolean, terminate = false): ResultReply {
  return { isError, content: [{ type: "text", text }], details: undefined, ...(terminate ? { terminate: true } : {}) };
}

function schemaErrors(schema: Record<string, unknown>, value: unknown): string[] {
  if (Value.Check(schema as TSchema, value)) return [];
  return Value.Errors(schema as TSchema, value).map((error) => JSON.stringify(error));
}

export function createAutomationResultSink<T = unknown>(
  schema: Record<string, unknown>,
  validate?: (value: unknown) => AutomationResultValidation<T>,
): AutomationResultSink<T> {
  let state: AutomationResultState<T> = { status: "empty" };
  let invalidAttempts = 0;
  const listeners = new Set<() => void>();
  const contractSchema = structuredClone(schema);
  const sink: AutomationResultSink<T> = {
    get state() {
      return structuredClone(state);
    },
    onSeal(listener) {
      if (state.status === "submitted") listener();
      else listeners.add(listener);
      return () => listeners.delete(listener);
    },
    submit(value) {
      if (state.status === "submitted") return reply("Result already submitted and sealed.", false, true);
      let checked: AutomationResultValidation<T>;
      try {
        const serialized = JSON.stringify(value);
        if (serialized === undefined) throw new Error("Result must be a JSON value");
        const json: unknown = JSON.parse(serialized);
        if (!Value.Equal(json, value)) throw new Error("Result must contain only JSON values");
        const errors = schemaErrors(contractSchema, json);
        checked = errors.length ? { ok: false, errors } : validate ? validate(json) : { ok: true, value: json as T };
      } catch (error) {
        checked = { ok: false, errors: [error instanceof Error ? error.message : String(error)] };
      }
      if (!checked.ok) {
        state = { status: "invalid", lastErrors: [...checked.errors], invalidAttempts: ++invalidAttempts };
        return reply(
          `Invalid automation result. Correct the payload and call automation_result again.\n${checked.errors.join("\n")}`,
          true,
        );
      }
      state = { status: "submitted", value: structuredClone(checked.value), submittedAtMs: Date.now() };
      for (const listener of [...listeners, ...(sink.onSealed ? [sink.onSealed] : [])]) {
        try {
          listener();
        } catch {}
      }
      listeners.clear();
      return reply("Result submitted and sealed. No further workspace operations are permitted.", false, true);
    },
  };
  return sink;
}

export function createAutomationResultTool(contract: AutomationResultContract): ToolDefinition {
  return {
    name: AUTOMATION_RESULT_TOOL_NAME,
    label: "Automation result",
    description:
      "Submit the final structured JSON result. Invalid payloads can be corrected. The first valid payload seals this session and stops further workspace operations.",
    parameters: contract.schema as TSchema,
    executionMode: "parallel",
    execute: async (_id, args) => contract.sink.submit(args),
  };
}
