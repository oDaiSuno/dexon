import { SyntaxHighlighter, vs, vscDarkPlus } from "@/lib/syntax-highlight";
import { getParentFilePath } from "@/lib/file-paths";
import type { TextFileData } from "@/lib/file-viewer-load-state";
import { MarkdownBody } from "../MarkdownBody";
import { DiffView } from "./diff-view";
import { HtmlPreview } from "./html-preview";
import type { TextViewMode } from "./use-text-file";

export interface TextFileContentProps {
  filePath: string;
  cwd?: string;
  sourceSessionId?: string | null;
  data: TextFileData;
  prevContent: string | null;
  hasDiff: boolean;
  viewMode: TextViewMode;
  previewMode: boolean;
  wrapLines: boolean;
  isDark: boolean;
}

export function TextFileContent({
  filePath,
  cwd,
  sourceSessionId,
  data,
  prevContent,
  hasDiff,
  viewMode,
  previewMode,
  wrapLines,
  isDark,
}: TextFileContentProps) {
  const isHtml = data.language === "html";
  const isMarkdown = data.language === "markdown";

  return (
    <div style={{ flex: 1, minHeight: 0, overflow: "auto", background: "var(--fx-surface-main)" }}>
      {viewMode === "diff" && hasDiff ? (
        <DiffView oldContent={prevContent!} newContent={data.content} />
      ) : isHtml && previewMode ? (
        <HtmlPreview content={data.content} filePath={filePath} sourceSessionId={sourceSessionId} />
      ) : isMarkdown && previewMode ? (
        <div className="markdown-body markdown-file-preview" style={{ padding: "24px 32px", maxWidth: 800 }}>
          <MarkdownBody cwd={cwd} imageBasePath={getParentFilePath(filePath)} sourceSessionId={sourceSessionId}>
            {data.content}
          </MarkdownBody>
        </div>
      ) : (
        <SyntaxHighlighter
          language={data.language === "text" ? "plaintext" : data.language}
          style={isDark ? vscDarkPlus : vs}
          showLineNumbers
          lineNumberStyle={{
            color: "var(--fx-text-tertiary)",
            fontStyle: "normal",
            minWidth: "3em",
            paddingRight: "1em",
          }}
          customStyle={{
            margin: 0,
            padding: "12px 0",
            background: "var(--fx-surface-main)",
            fontSize: "var(--text-body)",
            lineHeight: 1.6,
            fontFamily: "var(--font-mono)",
            minHeight: "100%",
          }}
          codeTagProps={{ style: { fontFamily: "var(--font-mono)" } }}
          wrapLongLines={wrapLines}
        >
          {data.content}
        </SyntaxHighlighter>
      )}
    </div>
  );
}
