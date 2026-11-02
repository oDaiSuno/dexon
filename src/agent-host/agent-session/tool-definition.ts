import { defineTool, type ToolDefinition } from "@earendil-works/pi-coding-agent";
import type { TSchema } from "typebox";

import type { DexonToolOwner } from "../../shared/pi-types";

export interface DexonToolMetadata {
  readonly dexonOwner: DexonToolOwner;
  readonly promptSnippet: string;
  readonly exposure: "direct";
  readonly defaultActive: boolean;
}

export type DexonToolDefinition<
  TParams extends TSchema = TSchema,
  TDetails = unknown,
  TState = unknown,
> = ToolDefinition<TParams, TDetails, TState> & DexonToolMetadata;

export function defineDexonTool<TParams extends TSchema, TDetails = unknown, TState = unknown>(
  definition: ToolDefinition<TParams, TDetails, TState> & Pick<DexonToolMetadata, "dexonOwner" | "promptSnippet">,
): DexonToolDefinition<TParams, TDetails, TState> & ReturnType<typeof defineTool<TParams, TDetails, TState>> {
  return {
    ...defineTool(definition),
    dexonOwner: definition.dexonOwner,
    promptSnippet: definition.promptSnippet,
    exposure: "direct",
    defaultActive: definition.dexonOwner === "coding",
  };
}
