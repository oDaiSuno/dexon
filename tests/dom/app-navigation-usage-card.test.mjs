import test, { after } from "node:test";
import { startNavigation, control, visibleText, click, waitFor, restoreGlobals } from "../support/app-navigation.mjs";

after(restoreGlobals);

test("opening the usage card from the top bar of an open conversation names the model that conversation uses", async (t) => {
  const scene = await startNavigation(t, { initialSession: "personal-history" });
  await waitFor(() => visibleText(scene.container, "Personal conversation marker"));
  await click(control(scene.container, "button", "View context and cost"));
  const card = await waitFor(() => control(scene.container, "region", "Context and cost"));
  await waitFor(() => visibleText(card, "fixture-model"));
});
