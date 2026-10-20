import { navigationBoundary } from "../fixtures/app-navigation-host.mjs";
import { startNavigation } from "./app-navigation.mjs";

export async function startSessionScene(t, conversations = [], options = {}) {
  const external = navigationBoundary();
  for (const conversation of conversations) external.addConversation(conversation);
  return startNavigation(t, options, external);
}
