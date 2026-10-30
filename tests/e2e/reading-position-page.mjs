// Serialized into Chromium by the native harness. Only public page state is
// read: roles, names, text and rendered geometry.
export function readingPositionPage(operation, args = {}) {
  const { document, getComputedStyle } = globalThis;
  const implicit = { button: "button", navigation: "nav", heading: "h1,h2,h3,h4,h5,h6", region: "[role=region]" };
  const nameOf = (element) =>
    (
      element.getAttribute("aria-label") ||
      element
        .getAttribute("aria-labelledby")
        ?.split(/\s+/)
        .map((id) => document.getElementById(id)?.textContent ?? "")
        .join(" ") ||
      element.textContent ||
      ""
    )
      .replace(/\s+/g, " ")
      .trim();
  const exposed = (element) => {
    if (!element || !element.getClientRects().length) return false;
    for (let current = element; current; current = current.parentElement) {
      const style = getComputedStyle(current);
      if (
        current.hidden ||
        current.hasAttribute("inert") ||
        current.getAttribute("aria-hidden") === "true" ||
        style.display === "none" ||
        style.visibility === "hidden"
      )
        return false;
    }
    const rect = element.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0;
  };
  const find = (role, name, root = document) => {
    const selector = [`[role="${role}"]`, implicit[role]].filter(Boolean).join(",");
    const matches = [...root.querySelectorAll(selector)].filter(
      (element) => exposed(element) && (name === undefined || nameOf(element).toLowerCase() === name.toLowerCase()),
    );
    if (matches.length > 1) throw new Error(`Ambiguous public control ${role}: ${name}`);
    return matches[0] ?? null;
  };
  const centerOf = (element) => {
    element.scrollIntoView({ block: "nearest", inline: "nearest" });
    const rect = element.getBoundingClientRect();
    const x = Math.round(rect.x + rect.width / 2);
    const heights = [0.5, 0.25, 0.75, 0.1, 0.9];
    let coveredBy = null;
    for (const fraction of heights) {
      const y = Math.round(rect.y + rect.height * fraction);
      const top = document.elementFromPoint(x, y);
      if (top && (element.contains(top) || top.contains(element))) return { x, y, hit: true };
      coveredBy ??= `${top?.tagName} ${nameOf(top ?? element).slice(0, 60)}`;
    }
    return { x, y: Math.round(rect.y + rect.height / 2), hit: false, coveredBy };
  };
  const conversation = () => find("region", "Conversation");
  const longPromptToggle = (marker) =>
    [...document.querySelectorAll("button[aria-controls]")].find((button) => {
      const controlled = document.getElementById(button.getAttribute("aria-controls"));
      return Boolean(controlled) && (controlled.textContent ?? "").includes(marker);
    }) ?? null;
  const longPromptText = (marker) => {
    const region = conversation();
    if (!region) return null;
    const paragraphs = [...region.querySelectorAll("p")].filter((element) =>
      (element.textContent ?? "").includes(marker),
    );
    return paragraphs.at(-1) ?? null;
  };
  const sentences = () => {
    const region = conversation();
    if (!region) return [];
    const top = region.getBoundingClientRect().top;
    const matches = [...region.querySelectorAll("*")].filter((element) => {
      if (!exposed(element)) return false;
      const text = element.textContent.replace(/\s+/g, " ").trim();
      if (!/^(Question|Answer) \d+ of (Long|Short) reading [A-Z]( — the reply starts here\.)?$/.test(text))
        return false;
      return ![...element.children].some((child) => child.textContent.replace(/\s+/g, " ").trim() === text);
    });
    return matches.map((element) => ({
      text: element.textContent.replace(/\s+/g, " ").trim(),
      top: element.getBoundingClientRect().top - top,
    }));
  };
  if (operation === "longPrompt") {
    const region = conversation();
    if (!region) return null;
    const origin = region.getBoundingClientRect().top;
    const toggle = longPromptToggle(args.marker);
    const controlled = toggle ? document.getElementById(toggle.getAttribute("aria-controls")) : null;
    const text = longPromptText(args.marker);
    const block = controlled ?? text;
    const anchor = block?.closest("[data-reading-anchor]") ?? null;
    const relative = (element) => (element ? Math.round(element.getBoundingClientRect().top - origin) : null);
    return {
      rendered: Boolean(text && text.getClientRects().length),
      anchorTop: relative(anchor),
      textTop: relative(block),
      textHeight: block ? Math.round(block.getBoundingClientRect().height) : null,
      folded: Boolean(toggle),
      expanded: toggle ? toggle.getAttribute("aria-expanded") : null,
      toggleName: toggle ? nameOf(toggle) : null,
      scrollTop: Math.round(region.scrollTop),
    };
  }
  if (operation === "longPromptTogglePoint") {
    const toggle = longPromptToggle(args.marker);
    return toggle ? centerOf(toggle) : null;
  }
  if (operation === "scrollLongPromptTo") {
    const region = conversation();
    const toggle = longPromptToggle(args.marker);
    const controlled = toggle ? document.getElementById(toggle.getAttribute("aria-controls")) : null;
    const block = controlled ?? longPromptText(args.marker);
    const anchor = block?.closest("[data-reading-anchor]") ?? block;
    if (!region || !anchor) return null;
    const origin = region.getBoundingClientRect().top;
    const current = anchor.getBoundingClientRect().top - origin;
    region.scrollTop += current - args.top;
    return { scrollTop: Math.round(region.scrollTop) };
  }
  if (operation === "scrollTextTo") {
    const region = conversation();
    if (!region) return null;
    const element = [...region.querySelectorAll("*")].find(
      (candidate) => (candidate.textContent ?? "").replace(/\s+/g, " ").trim() === args.text,
    );
    if (!element) return null;
    const origin = region.getBoundingClientRect().top;
    region.scrollTop += element.getBoundingClientRect().top - origin - args.top;
    return { scrollTop: Math.round(region.scrollTop) };
  }
  if (operation === "readingAnchors") {
    const region = conversation();
    if (!region) return [];
    const origin = region.getBoundingClientRect().top;
    return [...region.querySelectorAll("[data-reading-anchor]")].map((element) => {
      const rect = element.getBoundingClientRect();
      return {
        key: element.getAttribute("data-reading-anchor"),
        top: Math.round(rect.top - origin),
        height: Math.round(rect.height),
        text: (element.textContent ?? "").replace(/\s+/g, " ").trim().slice(0, 80),
      };
    });
  }
  if (operation === "text") return document.body.innerText;
  if (operation === "exists") return Boolean(find(args.role, args.name));
  if (operation === "conversation") {
    const region = conversation();
    if (!region) return null;
    const rect = region.getBoundingClientRect();
    return {
      scrollTop: region.scrollTop,
      scrollHeight: region.scrollHeight,
      clientHeight: region.clientHeight,
      distanceFromBottom: region.scrollHeight - region.clientHeight - region.scrollTop,
      center: { x: Math.round(rect.x + rect.width / 2), y: Math.round(rect.y + rect.height / 2) },
      scrollToBottomButton: Boolean(
        [...document.querySelectorAll('[role="button"], button')].find(
          (element) => exposed(element) && nameOf(element) === "Scroll to bottom",
        ),
      ),
    };
  }
  if (operation === "earlierMessages") {
    const zone = find("group", "Earlier messages");
    return zone ? zone.textContent.replace(/\s+/g, " ").trim() : null;
  }
  if (operation === "sentences") return sentences();
  if (operation === "offset") {
    const match = sentences().find((sentence) => sentence.text === args.text);
    return match ? match.top : null;
  }
  if (operation === "lowestQuestion") {
    const numbers = sentences().map((sentence) => Number(/^\D+ (\d+)/.exec(sentence.text)?.[1] ?? Number.NaN));
    return numbers.length ? Math.min(...numbers) : null;
  }
  if (operation === "historyRows") {
    const nav = find("navigation", "Main navigation");
    if (!nav) return [];
    return [...nav.querySelectorAll("button")]
      .filter((element) => exposed(element))
      .map((element) => {
        const rect = element.getBoundingClientRect();
        return { name: nameOf(element), left: Math.round(rect.left), top: Math.round(rect.top) };
      });
  }
  if (operation === "clickTarget") {
    const element = find(args.role, args.name);
    if (!element) return null;
    element.scrollIntoView({ block: "center", inline: "nearest" });
    // Accordion headers stick to the top of the conversation, so a centred
    // control can still sit underneath one; nudge it clear before pointing.
    const scroller = element.closest('[role="region"][aria-label="Conversation"]');
    if (scroller) scroller.scrollTop -= 60;
    const rect = element.getBoundingClientRect();
    const x = Math.round(rect.x + rect.width / 2);
    const y = Math.round(rect.y + rect.height / 2);
    const top = document.elementFromPoint(x, y);
    return {
      x,
      y,
      rect: {
        left: Math.round(rect.left),
        top: Math.round(rect.top),
        width: Math.round(rect.width),
        height: Math.round(rect.height),
      },
      self: `${element.tagName}.${element.className}`,
      top: top ? `${top.tagName}.${top.className}` : null,
      inside: Boolean(top && element.contains(top)),
    };
  }
  if (operation === "processDetailsExpanded") {
    const element = [...document.querySelectorAll("button")].find((candidate) =>
      (candidate.getAttribute("title") ?? "").includes("process details"),
    );
    return element ? element.getAttribute("aria-expanded") === "true" : null;
  }
  if (operation === "pointByTitle") {
    const element = [...document.querySelectorAll("button")].find(
      (candidate) => exposed(candidate) && (candidate.getAttribute("title") ?? "").includes(args.contains),
    );
    return element ? centerOf(element) : null;
  }
  if (operation === "historyPoint") {
    const nav = find("navigation", "Main navigation");
    const row = nav
      ? [...nav.querySelectorAll("button")]
          .filter((element) => exposed(element) && nameOf(element).includes(args.contains))
          .at(0)
      : undefined;
    return row ? centerOf(row) : null;
  }
  if (operation === "point") {
    const element = find(args.role, args.name);
    return element ? centerOf(element) : null;
  }
  throw new Error(`Unknown public page observation ${operation}`);
}
