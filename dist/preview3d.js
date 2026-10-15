/**
 * Dependency-free WebGL yarn preview. Each chart cell becomes a lit tube mesh.
 * This is a visual stitch approximation, not a physically simulated knitting model.
 *
 *   const preview = createPreview3D(canvas);
 *   const info = preview.update({ cols, rows, cells: [{color, symbol}, ...] });
 *   preview.resize(); preview.destroy();
 *
 * Large charts show their central 60 × 60 cells; update() reports the exact crop.
 * The canvas remains transparent so its host can supply a background.
 */
export function createPreview3D(canvas) {
  if (!canvas || typeof canvas.getContext !== "function") {
    throw new TypeError("createPreview3D requires a canvas element");
  }

  const LIMIT = 60;
  const SYMBOLS = ["knit", "purl", "yo", "k2tog", "ssk"];
  const TAU = Math.PI * 2;
  let gl;
  try {
    gl =
      canvas.getContext("webgl", {
        alpha: true,
        antialias: true,
        premultipliedAlpha: true,
        preserveDrawingBuffer: true,
        powerPreference: "low-power",
      }) || canvas.getContext("experimental-webgl");
  } catch (_) {
    gl = null;
  }

  let metadata = {
    available: !!gl,
    mode: gl ? "webgl" : "unavailable",
    cropped: false,
    cols: 0,
    rows: 0,
    totalCols: 0,
    totalRows: 0,
    startCol: 0,
    startRow: 0,
    stitchCount: 0,
    triangleCount: 0,
    message: gl ? "" : "이 브라우저에서는 WebGL 3D 미리보기를 사용할 수 없어요",
  };
  if (!gl) {
    return {
      available: false,
      get metadata() {
        return { ...metadata };
      },
      update() {
        return { ...metadata };
      },
      resize() {},
      reset() {},
      destroy() {},
      setOptions() {},
      setActive() {},
      setView() {},
      zoomBy() {},
      capture() {
        return null;
      },
    };
  }

  let options = {
    shape: "swatch",
    yarn: "medium",
    drape: 0.35,
    lighting: "soft",
    showProgress: false,
    autoRotate: false,
  };
  let rowPitch = 0.72;
  let currentRow = 1;
  let progressY = -100000;
  let lastTime = 0;
  let active = true;
  const motionPreference = globalThis.matchMedia?.(
    "(prefers-reduced-motion: reduce)",
  );
  let geometryKey = "";
  let program = null;
  let locations = null;
  let instancing = null;
  let templates = new Map();
  let batches = [];
  let chartSnapshot = null;
  let disposed = false;
  let contextLost = false;
  let frame = 0;
  let quality = "";
  let clothWidth = 1;
  let clothHeight = 1;
  let zoom = 1;
  let yaw = -0.13;
  let pitch = 0.08;
  let pixelWidth = 0;
  let pixelHeight = 0;
  const pointers = new Map();
  let pinchDistance = 0;
  const listeners = [];
  const originalTouchAction = canvas.style.touchAction;
  const originalCursor = canvas.style.cursor;
  const originalTabIndex = canvas.getAttribute("tabindex");
  const ownLabel = !canvas.hasAttribute("aria-label");
  canvas.style.touchAction = "none";
  canvas.style.cursor = "grab";
  if (originalTabIndex === null) canvas.tabIndex = 0;
  if (ownLabel)
    canvas.setAttribute(
      "aria-label",
      "실제 실 고리로 만든 3D 니트 미리보기. 드래그로 회전, 스크롤로 확대. 방향키로 회전, 더하기와 빼기로 확대, Home으로 초기화.",
    );

  const vertexSource = `
    attribute vec3 aPosition;
    attribute vec3 aNormal;
    attribute vec2 aUV;
    attribute vec2 aOffset;
    attribute vec3 aColor;
    attribute float aCourse;
    uniform mat4 uViewProjection;
    uniform float uClothWidth;
    uniform float uClothHeight;
    uniform float uRowScale;
    uniform float uShape;
    uniform float uDrape;
    uniform float uYarn;
    varying vec3 vNormal;
    varying vec3 vPosition;
    varying vec3 vColor;
    varying vec2 vUV;
    varying float vCourseY;
    vec3 fabric(vec3 p) {
      p.y *= uRowScale;
      if (uShape < 0.5) {
        p.z += uDrape * (0.32 * uClothWidth * pow(p.x / max(uClothWidth, 1.0), 2.0)
          + 0.18 * sin(p.x * 0.9) * cos(p.y * 0.35));
        p.y -= uDrape * 0.10 * uClothHeight * pow(2.0 * p.x / max(uClothWidth, 1.0), 2.0);
        return p;
      }
      float theta = p.x * 6.2831853 / max(uClothWidth, 1.0);
      float radius = uClothWidth / 6.2831853;
      float height = max(uClothHeight, 1.0);
      float t = clamp((p.y + height * 0.5) / height, 0.0, 1.0);
      if (uShape > 1.5) {
        // A hemispherical crown above a straight rib-height body.
        float crown = clamp((t - 0.58) / 0.42, 0.0, 0.9998);
        radius *= sqrt(max(0.0004, 1.0 - crown * crown));
      }
      radius += uDrape * 0.10 * sin(theta * 6.0) * (1.0 - t);
      return vec3((radius + p.z) * sin(theta), p.y, (radius + p.z) * cos(theta));
    }
    void main() {
      vec3 source = aPosition + vec3(aOffset, 0.0) + aNormal * uYarn;
      vec3 p = fabric(source);
      vec3 tangent = normalize(cross(aNormal, abs(aNormal.z) < 0.9 ? vec3(0,0,1) : vec3(0,1,0)));
      vec3 bitangent = cross(aNormal, tangent);
      vec3 dt = fabric(source + tangent * 0.01) - p;
      vec3 db = fabric(source + bitangent * 0.01) - p;
      vNormal = normalize(cross(dt, db));
      vCourseY = aCourse * uRowScale;
      vPosition = p;
      vColor = aColor;
      vUV = aUV;
      gl_Position = uViewProjection * vec4(p, 1.0);
    }
  `;
  const fragmentSource = `
    precision mediump float;
    varying vec3 vNormal;
    varying vec3 vPosition;
    varying vec3 vColor;
    varying vec2 vUV;
    uniform vec3 uEye;
    uniform float uStudio;
    uniform float uProgress;
    uniform float uShowProgress;
    varying float vCourseY;
    void main() {
      if (uShowProgress > 0.5 && vCourseY > uProgress) discard;
      vec3 n = normalize(vNormal);
      if (!gl_FrontFacing) n = -n;
      vec3 light = normalize(vec3(-0.45, 0.65, 1.0));
      vec3 eye = normalize(uEye - vPosition);
      float diffuse = max(dot(n, light), 0.0);
      float fill = max(dot(n, normalize(vec3(0.5, -0.3, -0.8))), 0.0);
      float specular = pow(max(dot(n, normalize(light + eye)), 0.0), 9.0);
      // Subtle helical plies give the tube a yarn-like surface without a texture.
      float plies = sin(6.2831853 * (vUV.x * 14.0 + vUV.y * 3.0));
      float fibers = sin(6.2831853 * (vUV.x * 53.0 - vUV.y * 7.0));
      float yarn = 0.99 + 0.012 * plies + 0.006 * fibers;
      vec3 shaded = vColor * ((0.65 - uStudio * 0.12) + (0.35 + uStudio * 0.16) * diffuse + 0.055 * fill) * yarn;
      shaded += vec3(1.0, 0.94, 0.83) * specular * 0.018;
      gl_FragColor = vec4(shaded, 1.0);
    }
  `;

  function compile(type, source) {
    const shader = gl.createShader(type);
    gl.shaderSource(shader, source);
    gl.compileShader(shader);
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
      const error = gl.getShaderInfoLog(shader);
      gl.deleteShader(shader);
      throw new Error(error || "WebGL shader compilation failed");
    }
    return shader;
  }

  function initGPU() {
    const vertex = compile(gl.VERTEX_SHADER, vertexSource);
    let fragment;
    try {
      fragment = compile(gl.FRAGMENT_SHADER, fragmentSource);
    } catch (error) {
      gl.deleteShader(vertex);
      throw error;
    }
    const nextProgram = gl.createProgram();
    gl.attachShader(nextProgram, vertex);
    gl.attachShader(nextProgram, fragment);
    gl.linkProgram(nextProgram);
    gl.deleteShader(vertex);
    gl.deleteShader(fragment);
    if (!gl.getProgramParameter(nextProgram, gl.LINK_STATUS)) {
      const error = gl.getProgramInfoLog(nextProgram);
      gl.deleteProgram(nextProgram);
      throw new Error(error || "WebGL shader linking failed");
    }
    program = nextProgram;
    locations = {};
    for (const name of [
      "aPosition",
      "aNormal",
      "aUV",
      "aOffset",
      "aColor",
      "aCourse",
    ]) {
      locations[name] = gl.getAttribLocation(program, name);
    }
    for (const name of [
      "uViewProjection",
      "uClothWidth",
      "uClothHeight",
      "uRowScale",
      "uShape",
      "uDrape",
      "uYarn",
      "uStudio",
      "uProgress",
      "uShowProgress",
      "uEye",
    ]) {
      locations[name] = gl.getUniformLocation(program, name);
    }
    instancing = gl.getExtension("ANGLE_instanced_arrays");
    gl.enable(gl.DEPTH_TEST);
    gl.depthFunc(gl.LEQUAL);
    gl.disable(gl.CULL_FACE);
    gl.clearColor(0, 0, 0, 0);
    quality = "";
    geometryKey = "";
    templates = new Map();
    batches = [];
  }

  function notifyStatus() {
    if (typeof CustomEvent !== "undefined" && canvas.dispatchEvent) {
      canvas.dispatchEvent(
        new CustomEvent("previewstatus", { detail: { ...metadata } }),
      );
    }
  }

  function fail(message) {
    metadata = { ...metadata, available: false, mode: "unavailable", message };
    notifyStatus();
  }

  try {
    initGPU();
  } catch (_) {
    fail(
      "3D 미리보기를 시작할 수 없어요. 브라우저의 하드웨어 가속 설정을 확인해 주세요",
    );
  }

  function normalise(v) {
    const length = Math.hypot(v[0], v[1], v[2]) || 1;
    return [v[0] / length, v[1] / length, v[2] / length];
  }
  function cross(a, b) {
    return [
      a[1] * b[2] - a[2] * b[1],
      a[2] * b[0] - a[0] * b[2],
      a[0] * b[1] - a[1] * b[0],
    ];
  }
  function dot(a, b) {
    return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  }
  function clamp(value, min, max) {
    return Math.min(max, Math.max(min, value));
  }

  function sampleCurve(points, subdivisions) {
    const output = [];
    for (let i = 0; i < points.length - 1; i++) {
      const a = points[Math.max(0, i - 1)];
      const b = points[i];
      const c = points[i + 1];
      const d = points[Math.min(points.length - 1, i + 2)];
      for (let j = 0; j < subdivisions; j++) {
        const t = j / subdivisions;
        const t2 = t * t;
        const t3 = t2 * t;
        output.push(
          [0, 1, 2].map(
            (k) =>
              0.5 *
              (2 * b[k] +
                (-a[k] + c[k]) * t +
                (2 * a[k] - 5 * b[k] + 4 * c[k] - d[k]) * t2 +
                (-a[k] + 3 * b[k] - 3 * c[k] + d[k]) * t3),
          ),
        );
      }
    }
    output.push(points[points.length - 1]);
    return output;
  }

  function appendTube(mesh, path, radius, sides, subdivisions) {
    const points = sampleCurve(path, subdivisions);
    const start = mesh.vertices.length / 8;
    let distance = 0;
    for (let i = 0; i < points.length; i++) {
      const p = points[i];
      const before = points[Math.max(0, i - 1)];
      const after = points[Math.min(points.length - 1, i + 1)];
      if (i > 0)
        distance += Math.hypot(
          ...p.map((value, k) => value - points[i - 1][k]),
        );
      const tangent = normalise(after.map((value, k) => value - before[k]));
      const reference = Math.abs(tangent[2]) > 0.92 ? [0, 1, 0] : [0, 0, 1];
      const normal = normalise(cross(tangent, reference));
      const binormal = normalise(cross(tangent, normal));
      // Duplicate the circumference seam for continuous texture coordinates.
      for (let j = 0; j <= sides; j++) {
        const angle = (TAU * j) / sides;
        const n = normal.map(
          (value, k) => value * Math.cos(angle) + binormal[k] * Math.sin(angle),
        );
        mesh.vertices.push(
          p[0] + n[0] * radius,
          p[1] + n[1] * radius,
          p[2] + n[2] * radius,
          n[0],
          n[1],
          n[2],
          distance,
          j / sides,
        );
      }
      if (i > 0) {
        for (let j = 0; j < sides; j++) {
          const a = start + (i - 1) * (sides + 1) + j;
          const b = a + sides + 1;
          mesh.indices.push(a, a + 1, b, a + 1, b + 1, b);
        }
      }
    }
  }

  function makeTemplate(symbol, highQuality) {
    const sides = highQuality ? 10 : 8;
    const subdivisions = highQuality ? 4 : 3;
    const mesh = { vertices: [], indices: [] };
    // Each course passes behind the following loop, around the head, and back.
    let path = [
      [-0.5, -0.4, -0.12],
      [-0.31, -0.36, -0.16],
      [-0.12, -0.12, 0.09],
      [-0.32, 0.39, 0.16],
      [-0.26, 0.57, 0.07],
      [0, 0.66, -0.1],
      [0.26, 0.57, 0.07],
      [0.32, 0.39, 0.16],
      [0.12, -0.12, 0.09],
      [0.31, -0.36, -0.16],
      [0.5, -0.4, -0.12],
    ];
    if (symbol === "yo") {
      path = [
        [-0.5, -0.4, -0.12],
        [-0.32, -0.36, -0.05],
        [-0.39, 0.1, 0.1],
        [-0.34, 0.48, 0.1],
        [0, 0.63, -0.02],
        [0.34, 0.48, 0.1],
        [0.39, 0.1, 0.1],
        [0.32, -0.36, -0.05],
        [0.5, -0.4, -0.12],
      ];
    } else if (symbol === "purl") {
      path = path.map(([x, y, z]) => [x, y, -z - 0.08]);
    } else if (symbol === "k2tog" || symbol === "ssk") {
      const direction = symbol === "k2tog" ? 1 : -1;
      path = path.map(([x, y, z]) => [x + direction * (y + 0.4) * 0.24, y, z]);
    }
    appendTube(mesh, path, symbol === "yo" ? 0.13 : 0.165, sides, subdivisions);
    if (symbol === "purl") {
      appendTube(
        mesh,
        [
          [-0.35, 0.09, 0.0],
          [-0.27, -0.005, 0.21],
          [0, -0.07, 0.26],
          [0.27, -0.005, 0.21],
          [0.35, 0.09, 0.0],
        ],
        0.165,
        sides,
        subdivisions,
      );
    }
    return {
      vertices: new Float32Array(mesh.vertices),
      indices: new Uint16Array(mesh.indices),
    };
  }

  function removeBuffers() {
    for (const batch of batches) {
      if (batch.vertexBuffer) gl.deleteBuffer(batch.vertexBuffer);
      if (batch.indexBuffer) gl.deleteBuffer(batch.indexBuffer);
    }
    batches = [];
    for (const mesh of templates.values()) {
      gl.deleteBuffer(mesh.vertexBuffer);
      gl.deleteBuffer(mesh.indexBuffer);
      gl.deleteBuffer(mesh.instanceBuffer);
    }
    templates.clear();
  }

  function prepareTemplates(highQuality) {
    const nextQuality = highQuality ? "high" : "compact";
    if (quality === nextQuality) return;
    removeBuffers();
    quality = nextQuality;
    for (const symbol of SYMBOLS) {
      const shape = makeTemplate(symbol, highQuality);
      const mesh = {
        ...shape,
        vertexBuffer: gl.createBuffer(),
        indexBuffer: gl.createBuffer(),
        instanceBuffer: gl.createBuffer(),
        instanceCount: 0,
      };
      gl.bindBuffer(gl.ARRAY_BUFFER, mesh.vertexBuffer);
      gl.bufferData(gl.ARRAY_BUFFER, shape.vertices, gl.STATIC_DRAW);
      gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, mesh.indexBuffer);
      gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, shape.indices, gl.STATIC_DRAW);
      templates.set(symbol, mesh);
    }
  }

  function parseColor(value) {
    if (typeof value !== "string") return [0.56, 0.64, 0.54];
    let hex = value.trim().replace(/^#/, "");
    if (/^[0-9a-f]{3}$/i.test(hex))
      hex = hex
        .split("")
        .map((c) => c + c)
        .join("");
    if (!/^[0-9a-f]{6}$/i.test(hex)) return [0.56, 0.64, 0.54];
    const n = parseInt(hex, 16);
    return [(n >> 16) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
  }

  function createFallbackBatches(groups) {
    for (const batch of batches) {
      gl.deleteBuffer(batch.vertexBuffer);
      gl.deleteBuffer(batch.indexBuffer);
    }
    batches = [];
    let vertices = [];
    let indices = [];
    const flush = () => {
      if (!indices.length) return;
      const vertexBuffer = gl.createBuffer();
      const indexBuffer = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, vertexBuffer);
      gl.bufferData(
        gl.ARRAY_BUFFER,
        new Float32Array(vertices),
        gl.STATIC_DRAW,
      );
      gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, indexBuffer);
      gl.bufferData(
        gl.ELEMENT_ARRAY_BUFFER,
        new Uint16Array(indices),
        gl.STATIC_DRAW,
      );
      batches.push({ vertexBuffer, indexBuffer, indexCount: indices.length });
      vertices = [];
      indices = [];
    };
    for (const symbol of SYMBOLS) {
      const mesh = templates.get(symbol);
      const data = groups[symbol];
      for (let i = 0; i < data.length; i += 5) {
        if (vertices.length / 12 + mesh.vertices.length / 8 > 64000) flush();
        const base = vertices.length / 12;
        for (let v = 0; v < mesh.vertices.length; v += 8) {
          vertices.push(
            mesh.vertices[v] + data[i],
            mesh.vertices[v + 1] + data[i + 1],
            mesh.vertices[v + 2],
            mesh.vertices[v + 3],
            mesh.vertices[v + 4],
            mesh.vertices[v + 5],
            mesh.vertices[v + 6],
            mesh.vertices[v + 7],
            data[i + 2],
            data[i + 3],
            data[i + 4],
            data[i + 1],
          );
        }
        for (const index of mesh.indices) indices.push(base + index);
      }
    }
    flush();
  }

  function update(chart) {
    if (disposed)
      return {
        ...metadata,
        available: false,
        message: "미리보기가 종료되었어요",
      };
    const totalCols = clamp(Math.floor(Number(chart?.cols) || 1), 1, 100000);
    const totalRows = clamp(Math.floor(Number(chart?.rows) || 1), 1, 100000);
    const cols = Math.min(LIMIT, totalCols);
    const rows = Math.min(LIMIT, totalRows);
    const startCol = Math.floor((totalCols - cols) / 2);
    const startRow = Math.floor((totalRows - rows) / 2);
    // Keep only this bounded preview for context restoration, not a large chart.
    const cells = [];
    for (let row = 0; row < rows; row++) {
      for (let col = 0; col < cols; col++) {
        const cell =
          chart?.cells?.[(row + startRow) * totalCols + col + startCol];
        cells.push({ color: cell?.color, symbol: cell?.symbol || "knit" });
      }
    }
    const positive = (value, fallback) =>
      Number.isFinite(Number(value)) && Number(value) > 0
        ? Number(value)
        : fallback;
    const gaugeSt = positive(chart?.gaugeSt, 20);
    const gaugeRows = positive(chart?.gaugeRows, 28);
    const requestedPitch = gaugeSt / gaugeRows;
    rowPitch = clamp(requestedPitch, 0.000001, 1000000);
    metadata.gaugeAspectAdjusted = requestedPitch !== rowPitch;
    metadata.rowPitch = rowPitch;
    currentRow = clamp(Number(chart?.currentRow) || 1, 1, totalRows);
    const completedRows =
      chart?.completed === true ? totalRows : currentRow - 1;
    progressY =
      ((rows - 1) / 2 - (totalRows - completedRows - startRow)) * rowPitch -
      (0.12 * rowPitch) / 0.72 +
      rowPitch * 0.5;
    chartSnapshot = {
      cols,
      rows,
      cells,
      gaugeSt,
      gaugeRows,
      currentRow: currentRow - (totalRows - rows - startRow),
      completed: chart?.completed === true,
    };
    const nextKey = JSON.stringify([cols, rows, rowPitch, cells]);
    if (geometryKey === nextKey && !contextLost && metadata.available) {
      metadata = {
        ...metadata,
        totalCols,
        totalRows,
        startCol,
        startRow,
        cropped: totalCols > LIMIT || totalRows > LIMIT,
      };
      invalidate();
      return { ...metadata };
    }
    const oldDimensions = `${metadata.cols},${metadata.rows}`;
    metadata = {
      ...metadata,
      cols,
      rows,
      totalCols,
      totalRows,
      startCol,
      startRow,
      cropped: totalCols > LIMIT || totalRows > LIMIT,
      stitchCount: 0,
      triangleCount: 0,
    };
    if (contextLost || !program || !metadata.available) return { ...metadata };
    const groups = Object.fromEntries(SYMBOLS.map((symbol) => [symbol, []]));
    const colorCache = new Map();
    prepareTemplates(cols * rows <= 1200);
    clothWidth = Math.max(1, cols);
    clothHeight = Math.max(1, rows * rowPitch + 0.35);
    geometryKey = nextKey;
    for (let row = 0; row < rows; row++) {
      for (let col = 0; col < cols; col++) {
        const cell = cells[row * cols + col];
        if (cell.symbol === "none") continue;
        const symbol = SYMBOLS.includes(cell.symbol) ? cell.symbol : "knit";
        if (!colorCache.has(cell.color))
          colorCache.set(cell.color, parseColor(cell.color));
        groups[symbol].push(
          col - (cols - 1) / 2,
          ((rows - 1) / 2 - row) * 0.72 - 0.12,
          ...colorCache.get(cell.color),
        );
        metadata.stitchCount++;
      }
    }
    for (const symbol of SYMBOLS) {
      const mesh = templates.get(symbol);
      mesh.instanceCount = groups[symbol].length / 5;
      metadata.triangleCount += (mesh.instanceCount * mesh.indices.length) / 3;
      if (instancing) {
        gl.bindBuffer(gl.ARRAY_BUFFER, mesh.instanceBuffer);
        gl.bufferData(
          gl.ARRAY_BUFFER,
          new Float32Array(groups[symbol]),
          gl.DYNAMIC_DRAW,
        );
      }
    }
    if (!instancing) createFallbackBatches(groups);
    if (oldDimensions !== `${cols},${rows}`) zoom = 1;
    metadata.message = metadata.cropped
      ? `가운데 ${cols}코 × ${rows}단 미리보기 (전체 ${totalCols}코 × ${totalRows}단)`
      : `${cols}코 × ${rows}단 · 실제 3D 실 고리`;
    invalidate();
    return { ...metadata };
  }

  function multiply(a, b) {
    const out = new Float32Array(16);
    for (let col = 0; col < 4; col++) {
      for (let row = 0; row < 4; row++) {
        out[col * 4 + row] =
          a[row] * b[col * 4] +
          a[4 + row] * b[col * 4 + 1] +
          a[8 + row] * b[col * 4 + 2] +
          a[12 + row] * b[col * 4 + 3];
      }
    }
    return out;
  }

  function camera(aspect) {
    const fov = Math.PI / 5.7;
    const fittedDistance =
      (Math.max(
        clothHeight,
        (options.shape === "swatch" ? clothWidth : clothWidth / Math.PI + 0.8) /
          aspect,
      ) /
        (2 * Math.tan(fov / 2))) *
        1.18 +
      1;
    const distance = Math.max(1.4, fittedDistance / zoom);
    const eye = [
      distance * Math.sin(yaw) * Math.cos(pitch),
      distance * Math.sin(pitch),
      distance * Math.cos(yaw) * Math.cos(pitch),
    ];
    const z = normalise(eye);
    const x = normalise(cross([0, 1, 0], z));
    const y = cross(z, x);
    const view = new Float32Array([
      x[0],
      y[0],
      z[0],
      0,
      x[1],
      y[1],
      z[1],
      0,
      x[2],
      y[2],
      z[2],
      0,
      -dot(x, eye),
      -dot(y, eye),
      -dot(z, eye),
      1,
    ]);
    const near = 0.05;
    const far = distance + Math.max(clothWidth, clothHeight) * 3 + 100;
    const f = 1 / Math.tan(fov / 2);
    const projection = new Float32Array([
      f / aspect,
      0,
      0,
      0,
      0,
      f,
      0,
      0,
      0,
      0,
      (far + near) / (near - far),
      -1,
      0,
      0,
      (2 * far * near) / (near - far),
      0,
    ]);
    return { matrix: multiply(projection, view), eye };
  }

  function bindAttribute(name, size, stride, offset) {
    const location = locations[name];
    gl.enableVertexAttribArray(location);
    gl.vertexAttribPointer(location, size, gl.FLOAT, false, stride, offset);
  }

  function measure() {
    const bounds = canvas.getBoundingClientRect();
    const dpr = Math.min(2, globalThis.devicePixelRatio || 1);
    const width = Math.max(
      1,
      Math.round((bounds.width || canvas.clientWidth || 400) * dpr),
    );
    const height = Math.max(
      1,
      Math.round((bounds.height || canvas.clientHeight || 320) * dpr),
    );
    if (width !== pixelWidth || height !== pixelHeight) {
      pixelWidth = width;
      pixelHeight = height;
      canvas.width = width;
      canvas.height = height;
    }
  }

  function render(time = 0) {
    frame = 0;
    if (
      active &&
      !globalThis.document?.hidden &&
      options.autoRotate &&
      !motionPreference?.matches &&
      !pointers.size
    ) {
      if (lastTime) yaw += Math.min(50, time - lastTime) * 0.00022;
      lastTime = time;
    } else lastTime = 0;
    if (disposed || contextLost || !program || !metadata.available) return;
    measure();
    gl.viewport(0, 0, pixelWidth, pixelHeight);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    if (!metadata.stitchCount) return;
    const { matrix, eye } = camera(pixelWidth / pixelHeight);
    gl.useProgram(program);
    gl.uniformMatrix4fv(locations.uViewProjection, false, matrix);
    gl.uniform1f(locations.uClothWidth, clothWidth);
    gl.uniform1f(locations.uClothHeight, clothHeight);
    gl.uniform1f(locations.uRowScale, rowPitch / 0.72);
    gl.uniform1f(
      locations.uShape,
      { swatch: 0, tube: 1, beanie: 2 }[options.shape],
    );
    gl.uniform1f(locations.uDrape, options.drape);
    gl.uniform1f(
      locations.uYarn,
      { fine: -0.045, medium: 0, chunky: 0.04 }[options.yarn],
    );
    gl.uniform1f(locations.uStudio, options.lighting === "studio" ? 1 : 0);
    gl.uniform1f(locations.uProgress, progressY);
    gl.uniform1f(locations.uShowProgress, options.showProgress ? 1 : 0);
    gl.uniform3fv(locations.uEye, eye);
    if (instancing) {
      for (const mesh of templates.values()) {
        if (!mesh.instanceCount) continue;
        gl.bindBuffer(gl.ARRAY_BUFFER, mesh.vertexBuffer);
        bindAttribute("aPosition", 3, 32, 0);
        bindAttribute("aNormal", 3, 32, 12);
        bindAttribute("aUV", 2, 32, 24);
        gl.bindBuffer(gl.ARRAY_BUFFER, mesh.instanceBuffer);
        bindAttribute("aOffset", 2, 20, 0);
        bindAttribute("aColor", 3, 20, 8);
        bindAttribute("aCourse", 1, 20, 4);
        instancing.vertexAttribDivisorANGLE(locations.aCourse, 1);
        instancing.vertexAttribDivisorANGLE(locations.aOffset, 1);
        instancing.vertexAttribDivisorANGLE(locations.aColor, 1);
        gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, mesh.indexBuffer);
        instancing.drawElementsInstancedANGLE(
          gl.TRIANGLES,
          mesh.indices.length,
          gl.UNSIGNED_SHORT,
          0,
          mesh.instanceCount,
        );
        instancing.vertexAttribDivisorANGLE(locations.aCourse, 0);
        instancing.vertexAttribDivisorANGLE(locations.aOffset, 0);
        instancing.vertexAttribDivisorANGLE(locations.aColor, 0);
      }
    } else {
      gl.disableVertexAttribArray(locations.aOffset);
      gl.vertexAttrib2f(locations.aOffset, 0, 0);
      for (const batch of batches) {
        gl.bindBuffer(gl.ARRAY_BUFFER, batch.vertexBuffer);
        bindAttribute("aPosition", 3, 48, 0);
        bindAttribute("aNormal", 3, 48, 12);
        bindAttribute("aUV", 2, 48, 24);
        bindAttribute("aColor", 3, 48, 32);
        bindAttribute("aCourse", 1, 48, 44);
        gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, batch.indexBuffer);
        gl.drawElements(gl.TRIANGLES, batch.indexCount, gl.UNSIGNED_SHORT, 0);
      }
    }
    if (
      active &&
      !globalThis.document?.hidden &&
      options.autoRotate &&
      !motionPreference?.matches
    )
      invalidate();
  }

  function setOptions(next = {}) {
    for (const [key, allowed] of Object.entries({
      shape: ["swatch", "tube", "beanie"],
      yarn: ["fine", "medium", "chunky"],
      lighting: ["soft", "studio"],
    })) {
      if (allowed.includes(next[key])) options[key] = next[key];
    }
    if (Number.isFinite(next.drape)) options.drape = clamp(next.drape, 0, 1);
    for (const key of ["showProgress", "autoRotate"])
      if (typeof next[key] === "boolean") options[key] = next[key];
    lastTime = 0;
    invalidate();
    return { ...options };
  }
  function setView(view) {
    if (!["front", "back", "angled"].includes(view)) return;
    yaw = view === "back" ? Math.PI : view === "front" ? 0 : -0.48;
    pitch = view === "angled" ? 0.18 : 0;
    invalidate();
  }
  function zoomBy(factor) {
    if (Number.isFinite(factor) && factor > 0)
      zoom = clamp(zoom * factor, 0.5, 6);
    invalidate();
  }
  function capture() {
    if (disposed || contextLost || !metadata.available) return null;
    if (frame) cancelAnimationFrame(frame);
    render();
    try {
      return canvas.toDataURL("image/png");
    } catch (_) {
      return null;
    }
  }
  function setActive(value) {
    active = !!value;
    lastTime = 0;
    if (!active && frame) {
      cancelAnimationFrame(frame);
      frame = 0;
    }
    if (active) invalidate();
  }
  const visibilityChanged = () => {
    lastTime = 0;
    if (globalThis.document?.hidden && frame) {
      cancelAnimationFrame(frame);
      frame = 0;
    } else if (active) invalidate();
  };
  globalThis.document?.addEventListener?.(
    "visibilitychange",
    visibilityChanged,
  );
  function invalidate() {
    if (
      active &&
      !globalThis.document?.hidden &&
      !frame &&
      !disposed &&
      !contextLost
    )
      frame = requestAnimationFrame(render);
  }
  function resize() {
    invalidate();
  }
  const motionChanged = () => invalidate();
  motionPreference?.addEventListener?.("change", motionChanged);
  function reset() {
    yaw = -0.13;
    pitch = 0.08;
    zoom = 1;
    invalidate();
  }
  function on(type, listener, options) {
    canvas.addEventListener(type, listener, options);
    listeners.push([type, listener, options]);
  }
  function pinchLength() {
    const pair = [...pointers.values()];
    return pair.length >= 2
      ? Math.hypot(pair[0].x - pair[1].x, pair[0].y - pair[1].y)
      : 0;
  }
  on("pointerdown", (event) => {
    if (event.button !== 0 && event.pointerType !== "touch") return;
    pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
    try {
      canvas.setPointerCapture(event.pointerId);
    } catch (_) {}
    canvas.style.cursor = "grabbing";
    pinchDistance = pinchLength();
    event.preventDefault();
  });
  on("pointermove", (event) => {
    const previous = pointers.get(event.pointerId);
    if (!previous) return;
    pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
    if (pointers.size >= 2) {
      const next = pinchLength();
      if (pinchDistance > 0)
        zoom = clamp((zoom * next) / pinchDistance, 0.5, 6);
      pinchDistance = next;
    } else {
      yaw += (event.clientX - previous.x) * 0.008;
      pitch = clamp(pitch + (event.clientY - previous.y) * 0.006, -1.2, 1.2);
    }
    invalidate();
    event.preventDefault();
  });
  const endPointer = (event) => {
    pointers.delete(event.pointerId);
    pinchDistance = pinchLength();
    if (!pointers.size) canvas.style.cursor = "grab";
  };
  on("pointerup", endPointer);
  on("pointercancel", endPointer);
  on("lostpointercapture", endPointer);
  on(
    "wheel",
    (event) => {
      const unit =
        event.deltaMode === 1
          ? 16
          : event.deltaMode === 2
            ? canvas.clientHeight
            : 1;
      zoom = clamp(
        zoom * Math.exp(-clamp(event.deltaY * unit, -300, 300) * 0.0015),
        0.5,
        6,
      );
      invalidate();
      event.preventDefault();
    },
    { passive: false },
  );
  on("dblclick", reset);
  on("keydown", (event) => {
    if (event.key === "ArrowLeft") yaw -= 0.12;
    else if (event.key === "ArrowRight") yaw += 0.12;
    else if (event.key === "ArrowUp") pitch = clamp(pitch - 0.12, -1.2, 1.2);
    else if (event.key === "ArrowDown") pitch = clamp(pitch + 0.12, -1.2, 1.2);
    else if (event.key === "+" || event.key === "=")
      zoom = clamp(zoom * 1.15, 0.5, 6);
    else if (event.key === "-" || event.key === "_")
      zoom = clamp(zoom / 1.15, 0.5, 6);
    else if (event.key === "Home" || event.key === "0") reset();
    else return;
    event.preventDefault();
    invalidate();
  });
  on("webglcontextlost", (event) => {
    event.preventDefault();
    contextLost = true;
    if (frame) cancelAnimationFrame(frame);
    frame = 0;
    fail("3D 연결이 잠시 끊겼어요. 복구되면 자동으로 다시 표시돼요");
  });
  on("webglcontextrestored", () => {
    contextLost = false;
    try {
      initGPU();
      metadata.available = true;
      metadata.mode = "webgl";
      // Restore GPU resources without losing the original crop metadata.
      const original = { ...metadata };
      const savedProgress = progressY;
      if (chartSnapshot) update(chartSnapshot);
      progressY = savedProgress;
      metadata = {
        ...metadata,
        totalCols: original.totalCols,
        totalRows: original.totalRows,
        startCol: original.startCol,
        startRow: original.startRow,
        cropped: original.cropped,
        message: original.cropped
          ? `가운데 ${original.cols}코 × ${original.rows}단 미리보기 (전체 ${original.totalCols}코 × ${original.totalRows}단)`
          : `${original.cols}코 × ${original.rows}단 · 실제 3D 실 고리`,
      };
      notifyStatus();
      invalidate();
    } catch (_) {
      fail("3D 미리보기를 복구할 수 없어요. 페이지를 새로 열어 주세요");
    }
  });
  let resizeObserver;
  if (typeof ResizeObserver !== "undefined") {
    resizeObserver = new ResizeObserver(resize);
    resizeObserver.observe(canvas);
  }
  const windowResize = () => resize();
  globalThis.addEventListener?.("resize", windowResize);

  function destroy() {
    if (disposed) return;
    disposed = true;
    if (frame) cancelAnimationFrame(frame);
    resizeObserver?.disconnect();
    globalThis.document?.removeEventListener?.(
      "visibilitychange",
      visibilityChanged,
    );
    motionPreference?.removeEventListener?.("change", motionChanged);
    globalThis.removeEventListener?.("resize", windowResize);
    for (const [type, listener, options] of listeners)
      canvas.removeEventListener(type, listener, options);
    pointers.clear();
    if (!contextLost) {
      removeBuffers();
      if (program) gl.deleteProgram(program);
    }
    canvas.style.touchAction = originalTouchAction;
    canvas.style.cursor = originalCursor;
    if (originalTabIndex === null) canvas.removeAttribute("tabindex");
    if (ownLabel) canvas.removeAttribute("aria-label");
    chartSnapshot = null;
    metadata = { ...metadata, available: false, mode: "destroyed" };
  }

  return {
    get available() {
      return metadata.available && !disposed;
    },
    get metadata() {
      return { ...metadata };
    },
    update,
    resize,
    reset,
    destroy,
    setOptions,
    setActive,
    setView,
    zoomBy,
    capture,
  };
}
