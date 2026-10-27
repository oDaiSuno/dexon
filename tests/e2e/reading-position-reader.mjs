export function createConversationReader({ page, wheel, clickButton, sleep, waitFor, nextFrames, tolerance, loading }) {
  async function earlierMessagesAreLoading() {
    return ((await page("earlierMessages")) ?? "").includes(loading);
  }

  // A positive wheel delta moves the conversation towards earlier messages, the
  // same sign a real trackpad produces on this platform.
  async function wheelUp(screens, pause = 60) {
    const { center } = await page("conversation");
    for (let step = 0; step < screens; step += 1) {
      wheel(500, center);
      await sleep(pause);
    }
    await nextFrames();
  }

  async function scrollBy(deltaY) {
    const { center } = await page("conversation");
    wheel(deltaY, center);
    await sleep(70);
  }

  // A wheel gesture keeps easing after the last event; the position that gets
  // remembered is the one the conversation comes to rest at.
  async function waitUntilStill(watched) {
    let previousTop = null;
    let previousScrollTop = null;
    let stable = 0;
    const deadline = Date.now() + 10000;
    while (Date.now() < deadline) {
      const { scrollTop } = await page("conversation");
      const top = await page("offset", { text: watched.text });
      stable = top !== null && top === previousTop && scrollTop === previousScrollTop ? stable + 1 : 0;
      previousTop = top;
      previousScrollTop = scrollTop;
      if (stable >= 3) return { text: watched.text, top };
      await sleep(100);
    }
    throw new Error(`The conversation never stopped moving at “${watched.text}”`);
  }

  // Real wheel input. The reader stops at the start of a message, because that
  // is the place the conversation itself treats as a position: a single answer
  // here is taller than many windows, so its middle is not a boundary.
  async function settleOnSentence(screens) {
    await wheelUp(screens);
    const startOfMessageBelow = (sentences) =>
      sentences.filter((sentence) => sentence.top >= -8).sort((left, right) => left.top - right.top)[0];
    const nearestStart = (sentences) =>
      sentences.slice().sort((left, right) => Math.abs(left.top) - Math.abs(right.top))[0];
    let watched = null;
    for (let attempt = 0; attempt < 60 && !watched; attempt += 1) {
      watched = startOfMessageBelow(await page("sentences")) ?? null;
      if (watched) break;
      const { distanceFromBottom } = await page("conversation");
      if (distanceFromBottom <= 0) break;
      await scrollBy(-500);
    }
    for (let attempt = 0; attempt < 20 && !watched; attempt += 1) {
      watched = nearestStart(await page("sentences")) ?? null;
      if (!watched) await sleep(100);
    }
    if (!watched) throw new Error("the conversation shows no message to read from");
    for (let attempt = 0; attempt < 90; attempt += 1) {
      const top = (await page("offset", { text: watched.text })) ?? watched.top;
      if (Math.abs(top) <= 8) break;
      await scrollBy(Math.round(Math.max(-520, Math.min(520, -top))));
    }
    return waitUntilStill(watched);
  }

  async function settledOffset(text) {
    const deadline = Date.now() + 20000;
    let previous = null;
    let stable = 0;
    while (Date.now() < deadline) {
      const current = await page("offset", { text });
      stable = current !== null && current === previous ? stable + 1 : 0;
      previous = current;
      if (stable >= 3) return current;
      await sleep(60);
    }
    throw new Error(`The sentence “${text}” never settled after returning (${previous})`);
  }

  async function expectSamePosition(watched, name) {
    let loadingSeen = false;
    const loadingDeadline = Date.now() + 40000;
    while (await earlierMessagesAreLoading()) {
      loadingSeen = true;
      if (Date.now() >= loadingDeadline) throw new Error("the earlier messages finish loading");
      await sleep(50);
    }
    const after = await settledOffset(watched.text);
    const delta = Math.round((after - watched.top) * 100) / 100;
    if (Math.abs(delta) > tolerance) {
      throw new Error(
        `${name}: “${watched.text}” was ${watched.top}px below the top before leaving and is ${after}px after returning`,
      );
    }
    return { watched, after, delta, loadingSeen };
  }

  // An arriving page prepends its messages above the reader, so the content the
  // conversation can scroll through grows. Wait for that growth to settle.
  async function waitForEarlierPage(previousHeight) {
    let previous = null;
    let stable = 0;
    const deadline = Date.now() + 40000;
    while (Date.now() < deadline) {
      const { scrollHeight } = await page("conversation");
      stable = scrollHeight > previousHeight && scrollHeight === previous ? stable + 1 : 0;
      previous = scrollHeight;
      if (stable >= 3) return scrollHeight;
      await sleep(100);
    }
    throw new Error("an earlier page never arrived");
  }

  async function loadEarlierPages(count) {
    let loads = 0;
    let height = (await page("conversation")).scrollHeight;
    const deadline = Date.now() + 120000;
    while (loads < count) {
      if (Date.now() >= deadline) throw new Error("earlier pages keep arriving while the reader scrolls up");
      let loaded = false;
      for (let attempt = 0; attempt < 200 && !loaded; attempt += 1) {
        await wheelUp(5, 20);
        const { scrollTop, scrollHeight } = await page("conversation");
        if (scrollHeight > height) {
          height = await waitForEarlierPage(height);
          loaded = true;
        } else if (scrollTop === 0) {
          if ((await page("point", { role: "button", name: "Load earlier messages" })) === null)
            throw new Error("the top of the loaded messages offers earlier ones");
          await clickButton("Load earlier messages");
          height = await waitForEarlierPage(height);
          loaded = true;
        }
      }
      if (!loaded) throw new Error("scrolling to the top reads an earlier page");
      loads += 1;
    }
    return loads;
  }

  async function scrollToTopOfLoadedMessages() {
    const deadline = Date.now() + 90000;
    let previousHeight = null;
    let stable = 0;
    while (Date.now() < deadline) {
      const { scrollTop, scrollHeight } = await page("conversation");
      stable = scrollTop === 0 && scrollHeight === previousHeight ? stable + 1 : 0;
      previousHeight = scrollHeight;
      if (stable >= 3) return;
      await wheelUp(4, 20);
      await waitFor(async () => !(await earlierMessagesAreLoading()), "the earlier page to finish loading", 40000);
    }
    throw new Error("the reader never reached the start of the loaded messages");
  }

  return {
    earlierMessagesAreLoading,
    settleOnSentence,
    loadEarlierPages,
    scrollToTopOfLoadedMessages,
    expectSamePosition,
  };
}
