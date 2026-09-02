import { useMemo, useState } from "react";
import { MarkdownBody } from "../MarkdownBody";
import { scaledChatFont } from "@/lib/chat-appearance";
import { useCopyFeedback } from "@/hooks/useCopyFeedback";
import { parseCompactionSummary } from "@/lib/compaction-summary";
import { DeferredContentActions, formatTime, getMessageImages, getMessageText, imageSource, safeJson } from "./shared";
import type { CustomMessage } from "@/lib/types";

export function CompactionMessageView({ message }: { message: CustomMessage }) {
  const summary = getMessageText(message.content);
  const parsedSummary = useMemo(() => parseCompactionSummary(summary), [summary]);
  const [expanded, setExpanded] = useState(false);
  const time = formatTime(message.timestamp);

  return (
    <div style={{ marginBottom: 16 }}>
      <div
        style={{
          border: "1px solid var(--border)",
          borderRadius: 8,
          overflow: "hidden",
          background: "var(--bg)",
        }}
      >
        <button
          type="button"
          className="compaction-summary-toggle"
          aria-expanded={expanded}
          onClick={() => setExpanded((value) => !value)}
          title={expanded ? "Collapse compaction summary" : "Expand compaction summary"}
          style={{
            display: "flex",
            alignItems: "center",
            gap: 8,
            padding: "7px 10px",
            borderBottom: expanded ? "1px solid var(--border)" : "none",
            background: "var(--bg-panel)",
            color: "var(--text-muted)",
          }}
        >
          <svg
            width="12"
            height="12"
            viewBox="0 0 12 12"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.6"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
            style={{
              flexShrink: 0,
              transform: expanded ? "rotate(90deg)" : "none",
              transition: "transform 0.15s",
            }}
          >
            <polyline points="4 2.5 7.5 6 4 9.5" />
          </svg>
          <span style={{ fontFamily: "var(--font-mono)", fontSize: scaledChatFont(11), fontWeight: 650 }}>
            compaction
          </span>
          <span style={{ color: "var(--text)", fontSize: scaledChatFont(12), fontWeight: 600 }}>
            Conversation compacted
          </span>
          {time && (
            <span style={{ marginLeft: "auto", color: "var(--text-dim)", fontSize: scaledChatFont(10) }}>{time}</span>
          )}
        </button>

        {expanded && (
          <div style={{ padding: "11px 13px 12px" }}>
            <div style={{ marginBottom: 10, color: "var(--text)", fontSize: scaledChatFont(14), lineHeight: 1.5 }}>
              The conversation history before this point was compacted into the following summary:
            </div>
            {parsedSummary.body ? (
              <MarkdownBody className="markdown-compaction-message">{parsedSummary.body}</MarkdownBody>
            ) : (
              <span style={{ color: "var(--text-dim)", fontSize: scaledChatFont(12) }}>(no summary)</span>
            )}
            <CompactionFileMetadata readFiles={parsedSummary.readFiles} modifiedFiles={parsedSummary.modifiedFiles} />
          </div>
        )}
      </div>
    </div>
  );
}

function CompactionFileMetadata({ readFiles, modifiedFiles }: { readFiles: string[]; modifiedFiles: string[] }) {
  const total = readFiles.length + modifiedFiles.length;
  if (total === 0) return null;

  const parts = [];
  if (readFiles.length > 0) parts.push(`${readFiles.length} read`);
  if (modifiedFiles.length > 0) parts.push(`${modifiedFiles.length} modified`);

  return (
    <details className="compaction-file-details">
      <summary>File context: {parts.join(", ")}</summary>
      {modifiedFiles.length > 0 && <CompactionFileList title="Modified files" files={modifiedFiles} />}
      {readFiles.length > 0 && <CompactionFileList title="Read files" files={readFiles} />}
    </details>
  );
}

function CompactionFileList({ title, files }: { title: string; files: string[] }) {
  return (
    <div className="compaction-file-section">
      <div className="compaction-file-title">{title}</div>
      <ul className="compaction-file-list">
        {files.map((file) => (
          <li key={file}>{file}</li>
        ))}
      </ul>
    </div>
  );
}

export function CustomMessageView({
  message,
  cwd,
  onOpenFile,
  onLoadDeferredContent,
}: {
  message: CustomMessage;
  cwd?: string;
  onOpenFile?: (filePath: string) => void;
  onLoadDeferredContent?: (entryId: string, blockIndex?: number) => Promise<void>;
}) {
  const isHiddenDisplay = message.display === false;
  const [contentExpanded, setContentExpanded] = useState(!isHiddenDisplay);
  const [detailsExpanded, setDetailsExpanded] = useState(false);
  const { copied, copy } = useCopyFeedback();
  const text = getMessageText(message.content);
  const images = getMessageImages(message.content);
  const hasDetails = message.details !== undefined;
  const detailsText = hasDetails ? safeJson(message.details) : "";
  const title = formatCustomType(message.customType);
  const time = formatTime(message.timestamp);

  const copyContent = () => void copy(text || detailsText);

  return (
    <div style={{ marginBottom: 16 }}>
      <div
        style={{
          border: "1px solid var(--border)",
          borderRadius: 8,
          overflow: "hidden",
          background: isHiddenDisplay ? "var(--bg-subtle)" : "var(--bg)",
          opacity: isHiddenDisplay && !contentExpanded ? 0.82 : 1,
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 8,
            padding: "7px 10px",
            borderBottom: "1px solid var(--border)",
            background: "var(--bg-panel)",
            color: "var(--text-muted)",
            fontSize: scaledChatFont(12),
          }}
        >
          <span
            style={{
              color: "var(--text-muted)",
              fontFamily: "var(--font-mono)",
              fontSize: scaledChatFont(11),
              fontWeight: 650,
            }}
          >
            {title}
          </span>
          {isHiddenDisplay && (
            <span style={{ color: "var(--text-dim)", fontSize: scaledChatFont(11) }}>hidden extension message</span>
          )}
          {time && (
            <span style={{ marginLeft: "auto", color: "var(--text-dim)", fontSize: scaledChatFont(10) }}>{time}</span>
          )}
        </div>

        {contentExpanded ? (
          <div style={{ padding: "6px 9px" }}>
            {images.length > 0 && (
              <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: text ? 8 : 0 }}>
                {images.map((img, i) => {
                  const src = imageSource(img);
                  if (!src) return null;
                  return (
                    <img
                      key={i}
                      src={src}
                      alt=""
                      style={{
                        maxWidth: 240,
                        maxHeight: 240,
                        borderRadius: 6,
                        objectFit: "contain",
                        display: "block",
                        border: "1px solid var(--border)",
                      }}
                    />
                  );
                })}
              </div>
            )}
            {text ? (
              <MarkdownBody className="markdown-custom-message" cwd={cwd} onOpenFile={onOpenFile}>
                {text}
              </MarkdownBody>
            ) : (
              <span style={{ color: "var(--text-dim)", fontSize: scaledChatFont(12) }}>(no message)</span>
            )}
            <DeferredContentActions content={message.content} onLoad={onLoadDeferredContent} />
          </div>
        ) : (
          <button
            onClick={() => setContentExpanded(true)}
            style={{
              display: "block",
              width: "100%",
              padding: "8px 10px",
              border: "none",
              background: "transparent",
              color: "var(--text-dim)",
              cursor: "pointer",
              fontSize: scaledChatFont(12),
              textAlign: "left",
            }}
          >
            {text ? previewText(text) : "Show extension message"}
          </button>
        )}

        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 8,
            padding: "4px 9px",
            borderTop: "1px solid var(--border)",
            background: "var(--bg-subtle)",
          }}
        >
          {text || detailsText ? (
            <button
              onClick={copyContent}
              style={{
                padding: "3px 7px",
                border: "none",
                background: "none",
                color: copied ? "var(--accent)" : "var(--text-dim)",
                cursor: "pointer",
                fontSize: scaledChatFont(11),
              }}
            >
              {copied ? "Copied" : "Copy"}
            </button>
          ) : null}
          {(hasDetails || isHiddenDisplay) && (
            <button
              onClick={() => {
                if (isHiddenDisplay) setContentExpanded((v) => !v);
                else setDetailsExpanded((v) => !v);
              }}
              style={{
                marginLeft: "auto",
                padding: "3px 7px",
                border: "none",
                background: "none",
                color: "var(--text-dim)",
                cursor: "pointer",
                fontSize: scaledChatFont(11),
              }}
            >
              {isHiddenDisplay
                ? contentExpanded
                  ? "Collapse"
                  : "Expand"
                : detailsExpanded
                  ? "Hide details"
                  : "Show details"}
            </button>
          )}
        </div>

        {hasDetails && ((isHiddenDisplay && contentExpanded) || (!isHiddenDisplay && detailsExpanded)) && (
          <pre
            style={{
              margin: 0,
              padding: "9px 10px",
              borderTop: "1px solid var(--border)",
              background: "var(--bg)",
              color: "var(--text-muted)",
              fontSize: scaledChatFont(12),
              lineHeight: 1.5,
              whiteSpace: "pre-wrap",
              wordBreak: "break-word",
              maxHeight: 360,
              overflow: "auto",
              fontFamily: "var(--font-mono)",
            }}
          >
            {detailsText}
          </pre>
        )}
      </div>
    </div>
  );
}

function formatCustomType(type: string): string {
  return type || "extension";
}

function previewText(text: string): string {
  const normalized = text.replace(/\s+/g, " ").trim();
  if (!normalized) return "Show extension message";
  return normalized.length > 140 ? `${normalized.slice(0, 140)}...` : normalized;
}
