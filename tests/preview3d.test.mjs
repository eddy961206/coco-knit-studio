import test from "node:test";
import assert from "node:assert/strict";
import { createPreview3D } from "../dist/preview3d.js";

function fixture(instanced = true) {
  const uploads = [],
    deleted = [],
    uniforms = {},
    listeners = new Map();
  let id = 0;
  const frames = new Map();
  globalThis.requestAnimationFrame = (callback) => {
    frames.set(++id, callback);
    return id;
  };
  globalThis.cancelAnimationFrame = (id) => frames.delete(id);
  const extension = {
    vertexAttribDivisorANGLE() {},
    drawElementsInstancedANGLE() {},
  };
  const gl = new Proxy(
    {
      getShaderParameter: () => true,
      getProgramParameter: () => true,
      getAttribLocation: () => 1,
      getUniformLocation: (_, name) => name,
      getExtension: () => (instanced ? extension : null),
      createShader: () => ({}),
      createProgram: () => ({}),
      createBuffer: () => ({ id: ++id }),
      bufferData: (_, data) => uploads.push(data),
      deleteBuffer: (value) => deleted.push(value),
      uniform1f: (name, value) => (uniforms[name] = value),
    },
    {
      get: (target, key) =>
        key in target ? target[key] : /^[A-Z_]+$/.test(key) ? 1 : () => {},
    },
  );
  const attrs = new Map();
  const canvas = {
    style: {},
    getContext: () => gl,
    getAttribute: (k) => attrs.get(k) ?? null,
    hasAttribute: (k) => attrs.has(k),
    setAttribute: (k, v) => attrs.set(k, v),
    removeAttribute: (k) => attrs.delete(k),
    addEventListener: (k, v) => listeners.set(k, v),
    removeEventListener: (k) => listeners.delete(k),
    getBoundingClientRect: () => ({ width: 600, height: 400 }),
    toDataURL: () => "data:image/png;base64,test",
  };
  return {
    preview: createPreview3D(canvas),
    uploads,
    deleted,
    uniforms,
    listeners,
    canvas,
    frames,
  };
}
const chart = (cols = 8, rows = 12) => ({
  cols,
  rows,
  gaugeSt: 20,
  gaugeRows: 30,
  currentRow: 1,
  cells: Array.from({ length: cols * rows }, (_, i) => ({
    color: "#e07040",
    symbol: i === 0 ? "none" : "knit",
  })),
});

test("gauge, options and progress use uniforms without rebuilding yarn buffers", () => {
  const f = fixture();
  assert.equal(f.preview.update(chart()).stitchCount, 95);
  const count = f.uploads.length;
  assert.deepEqual(
    f.preview.setOptions({
      shape: "beanie",
      yarn: "chunky",
      drape: 2,
      lighting: "studio",
      showProgress: true,
    }),
    {
      shape: "beanie",
      yarn: "chunky",
      drape: 1,
      lighting: "studio",
      showProgress: true,
      autoRotate: false,
    },
  );
  f.preview.update({ ...chart(), currentRow: 4 });
  f.preview.setView("back");
  f.preview.zoomBy(1.2);
  assert.match(f.preview.capture(), /^data:image\/png/);
  assert.equal(f.uploads.length, count);
  assert.equal(f.uniforms.uShape, 2);
  assert.equal(f.uniforms.uRowScale, 20 / 30 / 0.72);
  assert.equal(f.uniforms.uYarn, 0.04);
  assert.equal(f.uniforms.uStudio, 1);
  assert.equal(f.uniforms.uShowProgress, 1);
  for (const data of f.uploads)
    for (const v of data) assert.ok(Number.isFinite(v));
  f.preview.destroy();
  assert.ok(f.deleted.length >= 15);
  assert.equal(f.listeners.size, 0);
});

test("crop metadata survives context loss and restoration with bounded geometry", () => {
  const f = fixture(false);
  const info = f.preview.update(chart(63, 65));
  assert.equal(info.startCol, 1);
  assert.equal(info.startRow, 2);
  assert.equal(info.cols, 60);
  assert.equal(info.rows, 60);
  for (const data of f.uploads)
    if (data instanceof Uint16Array) assert.ok(data.every((v) => v < 64000));
  f.listeners.get("webglcontextlost")({ preventDefault() {} });
  assert.equal(f.preview.capture(), null);
  f.listeners.get("webglcontextrestored")();
  assert.equal(f.preview.metadata.totalRows, 65);
  assert.equal(f.preview.metadata.startRow, 2);
  assert.equal(f.preview.available, true);
  f.preview.destroy();
});

test("unavailable WebGL provides complete harmless public API", () => {
  const p = createPreview3D({ getContext: () => null });
  p.setOptions({ shape: "tube" });
  p.setView("front");
  p.zoomBy(2);
  p.resize();
  p.reset();
  assert.equal(p.capture(), null);
  assert.equal(p.available, false);
  p.destroy();
});

test("completed-only progress starts empty and includes the final row only after completion", () => {
  const f = fixture();
  f.preview.setOptions({ showProgress: true });
  f.preview.update(chart());
  f.preview.capture();
  const bottomCenter = (-(12 - 1) / 2) * (20 / 30) - (0.12 * (20 / 30)) / 0.72;
  assert.ok(f.uniforms.uProgress < bottomCenter);
  f.preview.update({ ...chart(), currentRow: 12 });
  f.preview.capture();
  const topCenter = ((12 - 1) / 2) * (20 / 30) - (0.12 * (20 / 30)) / 0.72;
  assert.ok(f.uniforms.uProgress < topCenter);
  f.preview.update({ ...chart(), currentRow: 12, completed: true });
  f.preview.capture();
  assert.ok(f.uniforms.uProgress > topCenter);
  f.preview.destroy();
});

test("inactive views stop scheduling and invalid gauge values remain finite", () => {
  const f = fixture();
  f.preview.update({ ...chart(), gaugeSt: Infinity, gaugeRows: -1 });
  f.preview.setOptions({ autoRotate: true });
  f.preview.capture();
  assert.equal(f.uniforms.uRowScale, 20 / 28 / 0.72);
  f.preview.setActive(false);
  assert.equal(f.frames.size, 0);
  f.preview.resize();
  f.preview.setView("angled");
  assert.equal(f.frames.size, 0);
  f.preview.setActive(true);
  assert.equal(f.frames.size, 1);
  f.preview.destroy();
  assert.equal(f.frames.size, 0);
});

test("legitimate wide and tall gauge ratios are preserved", () => {
  const f = fixture();
  for (const [gaugeSt, gaugeRows] of [
    [1, 100],
    [100, 1],
  ]) {
    const info = f.preview.update({ ...chart(), gaugeSt, gaugeRows });
    f.preview.capture();
    assert.equal(info.rowPitch, gaugeSt / gaugeRows);
    assert.equal(info.gaugeAspectAdjusted, false);
    assert.equal(f.uniforms.uRowScale, gaugeSt / gaugeRows / 0.72);
  }
  f.preview.destroy();
});
