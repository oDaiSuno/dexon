import { useState } from "react";
import { splitLeadingSkillCommand, parseExpandedSkillMessage, skillCommandText } from "@shared/skill-commands";
import { getUserBubbleStyle } from "@/lib/channel-message-style";
import { CHANNEL_ATTACHMENT_PROMPT_PLACEHOLDER, channelAttachmentCopyText } from "@shared/channel-message";
import { useI18n } from "@/i18n";
import { useTheme } from "@/hooks/useTheme";
import { formatTime } from "./shared";
import { UserMessageBubble } from "./user-message-bubble";
import { UserMessageEditor, type EditDraft, type EditDraftHandlers } from "./user-message-editor";
import { UserMessageFooter } from "./user-message-footer";
import type { ImageContent, TextContent, UserMessage } from "@/lib/types";

export function UserMessageView({
  message,
  cwd,
  sessionId,
  entryId,
  onOpenFile,
  editDraft,
  editHandlers,
  onSwitchVersion,
  agentRunning,
  onLoadDeferredContent,
  afterAssistant,
}: {
  message: UserMessage;
  /** Active session id — authorizes files.read for referenced attachment paths. */
  sessionId?: string | null;
  cwd?: string;
  entryId?: string;
  onOpenFile?: (filePath: string) => void;
  editDraft?: EditDraft | null;
  editHandlers?: EditDraftHandlers;
  onSwitchVersion?: (entryId: string) => void;
  agentRunning?: boolean;
  /* Turn-boundary spacing: when the previous message is an assistant reply,
     lift the bubble so it sits centered between the two replies (the hover
     action row below already reserves the same visual gap). */
  afterAssistant?: boolean;
  onLoadDeferredContent?: (entryId: string, blockIndex?: number) => Promise<void>;
}) {
  const { t } = useI18n();
  const { isDark } = useTheme();
  const [hovered, setHovered] = useState(false);

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
  const leadingSkillName = leadingSkill?.name ?? null;
  const draftText = leadingSkill
    ? [skillCommandText(leadingSkill.name), leadingSkill.rest.replace(/^\s+/, "")].filter(Boolean).join(" ")
    : visibleContent;

  const hasDeferredContent =
    Array.isArray(message.content) &&
    message.content.some((block) => Boolean((block as { deferredContent?: unknown }).deferredContent));
  const bubbleStyle = getUserBubbleStyle(message.channelSource, isDark);
  const canEdit =
    !agentRunning &&
    !message.channelSource &&
    !message.sessionSource &&
    !!entryId &&
    !!editHandlers &&
    !hasDeferredContent;
  const canSwitchVersion = !agentRunning && !!onSwitchVersion;
  const editing = !!editDraft && !!entryId && editDraft.entryId === entryId;

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
      {editing ? (
        <UserMessageEditor
          text={editDraft.text}
          images={editDraft.images}
          bubbleStyle={bubbleStyle}
          onChange={(text) => editHandlers?.change(text)}
          onRemoveImage={(index) => editHandlers?.removeImage(index)}
          onCancel={() => editHandlers?.cancel()}
          onSend={() => editHandlers?.send()}
        />
      ) : (
        <>
          <UserMessageBubble
            message={message}
            sessionId={sessionId}
            cwd={cwd}
            onOpenFile={onOpenFile}
            onLoadDeferredContent={onLoadDeferredContent}
            bubbleStyle={bubbleStyle}
            prose={prose}
            leadingSkillName={leadingSkillName}
            imageBlocks={imageBlocks}
          />
          <UserMessageFooter
            hovered={hovered}
            time={formatTime(message.timestamp)}
            running={!!agentRunning}
            copyableContent={copyableContent}
            versions={message.versions}
            canEdit={canEdit}
            onEdit={() => editHandlers?.start(entryId!, draftText, imageBlocks)}
            onSwitchVersion={(versionEntryId) => {
              if (canSwitchVersion) onSwitchVersion?.(versionEntryId);
            }}
          />
        </>
      )}
    </div>
  );
}
