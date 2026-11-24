import { FloatingQuotePreview } from "../messages/quote-preview";
import type { DetachedQuotePreview } from "./use-quote-jump";

const keepPinned = () => {};

export function QuoteJumpPreview({ preview, onClose }: { preview: DetachedQuotePreview | null; onClose: () => void }) {
  if (!preview) return null;
  return (
    <FloatingQuotePreview
      preview={{ quote: preview.quote, anchor: preview.anchorEl, detached: true, pinned: true }}
      onClose={onClose}
      onEnter={keepPinned}
      onLeave={keepPinned}
      dismissOnScroll
    />
  );
}
