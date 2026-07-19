// Harness parity Phase 1: dump baseline điểm cắt band từ engine TS (content-extractor/lib)
// trên corpus thật. CHỈ ĐỌC content-extractor — không sửa gì trong đó.
//
// Chạy (bắt buộc Node 24 — nvm use 24):
//   cd content-extractor && node_modules/.bin/tsx ../tools/parity-port/dump-cuts.ts
//
// Tái tạo ĐÚNG pipeline production ingestBandItems (pipeline.ts:102-133):
//   extractImages (natural sort) → downscale(maxEdge=1568) TRƯỚC stitch → stitchSlices
//   → toGray → computeSafeRuns → chooseCuts → regionsFromCuts → mergeLowInkBands
// và gọi thêm chính ingestBandItems để đối chứng band cuối (chứng minh chain thay thế
// tương đương). Dump cả artifacts trung gian (downscaled JPEG, canvas PNG) để Phase 3
// so parity thuật toán trên CÙNG bytes, loại biến JPEG encode giữa sharp và PIL.

import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';

// ---- Fail sớm nếu Node < 24 (NAPI của sharp/tsx cần Node 24 theo setup repo) ----
const major = Number(process.version.slice(1).split('.')[0]);
if (major < 24) {
  console.error(`Node ${process.version} < 24 — chạy 'nvm use 24' trước.`);
  process.exit(1);
}

// ---- Pin settings TƯỜNG MINH trước khi import lib (đè mọi env rò từ shell/.env) ----
const PINNED = {
  LINE_TOLERANCE: '25',
  IGNORABLE_BORDER: '5',
  MIN_GUTTER_HEIGHT: '24',
  SPLIT_HEIGHT: '1600',
  MIN_BAND_HEIGHT: '960', // 0.6 × 1600
  MAX_BAND_HEIGHT: '2240', // 1.4 × 1600
  MIN_INK_DENSITY: '0.02',
  STRIP_RATIO: '2.5',
  MAX_EDGE: '1568',
} as const;
for (const [k, v] of Object.entries(PINNED)) process.env[k] = v;

const MAX_EDGE = 1568;

const { extractImages, downscale, ingestBandItems } = await import(
  '../../content-extractor/lib/pipeline'
);
const { stitchSlices } = await import('../../content-extractor/lib/stitch');
const {
  readSplitSettings,
  toGray,
  computeSafeRuns,
  chooseCuts,
  regionsFromCuts,
  mergeLowInkBands,
} = await import('../../content-extractor/lib/smart-split');

const CORPUS_DIR =
  process.env.CORPUS_DIR ??
  path.join(
    process.env.HOME ?? '~',
    'Downloads',
    'Vừa Gả Đã Làm Mẹ Kế Của Ba Nhóc Con Chap 1.1 Next Chap 2.1 - NetTruyen',
  );
const OUT_DIR = path.join(import.meta.dirname, 'baseline');
const DOWNSCALED_DIR = path.join(OUT_DIR, 'downscaled');

fs.mkdirSync(DOWNSCALED_DIR, { recursive: true });

// ---- 1. Đọc corpus + natural sort qua extractImages (pipeline.ts:57-68) ----
const rawFiles = fs.readdirSync(CORPUS_DIR).filter((f) => !f.startsWith('.'));
const images = extractImages({
  images: rawFiles.map((filename) => ({
    filename,
    buffer: fs.readFileSync(path.join(CORPUS_DIR, filename)),
  })),
});
console.log(`Corpus: ${images.length} ảnh (sau filter + natural sort)`);

// ---- 2. Downscale TRƯỚC stitch (pipeline.ts:102-116), tuần tự để deterministic ----
// sharp resolve từ node_modules của content-extractor (repo root không có node_modules)
const requireCE = createRequire(
  path.join(import.meta.dirname, '..', '..', 'content-extractor', 'package.json'),
);
const sharp = requireCE('sharp') as typeof import('sharp');
const downscaled: Buffer[] = [];
const downscaledMeta: { file: string; src: string; w: number; h: number }[] = [];
for (let i = 0; i < images.length; i++) {
  const buf = await downscale(images[i].buffer, MAX_EDGE);
  const name = `${String(i).padStart(3, '0')}.jpg`;
  fs.writeFileSync(path.join(DOWNSCALED_DIR, name), buf);
  const m = await sharp(buf).metadata();
  downscaled.push(buf);
  downscaledMeta.push({ file: name, src: images[i].filename, w: m.width!, h: m.height! });
}

// ---- 3. Stitch → canvas PNG ----
const canvas = await stitchSlices(downscaled);
fs.writeFileSync(path.join(OUT_DIR, 'stitched.png'), canvas.buffer);
console.log(`Stitched: ${canvas.width}×${canvas.height}`);

// ---- 4. Split từng bước, dump trung gian (cùng composition với splitGray) ----
const settings = readSplitSettings();
const gray = await toGray(canvas.buffer);
const runs = computeSafeRuns(gray, settings);
const cuts = chooseCuts(runs, gray.height, settings);
const preMerge = regionsFromCuts(cuts, gray.width, gray.height);
const regions = mergeLowInkBands(preMerge, gray, settings);

// Mật độ mực từng band CUỐI (cùng công thức regionInkDensity: gray < 250)
const inkDensityPerBand = regions.map((r) => {
  let ink = 0;
  for (let y = r.y; y < r.y + r.h; y++) {
    const row = y * gray.width;
    for (let x = r.x; x < r.x + r.w; x++) {
      if (gray.data[row + x] < 250) ink++;
    }
  }
  return Math.round((ink / (r.w * r.h)) * 1e6) / 1e6;
});

// ---- 5. Đối chứng với ingestBandItems thật (ground truth production) ----
const bandItems = await ingestBandItems(images, MAX_EDGE);
const bandMatch =
  bandItems.length === regions.length &&
  bandItems.every((b, i) => b.width === regions[i].w && b.height === regions[i].h);
if (!bandMatch) {
  console.error('MISMATCH: chain harness ≠ ingestBandItems — harness sai, dừng.');
  console.error(
    JSON.stringify({
      harness: regions.map((r) => [r.w, r.h]),
      ingest: bandItems.map((b) => [b.width, b.height]),
    }),
  );
  process.exit(1);
}

// ---- 6. Ghi baseline-cuts.json ----
const gutters = runs
  .filter((r) => r.end - r.start >= settings.minGutterHeight)
  .map((r) => ({ center: Math.floor((r.start + r.end) / 2), thickness: r.end - r.start }));

const baseline = {
  generated_by: 'tools/parity-port/dump-cuts.ts',
  node_version: process.version,
  settings: { ...settings, maxEdge: MAX_EDGE, stripRatio: 2.5 },
  source: { dir: CORPUS_DIR, files: images.map((i) => i.filename) },
  downscaled: downscaledMeta,
  stitched: {
    width: canvas.width,
    height: canvas.height,
    sha256: createHash('sha256').update(canvas.buffer).digest('hex'),
  },
  safe_runs: runs.map((r) => [r.start, r.end]),
  gutters,
  cuts_raw: cuts,
  regions_pre_merge: preMerge.map((r) => ({ x: r.x, y: r.y, w: r.w, h: r.h })),
  regions: regions.map((r) => ({ x: r.x, y: r.y, w: r.w, h: r.h })),
  ink_density_per_band: inkDensityPerBand,
  band_items_check: 'PASS — khớp ingestBandItems',
};
fs.writeFileSync(path.join(OUT_DIR, 'baseline-cuts.json'), JSON.stringify(baseline, null, 2));

console.log(
  `OK: ${regions.length} band | ${cuts.length} cut raw | ${runs.length} safe-run | ${gutters.length} gutter`,
);
console.log(`Cuts: ${cuts.join(', ')}`);
console.log(`baseline-cuts.json + stitched.png + downscaled/ đã ghi vào ${OUT_DIR}`);
