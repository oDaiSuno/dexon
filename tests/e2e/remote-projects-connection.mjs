import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { remoteProjectLabels as labels, startRemoteProjectsDaemon } from "../fixtures/remote-projects-native.mjs";
import { remoteProjectSelectors as selectors } from "./remote-projects-page.mjs";
import { focusRemote } from "./remote-projects-navigation.mjs";
import { openRemoteFile } from "./remote-projects-files.mjs";

async function environment(driver, id) {
  return (await driver.bridge("listEnvironments")).environments.find((view) => view.id === id);
}

async function waitPhase(driver, id, phase) {
  await driver.waitFor(
    async () => (await environment(driver, id))?.status.phase === phase,
    `the real server enters ${phase}`,
    25000,
  );
  return environment(driver, id);
}

async function assertTone(driver, view, project, tone, status) {
  await driver.waitFor(
    async () => (await driver.row(view, project))?.tone === tone,
    `the visible project row becomes ${tone}`,
  );
  const row = await driver.row(view, project);
  assert.match(row.host.name, status);
  return row;
}

async function sendControls(driver) {
  return (await driver.page("elements", { role: "button", scope: { role: "group", name: "Message input" } })).filter(
    (button) => /send|waiting|reconnect/iu.test(button.name),
  );
}

export async function verifyOutageDraft(context) {
  const { driver, daemons, views, fixture } = context;
  await focusRemote(context);
  const draft = "Keep this native remote draft during a real daemon outage.";
  await driver.fillDraft(draft);
  const onlineSend = await sendControls(driver);
  assert.equal(onlineSend.length, 1);
  assert.ok(!onlineSend[0].disabled, "The same nonempty draft has an enabled send control before the outage");
  const beforeSessions = await daemons[0].rpc("sessions.list");
  const beforeBubbles = await driver.read("all", { selector: "[data-message-source]" });
  await daemons[0].stop();
  let backoff;
  await driver.waitFor(
    async () => {
      const view = await environment(driver, views.alpha.id);
      if (view.status.phase !== "backoff" || view.status.failureCount < 4 || view.status.retryAt - Date.now() < 6000)
        return false;
      backoff = view.status;
      return true;
    },
    "a real retry interval long enough to observe its countdown",
    45000,
  );
  const pending = await assertTone(driver, views.alpha, fixture.project, "pending", /Reconnecting|Connecting/u);
  const banner = { selector: selectors.banner };
  await driver.waitFor(() => driver.read("exists", banner), "the automatic reconnection banner");
  const firstCountdown = await driver.read("text", banner);
  assert.ok(firstCountdown.includes(views.alpha.label));
  assert.match(firstCountdown, /\d+\s*(?:s\b|seconds?)/iu);
  await driver.waitFor(
    async () => {
      const view = await environment(driver, views.alpha.id);
      return (
        view.status.phase === "backoff" &&
        view.status.retryAt === backoff.retryAt &&
        (await driver.read("text", banner)) !== firstCountdown
      );
    },
    "the visible countdown advances without a fake clock",
    3000,
  );
  const nextCountdown = await driver.read("text", banner);
  const blockedSend = await sendControls(driver);
  assert.equal(blockedSend.length, 1, "The composer has one disabled send entry point");
  assert.ok(blockedSend[0].disabled, "A nonempty draft cannot be sent while disconnected");
  const composer = await driver.read("text", { selector: selectors.attribution });
  assert.ok(composer.includes(views.alpha.label) && composer.includes(fixture.project));
  assert.match(composer, /draft.*saved|saved.*draft/iu);
  const pendingTopbar = await driver.read("text", { selector: selectors.topbar });
  assert.match(pendingTopbar, /Reconnecting|Connecting/u);
  assert.match(await driver.page("text"), /reconnect.*send|send.*reconnect/iu);
  const priorSubmissionNotices = (await driver.read("all", { selector: ".composer-banner" })).map(
    (notice) => notice.text,
  );
  await driver.clickCss({ selector: selectors.composer });
  await driver.key("Enter");
  assert.equal(await driver.read("draft"), draft, "Native Enter is blocked without consuming the remote draft");
  assert.deepEqual(
    await driver.read("all", { selector: "[data-message-source]" }),
    beforeBubbles,
    "Native Enter does not append a user message during the outage",
  );
  assert.deepEqual(
    (await driver.read("all", { selector: ".composer-banner" })).map((notice) => notice.text),
    priorSubmissionNotices,
    "A blocked Enter does not produce a failed-submission notice",
  );
  const screenshot = await driver.screenshot("outage-disabled-send-preserved-draft");
  await daemons[0].start();
  assert.deepEqual(
    (await driver.read("all", { selector: ".composer-banner" })).map((notice) => notice.text),
    priorSubmissionNotices,
    "The blocked draft was never submitted asynchronously",
  );
  const scheduledRetryAt = backoff.retryAt;
  assert.ok(Date.now() < scheduledRetryAt, "The daemon returns before the scheduled retry");
  await driver.clickCss({ selector: `${selectors.banner} button`, text: "Reconnect now" });
  await waitPhase(driver, views.alpha.id, "connected");
  assert.ok(Date.now() < scheduledRetryAt, "Reconnect now bypasses the scheduled backoff");
  await assertTone(driver, views.alpha, fixture.project, "online", /Online/u);
  await driver.waitFor(async () => !(await driver.read("exists", banner)), "the reconnection banner clears");
  assert.equal(
    await driver.read("draft"),
    draft,
    "The original remote draft is restored after the real connection returns",
  );
  assert.deepEqual(
    (await daemons[0].rpc("sessions.list")).sessions.map((session) => session.id),
    beforeSessions.sessions.map((session) => session.id),
    "The blocked Enter never created a persisted remote session",
  );
  const restoredSend = await sendControls(driver);
  assert.equal(restoredSend.length, 1);
  assert.ok(!restoredSend[0].disabled, "Reconnect re-enables the same nonempty draft");
  await driver.reload();
  await driver.waitFor(
    async () => (await driver.read("draft")) === draft,
    "the saved environment-scoped draft is restored through a real renderer reload",
  );
  const recoveredScreenshot = await driver.screenshot("reconnected-restored-draft-after-reload");
  const result = {
    pending,
    firstCountdown,
    nextCountdown,
    pendingTopbar,
    onlineSend,
    blockedSend,
    restoredSend,
    draft,
    retainedAfterReconnect: await driver.read("draft"),
    scheduledRetryBypassed: true,
    persistedSessionsBefore: beforeSessions.sessions.length,
    screenshots: [screenshot, recoveredScreenshot],
    limitation:
      "No model credentials, model response, or live streaming recovery is exercised. The real send control is enabled before the outage, disabled during it, and enabled after recovery.",
  };
  await driver.fillDraft("");
  return result;
}

export async function verifyOfflineAndBlocked(context) {
  const { driver, daemons, views, fixture } = context;
  await driver.bridge("environmentCommand", { type: "disconnect", environmentId: views.alpha.id });
  await waitPhase(driver, views.alpha.id, "offline");
  const offline = await assertTone(driver, views.alpha, fixture.project, "offline", /Offline/u);
  assert.match(await driver.read("text", { selector: selectors.topbar }), /Offline/u);
  const offlineScreenshot = await driver.screenshot("remote-offline");
  const previousIdentity = daemons[0].environmentId;
  await daemons[0].replaceIdentity();
  assert.notEqual(
    daemons[0].environmentId,
    previousIdentity,
    "A new real daemon identity takes over the same loopback endpoint",
  );
  await driver.bridge("environmentCommand", { type: "connect", environmentId: views.alpha.id });
  const blockedView = await waitPhase(driver, views.alpha.id, "blocked");
  assert.equal(blockedView.status.diagnosis.reason, "identity-mismatch");
  const blocked = await assertTone(driver, views.alpha, fixture.project, "blocked", /Needs attention|Blocked/u);
  const banner = { selector: selectors.banner };
  await driver.waitFor(
    async () => /identity|server.*changed/iu.test(await driver.read("text", banner)),
    "the actionable identity diagnosis appears in the session banner",
  );
  const diagnosisText = await driver.read("text", banner);
  assert.ok(diagnosisText.includes(views.alpha.label));
  assert.doesNotMatch(diagnosisText, /\d+\s*(?:seconds?|s)\s*(?:until|before|to retry)/iu);
  const blockedScreenshot = await driver.screenshot("remote-blocked-identity-diagnosis");
  await driver.clickCss({ selector: `${selectors.banner} button`, text: "View diagnosis" });
  await driver.waitFor(
    () => driver.exists({ role: "region", name: "Settings" }),
    "the blocked banner opens connection settings",
  );
  assert.equal(await driver.page("attribute", { role: "tab", name: "Servers", attribute: "aria-selected" }), "true");
  const settingsDiagnosis = await driver.page("text", { scope: { role: "article", name: views.alpha.label } });
  assert.match(settingsDiagnosis, /The remote Dexon environment identity has changed/u);
  await driver.bridge("environmentCommand", {
    type: "trust",
    environmentId: views.alpha.id,
    trust: "environment-identity",
  });
  await waitPhase(driver, views.alpha.id, "connected");
  await driver.closeSettings();
  await focusRemote(context);
  return {
    offline,
    blocked,
    previousIdentity,
    replacementIdentity: daemons[0].environmentId,
    diagnosisText,
    settingsDiagnosis,
    screenshots: [offlineScreenshot, blockedScreenshot],
    injectedStatus: false,
  };
}

export async function verifyZeroSessionRestart(context) {
  const { driver, daemons, views, fixture } = context;
  const sessions = await daemons[0].rpc("sessions.list");
  assert.equal(sessions.sessions.length, 0, "The mounted project must have no session-based authorization fallback");
  await focusRemote(context);
  await driver.showPanel();
  await driver.click({ role: "button", name: "Explorer" });
  await driver.waitFor(
    () => driver.exists({ role: "button", name: "Open file scope-proof.txt" }),
    "the zero-session remote files are initially readable",
  );
  const before = await environment(driver, views.alpha.id);
  await daemons[0].stop();
  await driver.waitFor(
    async () => (await environment(driver, views.alpha.id)).status.phase !== "connected",
    "desktop observes the real daemon restart",
  );
  const sentinelName = "after-real-daemon-restart.txt";
  fs.writeFileSync(
    path.join(fixture.project, sentinelName),
    "A new filesystem entry requires a fresh authorized remote read.\n",
  );
  await daemons[0].start();
  await driver.bridge("environmentCommand", { type: "connect", environmentId: views.alpha.id });
  const after = await waitPhase(driver, views.alpha.id, "connected");
  assert.ok(after.status.generation > before.status.generation);
  await driver.click({ role: "button", name: "Refresh explorer" });
  await driver.waitFor(
    () => driver.exists({ role: "button", name: `Open file ${sentinelName}` }),
    "fresh remote tree access is reauthorized after the daemon lost its in-memory allowedRoots",
    20000,
  );
  await openRemoteFile(driver, path.join(fixture.project, sentinelName));
  await driver.waitFor(
    async () =>
      (await driver.read("text", { selector: selectors.panel })).includes(
        "A new filesystem entry requires a fresh authorized remote read.",
      ),
    "the new file is opened by the real viewer after restart",
  );
  assert.equal((await daemons[0].rpc("sessions.list")).sessions.length, 0);
  return {
    zeroSessions: true,
    priorGeneration: before.status.generation,
    newGeneration: after.status.generation,
    sentinelName,
    actualDaemonPids: daemons[0].generations.map((generation) => generation.pid),
  };
}

export async function verifyOneTimeMigration(context) {
  const { driver, fixture, daemons, addRemote, output } = context;
  const history = { cwd: fixture.migrationProject, title: "Existing remote project before Unit 5" };
  const daemon = await startRemoteProjectsDaemon({
    root: process.cwd(),
    node: process.env.DEXON_REMOTE_PROJECTS_NODE,
    output,
    name: "migration",
    label: "Proof migration",
    history,
  });
  daemons.push(daemon);
  const view = await addRemote(daemon, "Proof migration");
  const persisted = await daemon.rpc("sessions.list");
  assert.ok(persisted.sessions.some((session) => session.id === daemon.seededHistory.sessionId));
  await driver.waitFor(
    async () => Boolean(await driver.row(view, fixture.migrationProject)),
    "an actual existing remote session root is mounted once on upgrade",
  );
  const seededRows = await driver.read("rows");
  await driver.openMenu(view, fixture.migrationProject);
  await driver.click({ role: "menuitem", name: labels.remove });
  await driver.waitFor(
    async () => !(await driver.row(view, fixture.migrationProject)),
    "the user unmounts the auto-seeded remote project",
  );
  await driver.reload();
  await driver.waitFor(
    () => driver.read("exists", { selector: selectors.list }),
    "the healthy unified sidebar after reload",
  );
  assert.doesNotMatch(await driver.page("text"), /UI crashed|Cannot connect to Agent Host/u);
  await driver.waitFor(
    async () => (await driver.bridge("getUiState")).projectSpaces?.seeded.includes(view.id),
    "the migration decision persists through a real renderer reload",
  );
  await driver.waitFor(
    async () => (await environment(driver, view.id)).status.phase === "connected",
    "the migrated server remains connected",
  );
  const observationDeadline = Date.now() + 2000;
  await driver.waitFor(
    async () => {
      assert.ok(
        !(await driver.row(view, fixture.migrationProject)),
        "The previously unmounted session root does not reappear after reload",
      );
      return Date.now() >= observationDeadline;
    },
    "the unmounted project remains absent while remote session discovery settles",
    3000,
  );
  assert.ok(
    (await daemon.rpc("sessions.list")).sessions.some((session) => session.id === daemon.seededHistory.sessionId),
    "Unmounting and migration do not delete the original remote conversation",
  );
  return {
    fixture: daemon.seededHistory,
    seededRows,
    afterReloadRows: await driver.read("rows"),
    oldHistoryPreserved: true,
    oneTimeSeedRespectsUserRemoval: true,
  };
}

export async function verifyThemeStates(context) {
  const { driver, fixture, daemons, views } = context;
  const observations = [];
  for (const theme of ["light", "dark"]) {
    await driver.theme(theme);
    await driver.closeSettings();
    await focusRemote(context);
    const online = await assertTone(driver, views.alpha, fixture.project, "online", /Online/u);
    const screenshots = [await driver.screenshot(`remote-online-${theme}`)];
    await driver.bridge("environmentCommand", { type: "disconnect", environmentId: views.alpha.id });
    await waitPhase(driver, views.alpha.id, "offline");
    const offline = await assertTone(driver, views.alpha, fixture.project, "offline", /Offline/u);
    screenshots.push(await driver.screenshot(`remote-offline-${theme}`));
    await daemons[0].replaceIdentity();
    await driver.bridge("environmentCommand", { type: "connect", environmentId: views.alpha.id });
    await waitPhase(driver, views.alpha.id, "blocked");
    const blocked = await assertTone(driver, views.alpha, fixture.project, "blocked", /Needs attention|Blocked/u);
    await driver.waitFor(() => driver.read("exists", { selector: selectors.banner }), "the blocked diagnosis banner");
    screenshots.push(await driver.screenshot(`remote-blocked-${theme}`));
    await driver.bridge("environmentCommand", {
      type: "trust",
      environmentId: views.alpha.id,
      trust: "environment-identity",
    });
    await waitPhase(driver, views.alpha.id, "connected");
    await daemons[0].stop();
    await waitPhase(driver, views.alpha.id, "backoff");
    const pending = await assertTone(driver, views.alpha, fixture.project, "pending", /Reconnecting|Connecting/u);
    await driver.waitFor(() => driver.read("exists", { selector: selectors.banner }), "the real reconnect banner");
    screenshots.push(await driver.screenshot(`remote-pending-${theme}`));
    await daemons[0].start();
    await driver.bridge("environmentCommand", { type: "connect", environmentId: views.alpha.id });
    await waitPhase(driver, views.alpha.id, "connected");
    observations.push({ theme, online, pending, offline, blocked, screenshots });
  }
  return { observations, injectedStatus: false };
}
