import { readFile } from "node:fs/promises";
import { expect, test, type Page } from "@playwright/test";
import en from "../lib/i18n/en";
import { apiAs, createUser, loginAs, uploadFile } from "./helpers";

const fill = (key: keyof typeof en, vars: Record<string, string | number>) =>
  en[key].replace(/\{(\w+)\}/g, (m, k: string) => (k in vars ? String(vars[k]) : m));

const list = (page: Page) => page.getByRole("listbox", { name: en["list.label"] });
const row = (page: Page, name: string) => list(page).getByRole("option", { name, exact: true });
const pane = (page: Page) => page.getByRole("dialog");

/** A real image of the given type, drawn by the browser (so it decodes). */
async function drawImage(page: Page, type: "image/png" | "image/jpeg", w: number, h: number): Promise<Buffer> {
  const url = await page.evaluate(
    ([type, w, h]) => {
      const c = document.createElement("canvas");
      c.width = w;
      c.height = h;
      const g = c.getContext("2d")!;
      g.fillStyle = "#5b8def";
      g.fillRect(0, 0, w, h);
      g.fillStyle = "#16181d";
      g.fillRect(w / 4, h / 4, w / 2, h / 2);
      return c.toDataURL(type);
    },
    [type, w, h] as const,
  );
  return Buffer.from(url.split(",")[1], "base64");
}

// Full Chromium (new headless) has the built-in PDF viewer; the default
// headless shell has none and would download the PDF instead.
test.use({ channel: "chromium" });

const tinyPdf = () => readFile(new URL("./fixtures/tiny.pdf", import.meta.url));

async function setup(page: Page) {
  const user = await createUser();
  const api = await apiAs(user.email, user.password);
  await page.goto("about:blank");
  const png = await drawImage(page, "image/png", 64, 48);
  const jpg = await drawImage(page, "image/jpeg", 80, 60);
  await loginAs(page, user.email, user.password);
  return { user, api, png, jpg };
}

test("images and PDFs open in the preview; arrows step through every previewable file", async ({ page }) => {
  const { api, png, jpg } = await setup(page);
  await uploadFile(api, "a.txt", "first");
  const b = await uploadFile(api, "b.png", png);
  const c = await uploadFile(api, "c.jpg", jpg);
  const d = await uploadFile(api, "d.pdf", await tinyPdf());
  await uploadFile(api, "e.zip", "PK not really");
  await api.dispose();
  // CSP violations: console errors from any frame, and the page's
  // securitypolicyviolation events.
  const violations: string[] = [];
  page.on("console", (m) => {
    if (m.type() === "error" && /Content Security Policy/i.test(m.text())) violations.push(m.text());
  });
  await page.exposeFunction("__cspViolation", (v: string) => violations.push(v));
  await page.addInitScript(() =>
    document.addEventListener("securitypolicyviolation", (e) =>
      (window as unknown as { __cspViolation: (v: string) => void }).__cspViolation(`${e.violatedDirective} ${e.blockedURI}`),
    ),
  );
  let autoDownloads = 0;
  page.on("download", () => autoDownloads++);
  await page.goto("/files");

  // Double-click an image: an <img> from /view, decoded, alt = file name.
  await row(page, "b.png").dblclick();
  const p = pane(page);
  await expect(p.getByRole("heading", { name: "b.png" })).toBeVisible();
  await expect(p).toContainText(fill("preview.position", { index: 2, count: 4 }));
  const img = p.getByRole("img", { name: "b.png" });
  await expect(img).toHaveAttribute("src", `/api/nodes/${b}/view`);
  await expect.poll(() => img.evaluate((el: HTMLImageElement) => el.naturalWidth)).toBe(64);

  // Fit to the window by default; a click (or Z) toggles actual size.
  const view = p.getByTestId("image-view");
  await expect(view).toHaveAttribute("data-zoom", "fit");
  await img.click();
  await expect(view).toHaveAttribute("data-zoom", "actual");
  await page.keyboard.press("z");
  await expect(view).toHaveAttribute("data-zoom", "fit");

  // → the JPEG, → the PDF (e.zip is skipped), ← back.
  await page.keyboard.press("ArrowRight");
  const jpeg = p.getByRole("img", { name: "c.jpg" });
  await expect(jpeg).toHaveAttribute("src", `/api/nodes/${c}/view`);
  await expect.poll(() => jpeg.evaluate((el: HTMLImageElement) => el.naturalWidth)).toBe(80);
  await page.keyboard.press("ArrowRight");
  await expect(p.getByRole("heading", { name: "d.pdf" })).toBeVisible();
  await expect(p).toContainText(fill("preview.position", { index: 4, count: 4 }));
  const frame = p.locator("iframe");
  await expect(frame).toHaveAttribute("src", `/api/nodes/${d}/view`);
  await expect(frame).toHaveAttribute("title", fill("preview.pdfFrame", { name: "d.pdf" }));
  // The built-in viewer loaded inside the frame (its extension frame exists).
  // Whether pages are painted is not asserted here.
  await expect
    .poll(() => page.frames().some((f) => f.url().startsWith("chrome-extension://") && f.url().endsWith("/index.html")))
    .toBe(true);
  const fallback = p.getByTestId("pdf-fallback");
  await expect(fallback).toContainText(en["preview.pdfFallback"]);
  // Framed, the PDF renders inline (the attachment rule is for top-level only).
  expect(autoDownloads).toBe(0);
  const [download] = await Promise.all([
    page.waitForEvent("download"),
    fallback.getByRole("button", { name: en["preview.pdfFallbackDownload"] }).click(),
  ]);
  expect(download.suggestedFilename()).toBe("d.pdf");
  await p.getByRole("button", { name: en["preview.prev"] }).click();
  await p.getByRole("button", { name: en["preview.prev"] }).click();
  await page.keyboard.press("ArrowLeft");
  await expect(p.getByTestId("text-view")).toContainText("first");
  await page.keyboard.press("Escape");
  await expect(p).toBeHidden();
  await expect(row(page, "a.txt")).toBeFocused();

  // Space quick-looks an image; Enter opens a PDF.
  await row(page, "c.jpg").click();
  await page.keyboard.press("Space");
  await expect(p.getByRole("img", { name: "c.jpg" })).toBeVisible();
  await page.keyboard.press("Escape");
  await row(page, "d.pdf").click();
  await page.keyboard.press("Enter");
  await expect(p.locator("iframe")).toBeVisible();
  await p.getByRole("button", { name: en["preview.close"] }).click();
  await expect(p).toBeHidden();
  expect(violations).toEqual([]);
});

test("the view endpoint sends the safety headers (through the web origin)", async ({ page }) => {
  const { api, png } = await setup(page);
  const id = await uploadFile(api, "h.png", png);
  const pdf = await uploadFile(api, "h.pdf", await tinyPdf());
  await api.dispose();
  const res = await page.request.get(`/api/nodes/${id}/view`);
  expect(res.status()).toBe(200);
  const h = res.headers();
  expect(h["content-type"]).toBe("image/png");
  expect(h["x-content-type-options"]).toBe("nosniff");
  expect(h["cache-control"]).toBe("private, no-store");
  expect(h["content-security-policy"]).toBe("default-src 'none'; sandbox");
  expect(h["content-disposition"]).toMatch(/^inline; filename="h.png"; filename\*=UTF-8''h.png$/);
  expect(h["x-frame-options"]).toBeUndefined();
  const range = await page.request.get(`/api/nodes/${id}/view`, { headers: { Range: "bytes=0-3" } });
  expect(range.status()).toBe(206);
  expect([...(await range.body())]).toEqual([0x89, 0x50, 0x4e, 0x47]);
  const p = await page.request.get(`/api/nodes/${pdf}/view`);
  expect(p.headers()["content-type"]).toBe("application/pdf");
  expect(p.headers()["content-security-policy"]).toBe("default-src 'none'; object-src 'self'; frame-ancestors 'self'");
});

test("SVG and files that only pretend to be images download instead", async ({ page }) => {
  const { api } = await setup(page);
  await uploadFile(api, "logo.svg", '<svg xmlns="http://www.w3.org/2000/svg"><script>window.__svg=1</script></svg>');
  await uploadFile(api, "fake.png", "<html><script>window.__fake=1</script></html>");
  await uploadFile(api, "fake.pdf", "<html><script>window.__fake=2</script></html>");
  await api.dispose();
  const views: string[] = [];
  page.on("request", (r) => {
    if (r.url().includes("/view")) views.push(r.url());
  });
  await page.goto("/files");

  // SVG is never previewed: it downloads without asking /view.
  const [svg] = await Promise.all([page.waitForEvent("download"), row(page, "logo.svg").dblclick()]);
  expect(svg.suggestedFilename()).toBe("logo.svg");
  await expect(pane(page)).toHaveCount(0);
  expect(views).toEqual([]);

  // A .png the server refuses (415) falls back to a download with a note.
  for (const name of ["fake.png", "fake.pdf"]) {
    const [dl] = await Promise.all([page.waitForEvent("download"), row(page, name).dblclick()]);
    expect(dl.suggestedFilename()).toBe(name);
    await expect(page.getByRole("status").filter({ hasText: name })).toContainText(fill("preview.notText", { name }));
    await expect(pane(page)).toHaveCount(0);
  }
  expect(await page.evaluate(() => (window as unknown as { __svg?: number; __fake?: number }).__svg ?? null)).toBeNull();
  expect(await page.evaluate(() => (window as unknown as { __fake?: number }).__fake ?? null)).toBeNull();
});

test("without a PDF viewer the pane offers the download instead of a frame", async ({ page }) => {
  const { api } = await setup(page);
  await uploadFile(api, "nv.pdf", await tinyPdf());
  await api.dispose();
  await page.addInitScript(() => Object.defineProperty(Navigator.prototype, "pdfViewerEnabled", { get: () => false }));
  let downloads = 0;
  page.on("download", () => downloads++);
  await page.goto("/files");
  await row(page, "nv.pdf").dblclick();
  const p = pane(page);
  await expect(p.getByText(en["preview.pdfNoViewer"])).toBeVisible();
  await expect(p.locator("iframe")).toHaveCount(0);
  await page.waitForTimeout(300);
  expect(downloads).toBe(0);
  const [dl] = await Promise.all([
    page.waitForEvent("download"),
    p.getByTestId("pdf-fallback").getByRole("button", { name: en["preview.pdfFallbackDownload"] }).click(),
  ]);
  expect(dl.suggestedFilename()).toBe("nv.pdf");
});

test("stepping onto an image the server refuses shows a panel in the pane instead of closing it", async ({ page }) => {
  const { api, png } = await setup(page);
  await uploadFile(api, "a-real.png", png);
  await uploadFile(api, "b-fake.png", "<html>not a png</html>");
  await uploadFile(api, "c-real.png", png);
  await api.dispose();
  let downloads = 0;
  page.on("download", () => downloads++);
  await page.goto("/files");
  await row(page, "a-real.png").dblclick();
  const p = pane(page);
  await expect(p.getByRole("img", { name: "a-real.png" })).toBeVisible();
  await page.keyboard.press("ArrowRight");
  await expect(p.getByRole("heading", { name: "b-fake.png" })).toBeVisible();
  const panel = p.getByRole("alert");
  await expect(panel).toContainText(fill("preview.cannotPreview", { name: "b-fake.png" }));
  expect(downloads).toBe(0);
  // Arrows keep working from the panel, and its Download button downloads.
  await page.keyboard.press("ArrowRight");
  await expect(p.getByRole("img", { name: "c-real.png" })).toBeVisible();
  await page.keyboard.press("ArrowLeft");
  const [dl] = await Promise.all([page.waitForEvent("download"), panel.getByRole("button", { name: en["preview.download"] }).click()]);
  expect(dl.suggestedFilename()).toBe("b-fake.png");
  await expect(p).toBeVisible();
});
