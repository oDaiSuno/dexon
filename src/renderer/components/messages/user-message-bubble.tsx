import { useEffect, useMemo, useState } from "react";
import { MarkdownBody, type InlineChips } from "../MarkdownBody";
import { findAttachmentTokens, isImagePath } from "@shared/attachment-tokens";
import { loadAttachmentPreview } from "@/lib/attachment-token-previews";
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
  message,
  sessionId,
  cwd,
  onOpenFile,
  onLoadDeferredContent,
  bubbleStyle,
  prose,
  leadingSkillName,
  imageBlocks,
}: {
  message: UserMessage;
  sessionId?: string | null;
  cwd?: string;
  onOpenFile?: (filePath: string) => void;
  onLoadDeferredContent?: (entryId: string, blockIndex?: number) => Promise<void>;
  bubbleStyle: { background: string; foreground: string };
  prose: string;
  leadingSkillName: string | null;
  imageBlocks: ImageContent[];
}) {
  const tokenImagePaths = useMemo(
    () =>
      findAttachmentTokens(prose)
        .map((token) => token.path)
        .filter(isImagePath),
    [prose],
  );
  const [tokenPreviews, setTokenPreviews] = useState<Map<string, string | null>>(new Map());
  const imageTokenPreviews = tokenImagePaths
    .map((path) => ({ path, url: tokenPreviews.get(path) }))
    .filter((entry): entry is { path: string; url: string } => typeof entry.url === "string" && entry.url.length > 0);

  useEffect(() => {
    if (tokenImagePaths.length === 0) return;
    let cancelled = false;
    tokenImagePaths.forEach((path) => {
      if (tokenPreviews.has(path)) return;
      void loadAttachmentPreview(path, sessionId ?? undefined).then((url) => {
        if (cancelled) return;
        setTokenPreviews((prev) => {
          const next = new Map(prev);
          next.set(path, url);
          return next;
        });
      });
    });
    return () => {
      cancelled = true;
    };
  }, [sessionId, tokenImagePaths, tokenPreviews]);

  const inlineChips = useMemo<InlineChips>(
    () => ({
      leadingSkill: leadingSkillName,
      attachment: ({ path }) => <AttachmentChip path={path} cwd={cwd} previewUrl={tokenPreviews.get(path) ?? null} />,
      skill: (name) => <SkillChip name={name} />,
    }),
    [cwd, leadingSkillName, tokenPreviews],
  );

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
        {(prose.trim() || leadingSkillName) && (
          <LongPromptFold>
            <MarkdownBody className="markdown-user-message" cwd={cwd} onOpenFile={onOpenFile} inlineChips={inlineChips}>
              {prose}
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
