export interface ModelOption {
  provider: string;
  modelId: string;
  name: string;
  image: boolean;
  reasoning: boolean;
}

export interface ModelGroup {
  provider: string;
  name: string;
  custom: boolean;
  options: ModelOption[];
}

const MODEL_COLLATOR = new Intl.Collator(undefined, { numeric: true, sensitivity: "base" });

const PROVIDER_NAMES: Record<string, string> = {
  "amazon-bedrock": "Amazon Bedrock",
  "ant-ling": "Ant Ling",
  anthropic: "Anthropic",
  "azure-openai-responses": "Azure OpenAI",
  baseten: "Baseten",
  cerebras: "Cerebras",
  "cloudflare-ai-gateway": "Cloudflare AI Gateway",
  "cloudflare-workers-ai": "Cloudflare Workers AI",
  deepseek: "DeepSeek",
  fireworks: "Fireworks",
  "github-copilot": "GitHub Copilot",
  google: "Google Gemini",
  "google-vertex": "Google Vertex AI",
  groq: "Groq",
  huggingface: "Hugging Face",
  "kimi-coding": "Kimi For Coding",
  minimax: "MiniMax",
  "minimax-cn": "MiniMax CN",
  mistral: "Mistral",
  moonshotai: "Moonshot AI",
  "moonshotai-cn": "Moonshot AI CN",
  nvidia: "NVIDIA",
  openai: "OpenAI",
  "openai-codex": "OpenAI Codex",
  opencode: "OpenCode Zen",
  "opencode-go": "OpenCode Go",
  openrouter: "OpenRouter",
  "qwen-token-plan": "Qwen Token Plan",
  "qwen-token-plan-cn": "Qwen Token Plan CN",
  "qwen-token-plan-individual": "Qwen Token Plan Individual",
  together: "Together",
  "vercel-ai-gateway": "Vercel AI Gateway",
  xai: "xAI",
  xiaomi: "Xiaomi",
  "xiaomi-token-plan-ams": "Xiaomi Token Plan AMS",
  "xiaomi-token-plan-cn": "Xiaomi Token Plan CN",
  "xiaomi-token-plan-sgp": "Xiaomi Token Plan SGP",
  zai: "Z.AI",
  "zai-coding-cn": "Z.AI Coding CN",
};

const LEADING_PROVIDERS = ["anthropic", "openai", "google"];
const FAMILY_TIERS = ["opus", "sonnet", "haiku"];

function isKnownProvider(provider: string): boolean {
  return Object.hasOwn(PROVIDER_NAMES, provider);
}

export function providerDisplayName(provider: string): string {
  return isKnownProvider(provider) ? PROVIDER_NAMES[provider] : provider;
}

function familyTier(option: ModelOption): number {
  const haystack = `${option.name} ${option.modelId}`.toLowerCase();
  const tier = FAMILY_TIERS.findIndex((family) => haystack.includes(family));
  return tier === -1 ? FAMILY_TIERS.length : tier;
}

function compareOptions(a: ModelOption, b: ModelOption): number {
  return (
    familyTier(a) - familyTier(b) ||
    MODEL_COLLATOR.compare(a.name || a.modelId, b.name || b.modelId) ||
    MODEL_COLLATOR.compare(a.modelId, b.modelId)
  );
}

function compareGroups(a: ModelGroup, b: ModelGroup): number {
  const aLead = LEADING_PROVIDERS.indexOf(a.provider);
  const bLead = LEADING_PROVIDERS.indexOf(b.provider);
  if (aLead !== -1 || bLead !== -1) {
    if (aLead === -1) return 1;
    if (bLead === -1) return -1;
    return aLead - bLead;
  }
  if (a.custom !== b.custom) return a.custom ? 1 : -1;
  if (a.custom) return MODEL_COLLATOR.compare(a.provider, b.provider);
  return MODEL_COLLATOR.compare(a.name, b.name);
}

export function groupModelOptions(options: readonly ModelOption[]): ModelGroup[] {
  const byProvider = new Map<string, ModelOption[]>();
  for (const option of options) {
    const bucket = byProvider.get(option.provider);
    if (bucket) bucket.push(option);
    else byProvider.set(option.provider, [option]);
  }
  const groups: ModelGroup[] = [];
  for (const [provider, bucket] of byProvider) {
    groups.push({
      provider,
      name: providerDisplayName(provider),
      custom: !isKnownProvider(provider),
      options: [...bucket].sort(compareOptions),
    });
  }
  return groups.sort(compareGroups);
}

export function filterModelGroups(groups: readonly ModelGroup[], query: string): ModelGroup[] {
  const needle = query.trim().toLowerCase();
  if (!needle) return groups as ModelGroup[];
  const result: ModelGroup[] = [];
  for (const group of groups) {
    const providerMatches = group.name.toLowerCase().includes(needle) || group.provider.toLowerCase().includes(needle);
    const options = providerMatches
      ? group.options
      : group.options.filter(
          (option) => option.name.toLowerCase().includes(needle) || option.modelId.toLowerCase().includes(needle),
        );
    if (options.length > 0) result.push({ ...group, options });
  }
  return result;
}
