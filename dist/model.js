export const PALETTE = [
  ["#f4eee3", "크림"],
  ["#c47f79", "로즈"],
  ["#8b9a80", "세이지"],
  ["#44494a", "차콜"],
  ["#caa76b", "허니"],
  ["#8eabc2", "블루"],
];
export const SYMBOLS = {
  knit: ["", "겉뜨기", "겉면 K · 안쪽면 P"],
  purl: ["−", "안뜨기", "겉면 P · 안쪽면 K"],
  yo: ["○", "바늘비우기", "YO · 코 늘림"],
  k2tog: ["/", "오른코 줄임", "겉면 K2tog · 안쪽면 P2tog"],
  ssk: ["\\", "왼코 줄임", "겉면 SSK · 안쪽면 SSP"],
  none: ["×", "코 없음", "뜨지 않는 자리 · 코 수 제외"],
};
export const blank = () => ({ color: PALETTE[0][0], symbol: "knit" });
export function makeChart(cols = 37, rows = 28) {
  return {
    version: 1,
    title: "이름 없는 도안",
    notes: "",
    cols,
    rows,
    mode: "flat",
    border: Math.min(3, Math.floor((cols - 1) / 2)),
    gaugeSt: 22,
    gaugeRows: 30,
    currentRow: 1,
    completed: false,
    cells: Array.from({ length: cols * rows }, blank),
  };
}
export function sample(kind = "rabbit") {
  if (kind === "rib" || kind === "stripes") {
    const c = makeChart(32, 32);
    c.border = 0;
    c.title = kind === "rib" ? "차분한 2×2 고무뜨기" : "봄빛 줄무늬";
    c.cells = c.cells.map((cell, i) =>
      kind === "rib"
        ? {
            ...cell,
            symbol: Math.floor((i % c.cols) / 2) % 2 ? "purl" : "knit",
          }
        : {
            ...cell,
            color:
              PALETTE[
                [0, 1, 0, 2][
                  Math.floor((c.rows - 1 - Math.floor(i / c.cols)) / 4) % 4
                ]
              ][0],
          },
    );
    return c;
  }
  let c = makeChart();
  c.title = kind === "rabbit" ? "토끼의 산책" : "마음을 잇는 하트";
  const rabbit = [
    "001001000",
    "001001000",
    "001101000",
    "000110000",
    "000111000",
    "000111100",
    "001111100",
    "011111000",
    "111111000",
    "111111000",
    "011110000",
  ];
  const heart = [
    "0110110",
    "1111111",
    "1111111",
    "0111110",
    "0011100",
    "0001000",
  ];
  const draw = (p, x, y, color) =>
    p.forEach((line, dy) =>
      [...line].forEach((v, dx) => {
        if (v === "1")
          c.cells[(y + dy) * c.cols + x + dx] = { color, symbol: "knit" };
      }),
    );
  if (kind === "rabbit") {
    draw(rabbit, 6, 7, PALETTE[1][0]);
    draw(
      rabbit.map((s) => [...s].reverse().join("")),
      22,
      7,
      PALETTE[1][0],
    );
    draw(heart, 15, 17, PALETTE[2][0]);
  } else
    for (let y = 4; y < 22; y += 8)
      for (let x = 5; x < 30; x += 10) draw(heart, x, y, PALETTE[1][0]);
  for (let y = 0; y < c.rows; y++)
    for (let x = 0; x < 3; x++) {
      c.cells[y * c.cols + x].symbol = y % 2 ? "knit" : "purl";
      c.cells[y * c.cols + c.cols - 1 - x].symbol = y % 2 ? "knit" : "purl";
    }
  return c;
}
export function validate(v) {
  if (
    !v ||
    v.version !== 1 ||
    !Number.isInteger(v.cols) ||
    !Number.isInteger(v.rows) ||
    v.cols < 1 ||
    v.cols > 120 ||
    v.rows < 1 ||
    v.rows > 160 ||
    !Array.isArray(v.cells) ||
    v.cells.length !== v.cols * v.rows
  )
    throw Error("도안은 가로 1–120칸, 세로 1–160단이어야 해요");
  if (
    Array.from(v.cells).some(
      (c) =>
        !c ||
        typeof c.color !== "string" ||
        !/^#[0-9a-f]{6}$/i.test(c.color) ||
        typeof c.symbol !== "string" ||
        !Object.hasOwn(SYMBOLS, c.symbol),
    )
  )
    throw Error("색상 또는 기호 데이터가 올바르지 않아요");
  return {
    ...makeChart(v.cols, v.rows),
    title: typeof v.title === "string" ? v.title.slice(0, 80) : "가져온 도안",
    notes: typeof v.notes === "string" ? v.notes.slice(0, 2000) : "",
    mode: v.mode === "round" ? "round" : "flat",
    border: Math.max(
      0,
      Math.min(
        Math.floor((v.cols - 1) / 2),
        Number.isInteger(v.border) ? v.border : 0,
      ),
    ),
    gaugeSt: finite(v.gaugeSt, 22),
    gaugeRows: finite(v.gaugeRows, 30),
    currentRow: Math.max(
      1,
      Math.min(v.rows, Number.isInteger(v.currentRow) ? v.currentRow : 1),
    ),
    completed: v.completed === true && v.currentRow === v.rows,
    cells: v.cells.map((c) => ({
      color: c.color.toLowerCase(),
      symbol: c.symbol,
    })),
  };
}
function finite(n, d) {
  return Number.isFinite(n) && n >= 1 && n <= 100 ? n : d;
}
export function resize(c, cols, rows) {
  let out = {
    ...c,
    cols,
    rows,
    completed: c.completed === true && cols === c.cols && rows === c.rows,
    currentRow: Math.min(c.currentRow, rows),
    border: Math.min(c.border, Math.floor((cols - 1) / 2)),
    cells: Array.from({ length: cols * rows }, blank),
  };
  for (let y = 0; y < Math.min(rows, c.rows); y++)
    for (let x = 0; x < Math.min(cols, c.cols); x++)
      out.cells[(rows - 1 - y) * cols + x] = {
        ...c.cells[(c.rows - 1 - y) * c.cols + x],
      };
  return out;
}
export function flood(c, start, paint) {
  const old = c.cells[start];
  if (old.color === paint.color && old.symbol === paint.symbol) return;
  let stack = [start],
    seen = new Set();
  while (stack.length) {
    const i = stack.pop();
    if (seen.has(i)) continue;
    seen.add(i);
    let v = c.cells[i];
    if (v.color !== old.color || v.symbol !== old.symbol) continue;
    c.cells[i] = { ...paint };
    let x = i % c.cols;
    if (x) stack.push(i - 1);
    if (x < c.cols - 1) stack.push(i + 1);
    if (i >= c.cols) stack.push(i - c.cols);
    if (i < c.cells.length - c.cols) stack.push(i + c.cols);
  }
}
export function mirrored(cell) {
  return {
    ...cell,
    symbol:
      cell.symbol === "k2tog"
        ? "ssk"
        : cell.symbol === "ssk"
          ? "k2tog"
          : cell.symbol,
  };
}

// A chart symbol describes the resulting stitch, not always one consumed stitch.
export function rowStats(c, row = c.currentRow) {
  const n = Math.max(1, Math.min(c.rows, Number.isInteger(row) ? row : 1));
  const cells = c.cells.slice((c.rows - n) * c.cols, (c.rows - n + 1) * c.cols);
  let consumed = 0,
    produced = 0,
    colors = {};
  for (const cell of cells) {
    if (cell.symbol === "none") continue;
    produced++;
    consumed +=
      cell.symbol === "yo" ? 0 : ["k2tog", "ssk"].includes(cell.symbol) ? 2 : 1;
    colors[cell.color] = (colors[cell.color] || 0) + 1;
  }
  return { row: n, consumed, produced, change: produced - consumed, colors };
}
export function measureChart(c) {
  const stitchCounts = Array.from(
    { length: c.rows },
    (_, i) => rowStats(c, i + 1).produced,
  );
  const minStitches = Math.min(...stitchCounts),
    maxStitches = Math.max(...stitchCounts);
  return {
    minStitches,
    maxStitches,
    minWidthCm: (minStitches * 10) / c.gaugeSt,
    widthCm: (maxStitches * 10) / c.gaugeSt,
    heightCm: (c.rows * 10) / c.gaugeRows,
  };
}
export function rowInstructions(c, row = c.currentRow) {
  const n = Math.max(1, Math.min(c.rows, Number.isInteger(row) ? row : 1));
  const rightToLeft = c.mode === "round" || n % 2 === 1;
  const cells = c.cells.slice((c.rows - n) * c.cols, (c.rows - n + 1) * c.cols);
  if (rightToLeft) cells.reverse();
  const stitches = rightToLeft
    ? { knit: "K", purl: "P", yo: "YO", k2tog: "K2tog", ssk: "SSK" }
    : { knit: "P", purl: "K", yo: "YO", k2tog: "P2tog", ssk: "SSP" };
  const runs = [];
  for (const cell of cells) {
    if (cell.symbol === "none") continue;
    const stitch = stitches[cell.symbol],
      last = runs.at(-1);
    if (last && last.stitch === stitch && last.color === cell.color)
      last.count++;
    else runs.push({ stitch, color: cell.color, count: 1 });
  }
  return runs;
}
