import { test, expect } from "@playwright/test";
import { readFile } from "node:fs/promises";

test.use({
  baseURL: "http://127.0.0.1:4187",
  viewport: { width: 1440, height: 1000 },
});
const savedChart = (page) =>
  page.evaluate(() => JSON.parse(localStorage.getItem("coco.knit.chart.v1")));
const upload = (page, data) =>
  page
    .locator("#fileInput")
    .setInputFiles({
      name: "pattern.json",
      mimeType: "application/json",
      buffer: Buffer.from(JSON.stringify(data)),
    });
const plainChart = () => ({
  version: 1,
  title: "회귀 테스트 도안",
  notes: "",
  cols: 4,
  rows: 4,
  mode: "flat",
  border: 0,
  gaugeSt: 20,
  gaugeRows: 30,
  currentRow: 1,
  completed: false,
  cells: Array.from({ length: 16 }, () => ({
    color: "#f4eee3",
    symbol: "knit",
  })),
});

test.beforeEach(async ({ page }) => {
  await page.goto("/");
  await expect(page.locator("#currentRow")).toHaveValue("1");
});

test("color button Space activation does not advance the knitting row", async ({
  page,
}) => {
  const sage = page.locator('[data-color="#8b9a80"]');
  await sage.focus();
  await page.keyboard.press("Space");
  await expect(sage).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator("#currentRow")).toHaveValue("1");
});

test("row progress is undoable and redoable from keyboard", async ({
  page,
}) => {
  await page.locator("#nextRow").click();
  await expect(page.locator("#currentRow")).toHaveValue("2");
  await page.keyboard.press("ControlOrMeta+z");
  await expect(page.locator("#currentRow")).toHaveValue("1");
  await page.keyboard.press("ControlOrMeta+Shift+z");
  await expect(page.locator("#currentRow")).toHaveValue("2");
});

test("project notes autosave without blur, survive reload, and are in JSON backup", async ({
  page,
}) => {
  const notes = "바늘 4mm\n세이지 실 두 겹 · <나만의 메모>";
  await page.locator("#projectNotes").fill(notes);
  await expect.poll(async () => (await savedChart(page))?.notes).toBe(notes);
  await page.reload();
  await expect(page.locator("#projectNotes")).toHaveValue(notes);
  await page.locator("#exportBtn").click();
  const downloading = page.waitForEvent("download");
  await page.locator("#jsonExport").click();
  const download = await downloading;
  const exported = JSON.parse(await readFile(await download.path(), "utf8"));
  expect(exported.notes).toBe(notes);
  expect(exported.cells).toHaveLength(exported.cols * exported.rows);
});

test("custom yarn color can be selected and painted by keyboard", async ({
  page,
}) => {
  await page.locator("#customColor").fill("#2468ac");
  await page.locator("#chart").focus();
  await page.keyboard.press("Enter");
  await expect
    .poll(async () =>
      (await savedChart(page))?.cells.some((c) => c.color === "#2468ac"),
    )
    .toBe(true);
  await expect(page.locator("#customColor")).toHaveValue("#2468ac");
});

test("even flat rows invert stitches while circular rows retain right-side stitches", async ({
  page,
}) => {
  await upload(page, plainChart());
  await page.locator("#confirmAction").click();
  await page.locator("#currentRow").fill("2");
  await page.locator("#currentRow").press("Tab");
  await expect(page.locator("#rowRuns")).toContainText("안뜨기 4코");
  await expect(page.locator("#direction")).toContainText("왼쪽에서 오른쪽");
  await page.locator('[data-mode="round"]').click();
  await expect(page.locator("#rowRuns")).toContainText("겉뜨기 4코");
  await expect(page.locator("#direction")).toContainText("오른쪽에서 왼쪽");
});

test("invalid import and cancelled valid import preserve the current project", async ({
  page,
}) => {
  await page.locator("#projectNotes").fill("현재 작업 보존");
  await page.locator("#projectNotes").press("Tab");
  await expect
    .poll(async () => (await savedChart(page))?.notes)
    .toBe("현재 작업 보존");
  const before = await savedChart(page);
  await upload(page, { version: 1, cells: [] });
  await expect(page.locator("#toast")).toContainText("파일을 열 수 없어요");
  expect(await savedChart(page)).toEqual(before);
  await upload(page, plainChart());
  await page.locator("#cancelAction").click();
  await expect(page.locator("#projectNotes")).toHaveValue("현재 작업 보존");
  await upload(page, plainChart());
  await page.locator("#confirmAction").click();
  await expect(page.locator("#title")).toHaveValue("회귀 테스트 도안");
  await expect.poll(async () => (await savedChart(page))?.cols).toBe(4);
});

test("shrinking after moving focus safely clamps keyboard flood fill", async ({
  page,
}) => {
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.locator("#chart").focus();
  for (let i = 0; i < 15; i++) await page.keyboard.press("ArrowRight");
  await page.locator("#cols").fill("2");
  await page.locator("#rows").fill("2");
  await page.locator("#resizeBtn").click();
  await page.locator("#confirmAction").click();
  await page.locator("#chart").focus();
  await page.keyboard.press("f");
  await page.keyboard.press("Enter");
  await expect.poll(async () => (await savedChart(page))?.cells.length).toBe(4);
  expect(errors).toEqual([]);
});

for (const width of [320, 390]) {
  test(`mobile ${width}px has no document overflow and Escape closes tools`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 844 });
    await expect(page.locator("#settingsMobile")).toBeVisible();
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    await page.locator("#settingsMobile").click();
    await expect(page.locator("#settingsMobile")).toHaveAttribute(
      "aria-expanded",
      "true",
    );
    await page.keyboard.press("Escape");
    await expect(page.locator("#settingsMobile")).toHaveAttribute(
      "aria-expanded",
      "false",
    );
    await expect(page.locator("#settingsMobile")).toBeFocused();
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
  });
}

test("unreadable stored project is preserved through recovery dismissal and reload", async ({
  page,
}) => {
  const raw = '{"version":1,"title":"recover me",broken';
  await page.addInitScript((value) => {
    if (!sessionStorage.getItem("corruption-seeded")) {
      localStorage.setItem("coco.knit.chart.v1", value);
      sessionStorage.setItem("corruption-seeded", "true");
    }
  }, raw);
  await page.reload();
  await expect(page.locator("#modal")).toBeVisible();
  await expect(page.locator("#modalContent")).toContainText(
    "저장한 도안을 읽지 못했어요",
  );
  await page.locator("#closeModal").click();
  await page.locator("#nextRow").click();
  await expect(page.locator("#saveStatus")).toHaveText(
    "이전 저장 데이터 복구 필요",
  );
  expect(
    await page.evaluate(() => localStorage.getItem("coco.knit.chart.v1")),
  ).toBe(raw);
  await page.reload();
  expect(
    await page.evaluate(() => localStorage.getItem("coco.knit.chart.v1")),
  ).toBe(raw);
  await expect(page.locator("#recoverDownload")).toBeVisible();
});

test("keyboard shortcuts cannot change tools or progress during a drawing gesture", async ({
  page,
}) => {
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await upload(page, plainChart());
  await page.locator("#confirmAction").click();
  const canvas = page.locator("#chart");
  await canvas.focus();
  const box = await canvas.boundingBox();
  await page.mouse.move(box.x + 40, box.y + 40);
  await page.mouse.down();
  await page.keyboard.press("f");
  await page.keyboard.press("Space");
  await page.keyboard.press("ControlOrMeta+z");
  await expect(page.locator('[data-tool="draw"]')).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await expect(page.locator("#currentRow")).toHaveValue("1");
  await page.mouse.move(box.x + 60, box.y + 40);
  await page.mouse.up();
  await expect
    .poll(async () =>
      (await savedChart(page))?.cells.some((c) => c.color === "#c47f79"),
    )
    .toBe(true);
  expect(errors).toEqual([]);
});

test("extreme accepted gauges keep the drawing canvas allocation bounded", async ({
  page,
}) => {
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.locator("#cols").fill("120");
  await page.locator("#rows").fill("160");
  await page.locator("#resizeBtn").click();
  await page.getByText("게이지 & 테두리", { exact: true }).click();
  await page.locator("#gaugeSt").fill("100");
  await page.locator("#gaugeSt").press("Tab");
  await page.locator("#gaugeRows").fill("1");
  await page.locator("#gaugeRows").press("Tab");
  await page.locator("#aspectBtn").click();
  for (let i = 0; i < 5; i++) await page.locator("#zoomIn").click();
  const dimensions = await page
    .locator("#chart")
    .evaluate((canvas) => ({ width: canvas.width, height: canvas.height }));
  expect(dimensions.width).toBeGreaterThan(0);
  expect(dimensions.height).toBeGreaterThan(0);
  expect(dimensions.width).toBeLessThanOrEqual(8192);
  expect(dimensions.height).toBeLessThanOrEqual(8192);
  expect(dimensions.width * dimensions.height).toBeLessThanOrEqual(12500000);
  expect(errors).toEqual([]);
});
