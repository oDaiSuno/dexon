import { useCallback, useEffect, useMemo, useRef, useState, type ClipboardEvent, type MutableRefObject } from "react";
import type { EnvironmentId } from "@contract/environment";
import { environmentAffordances } from "@/lib/environment-affordances";
import { processImageFileBatch } from "@/lib/image-file-processing";
import { ImageNormalizationError } from "@/lib/image-normalization";
import { modelSupportsImages } from "@/lib/model-selection";
import { findAttachmentTokens, isImagePath } from "@shared/attachment-tokens";
import { loadAttachmentPreview, registerStagedPreviewUrl } from "@/lib/attachment-token-previews";
import type { ComposerEditableHandle } from "./types";
import { useEnvironments } from "@/lib/environment-registry";

interface FileInspection {
  exists: boolean;
  isFile: boolean;
  insideCwd: boolean;
}

type Translate = (key: string, fallback: string) => string;

interface Options {
  environmentId: EnvironmentId;
  draftKey?: string;
  value: string;
  visible: boolean;
  cwd?: string | null;
  model?: { provider: string; modelId: string } | null;
  modelList?: { id: string; name: string; provider: string; input?: ("text" | "image")[] }[];
  editableRef: MutableRefObject<ComposerEditableHandle | null>;
  t: Translate;
  onImageNotice: (notice: string | null) => void;
}

function extensionForImageMime(mimeType: string): string | null {
  switch (mimeType.split(";")[0]?.trim().toLowerCase()) {
    case "image/png":
      return "png";
    case "image/jpeg":
      return "jpg";
    case "image/gif":
      return "gif";
    case "image/webp":
      return "webp";
    default:
      return null;
  }
}

export function useComposerAttachments({
  environmentId,
  draftKey,
  value,
  visible,
  cwd,
  model,
  modelList,
  editableRef,
  t,
  onImageNotice,
}: Options) {
  const environments = useEnvironments();
  const affordances = environmentAffordances(environments.find((view) => view.id === environmentId));
  const scope = JSON.stringify([environmentId, draftKey ?? null, cwd ?? null]);
  const currentScope = useRef(scope);
  currentScope.current = scope;
  const [inspections, setInspections] = useState({ scope, paths: new Map<string, FileInspection>() });
  const [previews, setPreviews] = useState({ scope, paths: new Map<string, string | null>() });
  const fileInspectionByPath = useMemo(
    () => (inspections.scope === scope ? inspections.paths : new Map<string, FileInspection>()),
    [inspections, scope],
  );
  const tokenPreviewsByPath = useMemo(
    () => (previews.scope === scope ? previews.paths : new Map<string, string | null>()),
    [previews, scope],
  );
  const attachmentTokens = useMemo(() => findAttachmentTokens(value), [value]);
  const tokenPaths = useMemo(
    () => Array.from(new Set(attachmentTokens.map((token) => token.path))),
    [attachmentTokens],
  );
  const selectedModelSupportsImages = modelSupportsImages(
    model ? { provider: model.provider, id: model.modelId } : null,
    modelList ?? [],
  );

  const missingTokenInspections = useMemo(() => {
    const missing = new Map<string, boolean>();
    for (const token of attachmentTokens) {
      const inspection = fileInspectionByPath.get(token.path);
      if (inspection && !inspection.exists) missing.set(token.path, true);
    }
    return missing;
  }, [attachmentTokens, fileInspectionByPath]);

  const insertAttachmentPath = useCallback(
    (path: string) => {
      editableRef.current?.insertTokenAtCaret(path);
    },
    [editableRef],
  );

  const stageClipboardImageFile = useCallback(
    async (file: File): Promise<{ ok: boolean; code?: string }> => {
      const { images, failures } = await processImageFileBatch([file]);
      const image = images[0];
      if (!image) {
        const failure = failures[0]?.error;
        return { ok: false, code: failure instanceof ImageNormalizationError ? failure.code : "attach-failed" };
      }
      const result = await window.piBridge?.stageClipboardImage?.({
        base64: image.data,
        ext: extensionForImageMime(image.mimeType) ?? "png",
      });
      if (!result?.ok) return { ok: false, code: result?.code ?? "stage-unavailable" };
      if (currentScope.current !== scope) return { ok: false, code: "scope-changed" };
      registerStagedPreviewUrl(result.staged.path, image.previewUrl, environmentId);
      editableRef.current?.insertTokenAtCaret(result.staged.path);
      return { ok: true };
    },
    [editableRef, environmentId, scope],
  );

  const processFiles = useCallback(
    async (files: File[]) => {
      if (!visible || !affordances.attachLocalFiles) return;
      const notices: string[] = [];
      let staged = 0;
      let failed = 0;
      let unsupportedOnly = true;
      let pathlessCount = 0;
      for (const file of files) {
        if (currentScope.current !== scope) return;
        const absolutePath = window.piBridge?.getPathForFile?.(file) ?? "";
        if (absolutePath) {
          insertAttachmentPath(absolutePath);
          continue;
        }
        if (!file.type.startsWith("image/")) {
          pathlessCount += 1;
          continue;
        }
        try {
          const result = await stageClipboardImageFile(file);
          if (result.ok) {
            staged += 1;
            continue;
          }
          failed += 1;
          if (result.code !== "unsupported-format") unsupportedOnly = false;
        } catch {
          failed += 1;
          unsupportedOnly = false;
        }
      }
      if (pathlessCount > 0) {
        notices.push(
          t("pathlessFilesAttachFailed", "{count} files had no local path and were not added").replace(
            "{count}",
            String(pathlessCount),
          ),
        );
      }
      if (failed > 0) {
        notices.push(
          staged > 0
            ? t("someImagesAttachFailed", "{failed} of {total} images could not be attached")
                .replace("{failed}", String(failed))
                .replace("{total}", String(failed + staged))
            : unsupportedOnly
              ? t(
                  "imageFormatUnsupported",
                  "This image format is not supported. Convert it to PNG or JPEG and try again.",
                )
              : t("imagesAttachFailed", "The selected images could not be attached"),
        );
      }
      if (staged > 0 && selectedModelSupportsImages === false) {
        notices.push(
          t(
            "modelImageUnsupported",
            "The selected model does not accept image input. Attached images will not be shown to the model.",
          ),
        );
      }
      if (currentScope.current === scope) onImageNotice(notices.length > 0 ? notices.join(". ") : null);
    },
    [
      insertAttachmentPath,
      onImageNotice,
      selectedModelSupportsImages,
      stageClipboardImageFile,
      t,
      visible,
      affordances.attachLocalFiles,
      scope,
    ],
  );

  const handlePaste = useCallback(
    (event: ClipboardEvent<HTMLDivElement>) => {
      event.preventDefault();
      const items = Array.from(event.clipboardData?.items ?? []);
      const fileItems = items.filter((item) => item.kind === "file");
      if (fileItems.length) {
        void processFiles(fileItems.map((item) => item.getAsFile()).filter((file): file is File => file !== null));
        return;
      }
      const text = event.clipboardData?.getData("text/plain") ?? "";
      if (text) editableRef.current?.pasteTextAtCaret(text.replace(/\r\n?/g, "\n"));
    },
    [editableRef, processFiles],
  );

  useEffect(() => {
    let cancelled = false;
    if (!visible)
      return () => {
        cancelled = true;
      };
    if (!affordances.attachLocalFiles || attachmentTokens.length === 0 || !window.piBridge?.inspectLocalFiles) {
      setInspections({ scope, paths: new Map() });
      return () => {
        cancelled = true;
      };
    }
    void window.piBridge
      .inspectLocalFiles({ paths: tokenPaths.slice(0, 8), cwd: cwd ?? undefined })
      .then((inspections) => {
        if (cancelled) return;
        const next = new Map<string, FileInspection>();
        inspections.forEach((inspection, index) => {
          const tokenPath = tokenPaths[index];
          if (tokenPath) next.set(tokenPath, inspection);
        });
        setInspections({ scope, paths: next });
      })
      .catch(() => {
        if (!cancelled) setInspections({ scope, paths: new Map() });
      });
    return () => {
      cancelled = true;
    };
  }, [attachmentTokens.length, cwd, tokenPaths, visible, affordances.attachLocalFiles, scope]);

  useEffect(() => {
    let cancelled = false;
    if (!visible)
      return () => {
        cancelled = true;
      };
    const imagePaths = tokenPaths.filter(isImagePath);
    void Promise.all(
      imagePaths.map(async (path) => [path, await loadAttachmentPreview(path, undefined, environmentId)] as const),
    ).then((entries) => {
      if (!cancelled) setPreviews({ scope, paths: new Map(entries) });
    });
    return () => {
      cancelled = true;
    };
  }, [environmentId, scope, tokenPaths, visible]);

  return {
    attachmentTokens,
    missingTokenInspections,
    tokenPreviewsByPath,
    insertAttachmentPath,
    processFiles,
    handlePaste,
  };
}
