import { looksLikePath } from "./attachment-tokens.ts";

export interface MarkdownTreeNode {
  type: string;
  value?: string;
  url?: string;
  path?: string;
  quoted?: boolean;
  raw?: string;
  name?: string;
  children?: MarkdownTreeNode[];
}

interface MicromarkEffect {
  enter: (type: string) => unknown;
  exit: (type: string) => unknown;
  consume: (code: number | null) => void;
}

type MicromarkState = (code: number | null) => MicromarkState;

interface MicromarkConstruct {
  name: string;
  previous: (code: number | null) => boolean;
  tokenize: (effects: MicromarkEffect, ok: MicromarkState, nok: MicromarkState) => MicromarkState;
}

interface FromMarkdownState {
  enter: (node: MarkdownTreeNode, token: unknown) => void;
  exit: (token: unknown) => void;
  sliceSerialize: (token: unknown) => string;
}

const isSeparator = (code: number | null): boolean =>
  code === null || code < 0 || /\s/.test(String.fromCodePoint(code));

const QUOTE = 34;
const AT = 64;

function attachmentTokenConstruct(): MicromarkConstruct {
  return {
    name: "attachmentToken",
    previous: isSeparator,
    tokenize(effects, ok, nok) {
      let word = "";
      function start(code: number | null): MicromarkState {
        effects.enter("attachmentToken");
        effects.consume(code);
        return afterAt;
      }
      function afterAt(code: number | null): MicromarkState {
        if (code === QUOTE) {
          effects.consume(code);
          return inQuote;
        }
        if (isSeparator(code)) return nok(code);
        return plain(code);
      }
      function plain(code: number | null): MicromarkState {
        if (isSeparator(code) || code === QUOTE) {
          if (!looksLikePath(word)) return nok(code);
          effects.exit("attachmentToken");
          return ok(code);
        }
        word += String.fromCodePoint(code as number);
        effects.consume(code);
        return plain;
      }
      function inQuote(code: number | null): MicromarkState {
        if (code === null || code < 0) return nok(code);
        effects.consume(code);
        if (code === QUOTE) {
          effects.exit("attachmentToken");
          return ok;
        }
        return inQuote;
      }
      return start;
    },
  };
}

function pluginData(processor: unknown): Record<string, unknown> {
  return (processor as { data: () => Record<string, unknown> }).data();
}

export function remarkAttachmentTokens(this: unknown): void {
  const data = pluginData(this);
  const constructs = (data.micromarkExtensions ??= []) as Record<string, unknown>[];
  constructs.push({ text: { [AT]: attachmentTokenConstruct() } });
  const extensions = (data.fromMarkdownExtensions ??= []) as Record<string, unknown>[];
  extensions.push({
    enter: {
      attachmentToken(this: FromMarkdownState, token: unknown) {
        const raw = this.sliceSerialize(token);
        const quoted = raw.charCodeAt(1) === QUOTE;
        this.enter({ type: "attachmentToken", path: quoted ? raw.slice(2, -1) : raw.slice(1), quoted, raw }, token);
      },
    },
    exit: {
      attachmentToken(this: FromMarkdownState, token: unknown) {
        this.exit(token);
      },
    },
  });
}

export function remarkLeadingSkill(name: string) {
  return (tree: MarkdownTreeNode): void => {
    const chip: MarkdownTreeNode = { type: "skillToken", name, children: [] };
    const children = tree.children ?? [];
    const [first] = children;
    if (!first || first.type !== "paragraph") {
      tree.children = [{ type: "paragraph", children: [chip] }, ...children];
      return;
    }
    first.children = [chip, ...(first.children ?? [])];
  };
}
