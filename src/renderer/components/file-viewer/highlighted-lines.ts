import { useEffect, useMemo, useState } from "react";
import { currentPrismTokenizer, loadPrismTokenizer, type PrismNode, type PrismTokenizer } from "@/lib/syntax-highlight";
import { normalizePrismLanguage } from "@/lib/syntax-highlight-data";

export interface CodeToken {
  className: string;
  text: string;
}

export type CodeLineTokens = CodeToken[];

function splitIntoLines(nodes: PrismNode[]): CodeLineTokens[] {
  const lines: CodeLineTokens[] = [[]];
  const walk = (node: PrismNode, classes: string[]) => {
    if (node.type === "text") {
      const parts = node.value.split("\n");
      parts.forEach((text, index) => {
        if (index > 0) lines.push([]);
        if (text) lines[lines.length - 1].push({ className: classes.join(" "), text });
      });
      return;
    }
    if (node.type !== "element") return;
    const nested = [...classes, ...(node.properties?.className ?? [])];
    for (const child of node.children) walk(child, nested);
  };
  for (const node of nodes) walk(node, []);
  return lines;
}

function plainLines(code: string): CodeLineTokens[] {
  return code.split("\n").map((text) => (text ? [{ className: "", text }] : []));
}

function tokenize(tokenizer: PrismTokenizer | null, code: string, language: string): CodeLineTokens[] {
  const prismLanguage = normalizePrismLanguage(language);
  if (!tokenizer || !prismLanguage || !tokenizer.registered(prismLanguage)) return plainLines(code);
  return splitIntoLines(tokenizer.highlight(code, prismLanguage).children);
}

function usePrismTokenizer(): PrismTokenizer | null {
  const [tokenizer, setTokenizer] = useState(currentPrismTokenizer);
  useEffect(() => {
    if (tokenizer) return;
    let active = true;
    void loadPrismTokenizer()
      .then((loaded) => {
        if (active) setTokenizer(() => loaded);
      })
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, [tokenizer]);
  return tokenizer;
}

export function useHighlightedLines(code: string, language: string, enabled = true): CodeLineTokens[] {
  const tokenizer = usePrismTokenizer();
  return useMemo(() => (enabled ? tokenize(tokenizer, code, language) : []), [code, enabled, language, tokenizer]);
}
