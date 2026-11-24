import type { QuoteInteractionProps } from "./quote-chip";

export function quoteScopeKey(entryId: string | undefined, quoteId: string): string {
  return entryId ? `${entryId}:${quoteId}` : quoteId;
}

export function messageQuoteInteraction(interaction: QuoteInteractionProps, entryId?: string): QuoteInteractionProps {
  if (!entryId) return interaction;
  const prefix = `${entryId}:`;
  const jump = interaction.onJumpQuote;
  return {
    onJumpQuote: jump && ((quote, anchor) => jump(quote, anchor, entryId)),
    jumpingQuoteKey: interaction.jumpingQuoteKey?.startsWith(prefix)
      ? interaction.jumpingQuoteKey.slice(prefix.length)
      : null,
    detachedQuoteKeys: new Set(
      Array.from(interaction.detachedQuoteKeys ?? [])
        .filter((key) => key.startsWith(prefix))
        .map((key) => key.slice(prefix.length)),
    ),
  };
}
