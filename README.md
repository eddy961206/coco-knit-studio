# 코코 스튜디오

A dependency-free, Korean knitting chart editor with a real WebGL yarn-mesh preview.

## Run
Serve `dist/` using a static HTTP server. No install or build is needed.

## Data
Chart data is only saved to browser localStorage under `coco.knit.chart.v1`. JSON backup/import preserves colors, stitch symbols, dimensions, gauge settings, row progress and completion. Import accepts only bounded, validated chart data (120 columns × 160 rows maximum; 4MB import maximum). No account data, analytics, remote fonts or third-party scripts are sent by the app.

## Features
Drag painting with one undo step per stroke, erase, flood fill, rectangular selection, copy/paste, mirror with decrease-slant swap, bounded horizontal repetition, zoom, gauge-shaped grid, flat/round reading directions, row tracker, original rabbit and heart samples. SVG/PNG and print exports contain row numbering, colors and stitch legends. The chart is always viewed from the right side and numbered from the bottom.

The 3D preview uses lit tube meshes with orbit and pinch/wheel zoom, per-cell colors, and differentiated approximate stitch appearances. It is not a physical knitting simulation. Increases/decreases are visual representations, not real topology changes; gauge and tension cannot predict the finished object. Large charts show a centered 60×60 preview. WebGL-unavailable browsers retain the working chart editor and explicit fallback notice.

## Testing
`node tests/model.test.mjs`
Syntax checks pass for every JavaScript module. The model tests cover sample integrity, dimensions, malformed imports, resize anchoring, max-size fill, isolated fill, mirror slants and SVG escaping.
The 3D component additionally received geometry and lifecycle tests with mock WebGL. Actual browser rendering and real device touch tests could not run in the task environment because Chromium launch was denied by socket restrictions. No visual/browser QA claim is made.

## Design
The implementation follows an original generated design reference: ivory work surface, forest-green controls, rose/sage yarns, restrained three-rail editor, row tracker, and uncluttered mobile tool drawer. The later requested 3D mode is a deliberate extension of this design. Native-sized screenshot comparison remains unverified because of the browser limitation.
