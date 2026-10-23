/**
 * Shared Prism highlighter that keeps the full language compatibility of the
 * original `Prism` export while moving refractor/all into an async chunk.
 */
import { createElement, type ComponentProps } from "react";
import { PrismAsync } from "react-syntax-highlighter";

import { normalizePrismLanguage } from "./syntax-highlight-data";

export type PrismNode =
  | { type: "text"; value: string }
  | { type: "element"; properties?: { className?: string[] }; children: PrismNode[] }
  | { type: "comment" | "doctype"; value?: string };

export interface PrismTokenizer {
  highlight(code: string, language: string): { children: PrismNode[] };
  registered(language: string): boolean;
}

type SyntaxHighlighterProps = ComponentProps<typeof PrismAsync>;
type AsyncPrismHighlighter = typeof PrismAsync & { preload(): Promise<unknown>; astGenerator: PrismTokenizer | null };

const asyncPrism = PrismAsync as AsyncPrismHighlighter;
let tokenizerLoad: Promise<PrismTokenizer> | null = null;

function SyntaxHighlighter({ language, ...props }: SyntaxHighlighterProps) {
  return createElement(PrismAsync, { useInlineStyles: false, ...props, language: normalizePrismLanguage(language) });
}

/** Exposed for the real-module SSR test; the app loads this automatically on mount. */
export function preloadSyntaxHighlighter(): Promise<unknown> {
  return asyncPrism.preload();
}

export function currentPrismTokenizer(): PrismTokenizer | null {
  return asyncPrism.astGenerator;
}

export function loadPrismTokenizer(): Promise<PrismTokenizer> {
  const loaded = currentPrismTokenizer();
  if (loaded) return Promise.resolve(loaded);
  tokenizerLoad ??= asyncPrism.preload().then(() => asyncPrism.astGenerator!);
  return tokenizerLoad;
}

export { SyntaxHighlighter };
