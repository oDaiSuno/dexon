import type { UserMessage } from "@shared/types";

export type MessageSource = NonNullable<UserMessage["channelSource"]> | "local";
export type MessageTheme = "light" | "dark";

export interface UserBubbleStyle {
  background: string;
  foreground: string;
}

const USER_BUBBLE_FOREGROUND = "#faf9f7";

/* Channel bubbles keep their brand colors; the local bubble follows the
 * chat surface language (soft gray field + ink) defined in chat.css. */
export const USER_BUBBLE_COLORS: Record<MessageTheme, Record<Exclude<MessageSource, "local">, string>> = {
  light: {
    weixin: "#08783e",
    telegram: "#1677a8",
    feishu: "#c2410c",
  },
  dark: {
    weixin: "#0f6840",
    telegram: "#176689",
    feishu: "#a13d13",
  },
};

export function getUserBubbleStyle(source: UserMessage["channelSource"] | undefined, isDark: boolean): UserBubbleStyle {
  if (!source) {
    return { background: "var(--bui-bubble)", foreground: "var(--bui-ink)" };
  }
  return {
    background: USER_BUBBLE_COLORS[isDark ? "dark" : "light"][source],
    foreground: USER_BUBBLE_FOREGROUND,
  };
}
