import AnthropicIcon from "@lobehub/icons/es/Anthropic/components/Mono";
import OpenAIIcon from "@lobehub/icons/es/OpenAI/components/Mono";
import GoogleIcon from "@lobehub/icons/es/Google/components/Mono";
import DeepSeekIcon from "@lobehub/icons/es/DeepSeek/components/Mono";
import GroqIcon from "@lobehub/icons/es/Groq/components/Mono";
import MistralIcon from "@lobehub/icons/es/Mistral/components/Mono";
import MoonshotIcon from "@lobehub/icons/es/Moonshot/components/Mono";
import MinimaxIcon from "@lobehub/icons/es/Minimax/components/Mono";
import FireworksIcon from "@lobehub/icons/es/Fireworks/components/Mono";
import HuggingFaceIcon from "@lobehub/icons/es/HuggingFace/components/Mono";
import CerebrasIcon from "@lobehub/icons/es/Cerebras/components/Mono";
import OpenRouterIcon from "@lobehub/icons/es/OpenRouter/components/Mono";
import XAIIcon from "@lobehub/icons/es/XAI/components/Mono";
import CloudflareIcon from "@lobehub/icons/es/Cloudflare/components/Mono";
import VercelIcon from "@lobehub/icons/es/Vercel/components/Mono";
import GithubCopilotIcon from "@lobehub/icons/es/GithubCopilot/components/Mono";
import AwsIcon from "@lobehub/icons/es/Aws/components/Mono";
import AzureIcon from "@lobehub/icons/es/Azure/components/Mono";
import KimiIcon from "@lobehub/icons/es/Kimi/components/Mono";
import QwenIcon from "@lobehub/icons/es/Qwen/components/Mono";
import ZhipuIcon from "@lobehub/icons/es/Zhipu/components/Mono";
import CohereIcon from "@lobehub/icons/es/Cohere/components/Mono";
import PerplexityIcon from "@lobehub/icons/es/Perplexity/components/Mono";
import TogetherIcon from "@lobehub/icons/es/Together/components/Mono";
import GrokIcon from "@lobehub/icons/es/Grok/components/Mono";
import AntGroupIcon from "@lobehub/icons/es/AntGroup/components/Mono";
import NvidiaIcon from "@lobehub/icons/es/Nvidia/components/Mono";
import OpenCodeIcon from "@lobehub/icons/es/OpenCode/components/Mono";
import XiaomiMiMoIcon from "@lobehub/icons/es/XiaomiMiMo/components/Mono";
import ZAIIcon from "@lobehub/icons/es/ZAI/components/Mono";
import OllamaIcon from "@lobehub/icons/es/Ollama/components/Mono";
import GeminiIcon from "@lobehub/icons/es/Gemini/components/Mono";

type IconComponent = React.ComponentType<{ size?: number | string; style?: React.CSSProperties }>;

const PROVIDER_ICONS: Record<string, IconComponent> = {
  anthropic: AnthropicIcon,
  openai: OpenAIIcon,
  "openai-codex": OpenAIIcon,
  google: GeminiIcon,
  "google-vertex": GoogleIcon,
  "ant-ling": AntGroupIcon,
  deepseek: DeepSeekIcon,
  groq: GroqIcon,
  mistral: MistralIcon,
  moonshotai: MoonshotIcon,
  "moonshotai-cn": MoonshotIcon,
  moonshot: MoonshotIcon,
  minimax: MinimaxIcon,
  "minimax-cn": MinimaxIcon,
  fireworks: FireworksIcon,
  huggingface: HuggingFaceIcon,
  cerebras: CerebrasIcon,
  openrouter: OpenRouterIcon,
  xai: XAIIcon,
  "cloudflare-ai-gateway": CloudflareIcon,
  "cloudflare-workers-ai": CloudflareIcon,
  "vercel-ai-gateway": VercelIcon,
  "github-copilot": GithubCopilotIcon,
  "amazon-bedrock": AwsIcon,
  "azure-openai-responses": AzureIcon,
  "kimi-coding": KimiIcon,
  nvidia: NvidiaIcon,
  opencode: OpenCodeIcon,
  "opencode-go": OpenCodeIcon,
  qwen: QwenIcon,
  xiaomi: XiaomiMiMoIcon,
  "xiaomi-token-plan-ams": XiaomiMiMoIcon,
  "xiaomi-token-plan-cn": XiaomiMiMoIcon,
  "xiaomi-token-plan-sgp": XiaomiMiMoIcon,
  zai: ZAIIcon,
  "zai-coding-cn": ZAIIcon,
  zhipu: ZhipuIcon,
  cohere: CohereIcon,
  perplexity: PerplexityIcon,
  together: TogetherIcon,
  grok: GrokIcon,
  ollama: OllamaIcon,
};

function GatewayIcon({ size }: { size: number }) {
  return (
    <svg
      aria-hidden="true"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      style={{ flexShrink: 0, color: "var(--fx-text-primary)" }}
    >
      <path d="M6 22V4a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v18Z" />
      <path d="M6 12H4a2 2 0 0 0-2 2v6a2 2 0 0 0 2 2h2" />
      <path d="M18 9h2a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2h-2" />
      <path d="M10 6h4M10 10h4M10 14h4M10 18h4" />
    </svg>
  );
}

export function ProviderIcon({ id, size }: { id: string; size: number }) {
  const Icon = PROVIDER_ICONS[id] ?? PROVIDER_ICONS[id.split(/[-_.]/).find((part) => PROVIDER_ICONS[part]) ?? ""];
  if (!Icon) return <GatewayIcon size={size} />;
  return <Icon size={size} style={{ color: "var(--fx-text-primary)" }} />;
}

export function ProviderLogoTile({ id, dimmed = false }: { id: string; dimmed?: boolean }) {
  return (
    <span
      aria-hidden="true"
      style={{
        width: 36,
        height: 36,
        flexShrink: 0,
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        border: "1px solid var(--fx-line-default)",
        borderRadius: "var(--radius-control)",
        background: "var(--fx-surface-card)",
        boxSizing: "border-box",
        opacity: dimmed ? 0.5 : undefined,
      }}
    >
      <ProviderIcon id={id} size={18} />
    </span>
  );
}
