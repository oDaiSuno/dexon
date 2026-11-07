import assert from "node:assert/strict";
import { remoteSettingsDialogWidths } from "../fixtures/remote-settings-native.mjs";

const button = (name, scope) => ({ role: "button", name, scope });

export async function verifyNativeDialogWidth(driver, scope, expected) {
  let width;
  await driver.waitFor(async () => {
    width = (await driver.page("elements", scope))[0]?.rect.width;
    return width !== undefined && Math.abs(width - expected) <= 1;
  }, `${scope.name} at its specified ${expected}px width`);
  return width;
}

export async function verifyNativeServerForms({ driver, labels, server, fixture, settingsScope, addScope }) {
  await driver.click(button(labels.add, settingsScope));
  await driver.waitFor(() => driver.exists(addScope), "Add remote server");
  await driver.waitFor(
    async () => {
      const text = await driver.page("text", { scope: addScope });
      return (
        text.includes(server.sshAlias) &&
        text.includes(fixture.config) &&
        text.includes(`fixture@127.0.0.1:${fixture.sshPort}`)
      );
    },
    "actual SSH config discovery with the local-only fixture",
    20000,
  );
  const discoveryWidth = await verifyNativeDialogWidth(driver, addScope, remoteSettingsDialogWidths.discovery);
  const discovery = await driver.screenshot("initial-add-ssh-discovery-light");
  await driver.click(button(labels.manual, addScope));
  const manualWidth = await verifyNativeDialogWidth(driver, addScope, remoteSettingsDialogWidths.manual);
  const fields = [
    [labels.label, server.manualLabel],
    [labels.alias, server.manualAlias],
    [labels.hostname, "127.0.0.1"],
    [labels.user, "fixture"],
  ];
  for (const [name, value] of fields) await driver.fill(name, value, addScope);
  await driver.click(button(labels.advanced, addScope));
  for (const [name, value] of [
    [labels.port, String(fixture.sshPort)],
    [labels.remotePort, "3780"],
    [labels.identity, fixture.identityFile],
    [labels.jump, `fixture@127.0.0.1:${fixture.sshPort}`],
    [labels.stateDir, "/tmp/dexon-remote-settings-fixture"],
  ]) {
    await driver.fill(name, value, addScope);
    fields.push([name, value]);
  }
  for (const [name, value] of fields)
    assert.equal(await driver.page("value", { role: "field", name, scope: addScope }), value);
  const advanced = await driver.screenshot("add-manual-advanced-light");
  await driver.key("Escape");
  await driver.waitFor(() => driver.exists(button("Discard", addScope)), "the unsaved manual details warning");
  await driver.click(button("Discard", addScope));
  await driver.waitFor(
    async () => !(await driver.exists(addScope)),
    "the manual dialog discarded without SSH connections",
  );
  assert.equal(
    (await driver.bridge("listEnvironments")).environments.filter((view) => view.id !== "primary").length,
    0,
  );
  return {
    discovery,
    advanced,
    fields: fields.map(([name]) => name),
    dialogWidths: { discovery: discoveryWidth, manual: manualWidth },
    noSshConnectionOrCredentials: true,
  };
}

export async function verifyNativeLifecyclePolicies({ driver, labels }) {
  await driver.settings();
  await driver.click({ role: "tab", name: "Servers" });
  for (const [name, key] of [
    [labels.detached, "detachedDaemon"],
    [labels.reconnect, "autoReconnect"],
  ]) {
    assert.equal(await driver.page("checked", { role: "switch", name }), true);
    await driver.click({ role: "switch", name });
    await driver.waitFor(async () => (await driver.bridge("listEnvironments")).policy[key] === false, `${name} saved`);
  }
  await driver.reload();
  await driver.settings();
  await driver.click({ role: "tab", name: "Servers" });
  for (const name of [labels.detached, labels.reconnect])
    assert.equal(await driver.page("checked", { role: "switch", name }), false);
  assert.deepEqual((await driver.bridge("listEnvironments")).policy, { detachedDaemon: false, autoReconnect: false });
  for (const name of [labels.detached, labels.reconnect]) await driver.click({ role: "switch", name });
  await driver.waitFor(
    async () => Object.values((await driver.bridge("listEnvironments")).policy).every(Boolean),
    "the lifecycle policies restored using native input",
  );
  return { persistedAfterRendererReload: { detachedDaemon: false, autoReconnect: false }, restored: true };
}

export async function verifyNativeServerEdit({ driver, labels, server, view, nodeVersion }) {
  const environmentId = view.id;
  const editScope = { role: "dialog", name: labels.editDialog };
  const card = (name = server.editedLabel) => ({ role: "article", name });
  await driver.click(button(labels.edit, card(server.label)));
  await driver.waitFor(() => driver.exists(editScope), "the real edit dialog");
  const dialogWidth = await verifyNativeDialogWidth(driver, editScope, remoteSettingsDialogWidths.edit);
  await driver.fill(labels.label, server.editedLabel, editScope);
  await driver.click(button(labels.save, editScope));
  await driver.waitFor(async () => !(await driver.exists(editScope)), "the edit saved through the real command");
  await driver.waitFor(async () => {
    view = (await driver.bridge("listEnvironments")).environments.find((candidate) => candidate.id === environmentId);
    return view?.label === server.editedLabel && view.status.phase === "connected";
  }, "the saved label and retained access token");
  if (!(await driver.exists(button(labels.test, card())))) await driver.click(button(labels.edit, card()));
  const scope = (await driver.exists(editScope)) ? editScope : card();
  await driver.click(button(labels.test, scope));
  await driver.waitFor(
    async () => (await driver.page("text", { scope })).includes("Connection test passed"),
    "the public successful test report",
    20000,
  );
  const report = await driver.page("definitions", { scope });
  assert.match(report.find((field) => field.name === "Latency")?.value ?? "", /^\d+ ms$/u);
  assert.equal(report.find((field) => field.name === "Node.js")?.value, nodeVersion);
  assert.equal(report.find((field) => field.name === "Remote daemon")?.value, "Daemon is running");
  const screenshot = await driver.screenshot("edit-test-public-report-light");
  if (await driver.exists(editScope)) await driver.click(button("Cancel", editScope));
  return {
    view,
    observation: { environmentId: view.id, editedLabel: view.label, publicReport: report, screenshot, dialogWidth },
  };
}

export async function verifyNativeRemoval({ driver, labels, view, daemon, workspace, closeDialog }) {
  const scope = { role: "dialog", name: labels.removeDialog };
  const card = { role: "article", name: view.label };
  await driver.click(button(labels.remove, card));
  await driver.waitFor(() => driver.exists(scope), "the explicit removal choice dialog");
  await verifyNativeDialogWidth(driver, scope, remoteSettingsDialogWidths.remove);
  const keep = { role: "radio", name: labels.keep, contains: true, scope };
  const stop = { role: "radio", name: labels.stop, contains: true, scope };
  assert.equal((await driver.page("elements", { role: "radio", scope })).length, 2);
  assert.equal(await driver.page("checked", keep), true, "removal defaults to keeping remote tasks alive");
  assert.equal((await driver.page("elements", stop))[0].disabled, true, "externally owned daemons cannot be stopped");
  await driver.screenshot("remove-keep-choice-dark");
  await driver.click(button(labels.removeKeep, scope));
  await driver.waitFor(
    async () => !(await driver.bridge("listEnvironments")).environments.some((candidate) => candidate.id === view.id),
    "the chosen server removed",
  );
  await driver.waitFor(
    async () => /was removed/u.test(await driver.page("text", { scope })),
    "the public removal outcome",
  );
  const text = await driver.page("text", { scope });
  assert.match(text, /left running/u);
  assert.ok(daemon.isAlive(), "an independently owned daemon is never stopped by removing its local connection");
  await driver.waitFor(async () => {
    const state = (await workspace()).projectSpaces;
    return (
      !state?.spaces.some((space) => space.environmentId === view.id) &&
      state?.lastFocusedSpace?.environmentId !== view.id
    );
  }, "removal cleared the local mounted spaces and focus");
  await closeDialog(scope);
  assert.equal(await driver.exists(card), false);
  return {
    outcomes: [{ choice: "keep", text, daemonStillAlive: daemon.isAlive(), localSpacesRemoved: true }],
    externallyOwnedStopDisabled: true,
    managedSshDaemonStopCovered: false,
    noExternalNetworkOrSshCredentials: true,
  };
}
