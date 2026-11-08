import type { Options as ReactMarkdownOptions } from "react-markdown";
import rehypeKatex from "rehype-katex";
import rehypeRaw from "rehype-raw";
import rehypeSanitize, { defaultSchema } from "rehype-sanitize";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import { remarkChatMath, remarkHoldUnclosedMath } from "./chat-math.ts";
import { remarkAttachmentTokens } from "./markdown-attachment-tokens.ts";

export const markdownSanitizeSchema = {
  ...defaultSchema,
  attributes: {
    ...defaultSchema.attributes,
    code: [["className", /^language-./, "math-inline", "math-display"]],
  },
  protocols: {
    ...defaultSchema.protocols,
    href: [...(defaultSchema.protocols?.href ?? []), "file"],
  },
  strip: [...(defaultSchema.strip || []), "iframe", "object", "style", "form"],
};

export const chatRemarkPlugins: NonNullable<ReactMarkdownOptions["remarkPlugins"]> = [
  remarkGfm,
  remarkChatMath,
  remarkHoldUnclosedMath,
];

export const filePreviewRemarkPlugins: NonNullable<ReactMarkdownOptions["remarkPlugins"]> = [remarkGfm, remarkMath];

export const markdownRehypePlugins: ReactMarkdownOptions["rehypePlugins"] = [
  rehypeRaw,
  [rehypeSanitize, markdownSanitizeSchema],
  [rehypeKatex, { throwOnError: false, strict: false }],
];

type RemarkRehypeHandlers = NonNullable<NonNullable<ReactMarkdownOptions["remarkRehypeOptions"]>["handlers"]>;

interface ChipHastNode {
  type: string;
  tagName?: string;
  properties?: Record<string, unknown>;
  children?: ChipHastNode[];
  data?: Record<string, unknown>;
}

const chipHandlers = {
  attachmentToken(_state: unknown, node: { path: string; quoted: boolean; raw: string }) {
    return {
      type: "attachmentToken",
      data: { attachmentToken: { path: node.path, quoted: node.quoted, raw: node.raw } },
    };
  },
  skillToken(_state: unknown, node: { name: string }) {
    return { type: "skillToken", data: { skillToken: { name: node.name } } };
  },
};

export function rehypeAttachmentChips() {
  return (tree: ChipHastNode): void => {
    const convert = (node: ChipHastNode, insideLink: boolean): void => {
      if (!node.children) return;
      node.children = node.children.map((child) => {
        const chip = child.type === "attachmentToken" || child.type === "skillToken";
        if (chip) {
          const raw = (child.data?.attachmentToken as { raw?: string } | undefined)?.raw;
          if (insideLink && raw) return { type: "text", value: raw };
          return { type: "element", tagName: "span", properties: {}, children: [], data: child.data };
        }
        convert(child, insideLink || (child.type === "element" && child.tagName === "a"));
        return child;
      });
    };
    convert(tree, false);
  };
}

export const userMessageRemarkPlugins: NonNullable<ReactMarkdownOptions["remarkPlugins"]> = [
  remarkGfm,
  remarkChatMath,
  remarkHoldUnclosedMath,
  remarkAttachmentTokens,
];

export const userMessageRemarkRehypeOptions: NonNullable<ReactMarkdownOptions["remarkRehypeOptions"]> = {
  handlers: chipHandlers as unknown as RemarkRehypeHandlers,
};

export const userMessageRehypePlugins: NonNullable<ReactMarkdownOptions["rehypePlugins"]> = [
  [rehypeRaw, { passThrough: ["attachmentToken", "skillToken"] }],
  rehypeAttachmentChips,
  [rehypeSanitize, markdownSanitizeSchema],
  [rehypeKatex, { throwOnError: false, strict: false }],
];
