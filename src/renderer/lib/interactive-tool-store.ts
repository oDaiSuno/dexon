import {
  createToolDraft,
  type InteractiveAnswer,
  type InteractiveReceipt,
  type InteractiveRequest,
  type InteractiveSnapshot,
  type ToolDraft,
} from "@shared/interactive-tools";

export type CardStatus = "checking" | "pending" | "sending" | "failed" | InteractiveReceipt["status"];
export interface ToolCardEntry {
  request: InteractiveRequest;
  draft: ToolDraft;
  status: CardStatus;
  error?: string;
}
interface SavedDrafts {
  runtimeId: string;
  drafts: Record<string, ToolDraft>;
}
interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}
export interface ToolCardState {
  entries: ToolCardEntry[];
  verified: boolean;
  storageFailed: boolean;
  expiredDraft?: boolean;
}
export const isPendingCard = (entry: ToolCardEntry) =>
  ["pending", "sending", "failed", "checking"].includes(entry.status);

/** Session-scoped external state: the view can unmount without ending a request. */
export class InteractiveToolStore {
  private state: ToolCardState = { entries: [], verified: false, storageFailed: false };
  private listeners = new Set<() => void>();
  private runtimeId: string | null = null;
  private retiredRuntimes = new Set<string>();
  private revision = -1;
  private generation = 0;
  private sessionId: string | null;
  private saved: SavedDrafts | null = null;
  private inputTail: Promise<void> = Promise.resolve();
  constructor(
    sessionId: string | null,
    private readonly send: (sessionId: string, command: Record<string, unknown>) => Promise<unknown>,
    private readonly storage?: StorageLike,
  ) {
    this.sessionId = sessionId;
    this.readSaved();
  }

  bindSession(sessionId: string): void {
    if (this.sessionId === sessionId) return;
    if (this.sessionId) throw new Error("Interactive state cannot move between sessions");
    this.sessionId = sessionId;
    this.readSaved();
  }

  getSnapshot = (): ToolCardState => this.state;
  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };
  getVersion(): number {
    return this.generation;
  }

  private get key(): string {
    return `dexon-tool-draft:v1:${this.sessionId}`;
  }
  private readSaved(): void {
    if (!this.sessionId) return;
    try {
      const raw = this.storage?.getItem(this.key);
      const value = raw ? (JSON.parse(raw) as SavedDrafts) : null;
      this.saved =
        value && typeof value.runtimeId === "string" && value.drafts && typeof value.drafts === "object" ? value : null;
    } catch {
      this.saved = null;
    }
  }
  private publish(entries = this.state.entries): void {
    this.generation++;
    this.state = { ...this.state, entries };
    try {
      if (this.sessionId && this.runtimeId) {
        const drafts = Object.fromEntries(entries.filter(isPendingCard).map((e) => [e.request.id, e.draft]));
        if (Object.keys(drafts).length)
          this.storage?.setItem(this.key, JSON.stringify({ runtimeId: this.runtimeId, drafts }));
        else this.storage?.removeItem(this.key);
      }
    } catch {
      this.state = { ...this.state, storageFailed: true };
    }
    for (const listener of this.listeners) listener();
  }

  /** Revision ordering prevents an earlier RPC snapshot resurrecting settled UI. */
  reconcile(snapshot: InteractiveSnapshot | null): void {
    if (!snapshot) {
      if (this.runtimeId) this.retiredRuntimes.add(this.runtimeId);
      if (this.saved) this.retiredRuntimes.add(this.saved.runtimeId);
      if (this.saved && !this.state.entries.length) this.state = { ...this.state, expiredDraft: true };
      try {
        if (this.sessionId) this.storage?.removeItem(this.key);
      } catch {
        /* Never reactivate a stale draft. */
      }
      this.saved = null;
      this.state = { ...this.state, verified: true };
      this.publish(
        this.state.entries.map((e) => (isPendingCard(e) ? { ...e, status: "expired", error: undefined } : e)),
      );
      return;
    }
    if (this.retiredRuntimes.has(snapshot.runtimeId)) return;
    if (snapshot.runtimeId === this.runtimeId && snapshot.revision < this.revision) return;
    if (this.saved && this.saved.runtimeId !== snapshot.runtimeId && !this.state.entries.length) {
      this.retiredRuntimes.add(this.saved.runtimeId);
      this.state = { ...this.state, expiredDraft: true };
    }
    if (
      this.saved?.runtimeId === snapshot.runtimeId &&
      Object.keys(this.saved.drafts).some(
        (id) =>
          !snapshot.requests.some((request) => request.id === id) &&
          !snapshot.completed.some((receipt) => receipt.id === id && receipt.status !== "expired"),
      )
    ) {
      this.state = { ...this.state, expiredDraft: true };
    }
    const sameRuntime = snapshot.runtimeId === this.runtimeId;
    if (this.runtimeId && !sameRuntime) this.retiredRuntimes.add(this.runtimeId);
    this.runtimeId = snapshot.runtimeId;
    this.revision = snapshot.revision;
    const previous = sameRuntime ? this.state.entries : [];
    const completed = new Map(snapshot.completed.map((r) => [r.id, r]));

    const entries: ToolCardEntry[] = snapshot.requests
      .filter((request) => {
        const old = previous.find((e) => e.request.id === request.id);
        return !old || isPendingCard(old);
      })
      .map((request) => {
        const old = previous.find((e) => e.request.id === request.id);
        const draft = old?.draft ?? this.restoreDraft(request, snapshot.runtimeId);
        return {
          request,
          draft,
          status: old && isPendingCard(old) ? old.status : "pending",
          ...(old?.error ? { error: old.error } : {}),
        };
      });
    const ended = previous
      .filter((e) => !entries.some((active) => active.request.id === e.request.id))
      .map((e): ToolCardEntry => ({
        ...e,
        status: completed.get(e.request.id)?.status ?? (isPendingCard(e) ? "expired" : e.status),
        error: undefined,
      }));
    if (!sameRuntime)
      ended.push(...this.state.entries.filter(isPendingCard).map((e): ToolCardEntry => ({ ...e, status: "expired" })));
    this.saved = null;
    this.state = { ...this.state, verified: true };
    // One compact terminal receipt is enough; completed cards never re-enter the queue.
    const newlyEnded = ended.find((e) => previous.some((old) => old.request.id === e.request.id && isPendingCard(old)));
    const lastReceipt = newlyEnded ?? ended.at(-1);
    this.publish([...entries, ...(lastReceipt ? [lastReceipt] : [])]);
  }

  private restoreDraft(request: InteractiveRequest, runtimeId: string): ToolDraft {
    const fallback = createToolDraft(request);
    const saved = this.saved?.runtimeId === runtimeId ? this.saved.drafts[request.id] : null;
    if (
      !saved ||
      typeof saved.collapsed !== "boolean" ||
      typeof saved.value !== "string" ||
      !Array.isArray(saved.answers)
    )
      return fallback;
    if (!Number.isInteger(saved.questionIndex) || saved.questionIndex < 0) return fallback;
    if (request.method === "questionnaire") {
      if (saved.questionIndex >= request.questions.length || saved.answers.length !== request.questions.length)
        return fallback;
      if (
        saved.answers.some(
          (answer, i) =>
            !answer ||
            typeof answer.text !== "string" ||
            !Array.isArray(answer.selected) ||
            answer.selected.some(
              (index) => !Number.isInteger(index) || index < 0 || index >= request.questions[i].options.length,
            ),
        )
      )
        return fallback;
    }
    return saved;
  }

  updateDraft(id: string, update: (draft: ToolDraft) => ToolDraft): void {
    this.publish(
      this.state.entries.map((e) =>
        e.request.id === id && isPendingCard(e) && e.status !== "sending" ? { ...e, draft: update(e.draft) } : e,
      ),
    );
  }
  setCollapsed(id: string, collapsed: boolean): void {
    this.publish(this.state.entries.map((e) => (e.request.id === id ? { ...e, draft: { ...e.draft, collapsed } } : e)));
  }
  dismissExpiredDraft(): void {
    this.state = { ...this.state, expiredDraft: false };
    this.publish();
  }

  dismiss(id: string): void {
    this.publish(this.state.entries.filter((e) => e.request.id !== id || isPendingCard(e)));
  }

  async respond(id: string, answer: InteractiveAnswer): Promise<void> {
    const entry = this.state.entries.find((e) => e.request.id === id);
    const sid = this.sessionId;
    const runtimeId = this.runtimeId;
    if (!sid || !entry || !this.state.verified || !isPendingCard(entry) || entry.status === "sending") return;
    this.patch(id, { status: "sending", error: undefined });
    try {
      const result = (await this.send(sid, { type: "extension_ui_response", id, ...answer })) as InteractiveReceipt;
      if (runtimeId !== this.runtimeId) return;
      if (!result || result.id !== id || !["submitted", "cancelled", "completed", "expired"].includes(result.status))
        throw new Error("Missing request acknowledgement");
      this.patch(id, { status: result.status, error: undefined });
    } catch (error) {
      const current = this.state.entries.find((e) => e.request.id === id);
      if (runtimeId === this.runtimeId && current && isPendingCard(current))
        this.patch(id, { status: "failed", error: String(error) });
    }
  }

  input(id: string, data: string): void {
    const sid = this.sessionId;
    const runtimeId = this.runtimeId;
    this.inputTail = this.inputTail.then(async () => {
      const entry = this.state.entries.find((e) => e.request.id === id);
      if (!sid || !entry || !isPendingCard(entry) || entry.status === "sending") return;
      try {
        await this.send(sid, { type: "extension_ui_input", id, data });
      } catch (error) {
        const current = this.state.entries.find((e) => e.request.id === id);
        if (runtimeId === this.runtimeId && current && isPendingCard(current))
          this.patch(id, { status: "failed", error: String(error) });
      }
    });
  }
  private patch(id: string, changes: Partial<ToolCardEntry>): void {
    this.publish(this.state.entries.map((e) => (e.request.id === id ? { ...e, ...changes } : e)));
  }
}

export function toolDraftStorage(): StorageLike | undefined {
  try {
    return typeof window !== "undefined" ? window.sessionStorage : undefined;
  } catch {
    return undefined;
  }
}
