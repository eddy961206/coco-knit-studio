import assert from "node:assert/strict";
import {
  sample,
  makeChart,
  validate,
  resize,
  flood,
  mirrored,
  rowStats,
  measureChart,
  rowInstructions,
} from "../dist/model.js";
import { chartSVG } from "../dist/export.js";
for (let kind of ["rabbit", "heart"]) {
  let c = sample(kind);
  assert.equal(c.cells.length, 1036);
  assert.equal(validate(JSON.parse(JSON.stringify(c))).title, c.title);
  assert.equal(c.border, 3);
}
for (let [cols, rows] of [
  [1, 1],
  [120, 160],
  [37, 28],
]) {
  let c = makeChart(cols, rows);
  c.cells[0] = { color: "#123456", symbol: "purl" };
  assert.equal(validate(c).cells[0].color, "#123456");
  assert.ok(chartSVG(c).endsWith("</svg>"));
}
for (let v of [
  null,
  {},
  { ...makeChart(), cols: 121 },
  { ...makeChart(), rows: 0 },
  { ...makeChart(), cells: [] },
  {
    ...makeChart(),
    cells: Array.from({ length: 1036 }, () => ({
      color: "red",
      symbol: "knit",
    })),
  },
])
  assert.throws(() => validate(v));
let c = makeChart(4, 3);
c.cells[8] = { color: "#123456", symbol: "yo" };
let r = resize(c, 2, 2);
assert.equal(r.cells[2].symbol, "yo");
assert.equal(r.cells.length, 4);
r = resize(c, 6, 5);
assert.equal(r.cells[24].symbol, "yo");
assert.equal(r.cells[0].symbol, "knit");
c = makeChart(120, 160);
flood(c, 0, { color: "#123456", symbol: "purl" });
assert.equal(c.cells.filter((c) => c.color === "#123456").length, 19200);
assert.equal(mirrored({ color: "#ffffff", symbol: "ssk" }).symbol, "k2tog");
assert.equal(mirrored({ color: "#ffffff", symbol: "k2tog" }).symbol, "ssk");
c = makeChart(3, 3);
c.cells[4] = { color: "#123456", symbol: "knit" };
flood(c, 0, { color: "#aaaaaa", symbol: "yo" });
assert.equal(c.cells[4].color, "#123456");
assert.equal(c.cells.filter((c) => c.symbol === "yo").length, 8);
let s = chartSVG({ ...c, title: '<script> & "x"' });
assert.ok(!s.includes("<script>"));
assert.ok(s.includes("&lt;script&gt;"));
assert.ok(s.includes("안쪽면"));
console.log(
  "PASS: sample validation, boundary sizes, invalid imports, resize origin, max-size flood, isolated flood, mirrored slants, SVG escaping and legend",
);

// Counting input stitches matters for increases, decreases, and shaped charts.
c = makeChart(5, 2);
c.gaugeSt = 20;
c.gaugeRows = 25;
c.cells.splice(
  5,
  5,
  ...["knit", "yo", "k2tog", "ssk", "none"].map((symbol) => ({
    color: "#123456",
    symbol,
  })),
);
assert.deepEqual(rowStats(c, 1), {
  row: 1,
  consumed: 5,
  produced: 4,
  change: -1,
  colors: { "#123456": 4 },
});
assert.deepEqual(measureChart(c), {
  minStitches: 4,
  maxStitches: 5,
  minWidthCm: 2,
  widthCm: 2.5,
  heightCm: 0.8,
});
assert.deepEqual(
  rowInstructions(c, 1).map((v) => v.stitch),
  ["SSK", "K2tog", "YO", "K"],
);
c.cells.splice(
  0,
  5,
  ...["knit", "purl", "k2tog", "ssk", "none"].map((symbol) => ({
    color: "#123456",
    symbol,
  })),
);
assert.deepEqual(
  rowInstructions(c, 2).map((v) => v.stitch),
  ["P", "K", "P2tog", "SSP"],
);
c.mode = "round";
assert.deepEqual(
  rowInstructions(c, 2).map((v) => v.stitch),
  ["SSK", "K2tog", "P", "K"],
);
s = chartSVG(c);
assert.ok(s.includes("10cm 게이지 20코 × 25단"));
assert.ok(s.includes("가로는 둘레"));
assert.ok(!s.includes("안쪽면"));
assert.ok(
  s.includes('fill="#25382f">×</text>'),
  "No-stitch text contrasts with the rendered gray background",
);
c = makeChart(1, 1);
c.cells[0] = {
  color: "#ABCDEF",
  symbol: "knit",
  unexpected: { payload: true },
};
let clean = validate(c);
assert.deepEqual(clean.cells[0], { color: "#abcdef", symbol: "knit" });
assert.notEqual(clean.cells[0], c.cells[0]);
assert.throws(() => validate({ ...c, cells: new Array(1) }));
c.completed = true;
assert.equal(resize(c, 1, 1).completed, true);
assert.equal(resize(c, 2, 1).completed, false);
c = makeChart(4, 1);
assert.deepEqual(rowInstructions(c), [
  { stitch: "K", color: c.cells[0].color, count: 4 },
]);
console.log(
  "PASS: stitch accounting, gauge dimensions, directional row instructions, round export, import sanitization, unchanged resize progress",
);

for (const kind of ["rib", "stripes"]) {
  const starter = sample(kind);
  assert.equal(starter.cols, 32);
  assert.equal(starter.rows, 32);
  assert.equal(starter.border, 0);
  assert.deepEqual(validate(JSON.parse(JSON.stringify(starter))), starter);
}
const rib = sample("rib");
for (let y = 0; y < rib.rows; y++)
  assert.deepEqual(
    rib.cells.slice(y * 32, y * 32 + 4).map((cell) => cell.symbol),
    ["knit", "knit", "purl", "purl"],
  );
assert.equal(new Set(rib.cells.map((cell) => cell.color)).size, 1);
assert.deepEqual(
  rowInstructions(rib, 1).map((run) => run.count),
  Array(16).fill(2),
);
assert.deepEqual(
  rowInstructions(rib, 2).map((run) => run.count),
  Array(16).fill(2),
);
const stripes = sample("stripes");
for (let row = 1; row <= 32; row++)
  assert.equal(Object.keys(rowStats(stripes, row).colors).length, 1);
assert.equal(new Set(stripes.cells.map((cell) => cell.color)).size, 3);
assert.equal(new Set(stripes.cells.map((cell) => cell.symbol)).size, 1);
assert.equal(makeChart().notes, "");
assert.equal(validate({ ...makeChart(), notes: 123 }).notes, "");
assert.equal(
  validate({ ...makeChart(), notes: "a".repeat(2100) }).notes.length,
  2000,
);
const noted = { ...makeChart(), notes: "바늘 4mm\n실 두 겹 · <메모>" };
assert.equal(validate(JSON.parse(JSON.stringify(noted))).notes, noted.notes);
const legacy = makeChart();
delete legacy.notes;
assert.equal(validate(legacy).notes, "");
console.log(
  "PASS: rib and stripe starters, legacy notes migration, bounded notes backup",
);
