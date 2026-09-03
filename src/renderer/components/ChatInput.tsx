import React, {
  useRef,
  useState,
  useCallback,
  useEffect,
  useLayoutEffect,
  useImperativeHandle,
  forwardRef,
  KeyboardEvent,
} from "react";
import type {
  BuiltinSlashCommandResult,
  CompactResultInfo,
  QueuedMessages,
  SlashCommandInfo,
} from "@/hooks/useAgentSession";
import { DraftPersistenceController, getDraft } from "@/lib/draft-store";
import { LatestAbortableRequest } from "@/lib/latest-abortable-request";
import { extractAtQuery, type AtQueryMatch, type FileIndexEntry } from "@/lib/file-fuzzy";
import {
  FileSuggestionLruCache,
  fileSuggestionCacheKey,
  projectFileSuggestionResponse,
  type FileSuggestionDegradedReason,
} from "@/lib/file-suggestion-client";
import { useIsMobile } from "@/hooks/useIsMobile";
import { useI18n } from "@/i18n";
import type { ModelCatalogStatus } from "@contract/types";
import { processImageFileBatch } from "@/lib/image-file-processing";
import { ImageNormalizationError } from "@/lib/image-normalization";
import { modelSupportsImages } from "@/lib/model-selection";
import {
  captureComposerSubmission,
  failedComposerSubmissionAction,
  failedComposerSubmissionValue,
  type ComposerSubmissionSnapshot,
} from "@/lib/composer-submission";
import { findAttachmentTokens, insertAttachmentToken, isImagePath } from "@shared/attachment-tokens";
import { loadAttachmentPreview, registerStagedPreviewUrl } from "@/lib/attachment-token-previews";
import { ComposerEditable, type ComposerEditableHandle } from "./chat-input/ComposerEditable";
import { AtMenu } from "./chat-input/AtMenu";
import { ModelPicker, compareModelOptions, type ModelOption } from "./chat-input/ModelPicker";
import { PlusMenu } from "./chat-input/PlusMenu";
import { SendSquare, StopSquare } from "./chat-input/SendControls";
import { SessionControls } from "./chat-input/SessionControls";
import { SlashMenu } from "./chat-input/SlashMenu";
import { CompactResultBanner, NoticeBanner, QueuedMessagesPanel, RetryBanner } from "./chat-input/StatusBanners";
import {
  BUILTIN_SLASH_COMMANDS,
  SLASH_SOURCES,
  compareSlashCommands,
  type SlashCommandPaletteItem,
  type SlashCommandSource,
} from "./chat-input/slash-commands";
import { PaperclipIcon, PlusIcon } from "./chat-input/icons";

interface Props {
  onSend: (message: string) => void | Promise<unknown> | { ok?: boolean };
  onAbort: () => void;
  onSteer?: (message: string) => Promise<void> | void;
  onFollowUp?: (message: string) => Promise<void> | void;
  onPromptWithStreamingBehavior?: (message: string, behavior: "steer" | "followUp") => Promise<void> | void;
  isStreaming: boolean;
  model?: { provider: string; modelId: string } | null;
  isAutoModelSelection?: boolean;
  modelNames?: Record<string, string>;
  modelList?: { id: string; name: string; provider: string; input?: ("text" | "image")[] }[];
  modelCatalog?: ModelCatalogStatus;
  modelRefreshing?: boolean;
  onModelChange?: (provider: string, modelId: string) => void;
  onModelsRefresh?: () => Promise<void> | void;
  onModelsRefreshCancel?: () => void;
  onCompact?: () => void;
  onAbortCompaction?: () => void;
  isCompacting?: boolean;
  compactError?: string | null;
  compactResult?: CompactResultInfo | null;
  contextUsage?: { percent: number | null; contextWindow: number; tokens: number | null } | null;
  thinkingLevel?: "auto" | "off" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max";
  onThinkingLevelChange?: (level: "auto" | "off" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max") => void;
  availableThinkingLevels?: string[] | null;
  thinkingLevelMap?: Record<string, string | null> | null;
  retryInfo?: { attempt: number; maxAttempts: number; errorMessage?: string } | null;
  queuedMessages?: QueuedMessages | null;
  onRecallQueue?: () => void;
  slashCommands?: SlashCommandInfo[];
  slashCommandsLoading?: boolean;
  onLoadSlashCommands?: () => Promise<SlashCommandInfo[]> | SlashCommandInfo[];
  onBuiltinCommand?: (message: string) => Promise<BuiltinSlashCommandResult>;
  soundEnabled?: boolean;
  onSoundToggle?: () => void;
  onAudioUnlock?: () => void;
  draftKey?: string;
  /** Session working directory — enables the @ file autocomplete menu */
  cwd?: string | null;
}

export interface ChatInputHandle {
  insertText: (text: string) => void;
  insertIfEmpty: (text: string) => void;
  prependText: (text: string) => void;
  addFiles: (files: File[]) => void;
}

const COMPOSITION_END_ENTER_GRACE_MS = 100;

function extensionForImageMime(mimeType: string): string | null {
  const base = mimeType.split(";")[0]?.trim().toLowerCase() ?? "";
  switch (base) {
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

export const ChatInput = forwardRef<ChatInputHandle, Props>(function ChatInput(
  {
    onSend,
    onAbort,
    onSteer,
    onFollowUp,
    isStreaming,
    model,
    isAutoModelSelection,
    modelNames,
    modelList,
    modelCatalog,
    modelRefreshing,
    onModelChange,
    onModelsRefresh,
    onModelsRefreshCancel,
    onCompact,
    onAbortCompaction,
    isCompacting,
    compactError,
    compactResult,
    contextUsage,
    thinkingLevel,
    onThinkingLevelChange,
    availableThinkingLevels,
    thinkingLevelMap,
    retryInfo,
    queuedMessages,
    onRecallQueue,
    slashCommands,
    slashCommandsLoading,
    onLoadSlashCommands,
    onBuiltinCommand,
    soundEnabled,
    onSoundToggle,
    onAudioUnlock,
    onPromptWithStreamingBehavior,
    draftKey,
    cwd,
  }: Props,
  ref,
) {
  const isMobile = useIsMobile();
  const { t } = useI18n();
  const [value, setValueState] = useState(() => (draftKey ? (getDraft(draftKey)?.value ?? "") : ""));
  const [modelDropdownOpen, setModelDropdownOpen] = useState(false);
  const [modelDropdownRect, setModelDropdownRect] = useState<{ top: number; left: number; width: number } | null>(null);
  const [thinkingDropdownOpen, setThinkingDropdownOpen] = useState(false);
  const [fileInspectionByPath, setFileInspectionByPath] = useState<
    Map<string, { exists: boolean; isFile: boolean; insideCwd: boolean }>
  >(new Map());
  const [tokenPreviewsByPath, setTokenPreviewsByPath] = useState<Map<string, string | null>>(new Map());
  const [slashMenuOpen, setSlashMenuOpen] = useState(false);
  const [slashActiveIndex, setSlashActiveIndex] = useState(0);
  const [atQuery, setAtQuery] = useState<AtQueryMatch | null>(null);
  const [atMenuOpen, setAtMenuOpen] = useState(false);
  const [atActiveIndex, setAtActiveIndex] = useState(0);
  const [atSuggestionState, setAtSuggestionState] = useState<{
    cwd: string;
    tokenKey: string;
    query: string;
    matches: FileIndexEntry[];
    truncated: boolean;
    degradedReason?: FileSuggestionDegradedReason;
    status: "loading" | "ready" | "error";
  } | null>(null);
  const [imageAttachNotice, setImageAttachNotice] = useState<string | null>(null);
  const [submissionNotice, setSubmissionNotice] = useState<string | null>(null);
  const [plusMenuOpen, setPlusMenuOpen] = useState(false);

  const editableRef = useRef<ComposerEditableHandle | null>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const modelButtonRef = useRef<HTMLButtonElement>(null);
  const modelDropdownPanelRef = useRef<HTMLDivElement>(null);
  const thinkingDropdownRef = useRef<HTMLDivElement>(null);
  const thinkingButtonRef = useRef<HTMLButtonElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (!plusMenuOpen) return;
    const close = (event: PointerEvent) => {
      const target = event.target;
      if (!(target instanceof Element) || !target.closest("[data-composer-anchor]")) {
        setPlusMenuOpen(false);
      }
    };
    document.addEventListener("pointerdown", close);
    return () => document.removeEventListener("pointerdown", close);
  }, [plusMenuOpen]);
  const openPicker = () => {
    setPlusMenuOpen(false);
    const input = fileInputRef.current;
    if (!input) return;
    input.removeAttribute("accept");
    input.click();
  };
  const isComposingRef = useRef(false);
  const lastCompositionEndAtRef = useRef(0);
  const slashCommandsRequestedRef = useRef(false);
  const slashItemRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const atItemRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const fileSuggestionCacheRef = useRef(new FileSuggestionLruCache());
  const fileSuggestionRequestRef = useRef(new LatestAbortableRequest());
  const draftKeyRef = useRef(draftKey);
  const valueRef = useRef(value);
  const inputRevisionRef = useRef(0);
  const draftPersistenceErrorHandlerRef = useRef<() => void>(() => {});
  const draftPersistenceRef = useRef<DraftPersistenceController | null>(null);
  draftPersistenceErrorHandlerRef.current = () =>
    setSubmissionNotice(
      t(
        "draftPersistenceFailed",
        "Draft could not be saved on this device. Your current input is still on screen; check available storage.",
      ),
    );
  if (!draftPersistenceRef.current) {
    draftPersistenceRef.current = new DraftPersistenceController(500, undefined, () =>
      draftPersistenceErrorHandlerRef.current(),
    );
  }
  const setValue = useCallback((next: React.SetStateAction<string>) => {
    const resolved = typeof next === "function" ? next(valueRef.current) : next;
    inputRevisionRef.current += 1;
    valueRef.current = resolved;
    setValueState(resolved);
  }, []);
  valueRef.current = value;

  // In-sentence attachment tokens are the single source of truth: they are
  // literal `@path` text in the message value, inserted by every entry point
  // (paste, plus-menu, drag-drop, @ autocomplete) and read by the model via
  // the `read` tool.
  const attachmentTokens = React.useMemo(() => findAttachmentTokens(value), [value]);
  const missingTokenInspections = React.useMemo(() => {
    const next = new Map<string, boolean>();
    for (const token of attachmentTokens) {
      const inspection = fileInspectionByPath.get(token.path);
      if (inspection && !inspection.exists) next.set(token.path, true);
    }
    return next;
  }, [attachmentTokens, fileInspectionByPath]);
  // Declared input modalities of the selected model; null when unknown.
  const selectedModelSupportsImages = modelSupportsImages(
    model ? { provider: model.provider, id: model.modelId } : null,
    modelList ?? [],
  );

  useImperativeHandle(ref, () => ({
    insertIfEmpty(text: string) {
      if (value.trim()) return;
      editableRef.current?.focus();
      editableRef.current?.setValue(text);
      setAtQuery(null);
    },
    prependText(text: string) {
      if (!text.trim()) return;
      // Mirrors the TUI's queue restore: queued text first, then whatever
      // the user already typed, separated by a blank line.
      const combined = [text, valueRef.current].filter((t) => t.trim()).join("\n\n");
      editableRef.current?.focus();
      editableRef.current?.setValue(combined);
      setAtQuery(null);
    },
    insertText(text: string) {
      editableRef.current?.insertTextAtCaret(text);
      setAtQuery(null);
    },
    addFiles(files: File[]) {
      void processFiles(files);
    },
    insertToken(path: string) {
      insertAttachmentPath(path);
    },
  }));

  /** Append a closed chip at the caret (or text end) and keep the value in sync. */
  const insertAttachmentPath = useCallback((path: string) => {
    editableRef.current?.insertTokenAtCaret(path);
    setAtQuery(null);
  }, []);

  /** Stage one clipboard image (normalize → bridge write → token). */
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
      registerStagedPreviewUrl(result.staged.path, image.previewUrl);
      insertAttachmentPath(result.staged.path);
      return { ok: true };
    },
    [insertAttachmentPath],
  );

  const processFiles = useCallback(
    async (files: File[]) => {
      // Attaching is allowed while streaming; sending is gated separately, so
      // the user can prepare references for the next prompt while the agent runs.
      const notices: string[] = [];
      let staged = 0;
      let failed = 0;
      let unsupportedOnly = true;
      let pathlessCount = 0;
      for (const file of files) {
        // Files that already live on disk (drag-drop, file picker) become
        // references directly — no copy, no staging.
        const absolutePath = window.piBridge?.getPathForFile?.(file) ?? "";
        if (absolutePath) {
          insertAttachmentPath(absolutePath);
          continue;
        }
        if (!file.type.startsWith("image/")) {
          pathlessCount += 1;
          continue;
        }
        // Clipboard bitmaps have no path: normalize (resize/format gate) then
        // write them to the pi-clipboard temp staging area.
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
      setImageAttachNotice(notices.length > 0 ? notices.join(". ") : null);
    },
    [insertAttachmentPath, selectedModelSupportsImages, stageClipboardImageFile, t],
  );

  const clearInput = useCallback(() => {
    setValue("");
    setAtQuery(null);
    if (draftKey) draftPersistenceRef.current?.clear(draftKey);
    if (draftKeyRef.current && draftKeyRef.current !== draftKey) {
      draftPersistenceRef.current?.clear(draftKeyRef.current);
    }
  }, [draftKey, setValue]);

  const restoreFailedSubmission = useCallback(
    (snapshot: ComposerSubmissionSnapshot, clearedAtRevision: number, kind: "send" | "queue") => {
      const action = failedComposerSubmissionAction(clearedAtRevision, inputRevisionRef.current);
      if (action === "restore") {
        setValue(failedComposerSubmissionValue(snapshot));
      }
      setSubmissionNotice(
        action === "restore"
          ? kind === "send"
            ? t("messageNotSentDraftRestored", "Message was not sent. Your draft was restored.")
            : t("messageNotQueuedDraftRestored", "Message could not be queued. Your draft was restored.")
          : kind === "send"
            ? t("messageNotSentNewDraftKept", "The previous message was not sent. Your newer draft was kept.")
            : t("messageNotQueuedNewDraftKept", "The previous message could not be queued. Your newer draft was kept."),
      );
    },
    [setValue, t],
  );

  const commitCurrentDraft = useCallback(() => {
    const currentDraftKey = draftKeyRef.current;
    if (!currentDraftKey) return;
    draftPersistenceRef.current?.commit(currentDraftKey, {
      value: valueRef.current,
    });
  }, []);

  useEffect(() => {
    if (!draftKey || draftKeyRef.current !== draftKey) return;
    draftPersistenceRef.current?.schedule(draftKey, {
      value,
    });
  }, [draftKey, value]);

  useEffect(() => {
    const previousDraftKey = draftKeyRef.current;
    if (previousDraftKey === draftKey) return;

    if (previousDraftKey) {
      draftPersistenceRef.current?.commit(previousDraftKey, {
        value: valueRef.current,
      });
    }

    const draft = draftKey ? getDraft(draftKey) : null;
    draftKeyRef.current = draftKey;
    setValue(draft?.value ?? "");
    setAtQuery(null);
    // Legacy v2 drafts stored base64 images plus file references separately.
    // Migrate them into in-sentence tokens: images are staged to the temp
    // area, files become plain path references. Anything that cannot be
    // migrated (bridge unavailable, staging rejected) is dropped with a note.
    if (draft?.images?.length || draft?.files?.length) {
      void (async () => {
        const notices: string[] = [];
        let value = draft?.value ?? "";
        for (const image of draft?.images ?? []) {
          try {
            const result = await window.piBridge?.stageClipboardImage?.({
              base64: image.data,
              ext: extensionForImageMime(image.mimeType) ?? "",
            });
            if (result?.ok) {
              registerStagedPreviewUrl(result.staged.path, `data:${image.mimeType};base64,${image.data}`);
              const appended = insertAttachmentToken(value, null, result.staged.path);
              value = appended.value;
            }
          } catch {
            // fall through to the migration-failed notice below
          }
        }
        for (const file of draft?.files ?? []) {
          const appended = insertAttachmentToken(value, null, file.path);
          value = appended.value;
        }
        if (value !== (draft?.value ?? "")) setValue(value);
        if (draft?.images?.length) {
          notices.push(
            t("draftImageMigrationFailed", "Some images from your draft could not be restored and were removed."),
          );
        }
        if (notices.length > 0) setImageAttachNotice(notices.join(". "));
      })();
    }
  }, [draftKey, setValue, t]);

  const tokenPaths = React.useMemo(
    () => Array.from(new Set(attachmentTokens.map((token) => token.path))),
    [attachmentTokens],
  );

  useEffect(() => {
    let cancelled = false;
    if (attachmentTokens.length === 0 || !window.piBridge?.inspectLocalFiles) {
      setFileInspectionByPath(new Map());
      return () => {
        cancelled = true;
      };
    }
    void window.piBridge
      .inspectLocalFiles({ paths: tokenPaths.slice(0, 8), cwd: cwd ?? undefined })
      .then((inspections) => {
        if (cancelled) return;
        const next = new Map<string, { exists: boolean; isFile: boolean; insideCwd: boolean }>();
        inspections.forEach((inspection, index) => {
          const tokenPath = tokenPaths[index];
          if (tokenPath) next.set(tokenPath, inspection);
        });
        setFileInspectionByPath(next);
      })
      .catch(() => {
        if (!cancelled) setFileInspectionByPath(new Map());
      });
    return () => {
      cancelled = true;
    };
  }, [attachmentTokens.length, cwd, tokenPaths]);

  useEffect(() => {
    return () => {
      commitCurrentDraft();
      draftPersistenceRef.current?.dispose();
    };
  }, [commitCurrentDraft]);

  // Resolve thumbnails for image tokens (fresh pastes hit the staged-preview
  // cache; everything else goes through the files.read bridge and may be
  // unavailable for unsent drafts).
  useEffect(() => {
    let cancelled = false;
    const imagePaths = tokenPaths.filter(isImagePath);
    if (imagePaths.length === 0) {
      setTokenPreviewsByPath((prev) => (prev.size === 0 ? prev : new Map()));
      return () => {
        cancelled = true;
      };
    }
    imagePaths.forEach((path) => {
      if (tokenPreviewsByPath.has(path)) return;
      void loadAttachmentPreview(path).then((url) => {
        if (cancelled) return;
        setTokenPreviewsByPath((prev) => {
          const next = new Map(prev);
          next.set(path, url);
          return next;
        });
      });
    });
    return () => {
      cancelled = true;
    };
  }, [tokenPaths, tokenPreviewsByPath]);

  const handleSend = useCallback(async () => {
    const msg = value.trim();
    if (!msg) return;
    if (isStreaming) return;
    onAudioUnlock?.();
    const snapshot = captureComposerSubmission(value);
    setSubmissionNotice(null);
    commitCurrentDraft();
    clearInput();
    const clearedAtRevision = inputRevisionRef.current;
    try {
      if (!attachmentTokens.length && msg.startsWith("/") && onBuiltinCommand) {
        const result = await onBuiltinCommand(msg);
        if (result.handled) {
          if (result.error) restoreFailedSubmission(snapshot, clearedAtRevision, "send");
          return;
        }
      }
      const result = onSend(msg) as void | Promise<unknown> | { ok?: boolean };
      const settled = await Promise.resolve(result);
      if (settled && typeof settled === "object" && "ok" in settled && settled.ok === false) {
        restoreFailedSubmission(snapshot, clearedAtRevision, "send");
        return;
      }
    } catch {
      restoreFailedSubmission(snapshot, clearedAtRevision, "send");
    }
  }, [
    clearInput,
    commitCurrentDraft,
    attachmentTokens.length,
    isStreaming,
    onAudioUnlock,
    onBuiltinCommand,
    onSend,
    restoreFailedSubmission,
    value,
  ]);

  const slashQuery = value.startsWith("/") && !/\s/.test(value.slice(1)) ? value.slice(1).toLowerCase() : null;

  const filteredSlashCommands = (() => {
    if (slashQuery === null) return [];
    const commands = [...(isStreaming ? [] : BUILTIN_SLASH_COMMANDS), ...(slashCommands ?? [])];
    return [...commands]
      .filter((command) => {
        const name = command.name.toLowerCase();
        const description = command.description?.toLowerCase() ?? "";
        return name.includes(slashQuery) || description.includes(slashQuery);
      })
      .sort((a, b) => compareSlashCommands(a, b, slashQuery));
  })();

  const groupedSlashCommands = (() => {
    const groups = new Map<
      SlashCommandSource,
      { source: SlashCommandSource; items: { command: SlashCommandPaletteItem; index: number }[] }
    >();
    for (const source of SLASH_SOURCES) {
      groups.set(source, { source, items: [] });
    }
    filteredSlashCommands.forEach((command, index) => {
      groups.get(command.source)?.items.push({ command, index });
    });
    return SLASH_SOURCES.map((source) => groups.get(source)!).filter((group) => group.items.length > 0);
  })();

  const slashCommandCountLabel =
    filteredSlashCommands.length === 1
      ? slashQuery
        ? t("oneMatch", "1 match")
        : t("oneCommand", "1 command")
      : slashQuery
        ? t("matchCount", "{count} matches").replace("{count}", String(filteredSlashCommands.length))
        : t("commandCount", "{count} commands").replace("{count}", String(filteredSlashCommands.length));
  const hasInputText = Boolean(value.trim());
  const canSend = hasInputText;

  // ── @ file autocomplete ──────────────────────────────────────────────────
  // Recomputed from the text before the caret on every change/caret move.
  // Disabled entirely when there is no cwd (new session without a directory).
  // `text` is the serialized text before the caret (derived from the DOM).
  const updateAtQuery = useCallback(
    (text: string) => {
      if (!cwd) {
        setAtQuery(null);
        return;
      }
      setAtQuery(extractAtQuery(text));
    },
    [cwd],
  );

  const atQueryText = atQuery?.query ?? null;
  // Open/reset the menu whenever the @token appears or changes (mirrors the
  // slash menu: Escape closes it, the next keystroke re-opens it).
  const atTokenKey = atQuery === null ? null : `${atQuery.start}:${atQuery.quoted ? 1 : 0}:${atQuery.query}`;
  useEffect(() => {
    if (atTokenKey === null) {
      setAtMenuOpen(false);
      setAtActiveIndex(0);
      return;
    }
    setAtMenuOpen(true);
    setAtActiveIndex(0);
  }, [atTokenKey]);

  // Request candidates for the active token. Empty queries and directory
  // drill-down browse immediately; non-empty searches debounce briefly. The
  // request generation and token tag both prevent stale responses from
  // replacing a newer query.
  useEffect(() => {
    if (atTokenKey === null || atQueryText === null || !cwd) {
      fileSuggestionRequestRef.current.cancel();
      setAtSuggestionState(null);
      return;
    }
    const fetchCwd = cwd;
    const query = atQueryText;
    const tokenKey = atTokenKey;
    const platform = window.piBridge?.platform ?? "linux";
    const cacheKey = fileSuggestionCacheKey(fetchCwd, query, platform);
    const cached = fileSuggestionCacheRef.current.get(cacheKey);
    if (cached) {
      setAtSuggestionState({ cwd: fetchCwd, tokenKey, query, ...cached, status: "ready" });
      return;
    }

    setAtSuggestionState({ cwd: fetchCwd, tokenKey, query, matches: [], truncated: false, status: "loading" });
    const requests = fileSuggestionRequestRef.current;
    let generation: number | null = null;
    const timer = setTimeout(
      () => {
        const request = requests.begin();
        generation = request.generation;
        fetch(`/api/file-index?cwd=${encodeURIComponent(fetchCwd)}&q=${encodeURIComponent(query)}`, {
          signal: request.signal,
        })
          .then((res) => {
            if (!res.ok) throw new Error(`file suggestions failed: ${res.status}`);
            return res.json() as Promise<unknown>;
          })
          .then((data) => {
            if (!requests.isCurrent(request.generation)) return;
            const snapshot = projectFileSuggestionResponse(data, query);
            fileSuggestionCacheRef.current.setWithTtl(
              cacheKey,
              snapshot,
              query === "" || query.endsWith("/") ? 2_000 : 1_000,
            );
            setAtSuggestionState({ cwd: fetchCwd, tokenKey, query, ...snapshot, status: "ready" });
          })
          .catch((error) => {
            if (!requests.isCurrent(request.generation) || (error as { name?: string })?.name === "AbortError") return;
            setAtSuggestionState({
              cwd: fetchCwd,
              tokenKey,
              query,
              matches: [],
              truncated: false,
              status: "error",
            });
          })
          .finally(() => requests.finish(request.generation));
      },
      query === "" || query.endsWith("/") ? 0 : 150,
    );
    return () => {
      clearTimeout(timer);
      if (generation !== null) requests.cancel(generation);
    };
  }, [atTokenKey, atQueryText, cwd]);

  const suggestionStateInUse =
    atSuggestionState !== null && atSuggestionState.cwd === cwd && atSuggestionState.tokenKey === atTokenKey;
  const activeSuggestionState = suggestionStateInUse ? atSuggestionState : null;
  const atMatches: FileIndexEntry[] = React.useMemo(
    () => activeSuggestionState?.matches ?? [],
    [activeSuggestionState],
  );

  const applyAtCompletion = useCallback(
    (entry: FileIndexEntry) => {
      if (!atQuery) return;
      // DOM surgery in the editable surface: files become chips (menu closes
      // via the trailing space), directories stay plain text for drill-down.
      editableRef.current?.completeAtQuery(atQuery, entry.path, entry.isDir);
    },
    [atQuery],
  );

  useEffect(() => {
    if (atActiveIndex >= atMatches.length) {
      setAtActiveIndex(Math.max(0, atMatches.length - 1));
    }
  }, [atMatches.length, atActiveIndex]);

  useEffect(() => {
    atItemRefs.current.length = atMatches.length;
  }, [atMatches.length]);

  useEffect(() => {
    if (!atMenuOpen) return;
    atItemRefs.current[atActiveIndex]?.scrollIntoView({ block: "nearest", inline: "nearest" });
  }, [atActiveIndex, atMenuOpen]);

  const applySlashCommand = useCallback((command: SlashCommandPaletteItem) => {
    // setValue rebuilds the editable surface and leaves the caret at the end.
    editableRef.current?.setValue(`/${command.name} `);
    setSlashMenuOpen(false);
    setSlashActiveIndex(0);
  }, []);

  const sendQueued = useCallback(
    async (mode: "steer" | "followup") => {
      // Queued prompts are plain strings on the pi queue. Attachment tokens
      // are literal text in the message, so token references queue safely.
      const msg = value.trim();
      if (!msg) return;
      onAudioUnlock?.();
      const snapshot = captureComposerSubmission(value);
      const streamingBehavior = mode === "steer" ? "steer" : "followUp";
      setSubmissionNotice(null);
      commitCurrentDraft();
      clearInput();
      const clearedAtRevision = inputRevisionRef.current;
      try {
        if (msg.startsWith("/") && onPromptWithStreamingBehavior) {
          await Promise.resolve(onPromptWithStreamingBehavior(msg, streamingBehavior));
          return;
        }
        if (mode === "steer" && onSteer) {
          await Promise.resolve(onSteer(msg));
        } else if (mode === "followup" && onFollowUp) {
          await Promise.resolve(onFollowUp(msg));
        }
      } catch {
        restoreFailedSubmission(snapshot, clearedAtRevision, "queue");
      }
    },
    [
      clearInput,
      commitCurrentDraft,
      onAudioUnlock,
      onFollowUp,
      onPromptWithStreamingBehavior,
      onSteer,
      restoreFailedSubmission,
      value,
    ],
  );

  const getNextSlashIndex = useCallback(
    (direction: "up" | "down" | "left" | "right") => {
      const lastIndex = filteredSlashCommands.length - 1;
      if (lastIndex < 0) return 0;

      if (direction === "left") return Math.max(0, slashActiveIndex - 1);
      if (direction === "right") return Math.min(lastIndex, slashActiveIndex + 1);

      const currentNode = slashItemRefs.current[slashActiveIndex];
      if (!currentNode) {
        return direction === "down" ? Math.min(lastIndex, slashActiveIndex + 1) : Math.max(0, slashActiveIndex - 1);
      }

      const currentRect = currentNode.getBoundingClientRect();
      const currentX = currentRect.left + currentRect.width / 2;
      const currentY = currentRect.top + currentRect.height / 2;
      let bestIndex = -1;
      let bestScore = Number.POSITIVE_INFINITY;

      for (let index = 0; index <= lastIndex; index += 1) {
        if (index === slashActiveIndex) continue;
        const node = slashItemRefs.current[index];
        if (!node) continue;
        const rect = node.getBoundingClientRect();
        const candidateY = rect.top + rect.height / 2;
        const verticalDelta = candidateY - currentY;
        if (direction === "down" ? verticalDelta <= 4 : verticalDelta >= -4) continue;

        const candidateX = rect.left + rect.width / 2;
        const score = Math.abs(verticalDelta) * 1000 + Math.abs(candidateX - currentX);
        if (score < bestScore) {
          bestIndex = index;
          bestScore = score;
        }
      }

      if (bestIndex >= 0) return bestIndex;
      return direction === "down" ? Math.min(lastIndex, slashActiveIndex + 1) : Math.max(0, slashActiveIndex - 1);
    },
    [filteredSlashCommands.length, slashActiveIndex],
  );

  const handleKeyDown = useCallback(
    (e: KeyboardEvent<HTMLDivElement>) => {
      const nativeEvent = e.nativeEvent;
      const recentlyComposed = Date.now() - lastCompositionEndAtRef.current < COMPOSITION_END_ENTER_GRACE_MS;
      const isComposing = isComposingRef.current || nativeEvent.isComposing || nativeEvent.keyCode === 229;

      if (e.key === "Enter" && !e.shiftKey && (isComposing || recentlyComposed)) {
        if (recentlyComposed) e.preventDefault();
        return;
      }

      if (slashMenuOpen && slashQuery !== null) {
        if (e.key === "ArrowDown") {
          e.preventDefault();
          setSlashActiveIndex(getNextSlashIndex("down"));
          return;
        }
        if (e.key === "ArrowUp") {
          e.preventDefault();
          setSlashActiveIndex(getNextSlashIndex("up"));
          return;
        }
        if (e.key === "ArrowRight") {
          e.preventDefault();
          setSlashActiveIndex(getNextSlashIndex("right"));
          return;
        }
        if (e.key === "ArrowLeft") {
          e.preventDefault();
          setSlashActiveIndex(getNextSlashIndex("left"));
          return;
        }
        if (e.key === "Escape") {
          e.preventDefault();
          setSlashMenuOpen(false);
          return;
        }
        if ((e.key === "Tab" || (e.key === "Enter" && !e.shiftKey)) && filteredSlashCommands[slashActiveIndex]) {
          e.preventDefault();
          applySlashCommand(filteredSlashCommands[slashActiveIndex]);
          return;
        }
      }

      // @ file menu — skip while composing so IME candidate navigation
      // (arrows/Enter/Tab) is never intercepted.
      if (atMenuOpen && atQuery !== null && !isComposing) {
        if (e.key === "ArrowDown") {
          e.preventDefault();
          setAtActiveIndex((i) => Math.min(Math.max(0, atMatches.length - 1), i + 1));
          return;
        }
        if (e.key === "ArrowUp") {
          e.preventDefault();
          setAtActiveIndex((i) => Math.max(0, i - 1));
          return;
        }
        if (e.key === "Escape") {
          e.preventDefault();
          setPlusMenuOpen(false);
          setAtMenuOpen(false);
          return;
        }
        if ((e.key === "Tab" || (e.key === "Enter" && !e.shiftKey)) && atMatches[atActiveIndex]) {
          e.preventDefault();
          applyAtCompletion(atMatches[atActiveIndex]);
          return;
        }
      }

      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        if (isStreaming) {
          // While the agent runs, sending queues the message as a follow-up.
          if (onFollowUp) void sendQueued("followup");
        } else {
          void handleSend();
        }
      }
    },
    [
      isStreaming,
      onFollowUp,
      slashMenuOpen,
      slashQuery,
      filteredSlashCommands,
      slashActiveIndex,
      applySlashCommand,
      sendQueued,
      handleSend,
      getNextSlashIndex,
      atMenuOpen,
      atQuery,
      atMatches,
      atActiveIndex,
      applyAtCompletion,
    ],
  );

  const handlePaste = useCallback(
    (e: React.ClipboardEvent) => {
      // The editable surface always takes pasted text as plain text; file
      // payloads go through the attachment pipeline.
      e.preventDefault();
      const items = Array.from(e.clipboardData?.items ?? []);
      const fileItems = items.filter((item) => item.kind === "file");
      if (fileItems.length) {
        const files = fileItems.map((item) => item.getAsFile()).filter((f): f is File => f !== null);
        void processFiles(files);
        return;
      }
      const text = e.clipboardData?.getData("text/plain") ?? "";
      if (text) editableRef.current?.insertTextAtCaret(text);
    },
    [processFiles],
  );

  useEffect(() => {
    if (slashQuery === null) {
      setSlashMenuOpen(false);
      setSlashActiveIndex(0);
      slashCommandsRequestedRef.current = false;
      return;
    }
    setSlashMenuOpen(true);
    setSlashActiveIndex(0);
    if (!slashCommandsRequestedRef.current && onLoadSlashCommands) {
      slashCommandsRequestedRef.current = true;
      Promise.resolve(onLoadSlashCommands()).catch(() => {
        slashCommandsRequestedRef.current = false;
      });
    }
  }, [slashQuery, onLoadSlashCommands]);

  useEffect(() => {
    if (slashActiveIndex >= filteredSlashCommands.length) {
      setSlashActiveIndex(Math.max(0, filteredSlashCommands.length - 1));
    }
  }, [filteredSlashCommands.length, slashActiveIndex]);

  useEffect(() => {
    slashItemRefs.current.length = filteredSlashCommands.length;
  }, [filteredSlashCommands.length]);

  useEffect(() => {
    if (!slashMenuOpen) return;
    slashItemRefs.current[slashActiveIndex]?.scrollIntoView({ block: "nearest", inline: "nearest" });
  }, [slashActiveIndex, slashMenuOpen]);

  // Build model options: prefer modelList (has provider info), fallback to modelNames
  const modelOptions: ModelOption[] = (() => {
    if (modelList && modelList.length > 0) {
      return modelList.map((m) => ({ provider: m.provider, modelId: m.id, name: m.name })).sort(compareModelOptions);
    }
    return Object.entries(modelNames ?? {})
      .map(([modelId, name]) => ({
        provider: model?.provider ?? "unknown",
        modelId,
        name,
      }))
      .sort(compareModelOptions);
  })();

  // Group options by provider, preserving insertion order
  const modelsByProvider: { provider: string; options: ModelOption[] }[] = [];
  for (const opt of modelOptions) {
    const group = modelsByProvider.find((g) => g.provider === opt.provider);
    if (group) group.options.push(opt);
    else modelsByProvider.push({ provider: opt.provider, options: [opt] });
  }

  const displayModelName = model
    ? (modelOptions.find((o) => o.modelId === model.modelId && o.provider === model.provider)?.name ?? model.modelId)
    : null;
  const currentName = displayModelName;

  const closeControlDropdowns = useCallback(() => {
    setThinkingDropdownOpen(false);
  }, []);

  const updateModelDropdownRect = useCallback(() => {
    const button = modelButtonRef.current;
    if (!button) return;
    const rect = button.getBoundingClientRect();
    const next = { top: rect.top, left: rect.left, width: rect.width };
    setModelDropdownRect((previous) =>
      previous && previous.top === next.top && previous.left === next.left && previous.width === next.width
        ? previous
        : next,
    );
  }, []);

  // Close dropdowns on outside click
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (
        dropdownRef.current &&
        !dropdownRef.current.contains(e.target as Node) &&
        modelDropdownPanelRef.current &&
        !modelDropdownPanelRef.current.contains(e.target as Node)
      ) {
        setModelDropdownOpen(false);
      }
      if (thinkingDropdownRef.current && !thinkingDropdownRef.current.contains(e.target as Node)) {
        setThinkingDropdownOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [closeControlDropdowns]);

  useEffect(() => {
    closeControlDropdowns();
  }, [closeControlDropdowns, isMobile, isStreaming]);

  const modelDropdownWasOpenRef = useRef(false);
  useEffect(() => {
    if (modelDropdownWasOpenRef.current && !modelDropdownOpen && modelRefreshing) onModelsRefreshCancel?.();
    modelDropdownWasOpenRef.current = modelDropdownOpen;
  }, [modelDropdownOpen, modelRefreshing, onModelsRefreshCancel]);

  useLayoutEffect(() => {
    if (!modelDropdownOpen) return;
    updateModelDropdownRect();

    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(() => updateModelDropdownRect());
    if (modelButtonRef.current) observer?.observe(modelButtonRef.current);
    if (dropdownRef.current?.parentElement) observer?.observe(dropdownRef.current.parentElement);

    const visualViewport = window.visualViewport;
    window.addEventListener("resize", updateModelDropdownRect);
    window.addEventListener("scroll", updateModelDropdownRect, true);
    visualViewport?.addEventListener("resize", updateModelDropdownRect);
    visualViewport?.addEventListener("scroll", updateModelDropdownRect);
    return () => {
      observer?.disconnect();
      window.removeEventListener("resize", updateModelDropdownRect);
      window.removeEventListener("scroll", updateModelDropdownRect, true);
      visualViewport?.removeEventListener("resize", updateModelDropdownRect);
      visualViewport?.removeEventListener("scroll", updateModelDropdownRect);
    };
  }, [modelDropdownOpen, updateModelDropdownRect]);

  useEffect(() => {
    if (!thinkingDropdownOpen) return;
    const handleEscape = (event: globalThis.KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      event.stopPropagation();
      closeControlDropdowns();
      requestAnimationFrame(() => thinkingButtonRef.current?.focus());
    };
    document.addEventListener("keydown", handleEscape, true);
    return () => document.removeEventListener("keydown", handleEscape, true);
  }, [closeControlDropdowns, thinkingDropdownOpen]);

  return (
    <div
      style={{
        flexShrink: 0,
        background: "transparent",
        padding: "12px 16px",
        paddingRight: isMobile ? 16 : 52, // desktop: 16px base + 36px for ChatMinimap alignment
      }}
    >
      {/* Hidden file input */}
      <input
        ref={fileInputRef}
        type="file"
        multiple
        style={{ display: "none" }}
        onChange={(e) => {
          const files = Array.from(e.target.files ?? []);
          void processFiles(files);
          e.target.value = "";
        }}
      />
      <div className="chat-content-column">
        {/* Queued steering / follow-up messages (delivered by pi on upcoming turns) */}
        {queuedMessages && queuedMessages.steering.length + queuedMessages.followUp.length > 0 && (
          <QueuedMessagesPanel queuedMessages={queuedMessages} onRecallQueue={onRecallQueue} />
        )}
        {retryInfo && <RetryBanner retryInfo={retryInfo} />}
        {imageAttachNotice && (
          <NoticeBanner
            message={imageAttachNotice}
            onDismiss={() => setImageAttachNotice(null)}
            dismissLabel="Dismiss image attachment error"
          />
        )}
        {submissionNotice && (
          <NoticeBanner
            testId="composer-submission-error"
            message={submissionNotice}
            onDismiss={() => setSubmissionNotice(null)}
            dismissLabel={t("dismissSubmissionError", "Dismiss submission error")}
          />
        )}
        {compactResult && <CompactResultBanner result={compactResult} />}

        <div data-composer-anchor style={{ position: "relative" }}>
          {plusMenuOpen && (
            <PlusMenu
              rows={[
                {
                  key: "files",
                  name: t("plusAttachFiles", "Add files"),
                  desc: t("plusAttachFilesDesc", "Upload files from your computer"),
                  icon: <PaperclipIcon size={15} />,
                  onSelect: () => openPicker(),
                },
              ]}
            />
          )}
          {slashMenuOpen && slashQuery !== null && (
            <SlashMenu
              groups={groupedSlashCommands}
              loading={slashCommandsLoading}
              countLabel={slashCommandCountLabel}
              activeIndex={slashActiveIndex}
              itemRefs={slashItemRefs}
              onApply={applySlashCommand}
              onHover={setSlashActiveIndex}
            />
          )}
          {atMenuOpen && atQuery !== null && (
            <AtMenu
              suggestionState={activeSuggestionState}
              matches={atMatches}
              activeIndex={atActiveIndex}
              itemRefs={atItemRefs}
              onApply={applyAtCompletion}
              onHover={setAtActiveIndex}
            />
          )}

          {/* Composer shell: attachments live inside, above the input row */}
          <div
            className="chat-composer-shell"
            style={
              {
                display: "flex",
                flexDirection: "column",
                gap: 8,
                background: "var(--assistant-bg)",
                border: `1px solid ${
                  isStreaming && (onSteer || onFollowUp) ? "var(--warning-border)" : "var(--border)"
                }`,
                borderRadius: "var(--radius-composer)",
                padding: "10px 12px",
                boxShadow: "0 8px 24px color-mix(in srgb, #000 8%, transparent)",
                transition: "border-color 0.15s, background 0.15s, box-shadow 0.15s",
              } as React.CSSProperties
            }
          >
            <div style={{ display: "flex", alignItems: "flex-end", gap: 8, minWidth: 0 }}>
              {/* attach: expands the ＋ menu; tinted while anything is attached */}
              <button
                type="button"
                aria-haspopup="menu"
                aria-expanded={plusMenuOpen}
                onClick={() => setPlusMenuOpen((open) => !open)}
                title={t(
                  "attachLocalFilesDescription",
                  "Add images or local file references. The agent reads absolute paths on this computer; moved files, remote agents, or sandboxes may not be able to access them.",
                )}
                aria-label={t("attachLocalFiles", "Add images or local file references")}
                style={{
                  flexShrink: 0,
                  alignSelf: "flex-end",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  width: 28,
                  height: 28,
                  padding: 0,
                  background: attachmentTokens.length > 0 ? "var(--accent-soft)" : "transparent",
                  border: "none",
                  borderRadius: "var(--radius-control)",
                  color: attachmentTokens.length > 0 ? "var(--accent)" : "var(--text-muted)",
                  cursor: "pointer",
                  transition: "background 0.12s, color 0.12s, transform 0.12s",
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.background =
                    attachmentTokens.length > 0
                      ? "color-mix(in srgb, var(--accent) 14%, transparent)"
                      : "var(--bg-hover)";
                  e.currentTarget.style.color = attachmentTokens.length > 0 ? "var(--accent)" : "var(--text)";
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.background = attachmentTokens.length > 0 ? "var(--accent-soft)" : "transparent";
                  e.currentTarget.style.color = attachmentTokens.length > 0 ? "var(--accent)" : "var(--text-muted)";
                }}
                className="tap-scale"
              >
                <PlusIcon size={16} />
              </button>

              <div style={{ flex: 1, minWidth: 0, display: "flex" }}>
                <ComposerEditable
                  value={value}
                  handleRef={editableRef}
                  placeholder={
                    isStreaming
                      ? t("queuePlaceholder", "Agent is running… sending queues a follow-up")
                      : t("messagePlaceholder", "Message… Type / for commands, @ for files")
                  }
                  onValueChange={(text) => {
                    setValue(text);
                    setPlusMenuOpen(false);
                  }}
                  onSelectionChange={updateAtQuery}
                  onKeyDown={handleKeyDown}
                  onPaste={handlePaste}
                  onCompositionStart={() => {
                    isComposingRef.current = true;
                  }}
                  onCompositionEnd={() => {
                    isComposingRef.current = false;
                    lastCompositionEndAtRef.current = Date.now();
                  }}
                  previewsByPath={tokenPreviewsByPath}
                  missingByPath={missingTokenInspections}
                  onRevealToken={(path) => {
                    void window.piBridge?.showItemInFolder?.(path);
                  }}
                  removeLabel={t("remove", "Remove")}
                />
              </div>

              {isStreaming ? (
                canSend && onFollowUp ? (
                  <SendSquare armed onSend={() => void sendQueued("followup")} />
                ) : (
                  <StopSquare onAbort={onAbort} />
                )
              ) : (
                <SendSquare armed={canSend} onSend={() => void handleSend()} />
              )}
            </div>
          </div>
        </div>

        {/* Session controls bar: model picker | spacer | thinking · compact · sound */}
        <div
          style={{
            marginTop: 8,
            display: "flex",
            alignItems: "center",
            gap: isMobile ? 2 : 6,
          }}
        >
          <div style={{ flex: isMobile ? "1 1 auto" : "0 0 auto", minWidth: 0, display: "flex" }}>
            <ModelPicker
              model={model}
              modelsByProvider={modelsByProvider}
              currentName={currentName}
              isMobile={isMobile}
              isStreaming={isStreaming}
              dropdownOpen={modelDropdownOpen}
              onToggle={() => {
                updateModelDropdownRect();
                setModelDropdownOpen((v) => !v);
              }}
              buttonRef={modelButtonRef}
              containerRef={dropdownRef}
              panelRef={modelDropdownPanelRef}
              dropdownRect={modelDropdownRect}
              modelCatalog={modelCatalog}
              modelRefreshing={modelRefreshing}
              onModelChange={onModelChange}
              onModelsRefresh={onModelsRefresh}
              onModelPick={(provider, modelId, isActive) => {
                setModelDropdownOpen(false);
                if (!isActive || isAutoModelSelection) onModelChange?.(provider, modelId);
              }}
            />
          </div>
          <SessionControls
            isMobile={isMobile}
            isStreaming={isStreaming}
            closeDropdowns={closeControlDropdowns}
            thinkingLevel={thinkingLevel}
            onThinkingLevelChange={onThinkingLevelChange}
            availableThinkingLevels={availableThinkingLevels}
            thinkingLevelMap={thinkingLevelMap}
            thinkingDropdownOpen={thinkingDropdownOpen}
            onThinkingToggle={() => {
              if (isStreaming) return;
              setModelDropdownOpen(false);
              setThinkingDropdownOpen((v) => !v);
            }}
            thinkingContainerRef={thinkingDropdownRef}
            thinkingButtonRef={thinkingButtonRef}
            onCompact={onCompact}
            onAbortCompaction={onAbortCompaction}
            isCompacting={isCompacting}
            compactError={compactError}
            contextUsage={contextUsage}
            soundEnabled={soundEnabled}
            onSoundToggle={onSoundToggle}
          />
        </div>
      </div>
    </div>
  );
});
