import { isAudioPath, isDocumentPreviewPath, isImagePath } from "@/lib/file-types";
import { AudioViewer } from "./file-viewer/audio-viewer";
import { DocumentViewer } from "./file-viewer/document-viewer";
import { ImageViewer } from "./file-viewer/image-viewer";
import { TextFileViewer } from "./file-viewer/text-file-viewer";
import type { FileViewerProps } from "./file-viewer/types";

export function FileViewer({ filePath, cwd, sourceSessionId }: FileViewerProps) {
  if (isImagePath(filePath)) {
    return <ImageViewer filePath={filePath} cwd={cwd} sourceSessionId={sourceSessionId} />;
  }
  if (isAudioPath(filePath)) {
    return <AudioViewer filePath={filePath} cwd={cwd} sourceSessionId={sourceSessionId} />;
  }
  if (isDocumentPreviewPath(filePath)) {
    return <DocumentViewer filePath={filePath} cwd={cwd} sourceSessionId={sourceSessionId} />;
  }
  return <TextFileViewer filePath={filePath} cwd={cwd} sourceSessionId={sourceSessionId} />;
}
