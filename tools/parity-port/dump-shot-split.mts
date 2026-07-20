// Harness parity: in region các mảnh mà shot-split.ts cắt ra từ slice corpus THẬT.
// So byte-identical với shot_split.py (compare_shot_split.py).
// Chạy: cd content-extractor && npx tsx ../tools/parity-port/dump-shot-split.mts
//
// Slice corpus lấy từ workdir skill — cùng bytes cho cả hai phía, loại biến giải mã ảnh.

import fs from 'node:fs';
import path from 'node:path';
import { toGray } from '../../content-extractor/lib/smart-split';
import { readShotSplitSettings, splitShot } from '../../content-extractor/lib/shot-split';
import type { Shot } from '../../content-extractor/lib/schema';

const SLICES =
  process.env.SHOT_SPLIT_CORPUS ??
  '/Users/jhin1m/Downloads/Standard of Reincarnation/.mtv/workdirs/' +
    'Read Standard of Reincarnation Chapter 1 Online - ToonGod/slices';

// Pin tường minh để env rò từ shell/.env không đổi kết quả giữa hai phía.
process.env.SHOT_MAX_HEIGHT = process.env.SHOT_MAX_HEIGHT ?? '1100';
const settings = readShotSplitSettings();

const files = fs
  .readdirSync(SLICES)
  .filter((f) => f.endsWith('.png'))
  .sort();

for (const f of files) {
  const img = await toGray(fs.readFileSync(path.join(SLICES, f)));
  const shot: Shot = { sourceIndex: 0, region: null, weight: 1 };
  const parts = splitShot(shot, img, settings);
  const cells = parts.map(
    (p) =>
      `${p.region ? `${p.region.x},${p.region.y},${p.region.w},${p.region.h}` : 'null'}` +
      `@${p.weight.toFixed(6)}`,
  );
  console.log(`${f} ${cells.join(' ')}`);
}
