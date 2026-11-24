import type { Options as ReactMarkdownOptions } from "react-markdown";
import rehypeKatex from "rehype-katex";
import rehypeRaw from "rehype-raw";
import rehypeSanitize, { defaultSchema } from "rehype-sanitize";
import remarkCjkFriendly from "remark-cjk-friendly";
import remarkCjkFriendlyGfmStrikethrough from "remark-cjk-friendly-gfm-strikethrough";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import { remarkChatMath, remarkHoldUnclosedMath } from "./chat-math.ts";
import { remarkAttachmentTokens, remarkQuoteTokens } from "./markdown-attachment-tokens.ts";
import { remarkStandaloneDisplayMath } from "./standalone-display-math.ts";

export const markdownSanitizeSchema = {
  ...defaultSchema,
  attributes: {
    ...defaultSchema.attributes,
    code: [["className", /^language-./, "math-inline", "math-display"]],
    span: [...(defaultSchema.attributes?.span ?? []), ["dataQuoteRef", /^[1-9]\d*$/]],
  },
  protocols: {
    ...defaultSchema.protocols,
    href: [...(defaultSchema.protocols?.href ?? []), "file"],
  },
  strip: [...(defaultSchema.strip || []), "iframe", "object", "style", "form"],
};

export const chatRemarkPlugins: NonNullable<ReactMarkdownOptions["remarkPlugins"]> = [
  remarkGfm,
  remarkCjkFriendly,
  remarkCjkFriendlyGfmStrikethrough,
  remarkChatMath,
  remarkHoldUnclosedMath,
  remarkStandaloneDisplayMath,
];

export const filePreviewRemarkPlugins: NonNullable<ReactMarkdownOptions["remarkPlugins"]> = [
  remarkGfm,
  remarkCjkFriendly,
  remarkCjkFriendlyGfmStrikethrough,
  remarkMath,
  remarkStandaloneDisplayMath,
];

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
  quoteToken(_state: unknown, node: { quoteId: string; raw: string }) {
    return { type: "quoteToken", data: { quoteToken: { quoteId: node.quoteId, raw: node.raw } } };
  },
};

export function rehypeAttachmentChips() {
  return (tree: ChipHastNode): void => {
    const convert = (node: ChipHastNode, insideLink: boolean): void => {
      if (!node.children) return;
      node.children = node.children.map((child) => {
        const chip = child.type === "attachmentToken" || child.type === "skillToken" || child.type === "quoteToken";
        if (chip) {
          const quote = child.data?.quoteToken as { quoteId: string; raw: string } | undefined;
          const raw = quote?.raw ?? (child.data?.attachmentToken as { raw?: string } | undefined)?.raw;
          if (insideLink && raw) return { type: "text", value: raw };
          return {
            type: "element",
            tagName: "span",
            properties: quote ? { dataQuoteRef: quote.quoteId } : {},
            children: quote ? [{ type: "text", value: quote.raw }] : [],
            data: child.data,
          };
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
  remarkCjkFriendly,
  remarkCjkFriendlyGfmStrikethrough,
  remarkChatMath,
  remarkHoldUnclosedMath,
  remarkStandaloneDisplayMath,
  remarkAttachmentTokens,
  remarkQuoteTokens,
];

export const userMessageRemarkRehypeOptions: NonNullable<ReactMarkdownOptions["remarkRehypeOptions"]> = {
  handlers: chipHandlers as unknown as RemarkRehypeHandlers,
};

export const userMessageRehypePlugins: NonNullable<ReactMarkdownOptions["rehypePlugins"]> = [
  [rehypeRaw, { passThrough: ["attachmentToken", "skillToken", "quoteToken"] }],
  rehypeAttachmentChips,
  [rehypeSanitize, markdownSanitizeSchema],
  [rehypeKatex, { throwOnError: false, strict: false }],
];
