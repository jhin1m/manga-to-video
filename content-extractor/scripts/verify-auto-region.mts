// Test auto-region v2.1 — full-width vertical window.
import { autoRegion, autoRegionWithin } from '../lib/auto-region';
import type { RawImage } from '../lib/ink-bbox';

let failures = 0;
const eq = (a: unknown, e: unknown, label: string) => {
  if (JSON.stringify(a) === JSON.stringify(e)) console.log(`  ✓ ${label}`);
  else {
    failures++;
    console.error(`  ✗ ${label}\n    expected: ${JSON.stringify(e)}\n    actual:   ${JSON.stringify(a)}`);
  }
};
const ok = (c: boolean, label: string) => eq(c, true, label);

function makeScene(opts: {
  width: number;
  height: number;
  art: [number, number, number, number];
  bubble: [number, number, number, number];
}): RawImage {
  const { width, height, art, bubble } = opts;
  const data = new Uint8ClampedArray(width * height * 4);
  for (let i = 0; i < width * height; i++) {
    const p = i * 4;
    data[p] = data[p + 1] = data[p + 2] = 160;
    data[p + 3] = 255;
  }
  const [ax, ay, aw, ah] = art;
  for (let y = ay; y < ay + ah; y++) {
    for (let x = ax; x < ax + aw; x++) {
      const p = (y * width + x) * 4;
      const v = (x + y) % 6 < 3 ? 40 : 90;
      data[p] = data[p + 1] = data[p + 2] = v;
    }
  }
  const [bx, by, bw, bh] = bubble;
  for (let y = by; y < by + bh; y++) {
    for (let x = bx; x < bx + bw; x++) {
      const p = (y * width + x) * 4;
      data[p] = data[p + 1] = data[p + 2] = 250;
    }
  }
  for (let y = by + 8; y < by + bh - 8; y += 6) {
    for (let x = bx + 8; x < bx + bw - 8; x += 5) {
      const p = (y * width + x) * 4;
      data[p] = data[p + 1] = data[p + 2] = 20;
    }
  }
  return { data, width, height, channels: 4 };
}

console.log('Test 1: bubble trên → full width, cắt dọc');
{
  const img = makeScene({
    width: 400,
    height: 700,
    art: [20, 280, 360, 400],
    bubble: [80, 10, 240, 180],
  });
  const r = autoRegion(img);
  ok(r !== null, 'có region');
  if (r) {
    ok(r.x === 0 && r.w === 400, `full width (${r.x},${r.w})`);
    ok(r.y > 0 || r.h < 700, `cắt dọc (y=${r.y} h=${r.h})`);
    ok(r.h >= 0.75 * 700, `giữ ≥75% cao (h=${r.h})`);
  }
}

console.log('Test 2: không bubble → null');
{
  const data = new Uint8ClampedArray(400 * 600 * 4);
  for (let y = 0; y < 600; y++) {
    for (let x = 0; x < 400; x++) {
      const p = (y * 400 + x) * 4;
      const v = (x + y) % 6 < 3 ? 50 : 100;
      data[p] = data[p + 1] = data[p + 2] = v;
      data[p + 3] = 255;
    }
  }
  eq(autoRegion({ data, width: 400, height: 600, channels: 4 }), null, 'null');
}

console.log('Test 3: within base');
{
  const img = makeScene({
    width: 400,
    height: 800,
    art: [50, 450, 300, 300],
    bubble: [80, 20, 240, 160],
  });
  const base = { x: 0, y: 200, w: 400, h: 600 };
  const r = autoRegionWithin(img, base);
  ok(r !== null, 'within ok');
  if (r) {
    ok(r.y >= base.y - 1, `y=${r.y}`);
    ok(r.y + r.h <= base.y + base.h + 1, 'trong base');
  }
}

if (failures > 0) {
  console.error(`verify-auto-region: ${failures} FAILED`);
  process.exit(1);
}
console.log('verify-auto-region: PASS');
