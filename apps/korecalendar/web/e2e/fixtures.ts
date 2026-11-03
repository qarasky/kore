import { test as base } from "@playwright/test";

export { expect } from "@playwright/test";

/**
 * Playwright's `test` with one change: `page.goto` also waits until React has revealed every
 * streamed Suspense segment. Until then the streamed page sits in a hidden `<div id="S:…">`
 * next to the visible one, and strict locators (`getByTestId("time-grid")`) see both.
 */
export const test = base.extend({
  page: async ({ page }, provide) => {
    const goto = page.goto.bind(page);
    page.goto = async (url, options) => {
      const res = await goto(url, options);
      await page.waitForFunction(() => !document.querySelector('body > [hidden][id^="S:"]'), undefined, { timeout: 5000 }).catch(() => {});
      return res;
    };
    await provide(page);
  },
});
