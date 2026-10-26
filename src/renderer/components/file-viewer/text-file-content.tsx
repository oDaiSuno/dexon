import { getParentFilePath } from "@/lib/file-paths";
import type { TextFileData } from "@/lib/file-viewer-load-state";
import { MarkdownBody } from "../MarkdownBody";
import { DiffView } from "./diff-view";
import { HtmlPreview } from "./html-preview";
import { SourceView, type SourceCursor } from "./source-view";
import type { DiffSummary, TextViewMode } from "./use-text-file";

const JSX_FLAVORS: Readonly<Record<string, string>> = { javascript: "jsx", typescript: "tsx" };

function sourceLanguage(language: string, filePath: string): string {
  if (language === "text") return "plaintext";
  if (/\.[jt]sx$/i.test(filePath)) return JSX_FLAVORS[language] ?? language;
  return language;
}

export interface TextFileContentProps {
  filePath: string;
  cwd?: string;
  sourceSessionId?: string | null;
  data: TextFileData;
  headContent: string | null;
  hasDiff: boolean;
  diffSummary: DiffSummary | null;
  viewMode: TextViewMode;
  previewMode: boolean;
  wrapLines: boolean;
  cursorLine: number | null;
  onCursorChange: (cursor: SourceCursor) => void;
}

export function TextFileContent({
  filePath,
  cwd,
  sourceSessionId,
  data,
  headContent,
  hasDiff,
  diffSummary,
  viewMode,
  previewMode,
  wrapLines,
  cursorLine,
  onCursorChange,
}: TextFileContentProps) {
  const isHtml = data.language === "html";
  const isMarkdown = data.language === "markdown";

  return (
    <div className="file-viewer-scroll">
      {viewMode === "diff" && hasDiff ? (
        <DiffView
          oldContent={headContent!}
          newContent={data.content}
          language={sourceLanguage(data.language, filePath)}
          wrapLines={wrapLines}
          summary={diffSummary}
        />
      ) : isHtml && previewMode ? (
        <HtmlPreview content={data.content} filePath={filePath} sourceSessionId={sourceSessionId} />
      ) : isMarkdown && previewMode ? (
        <div className="file-markdown-preview type-body-relaxed">
          <MarkdownBody
            className="markdown-file-preview"
            cwd={cwd}
            imageBasePath={getParentFilePath(filePath)}
            sourceSessionId={sourceSessionId}
            codeBlockVariant="plain"
          >
            {data.content}
          </MarkdownBody>
        </div>
      ) : (
        <SourceView
          code={data.content}
          language={sourceLanguage(data.language, filePath)}
          wrapLines={wrapLines}
          cursorLine={cursorLine}
          onCursorChange={onCursorChange}
        />
      )}
    </div>
  );
}
