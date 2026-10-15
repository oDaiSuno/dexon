// Compatibility for the retained startup fixture: share the same browser
// environment as renderer interaction tests instead of installing a second window.
export { dom, restoreGlobals, rootContainer } from "../resource-dom-environment.mjs";
