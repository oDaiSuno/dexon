export interface ChatDraftImage {
  data: string;
  mimeType: string;
}

export interface ChatDraftFile {
  name: string;
  path: string;
}

/**
 * Composer draft. Attachments live in the message text as `@path` tokens, so
 * the persisted draft is just the text. `images`/`files` are only populated
 * when loading a legacy v2 draft whose base64 images and file references must
 * be migrated to tokens; they are never written in the v3 schema.
 */
export interface ChatDraft {
  value: string;
  images?: ChatDraftImage[];
  files?: ChatDraftFile[];
}

interface PersistedChatDraftV3 {
  schemaVersion: typeof CHAT_DRAFT_SCHEMA_VERSION;
  value: string;
  updatedAt: number;
}

const drafts = new Map<string, ChatDraft | null>();
const LS_PREFIX = "dexon-draft:";
export const CHAT_DRAFT_SCHEMA_VERSION = 3;
/** Legacy v2 marker so loaded drafts can be told apart without version checks. */
export const CHAT_DRAFT_V2_SCHEMA_VERSION = 2;
export const MAX_DRAFT_FILE_PATH_CHARS = 32_768;

function cloneDraft(draft: ChatDraft): ChatDraft {
  return {
    value: draft.value,
    ...(draft.images ? { images: draft.images.map((image) => ({ ...image })) } : {}),
    ...(draft.files ? { files: draft.files.map((file) => ({ ...file })) } : {}),
  };
}

function isEmptyDraft(draft: ChatDraft): boolean {
  return !draft.value;
}

function persistKey(key: string): string {
  return LS_PREFIX + key;
}

function isValidLegacyImage(image: unknown): image is ChatDraftImage {
  if (!image || typeof image !== "object") return false;
  const candidate = image as Partial<ChatDraftImage>;
  return typeof candidate.data === "string" && typeof candidate.mimeType === "string";
}

function isValidLegacyFile(file: unknown): file is ChatDraftFile {
  if (!file || typeof file !== "object") return false;
  const candidate = file as Partial<ChatDraftFile>;
  if (typeof candidate.name !== "string" || typeof candidate.path !== "string") return false;
  const filePath = candidate.path;
  if (!filePath || filePath.includes("\0") || filePath.length > MAX_DRAFT_FILE_PATH_CHARS) return false;
  // Legacy v2 only persisted absolute paths; keep the same bar on migration.
  const isAbsolute =
    filePath.startsWith("/") ||
    filePath.startsWith("\\\\") ||
    filePath.startsWith("//") ||
    /^[a-zA-Z]:[\\/]/.test(filePath);
  return isAbsolute;
}

function loadFromStorage(key: string): ChatDraft | null {
  if (typeof localStorage === "undefined") return null;
  try {
    const raw = localStorage.getItem(persistKey(key));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<PersistedChatDraftV3> & {
      schemaVersion?: unknown;
      images?: unknown;
      files?: unknown;
    };
    const schemaVersion = parsed.schemaVersion as unknown;
    if (!parsed || typeof parsed !== "object" || typeof parsed.value !== "string") return null;
    // Unknown future versions must not be interpreted as the current schema.
    if (
      schemaVersion !== undefined &&
      schemaVersion !== CHAT_DRAFT_SCHEMA_VERSION &&
      schemaVersion !== CHAT_DRAFT_V2_SCHEMA_VERSION
    ) {
      return null;
    }
    const isLegacy = schemaVersion === CHAT_DRAFT_V2_SCHEMA_VERSION;
    return {
      value: parsed.value,
      ...(isLegacy && Array.isArray(parsed.images) ? { images: parsed.images.filter(isValidLegacyImage) } : {}),
      ...(isLegacy && Array.isArray(parsed.files) ? { files: parsed.files.filter(isValidLegacyFile) } : {}),
    };
  } catch {
    return null;
  }
}

function saveToStorage(key: string, draft: ChatDraft | null): boolean {
  if (typeof localStorage === "undefined") return true;
  try {
    if (!draft || isEmptyDraft(draft)) {
      localStorage.removeItem(persistKey(key));
      return true;
    }
    const toStore: PersistedChatDraftV3 = {
      schemaVersion: CHAT_DRAFT_SCHEMA_VERSION,
      value: draft.value,
      updatedAt: Date.now(),
    };
    localStorage.setItem(persistKey(key), JSON.stringify(toStore));
    return true;
  } catch {
    return false;
  }
}

export function getDraft(key: string): ChatDraft | null {
  if (drafts.has(key)) {
    const mem = drafts.get(key);
    return mem ? cloneDraft(mem) : null;
  }
  const stored = loadFromStorage(key);
  if (stored) {
    drafts.set(key, cloneDraft(stored));
    return cloneDraft(stored);
  }
  return null;
}

export function setDraft(key: string, draft: ChatDraft): void {
  if (isEmptyDraft(draft)) {
    drafts.set(key, null);
    return;
  }
  drafts.set(key, cloneDraft(draft));
}

export function flushDraft(key: string): boolean {
  return saveToStorage(key, drafts.get(key) ?? null);
}

export function clearDraft(key: string): boolean {
  drafts.set(key, null);
  return saveToStorage(key, null);
}

interface DraftPersistenceDependencies {
  stage: (key: string, draft: ChatDraft) => void;
  flush: (key: string) => boolean | void;
  clear: (key: string) => boolean | void;
  setTimer: (callback: () => void, delayMs: number) => ReturnType<typeof setTimeout>;
  clearTimer: (timer: ReturnType<typeof setTimeout>) => void;
}

const browserPersistenceDependencies: DraftPersistenceDependencies = {
  stage: setDraft,
  flush: flushDraft,
  clear: clearDraft,
  setTimer: (callback, delayMs) => setTimeout(callback, delayMs),
  clearTimer: (timer) => clearTimeout(timer),
};

export class DraftPersistenceController {
  private pendingKey: string | null = null;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private readonly delayMs: number;
  private readonly dependencies: DraftPersistenceDependencies;
  private readonly onPersistenceError?: (key: string) => void;

  constructor(
    delayMs = 500,
    dependencies: DraftPersistenceDependencies = browserPersistenceDependencies,
    onPersistenceError?: (key: string) => void,
  ) {
    this.delayMs = delayMs;
    this.dependencies = dependencies;
    this.onPersistenceError = onPersistenceError;
  }

  schedule(key: string, draft: ChatDraft): void {
    if (this.pendingKey && this.pendingKey !== key) this.flush();
    this.dependencies.stage(key, draft);
    this.pendingKey = key;
    if (this.timer) this.dependencies.clearTimer(this.timer);
    this.timer = this.dependencies.setTimer(() => {
      this.timer = null;
      const pendingKey = this.pendingKey;
      this.pendingKey = null;
      if (pendingKey) this.flushKey(pendingKey);
    }, this.delayMs);
  }

  commit(key: string, draft: ChatDraft): boolean {
    if (this.pendingKey === key) {
      this.cancelTimer();
      this.pendingKey = null;
    } else {
      this.flush();
    }
    this.dependencies.stage(key, draft);
    return this.flushKey(key);
  }

  clear(key: string): boolean {
    if (this.pendingKey === key) {
      this.cancelTimer();
      this.pendingKey = null;
    }
    const result = this.dependencies.clear(key);
    if (result === false) this.onPersistenceError?.(key);
    return result !== false;
  }

  flush(): boolean {
    this.cancelTimer();
    const pendingKey = this.pendingKey;
    this.pendingKey = null;
    return pendingKey ? this.flushKey(pendingKey) : true;
  }

  dispose(): boolean {
    return this.flush();
  }

  private cancelTimer(): void {
    if (!this.timer) return;
    this.dependencies.clearTimer(this.timer);
    this.timer = null;
  }

  private flushKey(key: string): boolean {
    const result = this.dependencies.flush(key);
    if (result === false) this.onPersistenceError?.(key);
    return result !== false;
  }
}
