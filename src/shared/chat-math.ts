import type { Extension } from "mdast-util-from-markdown";
import { mathFromMarkdown } from "mdast-util-math";
import { math as llmMath } from "micromark-extension-llm-math";
import { asciiDigit, markdownLineEnding, markdownSpace } from "micromark-util-character";
import type { Code, Effects, State, TokenizeContext } from "micromark-util-types";
import type { Processor } from "unified";

declare module "unified" {
  interface Data {
    micromarkExtensions?: unknown[];
    fromMarkdownExtensions?: unknown[];
  }
}

const DOLLAR = 36;
const BACKSLASH = 92;
const BACKTICK = 96;
const OPENING_BRACE = 123;
const CLOSING_BRACE = 125;

function tokenizeSingleDollarMath(effects: Effects, ok: State, nok: State): State {
  let previous: Code = null;
  let depth = 0;

  const openingDollar: State = (code) => {
    effects.enter("mathText");
    effects.enter("mathTextSequence");
    effects.consume(code);
    effects.exit("mathTextSequence");
    return contentStart;
  };

  const contentStart: State = (code) => {
    if (code === null || code === DOLLAR || code === BACKTICK || markdownSpace(code) || markdownLineEnding(code)) {
      return nok(code);
    }
    effects.enter("mathTextData");
    return content(code);
  };

  const escapedCharacter: State = (code) => {
    if (code === null || markdownLineEnding(code)) return nok(code);
    previous = code;
    effects.consume(code);
    return content;
  };

  const closingDollar: State = (code) => {
    if (code === DOLLAR || asciiDigit(code)) return nok(code);
    effects.exit("mathTextSequence");
    effects.exit("mathText");
    return ok(code);
  };

  const content: State = (code) => {
    if (code === null || code === BACKTICK || markdownLineEnding(code)) return nok(code);
    if (code === DOLLAR) {
      if (markdownSpace(previous) || depth !== 0) return nok(code);
      effects.exit("mathTextData");
      effects.enter("mathTextSequence");
      effects.consume(code);
      return closingDollar;
    }
    if (code === BACKSLASH) {
      effects.consume(code);
      return escapedCharacter;
    }
    if (code === OPENING_BRACE) depth += 1;
    if (code === CLOSING_BRACE) {
      if (depth === 0) return nok(code);
      depth -= 1;
    }
    previous = code;
    effects.consume(code);
    return content;
  };

  return openingDollar;
}

const singleDollarMath = {
  text: {
    [DOLLAR]: {
      name: "singleDollarMath",
      tokenize: tokenizeSingleDollarMath,
      previous(this: TokenizeContext, code: Code): boolean {
        return code !== DOLLAR || this.events.at(-1)?.[1].type === "characterEscape";
      },
    },
  },
};

const FENCES_OF_CLOSED_FLOW = 2;

const unclosedFlowMath = new WeakSet<object>();

function chatMathFromMarkdown(): Extension {
  const mathExtension = mathFromMarkdown();
  const exitMathFlow = mathExtension.exit?.mathFlow;
  let flowFences = 0;

  return {
    enter: {
      ...mathExtension.enter,
      mathFlowFence: () => {
        flowFences += 1;
      },
    },
    exit: {
      ...mathExtension.exit,
      mathFlow(token) {
        exitMathFlow?.call(this, token);
        const parent = this.stack.at(-1);
        const node = parent && "children" in parent ? parent.children.at(-1) : undefined;
        if (node?.type === "math" && flowFences < FENCES_OF_CLOSED_FLOW) unclosedFlowMath.add(node);
        flowFences = 0;
      },
    },
  };
}

export function remarkChatMath(this: Processor): void {
  const data = this.data();
  (data.micromarkExtensions ??= []).push(llmMath({ singleDollarTextMath: false }), singleDollarMath);
  (data.fromMarkdownExtensions ??= []).push(chatMathFromMarkdown());
}

interface MarkdownPosition {
  start: { offset?: number | null };
  end: { offset?: number | null };
}

interface MathTreeNode {
  type: string;
  value?: string;
  position?: MarkdownPosition;
  children?: MathTreeNode[];
}

export function remarkHoldUnclosedMath() {
  return (tree: MathTreeNode, file: { toString(): string }): void => {
    const source = String(file);
    const holdUnclosed = (parent: MathTreeNode): void => {
      if (!parent.children) return;
      for (const [index, node] of parent.children.entries()) {
        if (!unclosedFlowMath.has(node)) {
          holdUnclosed(node);
          continue;
        }
        const start = node.position?.start.offset;
        const end = node.position?.end.offset;
        if (typeof start !== "number" || typeof end !== "number") continue;
        parent.children[index] = { type: "paragraph", children: [{ type: "text", value: source.slice(start, end) }] };
      }
    };
    holdUnclosed(tree);
  };
}
