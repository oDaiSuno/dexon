import { qualifyProjectKey, type EnvironmentId } from "@contract/environment";
import { useEffect, useMemo, useState } from "react";
import { MarkdownBody, type InlineChips } from "../MarkdownBody";
import { findAttachmentTokens, isImagePath } from "@shared/attachment-tokens";
import { loadAttachmentPreview } from "@/lib/attachment-token-previews";
import { parseQuotedPrompt } from "@shared/quote-tokens";
import { QuoteChip, type QuoteInteractionProps } from "./quote-chip";
import { AttachmentChip, SkillChip } from "./message-chips";
import { LongPromptFold } from "./long-prompt-fold";
import { SessionSourceChip } from "./session-links";
import { DeferredContentActions } from "./shared";
import type { ImageContent, UserMessage } from "@/lib/types";

function imageSourceOf(block: ImageContent): string {
  if (block.source) {
    return block.source.type === "base64"
      ? `data:${block.source.media_type};base64,${block.source.data}`
      : (block.source.url ?? "");
  }
  const flat = block as unknown as { data?: string; mimeType?: string };
  return flat.data ? `data:${flat.mimeType};base64,${flat.data}` : "";
}

export function UserMessageBubble({
  environmentId,
  message,
  sessionId,
  cwd,
  onOpenFile,
  onLoadDeferredContent,
  bubbleStyle,
  prose,
  leadingSkillName,
  imageBlocks,
  onJumpQuote,
  jumpingQuoteKey,
  detachedQuoteKeys,
}: QuoteInteractionProps & {
  environmentId: EnvironmentId;
  message: UserMessage;
  sessionId?: string | null;
  cwd?: string;
  onOpenFile?: (filePath: string, environmentId?: EnvironmentId) => void;
  onLoadDeferredContent?: (entryId: string, blockIndex?: number) => Promise<void>;
  bubbleStyle: { background: string; foreground: string };
  prose: string;
  leadingSkillName: string | null;
  imageBlocks: ImageContent[];
}) {
  const { quotes, body } = useMemo(() => parseQuotedPrompt(prose), [prose]);
  const quotesById = useMemo(() => new Map(quotes.map((quote) => [quote.id, quote])), [quotes]);
  const unreferencedQuotes = quotes.filter((quote) => !body.includes(`[quote:${quote.id}]`));
  const renderQuote = (quoteId: string, raw: string) => {
    const quote = quotesById.get(quoteId);
    return quote ? (
      <QuoteChip
        quote={quote}
        onJumpQuote={onJumpQuote}
        jumping={jumpingQuoteKey === quote.id}
        detached={detachedQuoteKeys?.has(quote.id)}
      />
    ) : (
      raw
    );
  };
  const tokenImagePaths = useMemo(
    () =>
      findAttachmentTokens(body)
        .map((token) => token.path)
        .filter(isImagePath),
    [body],
  );
  const [tokenPreviews, setTokenPreviews] = useState<Map<string, string | null>>(new Map());
  const imageTokenPreviews = tokenImagePaths
    .map((path) => ({ path, url: tokenPreviews.get(qualifyProjectKey(environmentId, path)) }))
    .filter((entry): entry is { path: string; url: string } => typeof entry.url === "string" && entry.url.length > 0);

  useEffect(() => {
    if (tokenImagePaths.length === 0) return;
    let cancelled = false;
    tokenImagePaths.forEach((path) => {
      if (tokenPreviews.has(qualifyProjectKey(environmentId, path))) return;
      void loadAttachmentPreview(path, sessionId ?? undefined, environmentId).then((url) => {
        if (cancelled) return;
        setTokenPreviews((prev) => {
          const next = new Map(prev);
          next.set(qualifyProjectKey(environmentId, path), url);
          return next;
        });
      });
    });
    return () => {
      cancelled = true;
    };
  }, [environmentId, sessionId, tokenImagePaths, tokenPreviews]);

  const inlineChips: InlineChips = {
    leadingSkill: leadingSkillName,
    attachment: ({ path }) => (
      <AttachmentChip
        environmentId={environmentId}
        path={path}
        onOpenFile={onOpenFile}
        cwd={cwd}
        previewUrl={tokenPreviews.get(qualifyProjectKey(environmentId, path)) ?? null}
      />
    ),
    skill: (name) => <SkillChip name={name} />,
    quote: ({ quoteId, raw }) => renderQuote(quoteId, raw),
  };

  return (
    <div
      style={{
        display: "flex",
        alignItems: "flex-end",
        gap: 6,
        maxWidth: "68ch",
        width: "100%",
        justifyContent: "flex-end",
      }}
    >
      <div
        data-message-source={message.channelSource ?? "local"}
        className="chat-reading type-chat-body"
        style={{
          minWidth: 0,
          maxWidth: "100%",
          background: bubbleStyle.background,
          border: message.channelSource ? "none" : "1px solid var(--fx-line-default)",
          borderRadius: "var(--radius-composer)",
          padding: "var(--space-3) var(--space-4)",
          color: bubbleStyle.foreground,
          wordBreak: "break-word",
        }}
      >
        {message.sessionSource && (
          <div style={{ display: "flex", marginBottom: 2 }}>
            <SessionSourceChip source={message.sessionSource} />
          </div>
        )}
        {imageBlocks.length > 0 && (
          <div
            style={{
              display: "flex",
              gap: 6,
              flexWrap: "wrap",
              marginBottom: prose.trim() || leadingSkillName ? 8 : 0,
            }}
          >
            {imageBlocks.map((img, i) => (
              <img
                key={i}
                src={imageSourceOf(img)}
                alt=""
                style={{
                  maxWidth: 240,
                  maxHeight: 240,
                  borderRadius: "var(--radius-control)",
                  objectFit: "contain",
                  display: "block",
                  border: "1px solid var(--fx-line-translucent)",
                }}
              />
            ))}
          </div>
        )}
        {unreferencedQuotes.map((quote) => (
          <span key={quote.id}>{renderQuote(quote.id, "")} </span>
        ))}
        {(body.trim() || leadingSkillName) && (
          <LongPromptFold>
            <MarkdownBody
              environmentId={environmentId}
              sourceSessionId={sessionId}
              className="markdown-user-message"
              cwd={cwd}
              onOpenFile={onOpenFile}
              inlineChips={inlineChips}
            >
              {body}
            </MarkdownBody>
          </LongPromptFold>
        )}
        {imageTokenPreviews.length > 0 && (
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: 8 }}>
            {imageTokenPreviews.map(({ path, url }) => (
              <img
                key={path}
                src={url}
                alt=""
                style={{
                  maxWidth: 240,
                  maxHeight: 240,
                  borderRadius: "var(--radius-control)",
                  objectFit: "contain",
                  display: "block",
                  border: "1px solid var(--fx-line-translucent)",
                }}
              />
            ))}
          </div>
        )}
        <DeferredContentActions content={message.content} onLoad={onLoadDeferredContent} />
      </div>
    </div>
  );
}
