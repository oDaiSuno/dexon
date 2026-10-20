import { useEffect, useMemo, useState } from "react";
import { MarkdownBody, type InlineChips } from "../MarkdownBody";
import { scaledChatFont } from "@/lib/chat-appearance";
import { useCopyFeedback } from "@/hooks/useCopyFeedback";
import { findAttachmentTokens, isImagePath } from "@shared/attachment-tokens";
import { parseExpandedSkillMessage, splitLeadingSkillCommand } from "@shared/skill-commands";
import { loadAttachmentPreview } from "@/lib/attachment-token-previews";
import { AttachmentChip, SkillChip } from "./message-chips";
import { SessionSourceChip } from "./session-links";
import { getUserBubbleStyle } from "@/lib/channel-message-style";
import { CHANNEL_ATTACHMENT_PROMPT_PLACEHOLDER, channelAttachmentCopyText } from "@shared/channel-message";
import { useI18n } from "@/i18n";
import { useTheme } from "@/hooks/useTheme";
import { DeferredContentActions, formatTime } from "./shared";
import type { ImageContent, TextContent, UserMessage } from "@/lib/types";

export function UserMessageView({
  message,
  cwd,
  sessionId,
  onOpenFile,
  onNavigate,
  prevAssistantEntryId,
  onEditContent,
  onLoadDeferredContent,
  afterAssistant,
}: {
  message: UserMessage;
  /** Active session id — authorizes files.read for referenced attachment paths. */
  sessionId?: string | null;
  /* Turn-boundary spacing: when the previous message is an assistant reply,
     lift the bubble so it sits centered between the two replies (the hover
     action row below already reserves the same visual gap). */
  afterAssistant?: boolean;
  cwd?: string;
  onOpenFile?: (filePath: string) => void;
  onNavigate?: (entryId: string) => void;
  prevAssistantEntryId?: string;
  onEditContent?: (content: string) => void;
  onLoadDeferredContent?: (entryId: string, blockIndex?: number) => Promise<void>;
}) {
  const { t } = useI18n();
  const { isDark } = useTheme();
  const [hovered, setHovered] = useState(false);
  const { copied, copy } = useCopyFeedback();

  const content =
    typeof message.content === "string"
      ? message.content
      : message.content
          .filter((b): b is TextContent => b.type === "text")
          .map((b) => b.text)
          .join("\n");

  const imageBlocks: ImageContent[] =
    typeof message.content === "string"
      ? []
      : message.content.filter((b): b is ImageContent => b.type === "image" && !b.deferredContent);

  const isChannelAttachmentPlaceholder = !!message.channelSource && content === CHANNEL_ATTACHMENT_PROMPT_PLACEHOLDER;
  const attachmentCopyContent = isChannelAttachmentPlaceholder
    ? channelAttachmentCopyText(message.channelAttachments, imageBlocks)
    : "";
  const visibleContent = isChannelAttachmentPlaceholder
    ? imageBlocks.length > 0
      ? ""
      : attachmentCopyContent || t("channelAttachment", "Attachment")
    : content;
  const copyableContent = isChannelAttachmentPlaceholder ? attachmentCopyContent : visibleContent;

  // Pi rewrites a leading `/skill:name` into an expanded <skill> block before
  // storing or echoing the message, so accept both shapes (history reloads too).
  const leadingSkill = splitLeadingSkillCommand(visibleContent) ?? parseExpandedSkillMessage(visibleContent);
  const prose = leadingSkill ? leadingSkill.rest.replace(/^\s/, "") : visibleContent;
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

  const time = formatTime(message.timestamp);
  const messageSource = message.channelSource ?? "local";
  const bubbleStyle = getUserBubbleStyle(message.channelSource, isDark);
  const canNavigate = !!prevAssistantEntryId && !!onNavigate;
  const leadingSkillName = leadingSkill?.name ?? null;
  const inlineChips = useMemo<InlineChips>(
    () => ({
      leadingSkill: leadingSkillName,
      attachment: ({ path }) => <AttachmentChip path={path} cwd={cwd} previewUrl={tokenPreviews.get(path) ?? null} />,
      skill: (name) => <SkillChip name={name} />,
    }),
    [cwd, leadingSkillName, tokenPreviews],
  );

  const copyContent = () => void copy(copyableContent);

  return (
    <div
      style={{
        marginTop: afterAssistant ? 42 : 0,
        marginBottom: 14,
        display: "flex",
        flexDirection: "column",
        alignItems: "flex-end",
      }}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
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
          data-message-source={messageSource}
          style={{
            minWidth: 0,
            maxWidth: "100%",
            background: bubbleStyle.background,
            borderRadius: "12px 12px 4px 12px",
            padding: "8px 13px",
            fontSize: scaledChatFont(13),
            lineHeight: 1.55,
            color: bubbleStyle.foreground,
            wordBreak: "break-word",
            boxShadow: messageSource === "local" ? "var(--bui-shadow-btn)" : "none",
          }}
        >
          {message.sessionSource && (
            <div style={{ display: "flex", marginBottom: 2 }}>
              <SessionSourceChip source={message.sessionSource} />
            </div>
          )}
          {imageBlocks.length > 0 && (
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: visibleContent ? 8 : 0 }}>
              {imageBlocks.map((img, i) => {
                // lib/types.ts ImageContent uses {source:{type,data,media_type,url}}
                // pi-ai on-disk format uses flat {data, mimeType} — handle both
                const flat = img as unknown as { data?: string; mimeType?: string };
                const src = img.source
                  ? img.source.type === "base64"
                    ? `data:${img.source.media_type};base64,${img.source.data}`
                    : (img.source.url ?? "")
                  : flat.data
                    ? `data:${flat.mimeType};base64,${flat.data}`
                    : "";
                return (
                  <img
                    key={i}
                    src={src}
                    alt=""
                    style={{
                      maxWidth: 240,
                      maxHeight: 240,
                      borderRadius: "var(--radius-control)",
                      objectFit: "contain",
                      display: "block",
                      border: `1px solid color-mix(in srgb, ${bubbleStyle.foreground} 18%, transparent)`,
                    }}
                  />
                );
              })}
            </div>
          )}
          {(prose.trim() || leadingSkill) && (
            <MarkdownBody className="markdown-user-message" cwd={cwd} onOpenFile={onOpenFile} inlineChips={inlineChips}>
              {prose}
            </MarkdownBody>
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
                    border: `1px solid color-mix(in srgb, ${bubbleStyle.foreground} 18%, transparent)`,
                  }}
                />
              ))}
            </div>
          )}
          <DeferredContentActions content={message.content} onLoad={onLoadDeferredContent} />
        </div>
      </div>

      {/* Bottom row: action buttons + timestamp */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "flex-end",
          gap: 4,
          marginTop: 4,
        }}
      >
        <div
          className="message-hover-actions"
          style={{
            display: "flex",
            gap: 2,
            opacity: hovered ? 1 : 0,
            pointerEvents: hovered ? "auto" : "none",
            transition: "opacity var(--duration-quick) var(--ease-out)",
          }}
        >
          <button
            type="button"
            onClick={copyContent}
            disabled={!copyableContent}
            title={copyableContent ? "Copy message" : "Nothing to copy"}
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              width: 24,
              height: 24,
              background: "none",
              border: "none",
              borderRadius: "var(--bui-r-chip)",
              color: copied ? "var(--bui-green)" : "var(--bui-ink-3)",
              cursor: copyableContent ? "pointer" : "not-allowed",
              opacity: copyableContent ? 1 : 0.55,
              transition: "color var(--duration-quick) var(--ease-out)",
            }}
            onMouseEnter={(e) => {
              if (!copied) e.currentTarget.style.color = "var(--bui-ink-2)";
            }}
            onMouseLeave={(e) => {
              if (!copied) e.currentTarget.style.color = "var(--bui-ink-3)";
            }}
          >
            {copied ? (
              <svg
                width="13"
                height="13"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="3"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path d="M20 6L9 17l-5-5" />
              </svg>
            ) : (
              <svg
                width="15"
                height="15"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.8"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <rect x="9" y="9" width="12" height="12" rx="2.5" />
                <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
              </svg>
            )}
          </button>
        </div>
        {canNavigate && (
          <div
            className="message-hover-actions"
            style={{
              display: "flex",
              gap: 3,
              opacity: hovered ? 1 : 0,
              pointerEvents: hovered ? "auto" : "none",
              transition: "opacity var(--duration-quick) var(--ease-out)",
            }}
          >
            <button
              type="button"
              onClick={() => {
                onNavigate!(prevAssistantEntryId!);
                onEditContent?.(content);
              }}
              title="Edit from here — branches within this session"
              style={{
                display: "flex",
                alignItems: "center",
                gap: 4,
                padding: "2px 7px",
                height: 24,
                background: "none",
                border: "none",
                borderRadius: "var(--bui-r-chip)",
                color: "var(--bui-ink-3)",
                cursor: "pointer",
                fontSize: scaledChatFont(11),
                fontWeight: 400,
                whiteSpace: "nowrap",
                transition: "color var(--duration-quick) var(--ease-out)",
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.color = "var(--bui-accent)";
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.color = "var(--bui-ink-3)";
              }}
            >
              <svg
                width="12"
                height="12"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.8"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <polyline points="15 10 20 15 15 20" />
                <path d="M4 4v7a4 4 0 0 0 4 4h12" />
              </svg>
              Edit from here
            </button>
          </div>
        )}
        {time && (
          <span
            style={{
              fontSize: scaledChatFont(11),
              color: "var(--bui-ink-3)",
              fontFamily: "var(--font-mono)",
              opacity: hovered ? 1 : 0,
              transition: "opacity var(--duration-quick) var(--ease-out)",
            }}
          >
            {time}
          </span>
        )}
      </div>
    </div>
  );
}
