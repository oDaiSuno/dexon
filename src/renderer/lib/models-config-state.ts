export interface ModelEntry {
  id: string;
  name?: string;
  api?: string;
  reasoning?: boolean;
  thinkingLevelMap?: Record<string, string | null>;
  input?: string[];
  contextWindow?: number;
  maxTokens?: number;
  cost?: { input?: number; output?: number; cacheRead?: number; cacheWrite?: number };
  compat?: Record<string, unknown>;
  samplingParams?: Record<string, unknown>;
  [key: string]: unknown;
}

export interface ProviderEntry {
  baseUrl?: string;
  api?: string;
  apiKey?: string;
  headers?: Record<string, string | null>;
  compat?: Record<string, unknown>;
  models?: ModelEntry[];
  modelOverrides?: Record<string, unknown>;
  [key: string]: unknown;
}

export interface ModelsJson {
  providers?: Record<string, ProviderEntry>;
  [key: string]: unknown;
}

const RESERVED_PROVIDER_NAMES = new Set(["__proto__", "prototype", "constructor"]);

export type ProviderSaveResult =
  { ok: true; config: ModelsJson; name: string } | { ok: false; config: ModelsJson; error: string };

const hasProvider = (providers: Record<string, ProviderEntry>, name: string) =>
  Object.prototype.hasOwnProperty.call(providers, name);

export function nextCustomProviderName(config: ModelsJson): string {
  const providers = config.providers ?? {};
  let name = "new-provider";
  let suffix = 1;
  while (hasProvider(providers, name)) name = `new-provider-${suffix++}`;
  return name;
}

export function saveProviderEntry(
  config: ModelsJson,
  originalName: string | null,
  requestedName: string,
  entry: ProviderEntry,
): ProviderSaveResult {
  const name = requestedName.trim();
  if (!name) return { ok: false, config, error: "Provider name cannot be empty." };
  if (RESERVED_PROVIDER_NAMES.has(name)) {
    return { ok: false, config, error: `Provider name “${name}” is reserved.` };
  }

  const providers = config.providers ?? {};
  if (originalName !== null && !hasProvider(providers, originalName)) {
    return { ok: false, config, error: `Provider “${originalName}” no longer exists.` };
  }
  if (name !== originalName && hasProvider(providers, name)) {
    return { ok: false, config, error: `Provider “${name}” already exists.` };
  }

  if (originalName === null) {
    return { ok: true, config: { ...config, providers: { ...providers, [name]: entry } }, name };
  }
  const entries = Object.entries(providers).map(([providerName, provider]): [string, ProviderEntry] =>
    providerName === originalName ? [name, entry] : [providerName, provider],
  );
  return { ok: true, config: { ...config, providers: Object.fromEntries(entries) }, name };
}

export function deleteProviderEntry(config: ModelsJson, providerName: string): ModelsJson {
  const currentProviders = config.providers ?? {};
  if (!hasProvider(currentProviders, providerName)) return config;
  const providers = { ...currentProviders };
  delete providers[providerName];
  return { ...config, providers };
}

export function saveModelEntry(provider: ProviderEntry, index: number | null, model: ModelEntry): ProviderEntry {
  const models = [...(provider.models ?? [])];
  if (index === null) models.push(model);
  else models[index] = model;
  return { ...provider, models };
}

export function deleteModelEntry(provider: ProviderEntry, index: number): ProviderEntry {
  if (!provider.models || index < 0 || index >= provider.models.length) return provider;
  const models = provider.models.filter((_, i) => i !== index);
  return { ...provider, models: models.length ? models : undefined };
}

export function setProviderBaseUrl(config: ModelsJson, providerName: string, baseUrl: string): ModelsJson {
  const providers = { ...(config.providers ?? {}) };
  const provider = { ...(providers[providerName] ?? {}) };
  const normalized = baseUrl.trim();

  if (normalized) {
    provider.baseUrl = normalized;
    providers[providerName] = provider;
  } else {
    delete provider.baseUrl;
    if (Object.keys(provider).length > 0) providers[providerName] = provider;
    else delete providers[providerName];
  }

  return { ...config, providers };
}
