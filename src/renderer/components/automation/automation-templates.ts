import { translate as t } from "@/i18n";
import type { TaskSpec } from "@shared/automation/spec";

export interface AutomationStarterTemplate {
  id: string;
  name: string;
  description: string;
  spec: TaskSpec;
}
export function createStarterTemplates(cwd: string): readonly AutomationStarterTemplate[] {
  return [
    {
      id: "repository-check",
      name: t("autoPageTemplateRepository", "Scheduled repository check"),
      description: t(
        "autoPageTemplateRepositoryDescription",
        "Review repository health every morning without changing files.",
      ),
      spec: {
        schema: "dexon.automation/v1",
        id: "repository-check",
        name: t("autoPageTemplateRepository", "Scheduled repository check"),
        cwd,
        triggers: [
          { id: "daily", kind: "schedule", cron: "0 9 * * *", tz: Intl.DateTimeFormat().resolvedOptions().timeZone },
          { id: "manual", kind: "manual" },
        ],
        steps: [
          {
            id: "review",
            kind: "agent",
            tools: ["read", "grep", "find"],
            effect: "read",
            prompt: t(
              "autoPageTemplateRepositoryPrompt",
              "Inspect the repository in the working directory. Summarize build configuration, unfinished changes, and risks. Do not modify files or execute commands.",
            ),
            output: {
              schema: {
                type: "object",
                properties: { summary: { type: "string" } },
                required: ["summary"],
                additionalProperties: false,
              },
            },
          },
        ],
      },
    },
    {
      id: "endpoint-monitor",
      name: t("autoPageTemplateMonitor", "API failure monitor"),
      description: t(
        "autoPageTemplateMonitorDescription",
        "Watch an endpoint and request review after repeated failures.",
      ),
      spec: {
        schema: "dexon.automation/v1",
        id: "endpoint-monitor",
        name: t("autoPageTemplateMonitor", "API failure monitor"),
        cwd,
        triggers: [
          {
            id: "health",
            kind: "watch",
            every: "1m",
            probe: {
              action: "http.request",
              with: { url: { origin: "https://example.com", path: "/health" }, effect: "read" },
            },
            mode: {
              type: "threshold",
              healthy: { ref: "probe.ok", op: "eq", value: true },
              consecutive: 3,
              cooldown: "10m",
            },
          },
          { id: "manual", kind: "manual" },
        ],
        steps: [
          {
            id: "review",
            kind: "wait",
            wait: {
              kind: "approval",
              title: t("autoPageTemplateMonitorReview", "Review endpoint health"),
              prompt: t(
                "autoPageTemplateMonitorPrompt",
                "Repeated endpoint failures were detected. Review the service before continuing.",
              ),
            },
          },
        ],
      },
    },
    {
      id: "log-summary",
      name: t("autoPageTemplateLogs", "Scheduled log summary"),
      description: t(
        "autoPageTemplateLogsDescription",
        "Read logs in the working directory and produce a daily summary.",
      ),
      spec: {
        schema: "dexon.automation/v1",
        id: "log-summary",
        name: t("autoPageTemplateLogs", "Scheduled log summary"),
        cwd,
        triggers: [
          { id: "daily", kind: "schedule", cron: "0 18 * * *", tz: Intl.DateTimeFormat().resolvedOptions().timeZone },
          { id: "manual", kind: "manual" },
        ],
        steps: [
          {
            id: "summarize",
            kind: "agent",
            tools: ["read", "grep", "find"],
            effect: "read",
            prompt: t(
              "autoPageTemplateLogsPrompt",
              "Read log files in the working directory. Summarize notable errors and warnings, recurring patterns, and suggested next actions. Do not modify files.",
            ),
            output: {
              schema: {
                type: "object",
                properties: { summary: { type: "string" } },
                required: ["summary"],
                additionalProperties: false,
              },
            },
          },
        ],
      },
    },
  ];
}
