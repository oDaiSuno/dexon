import { call, subscribeAgentEvents, subscribeAuthLogin, subscribeRunning } from "./api-client";
import { fileTargetFromUrl } from "./api-file-route";

export class ApiEventSource {
  static CONNECTING = 0;
  static OPEN = 1;
  static CLOSED = 2;

  readyState = ApiEventSource.CONNECTING;
  onmessage: ((ev: MessageEvent) => void) | null = null;
  onerror: ((ev: Event) => void) | null = null;
  onopen: ((ev: Event) => void) | null = null;

  private unsub: (() => void) | null = null;
  private named = new Map<string, Set<(ev: Event) => void>>();
  private fileTarget: ReturnType<typeof fileTargetFromUrl> | null = null;
  private closed = false;

  constructor(url: string) {
    void this.connect(url);
  }

  private generation = 0;

  private dispatchNamed(type: string, data: unknown) {
    const me = { data: typeof data === "string" ? data : JSON.stringify(data) } as MessageEvent;
    this.named.get(type)?.forEach((cb) => {
      try {
        cb(me);
      } catch {}
    });
  }

  private async connect(url: string) {
    const gen = ++this.generation;
    try {
      const u = new URL(url, "http://local");
      const segs = u.pathname
        .replace(/^\/api\//, "")
        .split("/")
        .filter(Boolean);

      if (segs[0] === "agent" && segs[1] === "running" && segs[2] === "events") {
        this.unsub = await subscribeRunning((event) => {
          if (this.closed || gen !== this.generation) return;
          this.readyState = ApiEventSource.OPEN;
          this.onmessage?.({ data: JSON.stringify(event) } as MessageEvent);
        });
        if (this.closed || gen !== this.generation) {
          this.unsub?.();
          return;
        }
        this.readyState = ApiEventSource.OPEN;
        this.onopen?.(new Event("open"));
        return;
      }

      if (segs[0] === "agent" && segs[2] === "events") {
        const sessionId = decodeURIComponent(segs[1]);
        this.unsub = await subscribeAgentEvents(sessionId, (event) => {
          if (this.closed || gen !== this.generation) return;
          this.readyState = ApiEventSource.OPEN;

          this.onmessage?.({ data: JSON.stringify(event) } as MessageEvent);
        });
        if (this.closed || gen !== this.generation) {
          this.unsub?.();
          return;
        }
        this.readyState = ApiEventSource.OPEN;
        this.onopen?.(new Event("open"));
        this.onmessage?.({ data: JSON.stringify({ type: "connected" }) } as MessageEvent);
        return;
      }

      if (segs[0] === "auth" && segs[1] === "login") {
        const provider = decodeURIComponent(segs[2] ?? "");
        this.unsub = await subscribeAuthLogin(provider, (event) => {
          if (this.closed || gen !== this.generation) return;
          this.readyState = ApiEventSource.OPEN;
          this.onmessage?.({ data: JSON.stringify(event) } as MessageEvent);
        });
        if (this.closed || gen !== this.generation) {
          this.unsub?.();
          void call("auth.loginCancel", { provider }).catch(() => {});
          return;
        }
        const result = await call("auth.loginStart", { provider });
        if (!result.started) {
          throw new Error("An OAuth login is already active. Cancel it and try again.");
        }
        if (this.closed || gen !== this.generation) {
          void call("auth.loginCancel", { provider }).catch(() => {});
          return;
        }
        this.readyState = ApiEventSource.OPEN;
        this.onopen?.(new Event("open"));
        return;
      }

      if (segs[0] === "files") {
        const target = fileTargetFromUrl(u);
        const { api, path: filePath, sourceSessionId } = target;
        this.fileTarget = target;

        this.unsub = await api.subscribe("files.changed", filePath, (ev) => {
          if (this.closed || gen !== this.generation) return;
          this.readyState = ApiEventSource.OPEN;
          const eventName = ev.event ?? "change";
          this.dispatchNamed(eventName, {
            mtime: ev.mtime,
            size: ev.size,
            message: ev.message,
            filePath: ev.path,
          });
        });
        if (this.closed || gen !== this.generation) {
          this.unsub?.();
          return;
        }
        await api.call("files.watchStart", { path: filePath, sourceSessionId });
        if (this.closed || gen !== this.generation) {
          void api.call("files.watchStop", { path: filePath }).catch(() => {});
          return;
        }
        this.readyState = ApiEventSource.OPEN;
        this.onopen?.(new Event("open"));
        return;
      }

      this.readyState = ApiEventSource.CLOSED;
      this.onerror?.(new Event("error"));
    } catch (error) {
      if (!this.closed) {
        this.readyState = ApiEventSource.CLOSED;
        const message = error instanceof Error ? error.message : String(error);
        this.onerror?.(new ErrorEvent("error", { message }));
      }
    }
  }

  close() {
    if (this.closed) return;
    this.closed = true;
    this.generation += 1;
    this.readyState = ApiEventSource.CLOSED;
    this.unsub?.();
    this.unsub = null;

    if (this.fileTarget) {
      const { api, path } = this.fileTarget;
      void api.call("files.watchStop", { path }).catch(() => {});
      this.fileTarget = null;
    }
  }

  addEventListener(type: string, cb: EventListenerOrEventListenerObject) {
    const fn = typeof cb === "function" ? cb : (cb as EventListenerObject).handleEvent.bind(cb);
    let set = this.named.get(type);
    if (!set) {
      set = new Set();
      this.named.set(type, set);
    }
    set.add(fn as (ev: Event) => void);
  }

  removeEventListener(type: string, cb: EventListenerOrEventListenerObject) {
    const fn = typeof cb === "function" ? cb : (cb as EventListenerObject).handleEvent.bind(cb);
    this.named.get(type)?.delete(fn as (ev: Event) => void);
  }
}
