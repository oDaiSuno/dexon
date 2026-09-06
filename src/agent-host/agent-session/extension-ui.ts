import { parseQuestionAnswers } from "../../shared/questionnaire";
import { randomUUID } from "crypto";
import type {
  InteractiveReceipt,
  InteractiveSnapshot,
  QuestionDraft,
  ToolQuestion,
} from "../../shared/interactive-tools";
import type { AgentSessionLike, ExtensionUiContextLike } from "../../shared/pi-types";
import type { ExtensionUiRequest, ExtensionUiResponse, ExtensionWidgetItem } from "../../shared/types";
import { CustomUiBridge } from "./custom-ui";
import { PendingUiRequests } from "./pending-ui";
import type { AgentEvent, ExtensionCommandContextActionsLike } from "./types";

export abstract class SessionExtensionUi {
  public abstract readonly inner: AgentSessionLike;
  protected abstract applyForcedEmptySystemPrompt(): void;
  protected abstract emit(event: AgentEvent): void;
  protected abstract externalTurnActive: boolean;

  protected readonly uiRequests = new PendingUiRequests((event) => this.emit(event));
  protected readonly customUi = new CustomUiBridge(this.uiRequests, (event) => this.emit(event));

  getInteractiveSnapshot(): InteractiveSnapshot {
    return this.uiRequests.snapshot();
  }
  cancelInteractiveRequests(): void {
    this.uiRequests.cancelAll();
  }

  requestQuestionnaire(questions: ToolQuestion[], signal?: AbortSignal): Promise<QuestionDraft[] | undefined> {
    return this.requestExtensionUi(
      { method: "questionnaire", questions },
      undefined,
      (response) => parseQuestionAnswers(questions, "answers" in response ? response.answers : undefined),
      undefined,
      signal,
    );
  }

  protected extensionStatuses = new Map<string, string>();

  protected runtimeDiagnosticStatuses = new Map<string, string>();

  protected extensionWidgets = new Map<string, ExtensionWidgetItem>();

  protected extensionWorkingMessage = "Working";

  protected extensionWorkingIndicator = "";

  protected extensionWorkingVisible = true;

  protected extensionEditorText = "";

  protected unsupportedExtensionFeatures = new Set<string>();

  protected resolveExtensionUiResponse(response: ExtensionUiResponse): InteractiveReceipt {
    return this.uiRequests.respond(response);
  }

  protected handleExtensionUiInput(id: string, data: string): void {
    this.customUi.input(id, data);
  }

  protected getExtensionStatuses(): Array<{ key: string; text: string }> {
    return Array.from(new Map([...this.runtimeDiagnosticStatuses, ...this.extensionStatuses]), ([key, text]) => ({
      key,
      text,
    }));
  }

  protected setExtensionStatus(key: string, text: string | undefined): void {
    if (text === undefined) this.extensionStatuses.delete(key);
    else this.extensionStatuses.set(key, text);
    this.emit({
      type: "extension_ui_request",
      id: randomUUID(),
      method: "setStatus",
      statusKey: key,
      statusText: text,
    } as ExtensionUiRequest as AgentEvent);
  }

  protected syncExtensionWorkingStatus(): void {
    this.setExtensionStatus(
      "extension-working",
      this.extensionWorkingVisible
        ? [this.extensionWorkingIndicator, this.extensionWorkingMessage].filter(Boolean).join(" ")
        : undefined,
    );
  }

  protected reportUnsupportedExtensionFeature(feature: string): void {
    if (this.unsupportedExtensionFeatures.has(feature)) return;
    this.unsupportedExtensionFeatures.add(feature);
    this.emit({
      type: "extension_ui_request",
      id: randomUUID(),
      method: "notify",
      message: `Extension feature “${feature}” is terminal-specific and is not available in the desktop renderer.`,
      notifyType: "warning",
    } as ExtensionUiRequest as AgentEvent);
  }

  protected getExtensionWidgets(): ExtensionWidgetItem[] {
    return Array.from(this.extensionWidgets.values());
  }

  private requestExtensionCustomUi<T>(factory: unknown, options?: unknown): Promise<T> {
    if (this.blockHeadless("custom")) return Promise.resolve(undefined as T);
    return this.customUi.request<T>(factory, options);
  }

  private blockHeadless(feature: string): boolean {
    if (!this.externalTurnActive) return false;
    this.emit({
      type: "channel_headless_ui_blocked",
      feature,
      errorMessage: "Interactive extension UI is unavailable for messaging-channel turns.",
    });
    return true;
  }

  private requestExtensionUi<T>(
    request: Parameters<PendingUiRequests["open"]>[0],
    defaultValue: T,
    parseResponse: (response: ExtensionUiResponse) => T,
    timeout?: number,
    signal?: AbortSignal,
  ): Promise<T> {
    if (this.blockHeadless(request.method)) return Promise.resolve(defaultValue);
    return this.uiRequests.open(request, defaultValue, parseResponse, { timeout, signal }).promise;
  }

  protected createExtensionUiContext(): ExtensionUiContextLike {
    return {
      select: (title, options, opts) =>
        this.requestExtensionUi(
          { method: "select", title, options, ...(opts?.timeout ? { timeout: opts.timeout } : {}) },
          undefined,
          (response) => {
            if (!("value" in response) || !options.includes(response.value)) throw new Error("Expected a text answer");
            return response.value;
          },
          opts?.timeout,
          opts?.signal,
        ),
      confirm: (title, message, opts) =>
        this.requestExtensionUi(
          { method: "confirm", title, message, ...(opts?.timeout ? { timeout: opts.timeout } : {}) },
          false,
          (response) => {
            if (!("confirmed" in response) || typeof response.confirmed !== "boolean")
              throw new Error("Expected explicit confirmation");
            return response.confirmed;
          },
          opts?.timeout,
          opts?.signal,
        ),
      input: (title, placeholder, opts) =>
        this.requestExtensionUi(
          {
            method: "input",
            title,
            ...(placeholder !== undefined ? { placeholder } : {}),
            ...(opts?.timeout ? { timeout: opts.timeout } : {}),
          },
          undefined,
          (response) => {
            if (!("value" in response) || typeof response.value !== "string") throw new Error("Expected a text answer");
            return response.value;
          },
          opts?.timeout,
          opts?.signal,
        ),
      editor: (title, prefill, opts) =>
        this.requestExtensionUi(
          {
            method: "editor",
            title,
            ...(prefill !== undefined ? { prefill } : {}),
            ...(opts?.timeout ? { timeout: opts.timeout } : {}),
          },
          undefined,
          (response) => {
            if (!("value" in response) || typeof response.value !== "string") throw new Error("Expected a text answer");
            return response.value;
          },
          opts?.timeout,
          opts?.signal,
        ),
      notify: (message, type) => {
        this.emit({
          type: "extension_ui_request",
          id: randomUUID(),
          method: "notify",
          message,
          notifyType: type,
        } as ExtensionUiRequest as AgentEvent);
      },
      onTerminalInput: () => {
        this.reportUnsupportedExtensionFeature("raw terminal input");
        return () => {};
      },
      setStatus: (key, text) => {
        this.setExtensionStatus(key, text);
      },
      setWorkingMessage: (message) => {
        this.extensionWorkingMessage = message?.trim() || "Working";
        this.syncExtensionWorkingStatus();
      },
      setWorkingVisible: (visible) => {
        this.extensionWorkingVisible = visible;
        this.syncExtensionWorkingStatus();
      },
      setWorkingIndicator: (options) => {
        const frame = options?.frames?.[0];
        if (options?.frames?.length === 0) this.extensionWorkingVisible = false;
        else {
          this.extensionWorkingVisible = true;
          this.extensionWorkingIndicator = frame ?? "";
        }
        this.syncExtensionWorkingStatus();
      },
      setHiddenThinkingLabel: (label) => {
        this.setExtensionStatus("hidden-thinking-label", label);
      },
      setWidget: (key, content, options) => {
        if (content !== undefined && !Array.isArray(content)) return;
        if (content === undefined) {
          this.extensionWidgets.delete(key);
        } else {
          this.extensionWidgets.set(key, {
            key,
            lines: content,
            placement: options?.placement ?? "aboveEditor",
          });
        }
        this.emit({
          type: "extension_ui_request",
          id: randomUUID(),
          method: "setWidget",
          widgetKey: key,
          widgetLines: content,
          widgetPlacement: options?.placement,
        } as ExtensionUiRequest as AgentEvent);
      },
      setFooter: () => this.reportUnsupportedExtensionFeature("custom TUI footer"),
      setHeader: () => this.reportUnsupportedExtensionFeature("custom TUI header"),
      setTitle: (title) => {
        this.emit({
          type: "extension_ui_request",
          id: randomUUID(),
          method: "setTitle",
          title,
        } as ExtensionUiRequest as AgentEvent);
      },
      custom: <T = unknown>(factory: unknown, options?: unknown) => this.requestExtensionCustomUi<T>(factory, options),
      pasteToEditor: (text) => {
        this.extensionEditorText += text;
        this.emit({
          type: "extension_ui_request",
          id: randomUUID(),
          method: "set_editor_text",
          text,
        } as ExtensionUiRequest as AgentEvent);
      },
      setEditorText: (text) => {
        this.extensionEditorText = text;
        this.emit({
          type: "extension_ui_request",
          id: randomUUID(),
          method: "set_editor_text",
          text,
        } as ExtensionUiRequest as AgentEvent);
      },
      getEditorText: () => this.extensionEditorText,
      addAutocompleteProvider: () => this.reportUnsupportedExtensionFeature("TUI autocomplete provider"),
      setEditorComponent: () => this.reportUnsupportedExtensionFeature("custom TUI editor component"),
      getEditorComponent: () => undefined,
      get theme() {
        return undefined;
      },
      getAllThemes: () => [],
      getTheme: () => undefined,
      setTheme: () => ({
        success: false,
        error: "Theme switching is not supported in the Pi Desktop extension UI yet",
      }),
      getToolsExpanded: () => false,
      setToolsExpanded: () => {},
    };
  }
  protected createExtensionCommandContextActions(): ExtensionCommandContextActionsLike {
    return {
      waitForIdle: async () => {
        const agent = this.inner.agent as { waitForIdle?: () => Promise<void> };
        await agent.waitForIdle?.();
      },
      newSession: async () => {
        this.reportUnsupportedExtensionFeature("extension-driven session replacement");
        return { cancelled: true };
      },
      fork: async () => {
        this.reportUnsupportedExtensionFeature("extension-driven session fork");
        return { cancelled: true };
      },
      navigateTree: async (targetId, options) => {
        const result = await this.inner.navigateTree(targetId, { summarize: options?.summarize });
        return { cancelled: result.cancelled };
      },
      switchSession: async () => {
        this.reportUnsupportedExtensionFeature("extension-driven session switch");
        return { cancelled: true };
      },
      reload: async () => {
        this.extensionStatuses.clear();
        this.extensionWidgets.clear();
        await this.inner.reload({
          beforeSessionStart: () => {
            this.inner.extensionRunner.setUIContext?.(this.createExtensionUiContext(), "rpc");
          },
        });
        this.applyForcedEmptySystemPrompt();
      },
    };
  }
}
