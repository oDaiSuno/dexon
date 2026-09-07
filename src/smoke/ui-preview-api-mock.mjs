/**
 * Preview replacement for the real api-client module. The esbuild bundle step
 * aliases every import of `@/lib/api-client` (and bare `./api-client`) to this
 * module, so no preview code path can reach a real Agent Host — there is no
 * piBridge, no MessagePort and no real RPC inside the preview window.
 *
 * The mock implements only the surface the mounted component tree imports and
 * throws on anything else so missing coverage surfaces immediately.
 */

import { buildPreviewData } from "./ui-preview-data.mjs";

const data = buildPreviewData({ now: new Date() });

export async function call(method, params) {
  switch (method) {
    case "skills.getContent": {
      const content = data.skillContents.get(params.filePath);
      if (content === undefined) {
        throw new Error(`ui-preview: no sample content for ${params.filePath}`);
      }
      return { content };
    }
    default:
      throw new Error(`ui-preview: unexpected RPC ${method}`);
  }
}

export async function subscribe() {
  return () => undefined;
}

// Fail-fast stubs mirroring the real module's convenience wrappers. The
// preview exercises the resource pages and the chat canvas only; any call
// listed here is a coverage gap and must fail loudly.
const unsupported = (name) => () => Promise.reject(new Error(`ui-preview: ${name} is not exercised in previews`));
export const listSessions = unsupported("listSessions");
export const getSession = unsupported("getSession");
export const getSessionContext = unsupported("getSessionContext");
export const getSessionContextPage = unsupported("getSessionContextPage");
export const getSessionEntryContent = unsupported("getSessionEntryContent");
export const exportSession = unsupported("exportSession");
export const deleteSession = unsupported("deleteSession");
export const renameSession = unsupported("renameSession");
export const newAgent = unsupported("newAgent");
export const agentCommand = unsupported("agentCommand");
export const agentState = unsupported("agentState");
export const listModels = unsupported("listModels");
export const refreshModels = unsupported("refreshModels");
export const cancelModelsRefresh = unsupported("cancelModelsRefresh");
export const getModelPreferences = unsupported("getModelPreferences");
export const setModelPreferences = unsupported("setModelPreferences");
export const listWorktrees = unsupported("listWorktrees");
export const validateCwd = unsupported("validateCwd");
export const defaultCwd = unsupported("defaultCwd");
export const getHome = unsupported("getHome");
export const listFiles = unsupported("listFiles");
export const readFile = unsupported("readFile");
export const fileMeta = unsupported("fileMeta");
export const fileIndex = unsupported("fileIndex");
export const subscribeAgentEvents = unsupported("subscribeAgentEvents");
export const subscribeRunning = unsupported("subscribeRunning");
export const subscribeSessionsChanged = unsupported("subscribeSessionsChanged");
export const subscribeAuthLogin = unsupported("subscribeAuthLogin");
export const ensureRpc = () => Promise.reject(new Error("ui-preview: no RPC"));
export const getRpc = () => null;
export const resetRpc = () => {};
