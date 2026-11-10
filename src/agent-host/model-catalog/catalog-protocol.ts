import type { Api, Model } from "@earendil-works/pi-ai";
import type { ModelRuntime } from "@earendil-works/pi-coding-agent";
import type { ModelCatalogStatus, ModelCatalogWarning } from "../../contract/types.ts";

export const CATALOG_RESULT_MARKER = "DEXON_MODEL_CATALOG_RESULT:";

export interface CatalogJob {
  readonly kind: "available" | "refresh";
  readonly cwd: string;
  readonly agentDir: string;
  readonly offline: boolean;
}

export type CatalogModel = Pick<Model<Api>, "id" | "name" | "provider" | "reasoning" | "thinkingLevelMap"> & {
  readonly input?: Model<Api>["input"];
};
export type CatalogRuntime = Pick<ModelRuntime, "getProviders" | "getAvailableSnapshot" | "getAvailable">;

export interface CatalogSnapshot {
  readonly cwd: string;
  readonly models: readonly CatalogModel[];
  readonly providerIds: readonly string[];
  readonly warnings: readonly ModelCatalogWarning[];
  readonly status: ModelCatalogStatus;
  readonly builtAt: number;
}

export type CatalogJobResult = { readonly ok: true; readonly snapshot: CatalogSnapshot } | { readonly ok: false };

export function catalogModel(model: CatalogModel): CatalogModel {
  return {
    id: model.id,
    name: model.name,
    provider: model.provider,
    reasoning: model.reasoning,
    ...(Array.isArray(model.input) ? { input: [...model.input] } : {}),
    ...(model.thinkingLevelMap ? { thinkingLevelMap: { ...model.thinkingLevelMap } } : {}),
  };
}

export async function resolveCatalogModels(
  runtime: CatalogRuntime,
  signal?: AbortSignal,
): Promise<{ models: CatalogModel[]; warnings: ModelCatalogWarning[] }> {
  const snapshot = runtime.getAvailableSnapshot();
  const results = await Promise.all(
    [...runtime.getProviders()]
      .sort((a, b) => a.id.localeCompare(b.id))
      .map(async (provider) => {
        try {
          return { models: await runtime.getAvailable(provider.id, { signal }), warnings: [] };
        } catch (error) {
          if (signal?.aborted) throw signal.reason ?? error;
          return {
            models: snapshot.filter((model) => model.provider === provider.id),
            warnings: [
              {
                provider: provider.id,
                code: "PROVIDER_AVAILABILITY_FAILED" as const,
                message: `Unable to check ${provider.id} model availability; the last known state remains available.`,
              },
            ],
          };
        }
      }),
  );
  signal?.throwIfAborted();
  return {
    models: results.flatMap((result) => result.models.map(catalogModel)),
    warnings: results.flatMap((result) => result.warnings),
  };
}

function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Invalid model catalog payload");
  return value as Record<string, unknown>;
}

export function parseCatalogJob(value: unknown): CatalogJob {
  const raw = record(value);
  if (
    (raw.kind !== "available" && raw.kind !== "refresh") ||
    typeof raw.cwd !== "string" ||
    typeof raw.agentDir !== "string" ||
    typeof raw.offline !== "boolean"
  ) {
    throw new Error("Invalid model catalog job");
  }
  return { kind: raw.kind, cwd: raw.cwd, agentDir: raw.agentDir, offline: raw.offline };
}

function parseWarning(value: unknown): ModelCatalogWarning {
  const raw = record(value);
  if (
    typeof raw.provider !== "string" ||
    typeof raw.message !== "string" ||
    !["PROVIDER_REFRESH_FAILED", "PROVIDER_AVAILABILITY_FAILED", "MODEL_REFRESH_TIMEOUT"].includes(String(raw.code))
  ) {
    throw new Error("Invalid model catalog warning");
  }
  return { provider: raw.provider, message: raw.message, code: raw.code as ModelCatalogWarning["code"] };
}

export function parseCatalogJobResult(value: unknown): CatalogJobResult {
  const result = record(value);
  if (result.ok === false) return { ok: false };
  const raw = record(result.snapshot);
  const status = record(raw.status);
  if (
    result.ok !== true ||
    typeof raw.cwd !== "string" ||
    typeof raw.builtAt !== "number" ||
    !Array.isArray(raw.models) ||
    !Array.isArray(raw.providerIds) ||
    !raw.providerIds.every((id) => typeof id === "string") ||
    !Array.isArray(raw.warnings) ||
    !Array.isArray(status.warnings) ||
    !["network", "cache", "offline"].includes(String(status.source)) ||
    typeof status.refreshed !== "boolean" ||
    typeof status.aborted !== "boolean"
  ) {
    throw new Error("Invalid model catalog result");
  }
  const models = raw.models.map((value) => {
    const model = record(value);
    if (
      typeof model.id !== "string" ||
      typeof model.name !== "string" ||
      typeof model.provider !== "string" ||
      typeof model.reasoning !== "boolean"
    ) {
      throw new Error("Invalid catalog model");
    }
    const thinkingLevelMap = model.thinkingLevelMap === undefined ? undefined : record(model.thinkingLevelMap);
    if (
      thinkingLevelMap &&
      !Object.values(thinkingLevelMap).every((level) => level === null || typeof level === "string")
    ) {
      throw new Error("Invalid catalog thinking levels");
    }
    const input =
      model.input === undefined
        ? undefined
        : Array.isArray(model.input) &&
            model.input.every((item): item is "text" | "image" => item === "text" || item === "image")
          ? model.input
          : null;
    if (input === null) {
      throw new Error("Invalid catalog model inputs");
    }
    return catalogModel({
      id: model.id,
      name: model.name,
      provider: model.provider,
      reasoning: model.reasoning,
      ...(input ? { input } : {}),
      ...(thinkingLevelMap
        ? { thinkingLevelMap: thinkingLevelMap as NonNullable<CatalogModel["thinkingLevelMap"]> }
        : {}),
    });
  });
  return {
    ok: true,
    snapshot: {
      cwd: raw.cwd,
      builtAt: raw.builtAt,
      models,
      providerIds: raw.providerIds,
      warnings: raw.warnings.map(parseWarning),
      status: {
        source: status.source as ModelCatalogStatus["source"],
        refreshed: status.refreshed,
        aborted: status.aborted,
        warnings: status.warnings.map(parseWarning),
      },
    },
  };
}
