import { enUS as enUSInteractiveTools, zhCN as zhCNInteractiveTools } from "./i18n/interactive-tools.ts";
import { enUS as enUSApp, zhCN as zhCNApp } from "./i18n/app.ts";
import { enUS as enUSBrowser, zhCN as zhCNBrowser } from "./i18n/browser.ts";
import { enUS as enUSBrowserHero, zhCN as zhCNBrowserHero } from "./i18n/browser-hero.ts";
import { enUS as enUSBrowserSettings, zhCN as zhCNBrowserSettings } from "./i18n/browser-settings.ts";
import { enUS as enUSBrowserSettingsRows, zhCN as zhCNBrowserSettingsRows } from "./i18n/browser-settings-rows.ts";
import { enUS as enUSChannels, zhCN as zhCNChannels } from "./i18n/channels.ts";
import { enUS as enUSChat, zhCN as zhCNChat } from "./i18n/chat.ts";
import { enUS as enUSFiles, zhCN as zhCNFiles } from "./i18n/files.ts";
import { enUS as enUSHistory, zhCN as zhCNHistory } from "./i18n/history.ts";
import { enUS as enUSModels, zhCN as zhCNModels } from "./i18n/models.ts";
import { enUS as enUSResources, zhCN as zhCNResources } from "./i18n/resources.ts";
import { enUS as enUSSettings, zhCN as zhCNSettings } from "./i18n/settings.ts";
import { enUS as enUSToolchains, zhCN as zhCNToolchains } from "./i18n/toolchains.ts";

export const enUS: Record<string, string> = {
  ...enUSApp,
  ...enUSInteractiveTools,
  ...enUSBrowser,
  ...enUSBrowserHero,
  ...enUSBrowserSettings,
  ...enUSBrowserSettingsRows,
  ...enUSChannels,
  ...enUSChat,
  ...enUSFiles,
  ...enUSHistory,
  ...enUSModels,
  ...enUSResources,
  ...enUSSettings,
  ...enUSToolchains,
};

export const zhCN: Record<string, string> = {
  ...zhCNApp,
  ...zhCNInteractiveTools,
  ...zhCNBrowser,
  ...zhCNBrowserHero,
  ...zhCNBrowserSettings,
  ...zhCNBrowserSettingsRows,
  ...zhCNChannels,
  ...zhCNChat,
  ...zhCNFiles,
  ...zhCNHistory,
  ...zhCNModels,
  ...zhCNResources,
  ...zhCNSettings,
  ...zhCNToolchains,
};

export const dictionaries = {
  "en-US": enUS,
  "zh-CN": zhCN,
} satisfies Record<"en-US" | "zh-CN", Record<string, string>>;
