import {
  PALETTE,
  SYMBOLS,
  blank,
  makeChart,
  sample,
  validate,
  resize,
  flood,
  mirrored,
  rowStats,
  rowInstructions,
  measureChart,
} from "./model.js";
import { chartSVG, dark, download, esc } from "./export.js";
import { createPreview3D } from "./preview3d.js";
const $ = (id) => document.getElementById(id),
  KEY = "coco.knit.chart.v1";
let chart = sample(),
  restored = false,
  recoveryNeeded = false;
try {
  let saved = localStorage.getItem(KEY);
  if (saved) {
    chart = validate(JSON.parse(saved));
    restored = true;
  }
} catch {
  recoveryNeeded = true;
}
let tool = "draw",
  color = PALETTE[1][0],
  symbol = "knit",
  zoom = 1,
  base = 20,
  aspect = false,
  selection = null,
  clipboard = null,
  undo = [],
  redo = [],
  drawing = null,
  focus = { x: 0, y: chart.rows - 1 },
  activeView = "chart",
  preview = null,
  toastTimer,
  saveTimer;
let paletteKey = "",
  followKey = "",
  followStep = 0,
  notesBefore = null;
const extraColors = new Set();
const previewOptions = {
  shape: "swatch",
  yarn: "medium",
  drape: 0.35,
  lighting: "soft",
  showProgress: false,
  autoRotate: false,
};
const canvas = $("chart"),
  ctx = canvas.getContext("2d");
let cw = 20,
  ch = 20,
  pad = 28;
function toast(t) {
  $("toast").textContent = t;
  $("toast").hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => ($("toast").hidden = true), 3500);
}
function save() {
  if (recoveryNeeded) {
    $("saveStatus").textContent = "이전 저장 데이터 복구 필요";
    return;
  }
  clearTimeout(saveTimer);
  $("saveStatus").textContent = "저장 중…";
  saveTimer = setTimeout(() => {
    try {
      localStorage.setItem(KEY, JSON.stringify(chart));
      $("saveStatus").textContent = "이 브라우저에 저장됨";
    } catch {
      $("saveStatus").textContent = "저장 불가 · JSON 백업 필요";
      toast("브라우저 저장 공간을 사용할 수 없어요. JSON으로 백업해 주세요.");
    }
  }, 250);
}
function snapshot() {
  return JSON.stringify(chart);
}
function push(before = snapshot()) {
  undo.push(before);
  if (undo.length > 70) undo.shift();
  redo = [];
}
function change(fn) {
  let before = snapshot();
  fn();
  if (snapshot() !== before) {
    push(before);
    refresh();
    save();
  }
}
function undoAction() {
  if (!undo.length) return;
  redo.push(snapshot());
  chart = validate(JSON.parse(undo.pop()));
  selection = null;
  refresh();
  save();
}
function redoAction() {
  if (!redo.length) return;
  undo.push(snapshot());
  chart = validate(JSON.parse(redo.pop()));
  selection = null;
  refresh();
  save();
}
function refresh() {
  focus.x = Math.max(0, Math.min(chart.cols - 1, focus.x));
  focus.y = Math.max(0, Math.min(chart.rows - 1, focus.y));
  if (document.activeElement !== $("projectNotes"))
    $("projectNotes").value = chart.notes || "";
  const size = measureChart(chart);
  const width =
    size.minWidthCm === size.widthCm
      ? size.widthCm.toFixed(1)
      : `${size.minWidthCm.toFixed(1)}–${size.widthCm.toFixed(1)}`;
  $("measureInfo").textContent =
    `예상 ${chart.mode === "round" ? "둘레" : "너비"} ${width} × 높이 ${size.heightCm.toFixed(1)} cm`;
  for (let id of [
    "title",
    "cols",
    "rows",
    "currentRow",
    "gaugeSt",
    "gaugeRows",
    "border",
  ])
    $(id).value = chart[id];
  $("currentRow").max = chart.rows;
  $("border").max = Math.floor((chart.cols - 1) / 2);
  $("sizeInfo").textContent =
    `총 ${chart.cols}칸 · 양쪽 ${chart.border}칸 · 무늬 ${chart.cols - chart.border * 2}칸`;
  $("chartMeta").textContent =
    `${chart.cols} × ${chart.rows} · ${chart.mode === "flat" ? "평면" : "원형"}`;
  $("rowTotal").textContent = `/ ${chart.rows}`;
  const right = chart.mode === "round" || chart.currentRow % 2;
  $("direction").textContent =
    chart.mode === "round"
      ? "겉면 · 오른쪽에서 왼쪽으로 ←"
      : right
        ? "겉면 · 오른쪽에서 왼쪽으로 ←"
        : "안쪽면 · 왼쪽에서 오른쪽으로 →";
  $("rowAdvice").textContent = right
    ? "도안은 아래에서 위로 읽어요. 지금은 오른쪽부터 한 코씩 따라가세요."
    : "평면뜨기의 짝수단이에요. 도안을 왼쪽부터 읽고, 겉·안뜨기 기호를 반대로 떠요.";
  $("progress").style.width =
    `${((chart.completed ? chart.rows : chart.currentRow - 1) / chart.rows) * 100}%`;
  $("progressText").textContent = chart.completed
    ? "모든 단을 완성했어요!"
    : `${chart.currentRow - 1}단 완료 · ${chart.rows - chart.currentRow + 1}단 남음`;
  $("prevRow").disabled = chart.currentRow === 1 && !chart.completed;
  $("nextRow").innerHTML = chart.completed
    ? "완성했어요 <span>✓</span>"
    : chart.currentRow === chart.rows
      ? "마지막 단 완료 <span>✓</span>"
      : "다음 단으로 <span>→</span>";
  $("nextRow").disabled = !!chart.completed;
  $("undo").disabled = !undo.length;
  $("redo").disabled = !redo.length;
  document.querySelectorAll("[data-mode]").forEach((b) => {
    b.classList.toggle("active", b.dataset.mode === chart.mode);
    b.setAttribute("aria-pressed", b.dataset.mode === chart.mode);
  });
  const stats = rowStats(chart);
  $("rowColors").innerHTML =
    Object.entries(stats.colors)
      .map(
        ([c, n]) =>
          `<div><span class="swatch" style="background:${c}"></span><span>${colorName(c)}</span><strong>${n}코</strong></div>`,
      )
      .join("") || '<p class="micro">이 단에는 뜨는 코가 없어요.</p>';
  updateRowGuide();
  renderPalette();
  render();
  if (activeView === "preview") updatePreview();
  renderSelection();
}
function setupChoices() {
  $("symbols").innerHTML = Object.entries(SYMBOLS)
    .map(
      ([id, [s, n, h]]) =>
        `<button data-symbol="${id}" aria-label="${n}: ${h}"><span class="symbol">${esc(s)}</span><span>${n}<small>${h}</small></span></button>`,
    )
    .join("");
  document.querySelectorAll("[data-symbol]").forEach(
    (b) =>
      (b.onclick = () => {
        symbol = b.dataset.symbol;
        choices();
      }),
  );
  choices();
}
function colorName(c) {
  return PALETTE.find((p) => p[0] === c)?.[1] || c;
}
function renderPalette() {
  const colors = [
    ...new Set([
      ...PALETTE.map((p) => p[0]),
      ...extraColors,
      ...chart.cells.map((c) => c.color),
      color,
    ]),
  ];
  const key = colors.join(",");
  if (key !== paletteKey) {
    paletteKey = key;
    $("palette").innerHTML = colors
      .map(
        (c) =>
          `<button data-color="${c}" aria-label="${colorName(c)} 색상" title="${colorName(c)}"><span class="swatch" style="background:${c}"></span><span>${colorName(c)}</span></button>`,
      )
      .join("");
  }
  choices();
}
$("palette").onclick = (e) => {
  const b = e.target.closest("[data-color]");
  if (!b) return;
  color = b.dataset.color;
  $("customColor").value = color;
  choices();
};
const stitchNames = {
  K: "겉뜨기",
  P: "안뜨기",
  YO: "바늘비우기",
  K2tog: "오른코 줄임",
  SSK: "왼코 줄임",
  P2tog: "안뜨기 2코 모아뜨기",
  SSP: "안뜨기 왼코 줄임",
};
function updateRowGuide() {
  const runs = rowInstructions(chart),
    stats = rowStats(chart);
  const key = JSON.stringify([chart.currentRow, chart.mode, runs]);
  if (key !== followKey) {
    followKey = key;
    followStep = 0;
  }
  const instruction = (r) =>
    `${stitchNames[r.stitch]} ${r.count}${["K", "P"].includes(r.stitch) ? "코" : "회"}`;
  $("rowRuns").innerHTML =
    runs
      .map(
        (r) =>
          `<span class="run-chip"><i class="swatch" style="background:${r.color}"></i>${instruction(r)}</span>`,
      )
      .join("") || "<span>코 없음 · 이 단은 건너뛰어요</span>";
  const summary = `시작 ${stats.consumed}코 → 완성 ${stats.produced}코${stats.change ? ` · ${stats.change > 0 ? "+" : ""}${stats.change}코` : " · 코 수 유지"}`;
  $("rowStats").textContent = summary;
  $("followTitle").textContent = chart.completed
    ? "모든 단을 완성했어요"
    : `${chart.currentRow}단, 천천히 한 코씩`;
  $("followDirection").textContent =
    $("direction").textContent + " · 아래 순서대로 떠 주세요";
  $("followStats").textContent =
    `${summary} · ${followStep}/${runs.length}구간 확인`;
  $("followRuns").innerHTML =
    runs
      .map(
        (r, i) =>
          `<button class="follow-run ${i < followStep ? "done" : ""}" data-run="${i}" aria-pressed="${i < followStep}"><span class="run-number">${i < followStep ? "✓" : i + 1}</span><span class="swatch" style="background:${r.color}"></span><span><strong>${instruction(r)}</strong><small>${colorName(r.color)} · ${r.stitch} × ${r.count}</small></span></button>`,
      )
      .join("") ||
    "<p>이 단에는 뜨는 코가 없어요. 다음 단으로 이동해 주세요.</p>";
  $("followNext").disabled = chart.completed;
  $("followNext").textContent = chart.completed
    ? "완성했어요 ✓"
    : chart.currentRow === chart.rows
      ? "마지막 단 완료"
      : "이 단 완료 · 다음 단";
}
$("followRuns").onclick = (e) => {
  const b = e.target.closest("[data-run]");
  if (!b) return;
  const i = Number(b.dataset.run);
  followStep = i < followStep ? i : i + 1;
  updateRowGuide();
  $("followRuns")
    .querySelector(`[data-run="${i}"]`)
    ?.focus({ preventScroll: true });
};
function choices() {
  $("selectedYarn").textContent = `${colorName(color)} · ${SYMBOLS[symbol][1]}`;
  const hints = {
    draw: "색과 기호를 고르고, 도안 위에 그려 보세요.",
    erase: "드래그한 칸을 크림색 겉뜨기로 되돌려요.",
    fill: "같은 색과 기호로 연결된 영역을 한 번에 채워요.",
    select: "무늬를 드래그해 선택하면 복사·반전·반복할 수 있어요.",
    pan: "도안을 드래그해 원하는 위치로 옮겨 보세요.",
  };
  $("workHint").textContent = hints[tool];
  document.querySelectorAll("[data-color]").forEach((b) => {
    b.classList.toggle("active", b.dataset.color === color);
    b.setAttribute("aria-pressed", b.dataset.color === color);
  });
  document.querySelectorAll("[data-symbol]").forEach((b) => {
    b.classList.toggle("active", b.dataset.symbol === symbol);
    b.setAttribute("aria-pressed", b.dataset.symbol === symbol);
  });
  document.querySelectorAll("[data-tool]").forEach((b) => {
    b.classList.toggle("active", b.dataset.tool === tool);
    b.setAttribute("aria-pressed", b.dataset.tool === tool);
  });
  canvas.style.cursor =
    tool === "pan" ? "grab" : tool === "select" ? "crosshair" : "crosshair";
}
function render() {
  cw = base * zoom;
  ch = cw * (aspect ? chart.gaugeSt / chart.gaugeRows : 1);
  // Bound both pixel area and edge length before asking the browser for a canvas.
  const pixelRatio = Math.min(devicePixelRatio || 1, 2);
  const maxCssEdge = 8192 / pixelRatio;
  const scale = Math.min(
    1,
    (maxCssEdge - pad * 2) / (chart.cols * cw),
    (maxCssEdge - pad * 2) / (chart.rows * ch),
    Math.sqrt(
      12000000 /
        (pixelRatio *
          pixelRatio *
          (chart.cols * cw + pad * 2) *
          (chart.rows * ch + pad * 2)),
    ),
  );
  cw *= scale;
  ch *= scale;
  $("zoomValue").title =
    scale < 1 ? "큰 도안은 브라우저에 맞춰 표시 크기를 줄여요." : "";
  const w = chart.cols * cw + pad * 2,
    h = chart.rows * ch + pad * 2;
  let dpr = Math.min(devicePixelRatio || 1, 2);
  canvas.width = Math.ceil(w * dpr);
  canvas.height = Math.ceil(h * dpr);
  canvas.style.width = w + "px";
  canvas.style.height = h + "px";
  ctx.scale(dpr, dpr);
  ctx.fillStyle = "#fcfbf8";
  ctx.fillRect(0, 0, w, h);
  chart.cells.forEach((c, i) => {
    let x = pad + (i % chart.cols) * cw,
      y = pad + Math.floor(i / chart.cols) * ch;
    ctx.fillStyle = c.symbol === "none" ? "#d5d8d2" : c.color;
    ctx.fillRect(x, y, cw, ch);
    if (c.symbol !== "knit") {
      ctx.fillStyle = dark(c.symbol === "none" ? "#d5d8d2" : c.color)
        ? "#fff"
        : "#263a34";
      ctx.font = `${Math.min(cw, ch) * 0.7}px Arial`;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(SYMBOLS[c.symbol][0], x + cw / 2, y + ch / 2);
    }
  });
  ctx.lineWidth = 0.5;
  ctx.strokeStyle = "#bfc2b655";
  ctx.beginPath();
  for (let x = 0; x <= chart.cols; x++) {
    ctx.moveTo(pad + x * cw, pad);
    ctx.lineTo(pad + x * cw, pad + chart.rows * ch);
  }
  for (let y = 0; y <= chart.rows; y++) {
    ctx.moveTo(pad, pad + y * ch);
    ctx.lineTo(pad + chart.cols * cw, pad + y * ch);
  }
  ctx.stroke();
  ctx.strokeStyle = "#8a958266";
  ctx.beginPath();
  for (let x = 5; x < chart.cols; x += 5) {
    ctx.moveTo(pad + x * cw, pad);
    ctx.lineTo(pad + x * cw, pad + chart.rows * ch);
  }
  for (let y = chart.rows % 5; y < chart.rows; y += 5) {
    ctx.moveTo(pad, pad + y * ch);
    ctx.lineTo(pad + chart.cols * cw, pad + y * ch);
  }
  ctx.stroke();
  let ry = pad + (chart.rows - chart.currentRow) * ch;
  ctx.fillStyle = "#46755412";
  ctx.fillRect(pad, ry, chart.cols * cw, ch);
  ctx.strokeStyle = "#668c70";
  ctx.lineWidth = 1;
  ctx.strokeRect(pad, ry, chart.cols * cw, ch);
  ctx.font = "9px system-ui";
  ctx.textBaseline = "middle";
  for (let y = 0; y < chart.rows; y++) {
    let row = chart.rows - y;
    ctx.fillStyle = row === chart.currentRow ? "#244d40" : "#8a8f82";
    ctx.textAlign = "right";
    ctx.fillText(row, pad - 8, pad + y * ch + ch / 2);
    ctx.textAlign = "left";
    ctx.fillText(
      chart.mode === "round" || row % 2 ? "‹" : "›",
      w - pad + 9,
      pad + y * ch + ch / 2,
    );
  }
  ctx.textAlign = "center";
  for (let x = 0; x < chart.cols; x++)
    if (cw > 12 || (chart.cols - x) % 5 === 0)
      ctx.fillText(chart.cols - x, pad + x * cw + cw / 2, h - pad + 14);
  if (chart.border) {
    ctx.strokeStyle = "#829777";
    ctx.setLineDash([4, 4]);
    ctx.beginPath();
    for (let x of [chart.border, chart.cols - chart.border]) {
      ctx.moveTo(pad + x * cw, pad);
      ctx.lineTo(pad + x * cw, pad + chart.rows * ch);
    }
    ctx.stroke();
    ctx.setLineDash([]);
  }
  if (selection) {
    let r = rect();
    ctx.fillStyle = "#3f695921";
    ctx.fillRect(pad + r.x * cw, pad + r.y * ch, r.w * cw, r.h * ch);
    ctx.strokeStyle = "#244d40";
    ctx.lineWidth = 2;
    ctx.setLineDash([5, 3]);
    ctx.strokeRect(pad + r.x * cw, pad + r.y * ch, r.w * cw, r.h * ch);
    ctx.setLineDash([]);
  }
  if (document.activeElement === canvas) {
    ctx.strokeStyle = "#b9786d";
    ctx.lineWidth = 2;
    ctx.strokeRect(
      pad + focus.x * cw + 1,
      pad + focus.y * ch + 1,
      cw - 2,
      ch - 2,
    );
  }
  $("zoomValue").textContent = Math.round((cw / base) * 100) + "%";
}
function fit() {
  let wrap = $("canvasWrap");
  base = 20;
  zoom = Math.max(
    0.3,
    Math.min(
      2,
      (wrap.clientWidth - 44 - pad * 2) / (chart.cols * base),
      (wrap.clientHeight - 44 - pad * 2) /
        (chart.rows * base * (aspect ? chart.gaugeSt / chart.gaugeRows : 1)),
    ),
  );
  render();
}
function position(e) {
  let r = canvas.getBoundingClientRect();
  return {
    x: Math.floor((e.clientX - r.left - pad) / cw),
    y: Math.floor((e.clientY - r.top - pad) / ch),
  };
}
function valid(p) {
  return p.x >= 0 && p.x < chart.cols && p.y >= 0 && p.y < chart.rows;
}
function paint(p) {
  if (valid(p))
    chart.cells[p.y * chart.cols + p.x] =
      tool === "erase" ? blank() : { color, symbol };
}
function line(a, b) {
  let dx = Math.abs(b.x - a.x),
    dy = Math.abs(b.y - a.y),
    sx = a.x < b.x ? 1 : -1,
    sy = a.y < b.y ? 1 : -1,
    err = dx - dy;
  let x = a.x,
    y = a.y;
  for (let i = 0; i < 400; i++) {
    paint({ x, y });
    if (x === b.x && y === b.y) break;
    let e2 = 2 * err;
    if (e2 > -dy) {
      err -= dy;
      x += sx;
    }
    if (e2 < dx) {
      err += dx;
      y += sy;
    }
  }
}
canvas.addEventListener("pointerdown", (e) => {
  if (e.button !== 0) return;
  let p = position(e);
  if (tool !== "pan" && !valid(p)) return;
  e.preventDefault();
  canvas.setPointerCapture(e.pointerId);
  if (drawing) return;
  focus = {
    x: Math.max(0, Math.min(chart.cols - 1, p.x)),
    y: Math.max(0, Math.min(chart.rows - 1, p.y)),
  };
  canvas.focus({ preventScroll: true });
  drawing = {
    id: e.pointerId,
    start: p,
    last: p,
    before: snapshot(),
    x: e.clientX,
    y: e.clientY,
    sx: $("canvasWrap").scrollLeft,
    sy: $("canvasWrap").scrollTop,
  };
  if (tool === "select") {
    selection = { a: p, b: p };
    renderSelection();
  } else if (tool === "fill") {
    flood(chart, p.y * chart.cols + p.x, { color, symbol });
  } else if (tool !== "pan") paint(p);
  render();
});
canvas.addEventListener("pointermove", (e) => {
  let p = position(e);
  if (valid(p))
    $("cursorInfo").textContent =
      `${chart.rows - p.y}단 · 오른쪽에서 ${chart.cols - p.x}번째 칸`;
  if (!drawing || drawing.id !== e.pointerId) return;
  e.preventDefault();
  if (tool === "pan") {
    $("canvasWrap").scrollLeft = drawing.sx - e.clientX + drawing.x;
    $("canvasWrap").scrollTop = drawing.sy - e.clientY + drawing.y;
  } else if (tool === "select") {
    if (valid(p)) {
      selection.b = p;
      renderSelection();
      render();
    }
  } else if (tool !== "fill") {
    if (valid(p)) {
      line(drawing.last, p);
      drawing.last = p;
      render();
    }
  }
});
function finish(e) {
  if (!drawing || drawing.id !== e.pointerId) return;
  if (snapshot() !== drawing.before) {
    push(drawing.before);
    save();
    refresh();
  }
  drawing = null;
}
canvas.addEventListener("pointerup", finish);
canvas.addEventListener("pointercancel", finish);
canvas.addEventListener("lostpointercapture", finish);
function rect() {
  let x = Math.min(selection.a.x, selection.b.x),
    y = Math.min(selection.a.y, selection.b.y);
  return {
    x,
    y,
    w: Math.abs(selection.a.x - selection.b.x) + 1,
    h: Math.abs(selection.a.y - selection.b.y) + 1,
  };
}
function renderSelection() {
  $("selectionBar").hidden = activeView !== "chart" || !selection;
  if (selection) {
    let r = rect();
    $("selectionInfo").textContent = `${r.w} × ${r.h} 선택`;
  }
  $("pasteSelection").disabled = !clipboard;
}
function getBlock() {
  let r = rect();
  return {
    ...r,
    cells: Array.from({ length: r.h }, (_, y) =>
      chart.cells
        .slice((r.y + y) * chart.cols + r.x, (r.y + y) * chart.cols + r.x + r.w)
        .map((c) => ({ ...c })),
    ).flat(),
  };
}
$("copySelection").onclick = () => {
  clipboard = getBlock();
  renderSelection();
  toast("선택한 무늬를 복사했어요. 붙여넣을 위치를 선택하세요.");
};
$("pasteSelection").onclick = () => {
  if (!clipboard || !selection) return;
  let r = rect();
  if (r.x + clipboard.w > chart.cols || r.y + clipboard.h > chart.rows)
    return toast("무늬가 도안 밖으로 나가요. 안쪽 위치를 선택해 주세요.");
  change(() => {
    clipboard.cells.forEach(
      (c, i) =>
        (chart.cells[
          (r.y + Math.floor(i / clipboard.w)) * chart.cols +
            r.x +
            (i % clipboard.w)
        ] = { ...c }),
    );
  });
};
$("mirrorSelection").onclick = () =>
  change(() => {
    let b = getBlock();
    for (let y = 0; y < b.h; y++)
      for (let x = 0; x < b.w; x++)
        chart.cells[(b.y + y) * chart.cols + b.x + x] = mirrored(
          b.cells[y * b.w + b.w - 1 - x],
        );
  });
$("repeatSelection").onclick = () => {
  let b = getBlock();
  if (b.x < chart.border || b.x + b.w > chart.cols - chart.border)
    return toast("반복할 무늬는 양쪽 테두리 안에서 선택해 주세요.");
  let end = chart.cols - chart.border,
    n = Math.floor((end - b.x) / b.w);
  if (n < 2) return toast("테두리 안에 반복할 공간이 부족해요.");
  change(() => {
    for (let k = 1; k < n; k++)
      b.cells.forEach(
        (c, i) =>
          (chart.cells[
            (b.y + Math.floor(i / b.w)) * chart.cols + b.x + k * b.w + (i % b.w)
          ] = { ...c }),
      );
  });
  toast(`${n}회 반복했어요. 남는 칸과 테두리는 유지했어요.`);
};
$("clearSelection").onclick = () => {
  selection = null;
  renderSelection();
  render();
};
function modal(html) {
  $("modalContent").innerHTML = html;
  const heading = $("modalContent").querySelector("h2");
  if (heading) {
    heading.id = "modalTitle";
    $("modal").setAttribute("aria-labelledby", "modalTitle");
  }
  $("modal").showModal();
}
function close() {
  $("modal").close();
}
$("closeModal").onclick = close;
$("modal").addEventListener("click", (e) => {
  if (e.target === $("modal")) close();
});
function confirmAction(title, text, fn) {
  modal(
    `<h2>${title}</h2><p>${text}</p><div class="dialog-actions"><button id="cancelAction">돌아가기</button><button class="primary" id="confirmAction">계속하기</button></div>`,
  );
  $("cancelAction").onclick = close;
  $("confirmAction").onclick = () => {
    close();
    fn();
  };
}
function replace(next) {
  push();
  chart = next;
  selection = null;
  refresh();
  save();
  view("chart");
  requestAnimationFrame(fit);
}
$("newBtn").onclick = () => {
  modal(
    `<h2>어떤 무늬로 시작할까요?</h2><p>지금 작업은 바뀌어요. 필요한 도안은 먼저 JSON으로 백업해 주세요. 실행 취소로 되돌릴 수 있어요.</p><div class="starter-options">${[
      [
        "blank",
        "빈 도안",
        `${chart.cols}칸 × ${chart.rows}단 · 자유롭게 그리기`,
      ],
      ["rabbit", "토끼의 산책", "로즈빛 토끼와 작은 하트"],
      ["heart", "마음을 잇는 하트", "배색 무늬 연습"],
      ["rib", "포근한 고무뜨기", "32 × 32 · 겉2, 안2 조직"],
      ["stripes", "차분한 스트라이프", "32 × 32 · 4단씩 색 바꾸기"],
    ]
      .map(
        ([id, title, desc]) =>
          `<button data-start="${id}"><strong>${title}</strong><small>${desc}</small></button>`,
      )
      .join("")}</div>`,
  );
  $("modalContent")
    .querySelectorAll("[data-start]")
    .forEach(
      (b) =>
        (b.onclick = () => {
          close();
          replace(
            b.dataset.start === "blank"
              ? makeChart(chart.cols, chart.rows)
              : sample(b.dataset.start),
          );
          toast(
            "새 도안을 열었어요. 실행 취소로 이전 작업을 복원할 수 있어요.",
          );
        }),
    );
};
document
  .querySelectorAll("[data-sample]")
  .forEach(
    (b) =>
      (b.onclick = () =>
        confirmAction(
          "샘플 도안을 열까요?",
          "현재 작업을 선택한 샘플로 바꿔요. 필요한 작업은 먼저 JSON으로 백업해 주세요.",
          () => replace(sample(b.dataset.sample)),
        )),
  );
$("resizeBtn").onclick = () => {
  let cols = Number($("cols").value),
    rows = Number($("rows").value);
  if (
    !Number.isInteger(cols) ||
    !Number.isInteger(rows) ||
    cols < 1 ||
    cols > 120 ||
    rows < 1 ||
    rows > 160
  ) {
    refresh();
    return toast("가로 1–120칸, 세로 1–160단의 정수를 입력해 주세요.");
  }
  let fn = () => {
    selection = null;
    change(() => (chart = resize(chart, cols, rows)));
    renderSelection();
    fit();
  };
  if (cols < chart.cols || rows < chart.rows)
    confirmAction(
      "도안을 줄일까요?",
      "아래쪽·왼쪽 칸은 유지하고, 위쪽·오른쪽의 넘치는 칸을 지워요. 실행 취소로 복구할 수 있어요.",
      fn,
    );
  else fn();
};
$("title").onchange = () =>
  change(() => (chart.title = $("title").value.trim() || "이름 없는 도안"));
document
  .querySelectorAll("[data-mode]")
  .forEach(
    (b) => (b.onclick = () => change(() => (chart.mode = b.dataset.mode))),
  );
for (let id of ["gaugeSt", "gaugeRows", "border"])
  $(id).onchange = () => {
    let n = Number($(id).value),
      max = id === "border" ? Math.floor((chart.cols - 1) / 2) : 100;
    if (
      !Number.isFinite(n) ||
      n < (id === "border" ? 0 : 1) ||
      n > max ||
      (id === "border" && !Number.isInteger(n))
    ) {
      refresh();
      return toast("허용 범위 안의 값을 입력해 주세요.");
    }
    change(() => (chart[id] = n));
  };
function row(n) {
  change(() => {
    chart.completed = false;
    chart.currentRow = Math.max(1, Math.min(chart.rows, n));
  });
}
$("currentRow").onchange = () => {
  let n = Number($("currentRow").value);
  if (!Number.isInteger(n)) {
    refresh();
    return;
  }
  row(n);
};
$("nextRow").onclick = () => {
  if (chart.currentRow === chart.rows) {
    change(() => {
      chart.completed = true;
    });
    toast("모든 단을 완성했어요. 수고했어요!");
    return;
  }
  row(chart.currentRow + 1);
};
$("prevRow").onclick = () =>
  row(chart.completed ? chart.currentRow : chart.currentRow - 1);
$("followNext").onclick = () => $("nextRow").click();
$("resetRow").onclick = () =>
  confirmAction(
    "첫 단부터 다시 볼까요?",
    "도안은 그대로 두고 단수 기록만 1단으로 돌아가요.",
    () => row(1),
  );
$("undo").onclick = undoAction;
$("redo").onclick = redoAction;
document.querySelectorAll("[data-tool]").forEach(
  (b) =>
    (b.onclick = () => {
      tool = b.dataset.tool;
      choices();
      if (tool === "pan")
        toast("이동 모드 · 도안을 드래그해도 그려지지 않아요");
    }),
);
$("customColor").oninput = (e) => {
  color = e.target.value;
  choices();
};
$("customColor").onchange = (e) => {
  color = e.target.value;
  extraColors.add(color);
  renderPalette();
};
$("projectNotes").onfocus = () => {
  notesBefore = snapshot();
};
$("projectNotes").oninput = () => {
  chart.notes = $("projectNotes").value.slice(0, 2000);
  save();
};
$("projectNotes").onblur = () => {
  if (notesBefore && notesBefore !== snapshot()) {
    push(notesBefore);
    refresh();
  }
  notesBefore = null;
};
$("zoomOut").onclick = () => {
  zoom = Math.max(0.3, zoom / 1.2);
  render();
};
$("zoomIn").onclick = () => {
  zoom = Math.min(3, zoom * 1.2);
  render();
};
$("fit").onclick = fit;
$("aspectBtn").onclick = () => {
  aspect = !aspect;
  $("aspectBtn").setAttribute("aria-pressed", aspect);
  fit();
};
function toggleTools(open, restoreFocus = false) {
  $("toolPanel").classList.toggle("open", open);
  $("settingsMobile").setAttribute("aria-expanded", open);
  if (open) $("closeTools").focus();
  else if (restoreFocus) $("settingsMobile").focus();
}
$("settingsMobile").onclick = () =>
  toggleTools(!$("toolPanel").classList.contains("open"));
$("closeTools").onclick = () => toggleTools(false, true);
document.addEventListener("pointerdown", (e) => {
  if (!e.target.closest("#toolPanel") && !e.target.closest("#settingsMobile"))
    toggleTools(false);
});
$("preview3d").addEventListener("previewstatus", (e) => {
  if (e.detail?.available === false)
    $("previewNote").textContent = e.detail.message;
});
function updatePreview() {
  if (activeView !== "preview") return;
  if (!preview) {
    preview = createPreview3D($("preview3d"));
    preview.setOptions(previewOptions);
  }
  preview.setActive?.(true);
  const meta = preview.update(chart);
  preview.resize();
  const unavailable = meta?.available === false;
  $("previewNote").textContent = unavailable
    ? meta.message ||
      "이 브라우저에서 3D를 사용할 수 없어요. 도안 편집은 계속 사용할 수 있어요."
    : "배색과 조직을 살펴보는 형태 미리보기예요. 실제 치수·장력·늘림·줄임과 완성품을 예측하지 않아요.";
  $("previewDownload").disabled = unavailable;
  $("previewInfo").textContent = unavailable
    ? "도안 그리기와 따라 뜨기는 계속 사용할 수 있어요."
    : `${meta.cols}칸 × ${meta.rows}단 · 게이지 ${chart.gaugeSt}코 / ${chart.gaugeRows}단${meta.cropped ? ` · 전체 중 가운데 부분 (왼쪽 ${meta.startCol + 1}열부터, 위쪽 ${meta.startRow + 1}행부터)` : ""}${previewOptions.showProgress ? ` · 완료 ${chart.completed ? chart.rows : chart.currentRow - 1}단` : ""}`;
}
function view(which) {
  activeView = which;
  document.body.dataset.view = which;
  for (const name of ["chart", "preview", "follow"]) {
    const active = name === which;
    $(name + "Tab").setAttribute("aria-selected", active);
    $(name + "Tab").tabIndex = active ? 0 : -1;
  }
  $("canvasWrap").hidden = which !== "chart";
  $("previewWrap").hidden = which !== "preview";
  $("previewControls").hidden = which !== "preview";
  $("followPanel").hidden = which !== "follow";
  $("toolbar").hidden = which !== "chart";
  $("workHint").hidden = which !== "chart";
  $("selectionBar").hidden = which !== "chart" || !selection;
  document.querySelector(".canvas-footer").hidden = which !== "chart";
  preview?.setActive?.(which === "preview");
  if (which === "preview") requestAnimationFrame(updatePreview);
  if (which === "chart") requestAnimationFrame(fit);
  if (which === "follow") updateRowGuide();
}
for (const name of ["chart", "preview", "follow"])
  $(name + "Tab").onclick = () => view(name);
document.querySelector(".view-tabs").addEventListener("keydown", (e) => {
  if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(e.key)) return;
  e.preventDefault();
  const names = ["chart", "preview", "follow"];
  let i = names.indexOf(activeView);
  i =
    e.key === "Home"
      ? 0
      : e.key === "End"
        ? 2
        : (i + (e.key === "ArrowRight" ? 1 : 2)) % 3;
  view(names[i]);
  $(names[i] + "Tab").focus();
});
function applyPreviewOptions() {
  preview?.setOptions(previewOptions);
  if (activeView === "preview") updatePreview();
}
document.querySelectorAll("[data-shape]").forEach(
  (b) =>
    (b.onclick = () => {
      previewOptions.shape = b.dataset.shape;
      document.querySelectorAll("[data-shape]").forEach((x) => {
        x.classList.toggle("active", x === b);
        x.setAttribute("aria-pressed", x === b);
      });
      preview?.setView("angled");
      applyPreviewOptions();
    }),
);
$("yarnWeight").onchange = (e) => {
  previewOptions.yarn = e.target.value;
  applyPreviewOptions();
};
$("fabricDrape").oninput = (e) => {
  previewOptions.drape = Number(e.target.value) / 100;
  applyPreviewOptions();
};
$("previewLight").onchange = (e) => {
  previewOptions.lighting = e.target.value;
  applyPreviewOptions();
};
$("previewProgress").onchange = (e) => {
  previewOptions.showProgress = e.target.checked;
  applyPreviewOptions();
};
$("previewRotate").onclick = () => {
  previewOptions.autoRotate = !previewOptions.autoRotate;
  $("previewRotate").setAttribute("aria-pressed", previewOptions.autoRotate);
  $("previewRotate").textContent = previewOptions.autoRotate
    ? "회전 멈추기"
    : "자동 회전";
  applyPreviewOptions();
};
document
  .querySelectorAll("[data-view]")
  .forEach((b) => (b.onclick = () => preview?.setView(b.dataset.view)));
$("previewReset").onclick = () => preview?.reset();
$("previewZoomOut").onclick = () => preview?.zoomBy(1 / 1.2);
$("previewZoomIn").onclick = () => preview?.zoomBy(1.2);
$("previewDownload").onclick = () => {
  const url = preview?.capture();
  if (!url) return toast("3D 이미지를 만들 수 없어요.");
  const a = document.createElement("a");
  a.href = url;
  a.download = chart.title.replace(/[\\/:*?"<>|]/g, "_") + "-3D.png";
  a.click();
  toast("현재 시점의 3D 이미지를 내려받았어요.");
};
$("helpBtn").onclick = () =>
  modal(
    `<h2>한 코씩, 읽는 방법</h2><p>도안은 항상 겉면에서 본 모습이에요. 아래 1단부터 위로 읽어요. 평면뜨기는 홀수단 오른쪽→왼쪽, 짝수단 왼쪽→오른쪽. 원형뜨기는 모든 단을 오른쪽→왼쪽으로 읽어요.</p><div class="help-legend">${Object.entries(
      SYMBOLS,
    )
      .map(
        ([k, [s, n, h]]) =>
          `<div><span class="symbol">${esc(s)}</span><span>${n}<small>${h}</small></span></div>`,
      )
      .join(
        "",
      )}</div><p>지우기는 크림색 겉뜨기 칸으로 되돌려요. ‘코 없음’은 실제로 뜨지 않는 자리를 뜻해요. 늘림·줄임의 코 수 균형과 실제 편물은 별도 확인이 필요해요. 기호는 패턴마다 다를 수 있어요.</p><p>드래그로 그리기 · 선택 후 복사/반복 · 이동 모드로 스크롤<br>B 그리기 / E 지우기 / F 채우기 / S 선택 / H 이동<br>Ctrl/⌘ Z 취소 · Ctrl/⌘ Shift Z 다시 실행<br>도안에 초점을 두고 방향키 이동 · Enter 그리기<br>Space 다음 단 (입력 중에는 동작하지 않아요)</p><p><a href="https://craftyarncouncil.com/standards/knit-chart-symbols" target="_blank" rel="noopener">Craft Yarn Council 기호 참고</a></p>`,
  );
$("exportBtn").onclick = () => {
  modal(
    `<h2>내 손으로 만든 도안</h2><p>다시 편집하려면 JSON으로 백업하세요. 그림에는 단 번호와 기호 범례가 함께 담겨요.</p><div class="export-options"><button id="jsonExport">JSON 백업<small>모든 색상·기호·설정 · 다시 가져와 편집</small></button><button id="svgExport">SVG 도안<small>확대해도 선명한 벡터 파일</small></button><button id="pngExport">PNG 이미지<small>고해상도 도안과 범례</small></button><button id="printExport">인쇄 / PDF 저장<small>브라우저 인쇄에서 PDF로 저장할 수 있어요</small></button><button id="importExport">JSON 도안 열기<small>이전에 백업한 도안 가져오기</small></button><button id="newExport">빈 도안으로 시작<small>현재 크기의 새 도안 만들기</small></button></div>`,
  );
  let name = () => chart.title.replace(/[\\/:*?"<>|]/g, "_");
  $("jsonExport").onclick = () => {
    download(
      new Blob([JSON.stringify(chart, null, 2)], { type: "application/json" }),
      name() + ".json",
    );
    toast("JSON 백업을 내려받았어요");
  };
  $("svgExport").onclick = () =>
    download(
      new Blob([chartSVG(chart)], { type: "image/svg+xml" }),
      name() + ".svg",
    );
  $("pngExport").onclick = async () => {
    let b = $("pngExport");
    b.disabled = true;
    b.textContent = "이미지를 만들고 있어요…";
    try {
      let blob = new Blob([chartSVG(chart)], { type: "image/svg+xml" }),
        url = URL.createObjectURL(blob),
        img = new Image();
      await new Promise((resolve, reject) => {
        img.onload = resolve;
        img.onerror = reject;
        img.src = url;
      });
      let out = document.createElement("canvas");
      out.width = img.width;
      out.height = img.height;
      out.getContext("2d").drawImage(img, 0, 0);
      URL.revokeObjectURL(url);
      out.toBlob((blob) => {
        if (blob) download(blob, name() + ".png");
        else toast("PNG를 만들지 못했어요. SVG를 이용해 주세요.");
      }, "image/png");
    } catch {
      toast("PNG를 만들지 못했어요. SVG를 이용해 주세요.");
    } finally {
      b.disabled = false;
      b.textContent = "PNG 이미지";
    }
  };
  $("printExport").onclick = () => {
    let win = window.open("", "_blank");
    if (!win)
      return toast(
        "인쇄 창이 차단됐어요. 팝업을 허용하거나 SVG를 내려받으세요.",
      );
    win.document.write(
      `<!doctype html><html lang="ko"><head><title>${esc(chart.title)}</title><style>body{margin:20px}svg{width:100%;height:auto}button{padding:12px;margin:10px}@media print{button{display:none}@page{margin:10mm}}</style></head><body><button onclick="window.print()">인쇄 / PDF 저장</button>${chartSVG(chart)}</body></html>`,
    );
    win.document.close();
    win.focus();
    setTimeout(() => win.print(), 250);
  };
  $("importExport").onclick = () => {
    $("fileInput").click();
  };
  $("newExport").onclick = () => {
    close();
    $("newBtn").click();
  };
};
$("openBtn").onclick = () => $("fileInput").click();
$("fileInput").onchange = async (e) => {
  let f = e.target.files[0];
  e.target.value = "";
  if (!f) return;
  if (f.size > 4e6)
    return toast("파일이 너무 커요. 4MB 이하의 JSON을 선택하세요.");
  try {
    let next = validate(JSON.parse(await f.text()));
    if ($("modal").open) close();
    confirmAction(
      "백업한 도안을 열까요?",
      `‘${esc(next.title)}’ ${next.cols} × ${next.rows} 도안으로 현재 작업을 바꿔요.`,
      () => {
        replace(next);
        toast("도안을 가져왔어요");
      },
    );
  } catch (err) {
    toast("파일을 열 수 없어요. " + err.message);
  }
};
document.addEventListener("keydown", (e) => {
  if (drawing) return;
  if (e.key === "Escape" && $("toolPanel").classList.contains("open")) {
    toggleTools(false, true);
    return;
  }
  if (
    e.target.closest("input,textarea,select,[contenteditable=true]") ||
    $("modal").open
  )
    return;
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "z") {
    e.preventDefault();
    e.shiftKey ? redoAction() : undoAction();
    return;
  }
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "y") {
    e.preventDefault();
    redoAction();
    return;
  }
  if (e.ctrlKey || e.metaKey || e.altKey) return;
  if (
    e.code === "Space" &&
    !e.target.closest("button,a,summary,[role=button]")
  ) {
    e.preventDefault();
    if (!e.repeat) $("nextRow").click();
    return;
  }
  let map = { b: "draw", e: "erase", f: "fill", s: "select", h: "pan" };
  if (activeView === "chart" && map[e.key.toLowerCase()]) {
    tool = map[e.key.toLowerCase()];
    choices();
  }
  if (e.target === canvas) {
    if (e.key.startsWith("Arrow")) {
      e.preventDefault();
      focus.x = Math.max(
        0,
        Math.min(
          chart.cols - 1,
          focus.x +
            (e.key === "ArrowRight" ? 1 : e.key === "ArrowLeft" ? -1 : 0),
        ),
      );
      focus.y = Math.max(
        0,
        Math.min(
          chart.rows - 1,
          focus.y + (e.key === "ArrowDown" ? 1 : e.key === "ArrowUp" ? -1 : 0),
        ),
      );
      $("cursorInfo").textContent =
        `${chart.rows - focus.y}단 · 오른쪽에서 ${chart.cols - focus.x}번째 칸`;
      render();
    }
    if (e.key === "Enter") {
      e.preventDefault();
      if (tool === "pan" || !valid(focus)) return;
      if (tool === "select") {
        selection = { a: { ...focus }, b: { ...focus } };
        renderSelection();
        render();
      } else
        change(() => {
          if (tool === "fill")
            flood(chart, focus.y * chart.cols + focus.x, { color, symbol });
          else paint(focus);
        });
    }
  }
});
canvas.addEventListener("focus", render);
canvas.addEventListener("blur", render);
window.addEventListener("resize", () => {
  if (activeView === "chart") fit();
  else preview?.resize();
});
window.addEventListener("beforeunload", () => {
  if (!recoveryNeeded) {
    try {
      localStorage.setItem(KEY, JSON.stringify(chart));
    } catch {}
  }
});
setupChoices();
refresh();
view("chart");
requestAnimationFrame(fit);
if (!restored && !recoveryNeeded) save();
if (recoveryNeeded) {
  $("saveStatus").textContent = "이전 저장 데이터 복구 필요";
  modal(
    '<h2>저장한 도안을 읽지 못했어요</h2><p>이전 데이터는 덮어쓰지 않았어요. 먼저 원본을 내려받아 보관한 뒤 새로 시작할 수 있어요.</p><div class="dialog-actions"><button id="recoverDownload">원본 데이터 받기</button><button id="recoverStart" class="primary">새로 시작</button></div>',
  );
  $("recoverDownload").onclick = () => {
    try {
      const raw = localStorage.getItem(KEY);
      if (raw)
        download(
          new Blob([raw], { type: "application/json" }),
          "coco-recovery.json",
        );
      else toast("저장 공간에 접근할 수 없어요.");
    } catch {
      toast("브라우저 저장 공간에 접근할 수 없어요.");
    }
  };
  $("recoverStart").onclick = () => {
    close();
    confirmAction(
      "새로 시작할까요?",
      "읽지 못한 이전 데이터가 새 도안으로 바뀌어요. 필요한 원본은 먼저 내려받아 주세요.",
      () => {
        recoveryNeeded = false;
        save();
      },
    );
  };
}
