import { test, expect } from "@playwright/test";
import { readFile } from "node:fs/promises";

const pixels = (page) =>
  page.locator("#preview3d").evaluate((canvas) => {
    const gl = canvas.getContext("webgl");
    const data = new Uint8Array(canvas.width * canvas.height * 4);
    gl.readPixels(
      0,
      0,
      canvas.width,
      canvas.height,
      gl.RGBA,
      gl.UNSIGNED_BYTE,
      data,
    );
    let visible = 0,
      checksum = 0;
    for (let i = 0; i < data.length; i += 4)
      if (data[i + 3]) {
        visible++;
        checksum =
          (checksum + data[i] * 3 + data[i + 1] * 5 + data[i + 2] * 7) %
          1000000007;
      }
    return { visible, checksum, width: canvas.width, height: canvas.height };
  });

test("real WebGL renders distinct forms, yarn, views and a downloadable PNG", async ({
  page,
}) => {
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("/");
  await page.locator("#previewTab").click();
  await expect(page.locator("#previewInfo")).toContainText("37칸");
  await expect
    .poll(async () => (await pixels(page)).visible)
    .toBeGreaterThan(1000);
  const swatch = await pixels(page);
  await page.locator("[data-shape=tube]").click();
  await expect
    .poll(async () => (await pixels(page)).checksum)
    .not.toBe(swatch.checksum);
  const tube = await pixels(page);
  await page.locator("[data-shape=beanie]").click();
  await expect
    .poll(async () => (await pixels(page)).checksum)
    .not.toBe(tube.checksum);
  const beanie = await pixels(page);
  await page.locator("summary").filter({ hasText: "질감과 조명" }).click();
  await page.locator("#yarnWeight").selectOption("chunky");
  await expect
    .poll(async () => (await pixels(page)).checksum)
    .not.toBe(beanie.checksum);
  const thick = await pixels(page);
  await page.locator("#previewLight").selectOption("studio");
  await expect
    .poll(async () => (await pixels(page)).checksum)
    .not.toBe(thick.checksum);
  const lit = await pixels(page);
  await page.locator("[data-view=back]").click();
  await expect
    .poll(async () => (await pixels(page)).checksum)
    .not.toBe(lit.checksum);
  const downloadEvent = page.waitForEvent("download");
  await page.locator("#previewDownload").click();
  const downloaded = await downloadEvent;
  const bytes = await readFile(await downloaded.path());
  expect([...bytes.subarray(0, 8)]).toEqual([137, 80, 78, 71, 13, 10, 26, 10]);
  expect(bytes.length).toBeGreaterThan(10000);
  expect(errors).toEqual([]);
});

test("completed-only preview is empty at start, grows, and restores the full fabric", async ({
  page,
}) => {
  await page.goto("/");
  await page.locator("#previewTab").click();
  await page.locator("summary").filter({ hasText: "질감과 조명" }).click();
  await page.locator("#previewProgress").check();
  await expect.poll(async () => (await pixels(page)).visible).toBe(0);
  await page.locator("#nextRow").click();
  await expect
    .poll(async () => (await pixels(page)).visible)
    .toBeGreaterThan(0);
  const one = await pixels(page);
  await page.locator("#previewProgress").uncheck();
  await expect
    .poll(async () => (await pixels(page)).visible)
    .toBeGreaterThan(one.visible * 3);
});

test("WebGL unavailable keeps chart editing and follow mode usable", async ({
  page,
}) => {
  await page.addInitScript(() => {
    const getContext = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = function (type, ...args) {
      return type === "webgl" || type === "experimental-webgl"
        ? null
        : getContext.call(this, type, ...args);
    };
  });
  await page.goto("/");
  await page.locator("#previewTab").click();
  await expect(page.locator("#previewNote")).toContainText("WebGL");
  await expect(page.locator("#previewDownload")).toBeDisabled();
  await page.locator("#followTab").click();
  await page.locator("#followNext").click();
  await expect(page.locator("#followTitle")).toContainText("2단");
  await page.locator("#chartTab").click();
  await expect(page.locator("#chart")).toBeVisible();
});

for (const width of [320, 390])
  test(`3D expanded controls fit mobile ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 844 });
    await page.goto("/");
    await page.locator("#previewTab").click();
    await page.locator("summary").filter({ hasText: "질감과 조명" }).click();
    await page.locator("[data-shape=beanie]").click();
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    const box = await page.locator("#preview3d").boundingBox();
    expect(box.height).toBeGreaterThan(150);
    await expect
      .poll(async () => (await pixels(page)).visible)
      .toBeGreaterThan(100);
  });
