import assert from "node:assert/strict";
import test, { after } from "node:test";
import { attributionFixture, rootEl, restoreGlobals, harness } from "./remote-attribution.harness.mjs";

after(restoreGlobals);

const image = () => rootEl.querySelector('[role="textbox"] img');
const props = (environmentId, draftKey) => ({
  environmentId,
  draftKey,
  cwd: "/srv/shared",
  isStreaming: false,
  onSend() {},
  onAbort() {},
});
const encoded = (text) => ({ encoding: "base64", mime: "image/png", content: Buffer.from(text).toString("base64") });

test("identical image token paths resolve in the new draft's actual remote environment", async (t) => {
  const f = await attributionFixture(t);
  const blobs = new Map();
  t.mock.method(URL, "createObjectURL", (blob) => {
    const url = `blob:attribution-${blobs.size + 1}`;
    blobs.set(url, blob);
    return url;
  });
  f.serve("remote-a", { readFile: () => encoded("server A image") });
  f.serve("remote-b", { readFile: () => encoded("server B image") });
  const keyA = 'new:["remote-a","/srv/shared"]';
  const keyB = 'new:["remote-b","/srv/shared"]';
  f.api.setDraft(keyA, { value: "compare @/srv/shared/result.png" });
  f.api.setDraft(keyB, { value: "compare @/srv/shared/result.png" });
  await f.focus("remote-a");
  await f.render(f.api.ChatInput, props("remote-a", keyA));
  await f.flush();
  assert.equal(await blobs.get(image()?.getAttribute("src"))?.text(), "server A image");
  await f.focus("remote-b");
  await f.render(f.api.ChatInput, props("remote-b", keyB));
  await f.flush();
  assert.equal(await blobs.get(image()?.getAttribute("src"))?.text(), "server B image");
});

test("a late image from server A cannot replace server B's same-path draft preview", async (t) => {
  const f = await attributionFixture(t);
  const blobs = new Map();
  t.mock.method(URL, "createObjectURL", (blob) => {
    const url = `blob:late-attribution-${blobs.size + 1}`;
    blobs.set(url, blob);
    return url;
  });
  let finishA;
  const waitingA = new Promise((resolve) => {
    finishA = resolve;
  });
  f.serve("remote-a", { readFile: () => waitingA });
  f.serve("remote-b", { readFile: () => encoded("current B image") });
  f.api.setDraft("image-a", { value: "compare @/srv/shared/late.png" });
  f.api.setDraft("image-b", { value: "compare @/srv/shared/late.png" });
  await f.focus("remote-a");
  await f.render(f.api.ChatInput, props("remote-a", "image-a"));
  await f.flush();
  await f.focus("remote-b");
  await f.render(f.api.ChatInput, props("remote-b", "image-b"));
  await f.flush();
  assert.equal(await blobs.get(image()?.getAttribute("src"))?.text(), "current B image");
  finishA(encoded("obsolete A image"));
  await f.flush();
  assert.equal(await blobs.get(image()?.getAttribute("src"))?.text(), "current B image");
});

test("local file inspection is requalified by draft identity and ignores the previous draft's late result", async (t) => {
  const f = await attributionFixture(t);
  const inspections = [];
  t.mock.method(
    harness.dom.window.piBridge,
    "inspectLocalFiles",
    () => new Promise((resolve) => inspections.push(resolve)),
  );
  f.api.setDraft("local-inspection-a", { value: "inspect @/srv/shared/report.txt" });
  f.api.setDraft("local-inspection-b", { value: "inspect @/srv/shared/report.txt" });
  await f.focus("primary");
  await f.render(f.api.ChatInput, props("primary", "local-inspection-a"));
  await f.render(f.api.ChatInput, props("primary", "local-inspection-b"));
  assert.equal(inspections.length, 2);
  inspections[1]([{ exists: true, isFile: true, insideCwd: true }]);
  await f.flush();
  inspections[0]([{ exists: false, isFile: false, insideCwd: true }]);
  await f.flush();
  assert.equal(rootEl.querySelector(".token-chip-missing"), null);
  assert.ok(rootEl.querySelector('[data-attachment-token][data-path="/srv/shared/report.txt"]'));
});
