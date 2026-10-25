// Harness parity Phase 5: in chuỗi filtergraph kenburns() TS cho ma trận config cố định.
// So byte-identical với kenburns.py (compare_filters.py). Chạy:
//   cd content-extractor && npx tsx ../tools/parity-port/dump-filters.mts

import { kenburns } from '../../content-extractor/lib/kenburns';
import type { KenburnsInput } from '../../content-extractor/lib/kenburns';

const CASES: Array<[string, KenburnsInput]> = [
  ['pan-v tall 9:16', { imgW: 720, imgH: 2100, region: null, aspect: '9:16', durationSec: 4.567, fps: 30, zoom: 1.12 }],
  ['zoom blur tall 16:9', { imgW: 720, imgH: 2100, region: null, aspect: '16:9', durationSec: 4.567, fps: 30, zoom: 1.12 }],
  ['zoom square 1:1', { imgW: 720, imgH: 720, region: null, aspect: '1:1', durationSec: 3.0, fps: 30, zoom: 1.12 }],
  ['zoom blur nearsq 9:16', { imgW: 720, imgH: 800, region: null, aspect: '9:16', durationSec: 2.5, fps: 30, zoom: 1.12 }],
  ['pan-h wide 16:9', { imgW: 2000, imgH: 700, region: null, aspect: '16:9', durationSec: 5.123, fps: 30, zoom: 1.12 }],
  ['static forced blur', { imgW: 720, imgH: 800, region: null, aspect: '16:9', durationSec: 2, fps: 30, zoom: 1.12, motion: { mode: 'static' } }],
  ['zoom forced reverse', { imgW: 720, imgH: 720, region: null, aspect: '1:1', durationSec: 3.25, fps: 30, zoom: 1.12, motion: { mode: 'zoom', reverse: true } }],
  ['pan-v forced reverse', { imgW: 720, imgH: 2100, region: null, aspect: '9:16', durationSec: 4.0, fps: 30, zoom: 1.12, motion: { mode: 'pan-v', reverse: true } }],
  ['dur clamp 0.05', { imgW: 720, imgH: 720, region: null, aspect: '1:1', durationSec: 0.05, fps: 30, zoom: 1.12 }],
  ['region crop pan-v', { imgW: 720, imgH: 3000, region: { x: 10, y: 200, w: 700, h: 2500 }, aspect: '9:16', durationSec: 6.789, fps: 30, zoom: 1.12 }],
  // Slice manhwa thật trong khung ngang: trung vị + cực đoan của corpus 720px.
  ['tall median 16:9', { imgW: 720, imgH: 1418, region: null, aspect: '16:9', durationSec: 2.5, fps: 30, zoom: 1.12 }],
  ['tall extreme 16:9', { imgW: 720, imgH: 2240, region: null, aspect: '16:9', durationSec: 2.82, fps: 30, zoom: 1.12 }],
  // fill 'cover' (full màn hình, không blur): static + zoom lệch tỉ lệ, static vừa khít, pan giữ nguyên.
  ['static cover wide 9:16', { imgW: 720, imgH: 800, region: null, aspect: '9:16', durationSec: 2, fps: 30, zoom: 1.12, motion: { mode: 'static' }, fill: 'cover' }],
  ['static cover tall 9:16', { imgW: 720, imgH: 1600, region: { x: 0, y: 100, w: 720, h: 1500 }, aspect: '9:16', durationSec: 2, fps: 30, zoom: 1.12, motion: { mode: 'static' }, fill: 'cover' }],
  ['static cover exact 9:16', { imgW: 720, imgH: 1280, region: null, aspect: '9:16', durationSec: 2, fps: 30, zoom: 1.12, motion: { mode: 'static' }, fill: 'cover' }],
  ['zoom cover nearsq 9:16', { imgW: 720, imgH: 800, region: null, aspect: '9:16', durationSec: 2.5, fps: 30, zoom: 1.12, fill: 'cover' }],
  ['pan-v cover 9:16', { imgW: 720, imgH: 2100, region: null, aspect: '9:16', durationSec: 4.567, fps: 30, zoom: 1.12, fill: 'cover' }],
];

for (const [label, input] of CASES) {
  console.log(`### ${label}`);
  console.log(kenburns(input));
}
