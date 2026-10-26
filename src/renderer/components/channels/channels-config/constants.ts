import type { FeishuDomain } from "@shared/channel-types";
import { FEISHU_REQUIRED_TENANT_SCOPES } from "@shared/feishu-app";

export const TELEGRAM_BASE_URL = "https://api.telegram.org";
export const FEISHU_BASE_URLS: Record<FeishuDomain, string> = {
  feishu: "https://open.feishu.cn",
  lark: "https://open.larksuite.com",
};
export const FEISHU_PERMISSION_IMPORT_JSON = JSON.stringify(
  {
    scopes: {
      tenant: FEISHU_REQUIRED_TENANT_SCOPES,
      user: [],
    },
  },
  null,
  2,
);
export const TOOL_PRESETS = {
  none: [],
  read: ["read", "grep", "find", "ls"],
  full: ["read", "bash", "edit", "write", "grep", "find", "ls"],
} as const;
