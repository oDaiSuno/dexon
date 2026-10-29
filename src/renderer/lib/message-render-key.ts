export type MessageRenderRole = "message" | "process" | "answer" | "failure" | "turn";

const MAX_SCREEN_ALIASES = 2000;

export class MessageRenderKeyRegistry {
  private readonly screenBaseByMessage = new WeakMap<object, string>();
  private readonly screenBaseByEntryId = new Map<string, string>();
  private nextLocalId = 0;

  keyFor(message: object, entryId: string | undefined, role: MessageRenderRole): string {
    return `${this.baseFor(message, entryId)}:${role}`;
  }

  screenKey(key: string): string {
    const match = /^entry:([^:]+)(:.*)$/.exec(key);
    if (!match) return key;
    const screenBase = this.screenBaseByEntryId.get(match[1]);
    return screenBase === undefined ? key : `${screenBase}${match[2]}`;
  }

  private baseFor(message: object, entryId: string | undefined): string {
    const known = this.screenBaseByMessage.get(message);
    if (!entryId) {
      const local = known ?? `local:${++this.nextLocalId}`;
      this.screenBaseByMessage.set(message, local);
      return local;
    }
    const saved = `entry:${entryId}`;
    const screenBase = known ?? this.screenBaseByEntryId.get(entryId) ?? saved;
    this.screenBaseByMessage.set(message, screenBase);
    if (screenBase !== saved) this.rememberScreenBase(entryId, screenBase);
    return saved;
  }

  private rememberScreenBase(entryId: string, screenBase: string): void {
    this.screenBaseByEntryId.set(entryId, screenBase);
    while (this.screenBaseByEntryId.size > MAX_SCREEN_ALIASES) {
      const oldest = this.screenBaseByEntryId.keys().next().value;
      if (oldest === undefined) break;
      this.screenBaseByEntryId.delete(oldest);
    }
  }
}
