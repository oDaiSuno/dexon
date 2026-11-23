import { quoteSnippet, type QuoteReference } from "@shared/quote-tokens";
import { useI18n } from "@/i18n";
import { QUOTE_CHIP_SVG } from "../chat-input/quote-glyph";
import { useQuotePreview } from "./quote-preview";

export { QuotePreviewCard } from "./quote-preview-card";

export interface QuoteInteractionProps {
  onJumpQuote?: (quote: QuoteReference, anchorEl?: HTMLElement, sourceMessageEntryId?: string) => void;
  jumpingQuoteKey?: string | null;
  detachedQuoteKeys?: ReadonlySet<string>;
}

export function QuoteChip({
  quote,
  detached = false,
  jumping = false,
  onJumpQuote,
}: {
  quote: QuoteReference;
  detached?: boolean;
  jumping?: boolean;
  onJumpQuote?: QuoteInteractionProps["onJumpQuote"];
}) {
  const { t } = useI18n();
  const preview = useQuotePreview();
  return (
    <>
      <button
        type="button"
        className={`quote-chip type-label-medium${detached ? " quote-chip-detached" : ""}${jumping ? " quote-chip-jumping" : ""}`}
        data-quote-ref={quote.id}
        aria-busy={jumping || undefined}
        aria-label={jumping ? t("quoteJumping", "Locating source…") : quoteSnippet(quote.text)}
        onMouseEnter={(event) => preview.hover(quote, event.currentTarget, detached)}
        onMouseLeave={preview.leave}
        onFocus={(event) => preview.hover(quote, event.currentTarget, detached)}
        onBlur={preview.leave}
        onClick={(event) => {
          if (detached && !onJumpQuote) preview.toggle(quote, event.currentTarget, true);
          else {
            preview.close();
            onJumpQuote?.(quote, event.currentTarget);
          }
        }}
      >
        <span className="quote-chip-glyph" dangerouslySetInnerHTML={{ __html: QUOTE_CHIP_SVG }} />
        <span className="token-chip-name">{quoteSnippet(quote.text)}</span>
        {jumping ? (
          <svg className="quote-chip-loader" width="11" height="11" viewBox="0 0 16 16" fill="none" aria-hidden="true">
            <path d="M14 8a6 6 0 1 1-6-6" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
          </svg>
        ) : !detached ? (
          <span className="quote-chip-arrow" aria-hidden="true">
            ↗
          </span>
        ) : null}
      </button>
      {preview.portal}
    </>
  );
}
