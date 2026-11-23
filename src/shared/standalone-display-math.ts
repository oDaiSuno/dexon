interface MarkdownNode {
  type: string;
  value?: string;
  meta?: string | null;
  children?: MarkdownNode[];
  position?: {
    start: { offset?: number | null };
    end: { offset?: number | null };
  };
  data?: Record<string, unknown>;
}

function hasDisplayDelimiters(node: MarkdownNode, source: string): boolean {
  const start = node.position?.start.offset;
  const end = node.position?.end.offset;
  if (typeof start !== "number" || typeof end !== "number") return false;
  const raw = source.slice(start, end);
  const opening = raw.match(/^\${2,}/)?.[0];
  return opening !== undefined && raw.match(/\$+$/)?.[0] === opening;
}

function isLineBoundary(node: MarkdownNode | undefined, edge: "start" | "end"): boolean {
  if (!node || node.type === "break") return true;
  if (node.type !== "text") return false;
  return edge === "start"
    ? /(?:\r\n|\r|\n)[ \t]*$/.test(node.value ?? "")
    : /^[ \t]*(?:\r\n|\r|\n)/.test(node.value ?? "");
}

function trimBoundary(children: MarkdownNode[], edge: "start" | "end"): void {
  const index = edge === "start" ? 0 : children.length - 1;
  const node = children[index];
  if (!node) return;
  if (node.type === "break") {
    children.splice(index, 1);
  } else if (node.type === "text") {
    const value = (node.value ?? "").replace(
      edge === "start" ? /^[ \t]*(?:\r\n|\r|\n)[ \t]*/ : /[ \t]*(?:\r\n|\r|\n)[ \t]*$/,
      "",
    );
    if (value) children[index] = { ...node, value };
    else children.splice(index, 1);
  }
}

function displayMath(node: MarkdownNode): MarkdownNode {
  const value = node.value ?? "";
  return {
    type: "math",
    meta: null,
    value,
    position: node.position,
    data: {
      hName: "pre",
      hChildren: [
        {
          type: "element",
          tagName: "code",
          properties: { className: ["language-math", "math-display"] },
          children: [{ type: "text", value }],
        },
      ],
    },
  };
}

function splitParagraph(paragraph: MarkdownNode, source: string): MarkdownNode[] {
  const children = paragraph.children ?? [];
  const result: MarkdownNode[] = [];
  let segmentStart = 0;

  const appendParagraph = (end: number, beforeMath: boolean): void => {
    const segment = children.slice(segmentStart, end);
    if (segmentStart > 0) trimBoundary(segment, "start");
    if (beforeMath) trimBoundary(segment, "end");
    if (segment.some((node) => node.type !== "text" || node.value?.trim())) {
      result.push({ ...paragraph, children: segment });
    }
  };

  for (const [index, node] of children.entries()) {
    if (
      node.type !== "inlineMath" ||
      !node.value?.trim() ||
      !hasDisplayDelimiters(node, source) ||
      !isLineBoundary(children[index - 1], "start") ||
      !isLineBoundary(children[index + 1], "end")
    ) {
      continue;
    }
    appendParagraph(index, true);
    result.push(displayMath(node));
    segmentStart = index + 1;
  }

  if (segmentStart === 0) return [paragraph];
  appendParagraph(children.length, false);
  return result;
}

export function remarkStandaloneDisplayMath() {
  return (tree: MarkdownNode, file?: { toString(): string }): void => {
    const source = file ? String(file) : "";
    if (!source) return;

    const transform = (parent: MarkdownNode): void => {
      if (!parent.children) return;
      parent.children = parent.children.flatMap((node) => {
        if (node.type === "paragraph") return splitParagraph(node, source);
        transform(node);
        return [node];
      });
    };
    transform(tree);
  };
}
