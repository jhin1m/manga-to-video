---
phase: 1
title: "Rut helper Ken Burns CSS"
status: completed
effort: ""
priority: P2
dependencies: []
---

# Phase 1: Rút helper Ken Burns CSS (nền tảng DRY)

## Overview

Rút logic suy CSS Ken Burns đang nằm inline trong trang video ra một module thuần dùng chung, để
Phase 3 (preview Storyboard) và trang video cùng dùng một nguồn. Refactor **phi-hành-vi** — trang
video phải chạy y hệt trước/sau.

## Requirements

- Functional: có hàm thuần nhận `(KenburnsInput, progress p ∈ [0,1])` → trả `{ fgStyle,
  imgTransformStyle }` (React.CSSProperties), tái hiện đúng 3 nhánh `pan-v` / `pan-h` / `zoom` hiện
  có. Có hàm map `aspect → CSS aspect-ratio` (rút từ `ASPECT_CSS`). Có hàm nhãn mode →
  chuỗi tiếng Việt + hướng ("Lia dọc ↓" / "Lia ngang →" / "Zoom vào ⊙").
- Non-functional: không phụ thuộc React runtime ngoài kiểu `CSSProperties`; không spawn; dễ test
  thuần (giống tinh thần `kenburns.ts` — module thuần).

## Architecture

Nguồn hiện tại: `content-extractor/app/video/[jobId]/page.tsx:303-335` tính `fgStyle` +
`imgTransformStyle` từ `planKenburns(...)` và `p = (timeSec - shot.start)/shotDur` (kẹp reducedMotion
→ p=0). `ASPECT_CSS` map ở `page.tsx:48`.

Thiết kế module mới `content-extractor/lib/kenburns-css.ts`:

```ts
import type { CSSProperties } from 'react';
import { type Aspect } from './schema';
import { planKenburns, type KenburnsInput, type KenburnsPlan } from './kenburns';

export const ASPECT_CSS: Record<Aspect, string> = { '9:16': '9 / 16', '16:9': '16 / 9', '1:1': '1 / 1' };

export interface KenburnsFrameStyle { fgStyle: CSSProperties; imgTransformStyle: CSSProperties; }

// p ∈ [0,1] = tiến độ shot. zoom = config.kenburns.zoom (cho mode 'zoom').
export function kenburnsFrameStyle(plan: KenburnsPlan, p: number, zoom: number): KenburnsFrameStyle { /* 3 nhánh */ }

// Tiện lợi: tự gọi planKenburns rồi frame style (dùng cho preview).
export function kenburnsFrameFromInput(input: KenburnsInput, p: number): KenburnsFrameStyle { /* planKenburns + kenburnsFrameStyle */ }

export function kenburnsModeLabel(mode: KenburnsPlan['mode']): string { /* pan-v→'Lia dọc ↓', pan-h→'Lia ngang →', zoom→'Zoom vào ⊙' */ }
```

Giữ nguyên biểu thức CSS gốc từng nhánh (translateY/translateX theo `100cqh/100cqw`, scale). Không
đổi công thức — chỉ dời chỗ.

## Related Code Files

- Create: `content-extractor/lib/kenburns-css.ts`
- Modify: `content-extractor/app/video/[jobId]/page.tsx` — thay khối 303-335 bằng gọi
  `kenburnsFrameStyle(plan, p, config.kenburns.zoom)`; thay `ASPECT_CSS` cục bộ (page.tsx:48) bằng
  import từ module chung; giữ nguyên logic tính `plan` và `p` (reducedMotion, shotDur) tại chỗ.
- Create (test): `content-extractor/lib/kenburns-css.test.ts` (nếu repo có test thuần cho lib).

## Implementation Steps

1. Đọc `node_modules/next/dist/docs/` phần liên quan (client component / import) trước khi sửa (AGENTS.md).
2. Tạo `kenburns-css.ts`: chuyển đúng 3 nhánh CSS từ trang video vào `kenburnsFrameStyle`; thêm
   `ASPECT_CSS`, `kenburnsFrameFromInput`, `kenburnsModeLabel`.
3. Refactor trang video import & dùng helper; xoá `ASPECT_CSS` cục bộ và khối CSS inline.
4. Kiểm tra kiểu (`tsc`/lint) + build; mở trang video preview thử pan-v/pan-h/zoom thấy y hệt.

## Success Criteria

- [x] `kenburns-css.ts` tồn tại, thuần, export `kenburnsFrameStyle` / `kenburnsFrameFromInput` /
      `kenburnsModeLabel` / `ASPECT_CSS`.
- [x] Trang video dùng helper; không còn khối CSS Ken Burns inline & `ASPECT_CSS` trùng lặp.
- [x] Preview trang video chạy y hệt trước refactor (pan dọc/ngang/zoom + reducedMotion) —
      code-reviewer diff-verify công thức từng nhánh; test thuần `verify-kenburns-css.mts`
      khớp exact-string tại p=0/0.5/1 (đã nối vào `test:unit`).
- [x] `tsc`/lint/build sạch.

## Risk Assessment

- **Lệch biểu thức khi copy** → so từng nhánh với bản gốc; test thuần so khớp style ở p=0/0.5/1.
- **Khác biệt SSR/CSR khi tách file** → module thuần, chỉ nhận primitive + trả object; không dùng
  hook. Trang video vẫn giữ tính `p`/`plan` client-side.
