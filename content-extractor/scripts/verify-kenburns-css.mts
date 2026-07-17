// Test thuần lib/kenburns-css.ts: 3 nhánh style (pan-v/pan-h/zoom) tại p=0/0.5/1 phải
// khớp đúng biểu thức CSS gốc của trang video (trước khi rút helper), nhãn mode và
// ASPECT_CSS đúng map. Không cần ffmpeg/mock — chạy tức thời.
import {
  ASPECT_CSS,
  kenburnsFrameFromInput,
  kenburnsFrameStyle,
  kenburnsModeLabel,
} from '../lib/kenburns-css';
import { planKenburns, type KenburnsInput } from '../lib/kenburns';

let failures = 0;
const eq = (a: unknown, e: unknown, label: string) => {
  if (JSON.stringify(a) === JSON.stringify(e)) console.log(`  ✓ ${label}`);
  else {
    failures++;
    console.error(
      `  ✗ ${label}\n    expected: ${JSON.stringify(e)}\n    actual:   ${JSON.stringify(a)}`,
    );
  }
};

console.log('verify-kenburns-css: ASPECT_CSS');
eq(ASPECT_CSS['9:16'], '9 / 16', 'aspect 9:16');
eq(ASPECT_CSS['16:9'], '16 / 9', 'aspect 16:9');
eq(ASPECT_CSS['1:1'], '1 / 1', 'aspect 1:1');

console.log('verify-kenburns-css: kenburnsFrameStyle pan-v (biểu thức gốc trang video)');
const panV = { mode: 'pan-v' as const, blurFill: false, travelPx: 500, basePx: 0 };
eq(kenburnsFrameStyle(panV, 0, 1.12), {
  fgStyle: { width: '100%', height: 'auto' },
  imgTransformStyle: { transform: 'translateY(calc((100cqh - 100%) * 0.0000))' },
}, 'pan-v p=0');
eq(
  kenburnsFrameStyle(panV, 0.5, 1.12).imgTransformStyle.transform,
  'translateY(calc((100cqh - 100%) * 0.5000))',
  'pan-v p=0.5',
);
eq(
  kenburnsFrameStyle(panV, 1, 1.12).imgTransformStyle.transform,
  'translateY(calc((100cqh - 100%) * 1.0000))',
  'pan-v p=1',
);

console.log('verify-kenburns-css: kenburnsFrameStyle pan-h');
const panH = { mode: 'pan-h' as const, blurFill: false, travelPx: 500, basePx: 0 };
eq(kenburnsFrameStyle(panH, 0.5, 1.12), {
  fgStyle: { height: '100%', width: 'auto', maxWidth: 'none' },
  imgTransformStyle: { transform: 'translateX(calc((100cqw - 100%) * 0.5000))' },
}, 'pan-h p=0.5');

console.log('verify-kenburns-css: kenburnsFrameStyle zoom');
const zoomPlan = { mode: 'zoom' as const, blurFill: false };
eq(kenburnsFrameStyle(zoomPlan, 0, 1.12), {
  fgStyle: { width: '100%', height: '100%', objectFit: 'contain' },
  imgTransformStyle: { transform: 'scale(1.0000)' },
}, 'zoom p=0 → scale 1');
eq(
  kenburnsFrameStyle(zoomPlan, 1, 1.12).imgTransformStyle.transform,
  'scale(1.1200)',
  'zoom p=1 → scale = zoom đích',
);
eq(
  kenburnsFrameStyle(zoomPlan, 1, 0.8).imgTransformStyle.transform,
  'scale(1.0000)',
  'zoom < 1 kẹp về 1 (tĩnh)',
);

console.log('verify-kenburns-css: kenburnsFrameFromInput = planKenburns + frameStyle');
const tallInput: KenburnsInput = {
  imgW: 1000, imgH: 3000, region: null, aspect: '9:16', durationSec: 4, fps: 30, zoom: 1.12,
};
eq(planKenburns(tallInput).mode, 'pan-v', 'band cao → plan pan-v');
eq(
  kenburnsFrameFromInput(tallInput, 0.25),
  kenburnsFrameStyle(planKenburns(tallInput), 0.25, tallInput.zoom),
  'from-input khớp plan + style',
);
const wideInput: KenburnsInput = {
  imgW: 3000, imgH: 1000, region: null, aspect: '16:9', durationSec: 4, fps: 30, zoom: 1.12,
};
eq(planKenburns(wideInput).mode, 'pan-h', 'band ngang (16:9) → plan pan-h');
const squareInput: KenburnsInput = {
  imgW: 1000, imgH: 1000, region: null, aspect: '1:1', durationSec: 4, fps: 30, zoom: 1.12,
};
eq(planKenburns(squareInput).mode, 'zoom', 'band vuông → plan zoom');

console.log('verify-kenburns-css: reverse + static (motion override)');
const panVRev = { mode: 'pan-v' as const, blurFill: false, travelPx: 500, basePx: 0, reverse: true };
eq(
  kenburnsFrameStyle(panVRev, 0.25, 1.12).imgTransformStyle.transform,
  'translateY(calc((100cqh - 100%) * 0.7500))',
  'pan-v reverse: tiến độ đảo 1→0 (p=0.25 → 0.75)',
);
eq(
  kenburnsFrameStyle({ ...zoomPlan, reverse: true }, 0, 1.12).imgTransformStyle.transform,
  'scale(1.1200)',
  'zoom reverse p=0 bắt đầu từ zoom đích (zoom-out)',
);
eq(
  kenburnsFrameStyle({ mode: 'static', blurFill: false }, 0.5, 1.12),
  {
    fgStyle: { width: '100%', height: '100%', objectFit: 'contain' },
    imgTransformStyle: {},
  },
  'static: khung đứng yên, không transform',
);

console.log('verify-kenburns-css: kenburnsModeLabel');
eq(kenburnsModeLabel('pan-v'), 'Lia dọc ↓', 'label pan-v');
eq(kenburnsModeLabel('pan-h'), 'Lia ngang →', 'label pan-h');
eq(kenburnsModeLabel('zoom'), 'Zoom vào ⊙', 'label zoom');
eq(kenburnsModeLabel('pan-v', true), 'Lia dọc ↑', 'label pan-v reverse');
eq(kenburnsModeLabel('pan-h', true), 'Lia ngang ←', 'label pan-h reverse');
eq(kenburnsModeLabel('zoom', true), 'Zoom ra ⊙', 'label zoom reverse');
eq(kenburnsModeLabel('static'), 'Tĩnh', 'label static');

if (failures > 0) {
  console.error(`verify-kenburns-css: ${failures} FAILED`);
  process.exit(1);
}
console.log('verify-kenburns-css: PASS');
