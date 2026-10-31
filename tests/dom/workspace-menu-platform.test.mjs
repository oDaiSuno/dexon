import assert from "node:assert/strict";
import test, { after } from "node:test";
import { click, control, startNavigation, waitFor, restoreGlobals } from "../support/app-navigation.mjs";
import { card, openCard } from "../support/app-navigation-workspace.mjs";
import { navigationPaths as P } from "../fixtures/app-navigation-data.mjs";

after(restoreGlobals);

const cases = [
  { platform: "darwin", language: "zh-CN", label: "在访达中打开" },
  { platform: "win32", language: "zh-CN", label: "在资源管理器中打开" },
  { platform: "linux", language: "zh-CN", label: "在文件管理器中打开" },
  { platform: "darwin", language: "en-US", label: "Open in Finder" },
  { platform: "win32", language: "en-US", label: "Open in File Explorer" },
  { platform: "linux", language: "en-US", label: "Open in File Manager" },
];

for (const { platform, language, label } of cases) {
  test(`on ${platform} in ${language} the workspace card names the system file browser as “${label}” and opens the folder`, async (t) => {
    const scene = await startNavigation(t, {
      platform,
      language,
      lastSpaceCwd: P.project,
      openProjects: [P.personal, P.project],
    });
    await openCard(scene);
    await click(control(card(scene), "button", label));
    await waitFor(() => assert.equal(scene.external.desktop.openedDirectory, P.project));
  });
}
