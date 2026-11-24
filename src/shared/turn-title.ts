import { promptIntentText, readPromptIntent } from "./prompt-intent";
import { quoteTitleText } from "./quote-tokens.ts";
import type { AgentMessage } from "./types";

export function turnTitleOf(content: AgentMessage["content"]): string {
  const text =
    typeof content === "string"
      ? content
      : Array.isArray(content)
        ? content.flatMap((block) => (block.type === "text" ? [block.text] : [])).join(" ")
        : "";
  return quoteTitleText(promptIntentText(readPromptIntent(text)))
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 200);
}
