import { parseExpandedSkillMessage, skillCommandText, splitLeadingSkillCommand } from "./skill-commands";
import type { AgentMessage } from "./types";

export function turnTitleOf(content: AgentMessage["content"]): string {
  const text =
    typeof content === "string"
      ? content
      : Array.isArray(content)
        ? content.flatMap((block) => (block.type === "text" ? [block.text] : [])).join(" ")
        : "";
  const skill = splitLeadingSkillCommand(text) ?? parseExpandedSkillMessage(text);
  const visible = skill ? `${skillCommandText(skill.name)} ${skill.rest}` : text;
  return visible.replace(/\s+/g, " ").trim().slice(0, 200);
}
