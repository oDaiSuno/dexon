import { createElement } from "react";
import { createRoot } from "react-dom/client";
import { App } from "../../src/renderer/App.tsx";
import { setAppLanguage } from "../../src/renderer/i18n.ts";
import { resetRpc } from "../../src/renderer/lib/api-client.ts";
import { installApiShims } from "../../src/renderer/lib/api-fetch.ts";
import { installRendererApi } from "../support/renderer-api.mjs";
import { navigationBoundary } from "../fixtures/app-navigation-host.mjs";
import { navigationPaths as P, startedConversation } from "../fixtures/app-navigation-data.mjs";
import { allByRole, getByRole, accessibleName } from "../support/dom-queries.mjs";
import "./production-styles.mjs";

const window = globalThis.window;
const document = globalThis.document;
const getComputedStyle = window.getComputedStyle.bind(window);
const shortProject = "/work/api";
const external = navigationBoundary({ openProjects: [P.personal, P.project, P.other, shortProject] });
for (const [id, parent] of [
  ["pulse-root", null],
  ["pulse-middle", "pulse-root"],
  ["pulse-urgent", "pulse-middle"],
]) {
  const detail = startedConversation(id, P.project, id);
  Object.assign(detail.info, {
    name: id,
    parentSessionId: parent,
    relation: parent ? "delegate" : undefined,
    modified: "2020-01-01T00:00:00.000Z",
  });
  external.addConversation(detail);
}
for (let i = 0; i < 36; i++) {
  const detail = startedConversation(`filler-${i}`, P.project, `Recent task ${i}`);
  Object.assign(detail.info, { name: `Recent task ${i}`, modified: "2026-09-06T10:00:00.000Z" });
  external.addConversation(detail);
}
const error = startedConversation("pulse-error", P.other, "Failed background task");
Object.assign(error.info, { name: "Failed background task" });
external.addConversation(error);
const boundary = installRendererApi(window, { installApiShims, resetRpc }, () => external.host, {
  bridge: external.bridge,
});
setAppLanguage("en-US");
const root = createRoot(document.getElementById("root"));
root.render(createElement(App));
const navigation = () => getByRole(document, "navigation", "Main navigation");
const history = () => getByRole(navigation(), "navigation", "Project spaces");
const well = () => getByRole(navigation(), "region", "Active sessions");
const session = (id) => history().querySelector(`[data-session-id="${id}"]`);
const box = (element) => {
  const r = element.getBoundingClientRect();
  return { x: r.x, y: r.y, width: r.width, height: r.height, right: r.right, bottom: r.bottom };
};
window.pulseProof = {
  ready: () => external.runningSubscribers() > 0 && allByRole(document, "button", "Show file panel").length > 0,
  start() {
    external.running(["review-history"], { "pulse-urgent": "awaiting_input", "pulse-error": "error" });
  },
  find(scope, role, name) {
    const container =
      scope === "settings"
        ? getByRole(document, "region", "Settings")
        : scope === "well"
          ? well()
          : scope === "history"
            ? history()
            : scope === "target"
              ? session("pulse-urgent")
              : navigation();
    return getByRole(container, role, typeof name === "string" ? name : new RegExp(name.pattern));
  },
  shortPrefix() {
    const detail = startedConversation("pulse-short", shortProject, "Short project task");
    Object.assign(detail.info, { name: "Short project task" });
    external.addConversation(detail);
    external.updateSession("pulse-short", {});
    external.running(["review-history", "pulse-short"], { "pulse-urgent": "awaiting_input", "pulse-error": "error" });
  },
  manyRoots(count = 30) {
    external.running(
      Array.from({ length: count }, (_, index) => `filler-${index}`),
      {},
    );
  },
  overflowState() {
    const nav = navigation();
    const region = well();
    const rows = [...region.querySelectorAll("button")].filter((button) => button.querySelector(".type-body-medium"));
    const viewport = rows[0]?.parentElement;
    const reachable = (element) => {
      if (!element) return false;
      const r = element.getBoundingClientRect();
      return (
        r.y >= 0 &&
        r.bottom <= window.innerHeight &&
        element.contains(document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2))
      );
    };
    const cap = allByRole(region, "button").find((button) =>
      /Show (all|fewer) active tasks/.test(accessibleName(button)),
    );
    const settings = getByRole(nav, "button", "Settings");
    const bounds = viewport?.getBoundingClientRect();
    return {
      frameHeight: window.innerHeight,
      activeCount: Number(
        getByRole(region, "button", "Collapse active sessions").querySelector(".type-mono-meta").textContent,
      ),
      nav: box(nav),
      well: box(region),
      header: box(getByRole(region, "button", "Collapse active sessions")),
      cap: cap ? { ...box(cap), reachable: reachable(cap) } : null,
      settings: { ...box(settings), reachable: reachable(settings) },
      settingsOpen: allByRole(document, "region", "Settings").length > 0,
      history: box(history()),
      viewport: viewport
        ? {
            ...box(viewport),
            clientHeight: viewport.clientHeight,
            scrollHeight: viewport.scrollHeight,
            clientWidth: viewport.clientWidth,
            scrollWidth: viewport.scrollWidth,
            scrollTop: viewport.scrollTop,
            overflowY: getComputedStyle(viewport).overflowY,
          }
        : null,
      rootNames: rows.map(accessibleName),
      rowHeights: rows.map((button) => button.getBoundingClientRect().height),
      visibleRoots: rows
        .filter((button) => {
          const r = button.getBoundingClientRect();
          return bounds && r.y >= bounds.y && r.bottom <= bounds.bottom && reachable(button);
        })
        .map(accessibleName),
      selectedRoots: rows.filter((button) => button.getAttribute("aria-current") === "page").map(accessibleName),
    };
  },
  target: () => session("pulse-urgent"),
  history,
  fold(id) {
    getByRole(session(id), "button", "Collapse forks").click();
  },
  scrollAway() {
    history().scrollTop = 0;
  },
  targetState() {
    const target = session("pulse-urgent");
    const r = target?.getBoundingClientRect();
    const h = history().getBoundingClientRect();
    const button = target?.querySelector("button");
    const status = target?.querySelector('[aria-label="Waiting for your answer"]');
    return {
      present: !!target,
      reservedActions: button ? parseFloat(getComputedStyle(button).paddingRight) : null,
      status: status ? box(status) : null,
      statusName: status?.getAttribute("aria-label"),
      selected: button?.getAttribute("aria-current") === "page",
      visible: !!r && r.top >= h.top && r.bottom <= h.bottom,
      scrollTop: history().scrollTop,
      scrollLeft: history().scrollLeft,
      historyClientWidth: history().clientWidth,
      historyScrollWidth: history().scrollWidth,
      history: box(history()),
      row: target ? box(target) : null,
      titleWidth: target?.querySelector("[data-session-row-title]")?.getBoundingClientRect().width ?? null,
      parts: button ? [...button.children].map((element) => ({ text: element.textContent, ...box(element) })) : [],
      projectOpen: getByRole(history(), "button", "navigation-project").getAttribute("aria-expanded"),
      folded: allByRole(history(), "button", "Expand forks").length,
      name: button ? accessibleName(button) : null,
    };
  },
  measurements() {
    const nav = navigation();
    const summary = allByRole(nav, "button").find((button) =>
      accessibleName(button).startsWith("Expand active sessions"),
    );
    const project = getByRole(history(), "button", "navigation-project");
    const badge = project.querySelector('[data-activity="awaiting_input"]');
    const more = getByRole(history(), "button", "Actions for navigation-project");
    return {
      summary: summary ? box(summary) : null,
      summaryNames: summary ? box(summary.querySelector(".type-mono-meta")) : null,
      summaryDescription: summary?.getAttribute("aria-description"),
      summaryTooltip: summary?.title,
      summaryBorder: summary ? getComputedStyle(summary).borderColor : null,
      warningBorder: getComputedStyle(nav).getPropertyValue("--fx-status-warning-border").trim(),
      projectLabel: accessibleName(project),
      badge: badge ? box(badge) : null,
      more: box(more),
      moreOpacity: Number(getComputedStyle(more).opacity),
      moreReachable: more.contains(
        document.elementFromPoint(more.getBoundingClientRect().x + 12, more.getBoundingClientRect().y + 12),
      ),
      wellRows: [...well().querySelectorAll("button")].map((button) => {
        const title = button.querySelector(".type-body-medium");
        const chip = [...button.children].find((element) => element.hasAttribute("aria-label"));
        return {
          name: accessibleName(button),
          height: button.getBoundingClientRect().height,
          titleWidth: title?.getBoundingClientRect().width ?? null,
          row: box(button),
          prefixChildren: title ? [...button.children[1].children].map(box) : [],
          prefixName: title ? button.children[1].firstElementChild.textContent : null,
          prefixNameWidth: title ? button.children[1].firstElementChild.clientWidth : null,
          prefixNameScrollWidth: title ? button.children[1].firstElementChild.scrollWidth : null,
          tooltip: button.title,
          trailingClientWidth: title ? button.lastElementChild.clientWidth : null,
          trailingScrollWidth: title ? button.lastElementChild.scrollWidth : null,
          parts: title
            ? {
                lead: box(button.firstElementChild),
                prefix: box(button.children[1]),
                title: box(title),
                chip: chip ? box(chip) : null,
                trailing: box(button.lastElementChild),
              }
            : null,
        };
      }),
    };
  },
  rail() {
    const nav = navigation();
    const show = getByRole(nav, "button", "Show sidebar");
    return {
      width: nav.getBoundingClientRect().width,
      buttons: allByRole(nav, "button").length,
      status: show.getAttribute("aria-describedby")
        ? document.getElementById(show.getAttribute("aria-describedby"))?.textContent
        : show.getAttribute("aria-description"),
      dot: !!show.querySelector('[data-activity="awaiting_input"]'),
    };
  },
  unexpected: () => external.unexpected,
  close() {
    root.unmount();
    boundary.close();
    external.releaseHolds();
  },
};
