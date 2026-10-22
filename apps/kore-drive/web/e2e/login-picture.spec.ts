import { crc32, deflateSync } from "node:zlib";
import { expect, test, type Browser, type Page } from "@playwright/test";
import en from "../lib/i18n/en";
import { ADMIN, loginAs } from "./helpers";

/** A real w×h RGB PNG (solid colour), so the browser can decode it. */
function png(w: number, h: number, rgb: [number, number, number]): Buffer {
  const chunk = (type: string, data: Buffer) => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const td = Buffer.concat([Buffer.from(type, "ascii"), data]);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(td));
    return Buffer.concat([len, td, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // RGB
  const row = Buffer.concat([Buffer.from([0]), Buffer.from(Array.from({ length: w }, () => rgb).flat())]);
  const raw = Buffer.concat(Array.from({ length: h }, () => row));
  return Buffer.concat([
    Buffer.from("89504e470d0a1a0a", "hex"),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(raw)),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

const toast = (page: Page) => page.getByRole("status");

/** The login page as a logged-out visitor sees it. */
async function anonLogin(browser: Browser, width: number) {
  const ctx = await browser.newContext({ viewport: { width, height: 800 } });
  const page = await ctx.newPage();
  await page.goto("/login");
  return { page, close: () => ctx.close() };
}

test("login page: form plus picture on wide screens, just the form on narrow ones", async ({ browser }) => {
  const wide = await anonLogin(browser, 1280);
  await expect(wide.page.getByLabel(en["login.email"])).toBeVisible();
  const panel = wide.page.getByTestId("login-picture");
  await expect(panel).toBeVisible();
  const box = (await panel.boundingBox())!;
  expect(box.x).toBeGreaterThanOrEqual(600);
  expect(box.height).toBeGreaterThanOrEqual(790);
  await expect(panel.getByTestId("login-art")).toBeVisible();
  await wide.close();

  const narrow = await anonLogin(browser, 700);
  await expect(narrow.page.getByLabel(en["login.email"])).toBeVisible();
  await expect(narrow.page.getByTestId("login-picture")).toBeHidden();
  await narrow.close();
});

test("admin uploads a login picture, rejects a non-image, and resets it", async ({ page, browser }) => {
  await loginAs(page, ADMIN.email, ADMIN.password);
  await page.goto("/admin/settings");
  const card = page.getByTestId("login-image-card");
  await expect(card.getByText(en["branding.public"])).toBeVisible();
  await expect(card.getByTestId("login-image-kind")).toHaveText(en["branding.default"]);
  const input = card.getByTestId("login-image-input");

  // A non-image named .png gets past the browser's type check; the server's
  // magic-byte check refuses it.
  await input.setInputFiles({
    name: "evil.png",
    mimeType: "image/png",
    buffer: Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>'),
  });
  await expect(toast(page)).toContainText(en["branding.error.type"]);
  await expect(card.getByTestId("login-image-kind")).toHaveText(en["branding.default"]);

  // Upload a real PNG.
  await input.setInputFiles({ name: "office.png", mimeType: "image/png", buffer: png(32, 18, [40, 90, 200]) });
  await expect(toast(page)).toContainText(en["branding.uploaded"]);
  await expect(card.getByTestId("login-image-kind")).toHaveText(en["branding.custom"]);
  await expect(card.getByTestId("login-image-preview")).toHaveJSProperty("naturalWidth", 32);

  // A logged-out visitor's login page serves it.
  const anon = await anonLogin(browser, 1280);
  const img = anon.page.getByTestId("login-picture-custom");
  await expect(img).toHaveAttribute("src", /^\/api\/branding\/login-image\?v=\d+$/);
  await expect(img).toHaveAttribute("alt", "");
  await expect.poll(() => img.evaluate((el: HTMLImageElement) => el.complete && el.naturalWidth)).toBe(32);
  await anon.close();

  // Reset to the built-in artwork.
  await card.getByRole("button", { name: en["branding.reset"] }).click();
  await expect(toast(page)).toContainText(en["branding.resetDone"]);
  await expect(card.getByTestId("login-image-kind")).toHaveText(en["branding.default"]);
  const after = await anonLogin(browser, 1280);
  await expect(after.page.getByTestId("login-art")).toBeVisible();
  await expect(after.page.getByTestId("login-picture-custom")).toHaveCount(0);
  await after.close();
});
