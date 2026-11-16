import type { ModelsListResult } from "@contract/types";

const catalogs = new Map<string, ModelsListResult>();

export function clearLastKnownGoodModels(): void {
  catalogs.clear();
}

export function lastKnownGoodModels(key: string): ModelsListResult | undefined {
  return catalogs.get(key);
}

export function rememberGoodModels(key: string, result: ModelsListResult): void {
  catalogs.delete(key);
  catalogs.set(key, result);
  if (catalogs.size > 32) catalogs.delete(catalogs.keys().next().value!);
}
