import { accessibleName, allByRole, byRole } from "../support/dom-queries.mjs";

export function createFoldQueries({ document, window, bubbleOf, bounds }) {
  const conversationOf = (scope) => {
    const nearest = scope?.closest('[role="region"]') ?? null;
    if (nearest && nearest.scrollHeight >= nearest.clientHeight) return nearest;
    for (const region of document.querySelectorAll('[role="region"]')) {
      if (region.scrollHeight > region.clientHeight) return region;
    }
    return nearest;
  };

  const rangeLines = (element) => {
    if (!element) return 0;
    const range = document.createRange();
    range.selectNodeContents(element);
    return [...range.getClientRects()].filter((rect) => rect.width > 0).length;
  };

  const toggleOf = (scope) => {
    for (const button of scope.querySelectorAll("button[aria-controls]")) {
      const region = document.getElementById(button.getAttribute("aria-controls"));
      if (region && scope.contains(region)) return { button, region };
    }
    return null;
  };

  const barOf = (button, region) => {
    let bar = button;
    for (let node = button.parentElement; node && node !== document.body; node = node.parentElement) {
      if (region && node.contains(region)) break;
      bar = node;
    }
    return bar;
  };

  const clippedOf = (element) => {
    const rect = element.getBoundingClientRect();
    let top = rect.top;
    let bottom = rect.bottom;
    let left = rect.left;
    let right = rect.right;
    for (let node = element.parentElement; node; node = node.parentElement) {
      const style = window.getComputedStyle(node);
      if (style.overflowX === "visible" && style.overflowY === "visible") continue;
      const box = node.getBoundingClientRect();
      top = Math.max(top, box.top);
      bottom = Math.min(bottom, box.bottom);
      left = Math.max(left, box.left);
      right = Math.min(right, box.right);
    }
    return { width: Math.max(0, right - left), height: Math.max(0, bottom - top) };
  };

  const conversationSummary = (scope) => {
    const element = conversationOf(scope);
    if (!element) return null;
    const spacer = element.querySelector("[data-run-spacer]");
    const spacerHeight = spacer ? spacer.getBoundingClientRect().height : 0;
    return {
      rect: bounds(element),
      scrollTop: element.scrollTop,
      scrollHeight: element.scrollHeight,
      clientHeight: element.clientHeight,
      spacerHeight: Math.round(spacerHeight),
      distanceFromBottom: Math.round(element.scrollHeight - element.clientHeight - element.scrollTop),
      distanceToLiveEnd: Math.round(element.scrollHeight - spacerHeight - element.clientHeight - element.scrollTop),
      scrollToBottomButton: Boolean(
        byRole(document, "button", /^(Scroll to bottom|Jump to latest|滚到底部|跳到最新)$/),
      ),
    };
  };

  const regionSummary = (region) => {
    if (!region) return null;
    const style = window.getComputedStyle(region);
    return {
      id: region.id ?? "",
      rect: bounds(region),
      clientHeight: region.clientHeight,
      scrollHeight: region.scrollHeight,
      scrollTop: region.scrollTop,
      lineHeight: Number.parseFloat(style.lineHeight),
      lines: rangeLines(region),
      text: region.textContent ?? "",
    };
  };

  const barSummary = (toggle) => {
    if (!toggle) return null;
    const bar = barOf(toggle.button, toggle.region);
    const clone = bar.cloneNode(true);
    for (const button of clone.querySelectorAll("button")) button.remove();
    return {
      rect: bounds(bar),
      label: (clone.textContent ?? "").replace(/\s+/g, " ").trim(),
      text: (bar.textContent ?? "").replace(/\s+/g, " ").trim(),
      buttons: [...bar.querySelectorAll("button")].map((button) => ({
        name: accessibleName(button),
        expanded: button.getAttribute("aria-expanded"),
        controls: button.getAttribute("aria-controls"),
        rect: bounds(button),
      })),
    };
  };

  const rowButton = (scope, name) => {
    for (let node = scope.parentElement; node && node !== document.body; node = node.parentElement) {
      const match = allByRole(node, "button", name)[0];
      if (match) return match;
    }
    return null;
  };

  const pointOn = (element) => {
    const rect = element.getBoundingClientRect();
    const x = Math.round(rect.x + rect.width / 2);
    const y = Math.round(rect.y + rect.height / 2);
    const hit = document.elementFromPoint(x, y);
    return { x, y, hits: Boolean(hit && (element.contains(hit) || hit.contains(element))) };
  };

  const fold = (marker) => {
    const scope = bubbleOf(marker);
    if (!scope) return { exists: false };
    const toggle = toggleOf(scope);
    const region = toggle ? toggle.region : scope.querySelector("p");
    const conversation = conversationSummary(scope);
    return {
      exists: true,
      source: scope.getAttribute("data-message-source"),
      bubble: bounds(scope),
      region: regionSummary(region),
      bar: barSummary(toggle),
      images: [...scope.querySelectorAll("img")].map((image) => ({
        rect: bounds(image),
        naturalWidth: image.naturalWidth,
        loaded: image.complete && image.naturalWidth > 0,
        inRegion: Boolean(region && region.contains(image)),
        inChip: image.closest("[title]") !== null,
        visible: clippedOf(image),
      })),
      bubbleTopInConversation: conversation ? Math.round(bounds(scope).top - conversation.rect.top) : null,
      scrolledInside: [...scope.querySelectorAll("*")]
        .filter((element) => element.scrollTop !== 0)
        .map((element) => ({ tag: element.tagName.toLowerCase(), scrollTop: element.scrollTop })),
      conversation,
    };
  };

  return {
    fold(marker) {
      return fold(marker);
    },
    conversation() {
      return conversationSummary(null);
    },
    foldPoint(marker) {
      const scope = bubbleOf(marker);
      const toggle = scope ? toggleOf(scope) : null;
      return toggle ? pointOn(toggle.button) : null;
    },
    foldFocused(marker) {
      const scope = bubbleOf(marker);
      const toggle = scope ? toggleOf(scope) : null;
      const active = document.activeElement;
      return Boolean(toggle && active && (toggle.button === active || toggle.button.contains(active)));
    },
    focusBefore(marker) {
      const scope = bubbleOf(marker);
      let previous = scope?.closest("[data-reading-anchor]")?.previousElementSibling ?? null;
      while (previous) {
        const controls = [...previous.querySelectorAll('button, a[href], [tabindex]:not([tabindex="-1"])')];
        const last = controls.at(-1);
        if (last) {
          last.focus();
          return true;
        }
        previous = previous.previousElementSibling;
      }
      return false;
    },
    rowButtonPoint(marker, name) {
      const scope = bubbleOf(marker);
      const button = scope ? rowButton(scope, name) : null;
      return button ? pointOn(button) : null;
    },
    async appearance(marker) {
      const scope = bubbleOf(marker);
      const container = conversationOf(scope);
      if (!scope || !container) return { exists: false };
      const containerRect = container.getBoundingClientRect();
      const before = scope.getBoundingClientRect();
      const offscreen = before.bottom < containerRect.top || before.top > containerRect.bottom;
      scope.scrollIntoView({ block: "center" });
      for (let frame = 1; frame <= 6; frame += 1) {
        await new Promise((resolve) => window.requestAnimationFrame(resolve));
        const snapshot = fold(marker);
        if (snapshot.region && snapshot.region.rect.height > 0 && snapshot.region.lines > 0) {
          return {
            ...snapshot,
            offscreen,
            frames: frame,
            before: { top: Math.round(before.top), bottom: Math.round(before.bottom) },
            viewport: { top: Math.round(containerRect.top), bottom: Math.round(containerRect.bottom) },
          };
        }
      }
      return { ...fold(marker), offscreen, frames: 6, before: bounds(scope) };
    },
    bottomIntoView(marker, gap = 40) {
      const scope = bubbleOf(marker);
      const container = conversationOf(scope);
      if (!scope || !container) return null;
      const rect = scope.getBoundingClientRect();
      const containerRect = container.getBoundingClientRect();
      container.scrollTop += Math.round(rect.bottom - containerRect.bottom + gap);
      return { scrollTop: container.scrollTop, gap };
    },
    topIntoView(marker, gap = 16) {
      const scope = bubbleOf(marker);
      const container = conversationOf(scope);
      if (!scope || !container) return null;
      const rect = scope.getBoundingClientRect();
      const containerRect = container.getBoundingClientRect();
      container.scrollTop += Math.round(rect.top - containerRect.top - gap);
      return { scrollTop: container.scrollTop, gap };
    },
    scrollToBottom() {
      const container = conversationOf(null);
      if (!container) return null;
      container.scrollTop = container.scrollHeight;
      return { scrollTop: container.scrollTop };
    },
    editorText(marker) {
      const editors = [...document.querySelectorAll('[contenteditable="true"]')];
      const editor = editors.find((candidate) => (candidate.textContent ?? "").includes(marker));
      return editor ? (editor.textContent ?? "") : null;
    },
    channelColors(marker) {
      const scope = bubbleOf(marker);
      if (!scope) return null;
      const toggle = toggleOf(scope);
      const bar = toggle ? barOf(toggle.button, toggle.region) : null;
      const leaf = bar
        ? [...bar.querySelectorAll("*")].find(
            (element) =>
              element.children.length === 0 &&
              !element.querySelector("button") &&
              (element.textContent ?? "").trim() !== "",
          )
        : null;
      const style = window.getComputedStyle(scope);
      return {
        label: window.getComputedStyle(leaf ?? bar ?? scope).color,
        muted: style.getPropertyValue("--fx-channel-on-brand-muted").trim(),
      };
    },
  };
}
