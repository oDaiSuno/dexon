import type { UserMessage } from "@shared/types";
import framerTokens from "../styles/framer-tokens.json";

export type MessageSource = NonNullable<UserMessage["channelSource"]> | "local";
export type MessageTheme = "light" | "dark";

export interface UserBubbleStyle {
  background: string;
  foreground: string;
}

type FramerColorPath = keyof typeof framerTokens.colors;

function framerHex(path: FramerColorPath, theme: MessageTheme): string {
  const channels = framerTokens.colors[path][theme].match(/\d+/g) ?? [];
  return `#${channels
    .slice(0, 3)
    .map((channel) => Number(channel).toString(16).padStart(2, "0"))
    .join("")}`;
}

const CHANNEL_BRAND: Record<Exclude<MessageSource, "local">, FramerColorPath> = {
  weixin: "/Channel/WeChat",
  telegram: "/Channel/Telegram",
  feishu: "/Channel/Feishu",
};

function brandPalette(theme: MessageTheme): Record<Exclude<MessageSource, "local">, string> {
  return {
    weixin: framerHex(CHANNEL_BRAND.weixin, theme),
    telegram: framerHex(CHANNEL_BRAND.telegram, theme),
    feishu: framerHex(CHANNEL_BRAND.feishu, theme),
  };
}

export const USER_BUBBLE_COLORS: Record<MessageTheme, Record<Exclude<MessageSource, "local">, string>> = {
  light: brandPalette("light"),
  dark: brandPalette("dark"),
};

export function getUserBubbleStyle(source: UserMessage["channelSource"] | undefined, isDark: boolean): UserBubbleStyle {
  if (!source) {
    return { background: "var(--fx-surface-card)", foreground: "var(--fx-text-primary)" };
  }
  const theme = isDark ? "dark" : "light";
  return {
    background: USER_BUBBLE_COLORS[theme][source],
    foreground: framerHex("/Channel/On Brand", theme),
  };
}
