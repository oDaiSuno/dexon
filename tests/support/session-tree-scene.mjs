import { navigationBoundary } from "../fixtures/app-navigation-host.mjs";
import { startNavigation } from "./app-navigation.mjs";

// The real App on a Host that knows these sessions before the first list is
// answered, so the tree under test is what the user would see on startup.
export async function startSessionScene(t, conversations = [], options = {}) {
  const external = navigationBoundary();
  for (const conversation of conversations) external.addConversation(conversation);
  return startNavigation(t, options, external);
}
