import assert from "node:assert/strict";
import path from "node:path";
import { remoteProjectSelectors as selectors } from "./remote-projects-page.mjs";
import { focusRemote } from "./remote-projects-navigation.mjs";

const tabSelector = `${selectors.panel} .right-panel-tab-strip button[title]`;
const unavailableRead = /not connected|unavailable|offline|connection.*closed/iu;

function fileTabTarget(file) {
  return { selector: `${tabSelector}[title=${JSON.stringify(file)}]` };
}

async function tabState(driver, fixture) {
  const tabs = (await driver.read("all", { selector: tabSelector })).filter((tab) =>
    [fixture.text, fixture.image].includes(tab.title),
  );
  return {
    paths: tabs.map((tab) => tab.title).sort(),
    selected: tabs.filter((tab) => tab.current === "page").map((tab) => tab.title),
  };
}

async function expectTabs(driver, fixture, paths, selected) {
  const expected = { paths: [...paths].sort(), selected: selected ? [selected] : [] };
  let actual;
  await driver.waitFor(async () => {
    actual = await tabState(driver, fixture);
    return JSON.stringify(actual) === JSON.stringify(expected);
  }, "only the focused environment's retained file tabs and selection");
  assert.deepEqual(actual, expected);
  return actual;
}

export async function openRemoteFile(driver, file) {
  await driver.showPanel();
  await driver.click({ role: "button", name: "Explorer" });
  const target = { role: "button", name: `Open file ${path.basename(file)}` };
  await driver.waitFor(() => driver.exists(target), `the real remote tree exposes ${file}`);
  await driver.hover({ selector: `${selectors.panel} button[aria-label=${JSON.stringify(target.name)}]` });
  await driver.click(target);
}

async function textContent(driver, marker, otherMarker) {
  await driver.waitFor(
    async () => (await driver.read("text", { selector: selectors.panel })).includes(marker),
    "the real file viewer renders the selected server's bytes",
  );
  const text = await driver.read("text", { selector: selectors.panel });
  assert.ok(text.includes(marker));
  assert.ok(!text.includes(otherMarker), "The viewer does not render the other server's staged bytes");
  return text;
}

async function imageContent(driver, file, marker, otherMarker) {
  let image;
  await driver.waitFor(async () => {
    image = await driver.read("image", { path: file });
    return Boolean(image);
  }, "the image viewer decodes a real production blob");
  assert.match(image.src, /^blob:app:\/\//u);
  assert.equal(image.width, 320);
  assert.equal(image.height, 160);
  const content = await driver.blobText(image.src);
  assert.ok(
    content.includes(marker),
    "The image rendered from the production blob contains the selected environment's bytes",
  );
  assert.ok(!content.includes(otherMarker), "The image blob never reuses the other environment's bytes");
  return {
    ...image,
    content,
    blobReadBoundary: "Read-only DevTools Page.getResourceContent for the actual production img.src",
  };
}

async function fileUrlResult(driver, environmentId, file) {
  const encoded = file.replaceAll("\\", "/").split("/").filter(Boolean).map(encodeURIComponent).join("/");
  const url = `/api/files/${encoded}?type=read&environment=${encodeURIComponent(environmentId)}`;
  const result = await driver.js(
    `fetch(${JSON.stringify(url)}).then(async response => ({status:response.status,payload:await response.json()})).catch(error => ({error:String(error)}))`,
  );
  return { url, ...result };
}

async function fileUrlRead(driver, environmentId, file, marker) {
  const result = await fileUrlResult(driver, environmentId, file);
  assert.equal(result.status, 200, "The production file API accepts an explicitly scoped URL");
  assert.equal(result.payload.content, `${marker}\n`, "The public file URL reads the staged bytes");
  return result;
}

async function verifyUnavailableTab(context, unavailable, online, file) {
  const { driver, views, fixture } = context;
  const ownMarker = fixture.stage(unavailable);
  await focusRemote(context, unavailable);
  await driver.showPanel();
  const before = await tabState(driver, fixture);
  assert.ok(before.paths.includes(file), "The unavailable read targets a retained tab belonging to its focused owner");
  await driver.bridge("environmentCommand", { type: "disconnect", environmentId: views[unavailable].id });
  await driver.waitFor(
    async () =>
      (await driver.bridge("listEnvironments")).environments.find((view) => view.id === views[unavailable].id)?.status
        .phase === "offline",
    "the focused file owner's real server is disconnected",
  );
  assert.equal(
    (await driver.bridge("listEnvironments")).environments.find((view) => view.id === views[online].id)?.status.phase,
    "connected",
    "The other configured server remains genuinely online",
  );
  const onlineMarker = fixture.stage(online);
  const onlineUrlWhileOwnerOffline = await fileUrlRead(driver, views[online].id, fixture.text, onlineMarker);
  assert.ok((await driver.read("text", { selector: selectors.topbar })).includes(views[unavailable].label));
  await driver.click({ role: "button", name: "Explorer" });
  await driver.clickCss(fileTabTarget(file));
  const reselected = await expectTabs(driver, fixture, before.paths, file);
  await driver.waitFor(
    async () => unavailableRead.test(await driver.read("text", { selector: selectors.panel })),
    "reselecting the disconnected owner's file performs a fresh read and shows its connection failure",
  );
  const visibleError = await driver.read("text", { selector: selectors.panel });
  assert.ok(!visibleError.includes(onlineMarker), "The failed viewer never renders the other online server's bytes");
  assert.ok(!visibleError.includes(ownMarker), "Reselecting an unavailable file does not pass with old cached bytes");
  assert.equal(
    await driver.read("image", { path: fixture.image }),
    null,
    "No stale image blob survives the failed read",
  );
  const screenshot = await driver.screenshot(`scoped-file-${unavailable}-unavailable-owner`);
  await focusRemote(context, online);
  const unavailableUrlsWhileOtherFocused = [];
  for (const target of [fixture.text, fixture.image]) {
    const result = await fileUrlResult(driver, views[unavailable].id, target);
    assert.ok(
      result.error || result.status !== 200 || result.payload?.error,
      "An explicitly unavailable server URL never succeeds through the focused online server",
    );
    assert.match(JSON.stringify(result), unavailableRead, "The URL fails for its own disconnected environment");
    assert.ok(!result.payload?.content, "No other environment's bytes leak into the unavailable URL response");
    unavailableUrlsWhileOtherFocused.push(result);
  }
  assert.ok((await driver.read("text", { selector: selectors.topbar })).includes(views[online].label));
  await driver.bridge("environmentCommand", { type: "connect", environmentId: views[unavailable].id });
  await driver.waitFor(
    async () =>
      (await driver.bridge("listEnvironments")).environments.find((view) => view.id === views[unavailable].id)?.status
        .phase === "connected",
    "the file tab's own server reconnects",
    20000,
  );
  return {
    unavailable,
    online,
    ownerFocusedForRead: unavailable,
    file,
    before,
    reselected,
    visibleError,
    onlineUrlWhileOwnerOffline,
    unavailableUrlsWhileOtherFocused,
    screenshot,
  };
}

export async function verifyScopedFiles(context) {
  const { driver, fixture, views, mount } = context;
  const states = {};
  const { alpha: alphaMarker, beta: betaMarker } = fixture.markers;
  fixture.stage("alpha");
  await focusRemote(context, "alpha");
  await openRemoteFile(driver, fixture.text);
  const alphaText = await textContent(driver, alphaMarker, betaMarker);
  await openRemoteFile(driver, fixture.image);
  const alphaImage = await imageContent(driver, fixture.image, alphaMarker, betaMarker);
  states.alphaInitial = await expectTabs(driver, fixture, [fixture.text, fixture.image], fixture.image);
  const screenshots = [await driver.screenshot("scoped-file-alpha-image")];
  await mount(views.beta, fixture.project);
  await driver.closeSettings();
  fixture.stage("beta");
  await focusRemote(context, "beta");
  await driver.showPanel();
  states.betaBeforeOpen = await expectTabs(driver, fixture, [], null);
  assert.ok(!(await driver.read("text", { selector: selectors.panel })).includes(alphaMarker));
  assert.equal(await driver.read("image", { path: fixture.image }), null, "Beta never inherits alpha's visible image");
  await openRemoteFile(driver, fixture.text);
  const betaText = await textContent(driver, betaMarker, alphaMarker);
  await openRemoteFile(driver, fixture.image);
  const betaImage = await imageContent(driver, fixture.image, betaMarker, alphaMarker);
  states.betaImage = await expectTabs(driver, fixture, [fixture.text, fixture.image], fixture.image);
  assert.notEqual(
    alphaImage.src,
    betaImage.src,
    "Equal canonical paths on different servers produce separate blob URLs",
  );
  screenshots.push(await driver.screenshot("scoped-file-beta-image"));
  await driver.clickCss(fileTabTarget(fixture.text));
  await textContent(driver, betaMarker, alphaMarker);
  states.betaText = await expectTabs(driver, fixture, [fixture.text, fixture.image], fixture.text);
  fixture.stage("alpha");
  await focusRemote(context, "alpha");
  states.alphaRestored = await expectTabs(driver, fixture, [fixture.text, fixture.image], fixture.image);
  const alphaRestoredImage = await imageContent(driver, fixture.image, alphaMarker, betaMarker);
  assert.notEqual(alphaRestoredImage.src, betaImage.src, "Restoring alpha does not reuse beta's rendered blob");
  await driver.hover(fileTabTarget(fixture.text));
  await driver.click({ role: "button", name: `Close ${path.basename(fixture.text)}` });
  states.alphaAfterClose = await expectTabs(driver, fixture, [fixture.image], fixture.image);
  fixture.stage("beta");
  await focusRemote(context, "beta");
  states.betaAfterAlphaClose = await expectTabs(driver, fixture, [fixture.text, fixture.image], fixture.text);
  const betaRestoredText = await textContent(driver, betaMarker, alphaMarker);
  screenshots.push(await driver.screenshot("scoped-file-beta-retained-tabs"));
  fixture.stage("alpha");
  const alphaUrlWhileBetaFocused = await fileUrlRead(driver, views.alpha.id, fixture.text, alphaMarker);
  assert.ok((await driver.read("text", { selector: selectors.topbar })).includes(views.beta.label));
  await focusRemote(context, "alpha");
  states.alphaCloseRetained = await expectTabs(driver, fixture, [fixture.image], fixture.image);
  const alphaAfterCloseImage = await imageContent(driver, fixture.image, alphaMarker, betaMarker);
  screenshots.push(await driver.screenshot("scoped-file-alpha-independent-tabs"));
  fixture.stage("beta");
  const betaUrlWhileAlphaFocused = await fileUrlRead(driver, views.beta.id, fixture.text, betaMarker);
  assert.ok((await driver.read("text", { selector: selectors.topbar })).includes(views.alpha.label));
  const betaUnavailable = await verifyUnavailableTab(context, "beta", "alpha", fixture.text);
  const alphaUnavailable = await verifyUnavailableTab(context, "alpha", "beta", fixture.image);
  fixture.stage("alpha");
  await focusRemote(context, "alpha");
  states.alphaAfterReconnect = await expectTabs(driver, fixture, [fixture.image], fixture.image);
  const alphaRecoveredImage = await imageContent(driver, fixture.image, alphaMarker, betaMarker);
  return {
    canonicalPath: fixture.text,
    canonicalImagePath: fixture.image,
    filesystemModel: fixture.filesystemModel,
    configuredEnvironments: { alpha: views.alpha.id, beta: views.beta.id },
    tabStateModel: "Per-environment retained tabs and selection; only the active environment's tabs are visible",
    states,
    alphaText,
    betaText,
    betaRestoredText,
    alphaImage,
    betaImage,
    alphaRestoredImage,
    alphaAfterCloseImage,
    alphaRecoveredImage,
    alphaUrlWhileBetaFocused,
    betaUrlWhileAlphaFocused,
    betaUnavailable,
    alphaUnavailable,
    scopedRoutingDistinguishedByRealDisconnection: true,
    screenshots,
    coverageLimit:
      "The fixture proves per-environment retained tabs and selection, scoped routing, and separately rendered tab/blob reads. It does not create physically separate disks or force concurrent pending blob reads.",
  };
}
