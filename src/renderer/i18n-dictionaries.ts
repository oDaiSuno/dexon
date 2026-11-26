import { enUS as enUSInteractiveTools, zhCN as zhCNInteractiveTools } from "./i18n/interactive-tools.ts";
import { enUS as enUSApp, zhCN as zhCNApp } from "./i18n/app.ts";
import { enUS as enUSAutomation, zhCN as zhCNAutomation } from "./i18n/automation.ts";
import { enUS as enUSAutomationPage, zhCN as zhCNAutomationPage } from "./i18n/automation-page.ts";
import { enUS as enUSAutomationOverview, zhCN as zhCNAutomationOverview } from "./i18n/automation-overview.ts";
import { enUS as enUSAutomationTask, zhCN as zhCNAutomationTask } from "./i18n/automation-task.ts";
import { enUS as enUSAutomationRun, zhCN as zhCNAutomationRun } from "./i18n/automation-run.ts";
import { enUS as enUSAutomationDrawers, zhCN as zhCNAutomationDrawers } from "./i18n/automation-drawers.ts";
import { enUS as enUSAutomationEditor, zhCN as zhCNAutomationEditor } from "./i18n/automation-editor.ts";
import {
  enUS as enUSAutomationEditorTriggers,
  zhCN as zhCNAutomationEditorTriggers,
} from "./i18n/automation-editor-triggers.ts";
import {
  enUS as enUSAutomationEditorSteps,
  zhCN as zhCNAutomationEditorSteps,
} from "./i18n/automation-editor-steps.ts";
import {
  enUS as enUSAutomationEditorPermissions,
  zhCN as zhCNAutomationEditorPermissions,
} from "./i18n/automation-editor-permissions.ts";
import { enUS as enUSAutomationShell, zhCN as zhCNAutomationShell } from "./i18n/automation-shell.ts";
import { enUS as enUSAutomationChatFlow, zhCN as zhCNAutomationChatFlow } from "./i18n/automation-chat-flow.ts";
import { enUS as enUSBrowser, zhCN as zhCNBrowser } from "./i18n/browser.ts";
import { enUS as enUSBrowserHero, zhCN as zhCNBrowserHero } from "./i18n/browser-hero.ts";
import { enUS as enUSBrowserPanel, zhCN as zhCNBrowserPanel } from "./i18n/browser-panel.ts";
import { enUS as enUSBrowserSettings, zhCN as zhCNBrowserSettings } from "./i18n/browser-settings.ts";
import { enUS as enUSBrowserSettingsRows, zhCN as zhCNBrowserSettingsRows } from "./i18n/browser-settings-rows.ts";
import { enUS as enUSChannels, zhCN as zhCNChannels } from "./i18n/channels.ts";
import { enUS as enUSChat, zhCN as zhCNChat } from "./i18n/chat.ts";
import { enUS as enUSChatModels, zhCN as zhCNChatModels } from "./i18n/chat-models.ts";
import { enUS as enUSFiles, zhCN as zhCNFiles } from "./i18n/files.ts";
import { enUS as enUSHistory, zhCN as zhCNHistory } from "./i18n/history.ts";
import { enUS as enUSMediaLightbox, zhCN as zhCNMediaLightbox } from "./i18n/media-lightbox.ts";
import { enUS as enUSModels, zhCN as zhCNModels } from "./i18n/models.ts";
import { enUS as enUSResources, zhCN as zhCNResources } from "./i18n/resources.ts";
import { enUS as enUSSettings, zhCN as zhCNSettings } from "./i18n/settings.ts";
import { enUS as enUSToolchains, zhCN as zhCNToolchains } from "./i18n/toolchains.ts";
import { enUS as enUSServers, zhCN as zhCNServers } from "./i18n/servers.ts";
import { enUS as enUSRemoteUx, zhCN as zhCNRemoteUx } from "./i18n/remote-ux.ts";

export const enUS: Record<string, string> = {
  ...enUSApp,
  ...enUSAutomation,
  ...enUSAutomationPage,
  ...enUSAutomationOverview,
  ...enUSAutomationTask,
  ...enUSAutomationRun,
  ...enUSAutomationDrawers,
  ...enUSAutomationEditor,
  ...enUSAutomationEditorTriggers,
  ...enUSAutomationEditorSteps,
  ...enUSAutomationEditorPermissions,
  ...enUSAutomationShell,
  ...enUSAutomationChatFlow,
  ...enUSInteractiveTools,
  ...enUSBrowser,
  ...enUSBrowserHero,
  ...enUSBrowserPanel,
  ...enUSBrowserSettings,
  ...enUSBrowserSettingsRows,
  ...enUSChannels,
  ...enUSChat,
  ...enUSChatModels,
  ...enUSFiles,
  ...enUSHistory,
  ...enUSMediaLightbox,
  ...enUSModels,
  ...enUSResources,
  ...enUSSettings,
  ...enUSToolchains,
  ...enUSServers,
  ...enUSRemoteUx,
};

export const zhCN: Record<string, string> = {
  ...zhCNApp,
  ...zhCNAutomation,
  ...zhCNAutomationPage,
  ...zhCNAutomationOverview,
  ...zhCNAutomationTask,
  ...zhCNAutomationRun,
  ...zhCNAutomationDrawers,
  ...zhCNAutomationEditor,
  ...zhCNAutomationEditorTriggers,
  ...zhCNAutomationEditorSteps,
  ...zhCNAutomationEditorPermissions,
  ...zhCNAutomationShell,
  ...zhCNAutomationChatFlow,
  ...zhCNInteractiveTools,
  ...zhCNBrowser,
  ...zhCNBrowserHero,
  ...zhCNBrowserPanel,
  ...zhCNBrowserSettings,
  ...zhCNBrowserSettingsRows,
  ...zhCNChannels,
  ...zhCNChat,
  ...zhCNChatModels,
  ...zhCNFiles,
  ...zhCNHistory,
  ...zhCNMediaLightbox,
  ...zhCNModels,
  ...zhCNResources,
  ...zhCNSettings,
  ...zhCNToolchains,
  ...zhCNServers,
  ...zhCNRemoteUx,
};

export const dictionaries = {
  "en-US": enUS,
  "zh-CN": zhCN,
} satisfies Record<"en-US" | "zh-CN", Record<string, string>>;
