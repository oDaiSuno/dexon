import type { AgentEvent, CustomUiComponent } from "./types";
import { PendingUiRequests } from "./pending-ui";

function customWidth(options: unknown): number {
  if (!options || typeof options !== "object") return 92;
  const overlay = (options as { overlayOptions?: unknown }).overlayOptions;
  const resolved = typeof overlay === "function" ? overlay() : overlay;
  const width = resolved && typeof resolved === "object" ? (resolved as { width?: unknown }).width : undefined;
  return typeof width === "number" && Number.isFinite(width) ? Math.max(40, Math.min(140, Math.round(width))) : 92;
}

export class CustomUiBridge {
  private components = new Map<string, { component: CustomUiComponent; width: number }>();

  constructor(
    private readonly requests: PendingUiRequests,
    private readonly emit: (event: AgentEvent) => void,
  ) {}

  request<T>(factory: unknown, options?: unknown): Promise<T> {
    if (typeof factory !== "function") return Promise.resolve(undefined as T);
    const owner: { id?: string } = {};
    const opened = this.requests.open<T>(
      { method: "custom", lines: [] },
      undefined as T,
      () => {
        throw new Error("Custom UI requires keyboard input or explicit abandonment");
      },
      {
        onFinish: () => {
          if (owner.id) this.dispose(owner.id);
        },
      },
    );
    const { id, promise, finish } = opened;
    owner.id = id;
    const tui = { requestRender: () => this.render(id) };
    void Promise.resolve()
      .then(() =>
        this.requests.contains(id)
          ? factory(tui, undefined, undefined, (value: T) => finish(value, "completed"))
          : null,
      )
      .then((component: CustomUiComponent | null) => {
        if (!component || typeof component.render !== "function") {
          finish(undefined as T, "expired");
          return;
        }
        if (!this.requests.contains(id)) {
          try {
            component.dispose?.();
          } catch {
            /* Already settled. */
          }
          return;
        }
        this.components.set(id, { component, width: customWidth(options) });
        this.render(id);
      })
      .catch((error: unknown) => {
        finish(undefined as T, "expired");
        this.reportError(id, error);
      });
    return promise;
  }

  input(id: string, data: string): void {
    const custom = this.components.get(id);
    if (!custom || !this.requests.contains(id)) throw new Error("Interactive request is no longer available");
    if (typeof data !== "string") throw new Error("Invalid custom input");
    custom.component.handleInput?.(data);
    this.render(id);
  }

  private render(id: string): void {
    const custom = this.components.get(id);
    if (!custom || !this.requests.contains(id)) return;
    try {
      this.requests.update(id, { lines: custom.component.render(custom.width) });
    } catch (error) {
      this.reportError(id, error);
      this.requests.respond({ type: "extension_ui_response", id, cancelled: true });
    }
  }

  private dispose(id: string): void {
    const custom = this.components.get(id);
    this.components.delete(id);
    custom?.component.dispose?.();
  }

  private reportError(id: string, error: unknown): void {
    this.emit({
      type: "extension_error",
      extensionPath: `custom-ui:${id}`,
      event: "custom_ui",
      error: error instanceof Error ? error.message : String(error),
    });
  }
}
