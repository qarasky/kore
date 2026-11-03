// Builds nothing: run `npm run build` first. Serves showcase/dist with `vite preview`
// and writes PNGs to ../docs/screenshots.
import { spawn } from "node:child_process";
import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const here = dirname(fileURLToPath(import.meta.url));
const out = resolve(here, "../../docs/screenshots");
mkdirSync(out, { recursive: true });
const PORT = 4317;
const base = `http://localhost:${PORT}/`;

// Run vite's binary directly (not through npx) so killing it stops the server.
const server = spawn(process.execPath, [resolve(here, "../node_modules/vite/bin/vite.js"), "preview", "--port", String(PORT), "--strictPort"], {
  cwd: resolve(here, ".."),
  stdio: ["ignore", "pipe", "inherit"],
});
await new Promise((ok, fail) => {
  server.stdout.on("data", (d) => String(d).includes(String(PORT)) && ok());
  server.on("exit", (code) => fail(new Error(`vite preview exited (${code})`)));
});

const browser = await chromium.launch();
const shot = async (page, name, opts = {}) => {
  await page.waitForTimeout(350);
  await page.screenshot({ path: `${out}/${name}.png`, ...opts });
  console.log("wrote", name);
};

try {
  const desk = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
  let n = 0;
  // A fresh document per page (a hash change alone would keep toasts and state around).
  const go = async (hash) => {
    await desk.goto(`${base}?p=${n++}#/${hash}`);
    await desk.evaluate(() => document.fonts.ready);
    await desk.mouse.move(0, 0);
  };

  await go("components");
  await shot(desk, "components", { fullPage: true });

  await desk.getByTestId("open-dialog").click();
  await shot(desk, "dialog");
  await desk.keyboard.press("Escape");
  await desk.getByTestId("open-confirm").click();
  await shot(desk, "confirm-dialog");
  await desk.keyboard.press("Escape");
  await desk.getByTestId("open-menu").click();
  await desk.getByRole("menuitem", { name: "Share with" }).hover();
  await shot(desk, "menu");
  await desk.keyboard.press("Escape");
  await desk.keyboard.press("Escape");
  await desk.getByRole("combobox", { name: "Role" }).click();
  await shot(desk, "select");
  await desk.keyboard.press("Escape");
  await desk.getByTestId("open-popover").click();
  await shot(desk, "popover");
  await desk.keyboard.press("Escape");
  await desk.getByTestId("toast-action").click();
  await desk.getByTestId("tooltip-trigger").hover();
  await desk.getByRole("tooltip").first().waitFor();
  await shot(desk, "toast-tooltip");

  await go("app");
  await shot(desk, "app-shell");
  await desk.getByRole("button", { name: "Apps" }).click();
  await shot(desk, "app-switcher");
  await desk.keyboard.press("Escape");
  await desk.getByRole("button", { name: /^Account:/ }).click();
  await shot(desk, "account-menu");
  await desk.keyboard.press("Escape");
  await desk.getByRole("row", { name: /Q3 budget/ }).click({ button: "right" });
  await shot(desk, "context-menu");
  await desk.keyboard.press("Escape");

  await go("users");
  await shot(desk, "table");
  await desk.getByRole("button", { name: "Add user" }).click();
  await shot(desk, "add-user-dialog");
  await desk.keyboard.press("Escape");

  await go("settings");
  await shot(desk, "settings");
  await desk.getByRole("button", { name: "Security" }).click();
  await shot(desk, "settings-security");

  await go("auth");
  await shot(desk, "auth");
  await go("auth/error");
  await shot(desk, "auth-error");
  await go("auth/kore-id");
  await shot(desk, "auth-kore-id");
  await go("auth/no-access");
  await shot(desk, "auth-no-access");

  const phone = await browser.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
  await phone.goto(`${base}#/app`);
  await phone.evaluate(() => document.fonts.ready);
  await shot(phone, "mobile-app-shell");
  await phone.getByRole("button", { name: "Open navigation" }).click();
  await shot(phone, "mobile-drawer");
  await phone.goto(`${base}?p=s#/settings`);
  await shot(phone, "mobile-settings");
  await phone.goto(`${base}?p=a#/auth`);
  await shot(phone, "mobile-auth");
} finally {
  await browser.close();
  server.kill();
}
