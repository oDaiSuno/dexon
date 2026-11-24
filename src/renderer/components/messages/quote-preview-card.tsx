import { useI18n } from "@/i18n";
import type { QuoteReference } from "@shared/quote-tokens";

export function QuotePreviewCard({ quote, detached = false }: { quote: QuoteReference; detached?: boolean }) {
  const { t } = useI18n();
  return (
    <div className="quote-preview-card">
      <div className="quote-preview-header type-label-medium">
        {quote.from === "assistant" ? t("quoteFromAssistant", "Dexon reply") : t("quoteFromUser", "Your message")}
      </div>
      <div className="quote-preview-text type-body-relaxed">{quote.text}</div>
      <div className="quote-preview-hint type-meta-default">
        {detached
          ? `${t("quoteDetachedSource", "Source message is not in this branch")} · ${t("quoteDetachedPreserved", "Full quote preserved")}`
          : t("quoteClickToJump", "Click to jump to source")}
      </div>
    </div>
  );
}
