import type { EventBus, LoadExtensionsResult } from "@earendil-works/pi-coding-agent";
import { readFileSync } from "node:fs";
import path from "node:path";
import type { QuestionDraft, ToolQuestion } from "../../shared/interactive-tools";
import { buildQuestionnaireResult, readQuestionnaire } from "../../shared/questionnaire";

/** Recognize the reviewed package/version, never an unrelated same-named permission tool. */
export function isSupportedQuestionnaireSource(resolvedPath: string): boolean {
  let directory = path.dirname(resolvedPath);
  for (let depth = 0; depth < 8; depth++) {
    try {
      const metadata = JSON.parse(readFileSync(path.join(directory, "package.json"), "utf8")) as {
        name?: string;
        version?: string;
      };
      return metadata.name === "@juicesharp/rpiv-ask-user-question" && metadata.version === "2.7.1";
    } catch {
      /* Extension entry points may live below the package root. */
    }
    const parent = path.dirname(directory);
    if (parent === directory) break;
    directory = parent;
  }
  return false;
}

export function createQuestionnaireOverride(options: {
  request(questions: ToolQuestion[], signal?: AbortSignal): Promise<QuestionDraft[] | undefined>;
  events: Pick<EventBus, "emit">;
  supportsSource?: (path: string) => boolean;
}): (base: LoadExtensionsResult) => LoadExtensionsResult {
  return (base) => ({
    ...base,
    extensions: base.extensions.map((extension) => {
      const registered = extension.tools.get("ask_user_question");
      if (!registered || !(options.supportsSource ?? isSupportedQuestionnaireSource)(extension.resolvedPath))
        return extension;
      const original = registered.definition;
      const tools = new Map(extension.tools);
      tools.set("ask_user_question", {
        ...registered,
        definition: {
          ...original,
          async execute(id, params, signal, update, ctx) {
            const questions = readQuestionnaire(params);
            // Preserve original errors/guards and all non-desktop hosts. No new
            // registration or active-tool changes: the SDK retains ownership.
            if (!ctx.hasUI || ctx.mode !== "rpc" || !questions)
              return original.execute(id, params, signal, update, ctx);
            if (signal?.aborted) return buildQuestionnaireResult(questions, undefined);
            options.events.emit("rpiv:ask-user:prompt", {
              questions: questions.map((q) => ({
                question: q.question,
                header: q.header,
                multiSelect: q.multiSelect ?? false,
                options: q.options.map((o) => ({
                  label: o.label,
                  description: o.description,
                  hasPreview: !!o.preview,
                })),
              })),
            });
            options.events.emit("rpiv:ask-user:blocked", { active: true });
            try {
              return buildQuestionnaireResult(questions, await options.request(questions, signal));
            } finally {
              options.events.emit("rpiv:ask-user:blocked", { active: false });
            }
          },
        },
      });
      return { ...extension, tools };
    }),
  });
}
