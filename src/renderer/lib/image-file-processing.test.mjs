import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

test("ChatInput stages clipboard images through the normalization pipeline", () => {
  const source = fs.readFileSync(new URL("../components/ChatInput.tsx", import.meta.url), "utf8");

  // Clipboard bitmaps are normalized (resize/format gate) before staging.
  assert.match(source, /const \{ images, failures \} = await processImageFileBatch\(\[file\]\)/);
  // Staging goes through the bridge and the staged preview is registered so
  // the token renders a thumbnail immediately.
  assert.match(source, /stageClipboardImage\?\.\(\{\s*base64: image\.data,/);
  assert.match(source, /registerStagedPreviewUrl\(result\.staged\.path/);
});

test("StatusBanners keeps alert semantics for notice banners", () => {
  const bannerSource = fs.readFileSync(new URL("../components/chat-input/StatusBanners.tsx", import.meta.url), "utf8");
  assert.match(bannerSource, /role="alert"/);
});
