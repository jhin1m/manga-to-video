---
title: "Storyboard: nối dây region → render + ghi đè hiệu ứng per-nhịp"
description: "Nối Beat.region vào pipeline render (hiện bị vứt) và thêm ghi đè hiệu ứng per-nhịp mặc định auto — trị bệnh 25/27 shot đều pan-v"
status: completed
priority: P1
effort: ""
tags: [storyboard, kenburns, render, ux]
created: 2026-07-17
blockedBy: []
blocks: []
---

# Storyboard: nối dây region → render + ghi đè hiệu ứng per-nhịp

**Brainstorm:** [`docs/brainstorms/2026-07-17-storyboard-region-motion-autotrim.md`](../../docs/brainstorms/2026-07-17-storyboard-region-motion-autotrim.md)
**Spike (đo trên corpus thật):** [`reports/spike-260717-1720-ink-bbox-calibration-tren-corpus-that-report.md`](./reports/spike-260717-1720-ink-bbox-calibration-tren-corpus-that-report.md)
**Mode:** hard (research → plan → red-team → validate) · **Scope:** HOLD, đã co sau spike

## Overview

Ba than phiền ("region khó dùng", "chỉ có Auto", "cắt khoảng trắng") hoá ra là **một bệnh**:
`Beat.region` không bao giờ tới render. `lib/script.ts:159` đặt cứng `region: null` cho mọi shot →
`planKenburns` luôn suy chuyển động từ **cả band** → region thành nút xoay không nối dây.

**Spike đo trên chương thật xác nhận bằng số:** 27 band → **25 `pan-v`, 2 `zoom`, 0 `pan-h`**. Video
hiện là 25 cú lia dọc liên tiếp. Bệnh đơn điệu là **cấu trúc**, không phải cảm giác.

Cùng spike đó **bác bỏ auto-trim**: tiết kiệm TB chỉ **7.3%**, 2/27 band đạt ngưỡng. Khoảng trắng
nằm giữa ảnh chứ không ở lề (webtoon full-bleed ngang) → auto-trim là 5-7h công cho gần như không gì.
Phase 3 vì vậy co từ "auto + thủ công" xuống **chỉ còn nút thủ công** (~2h).

## Goals

| # | Goal | Priority |
|---|------|----------|
| 1 | Region vẽ ở Storyboard điều khiển thật khung hình video | P1 |
| 2 | Ghi đè hiệu ứng per-nhịp (mode + đảo hướng), mặc định `auto` giữ nguyên hành vi cũ | P1 |
| 3 | Nút "Vừa khít nội dung" thủ công (2/27 band hưởng lợi) | P3 |

## Phases

| # | Phase | Status |
|---|-------|--------|
| 1 | [Phase 1: Nối dây region → render](./phase-01-noi-day-region-motion.md) | ✅ Done |
| 2 | [Phase 2: Ghi đè hiệu ứng per-nhịp](./phase-02-ghi-de-hieu-ung-per-nhip.md) | ✅ Done |
| 3 | [Phase 3: Nút "Vừa khít nội dung"](./phase-03-nut-vua-khit-noi-dung.md) | ✅ Done |

**Phụ thuộc:** 1 → 2 → 3, tuần tự. Không song song: P2 sửa cùng `lib/schema.ts`/`lib/script.ts` mà P1
vừa đổi; P3 cần đường ghi đè của P2 vì trim có thể đổi mode (spike xác nhận: band #14 `zoom` → `pan-v`).

**P1+P2 là trọng tâm.** P3 là phần thưởng nhỏ, có thể cắt nếu hết thời gian.

## Bối cảnh kiến trúc (đọc trước khi code)

```
upload → stitch canvas → detectBands → extract band-NN.jpg → job.items[i]
   → storyboard/route.ts buildAndCompose → working[] (giữ buffer in-memory)
   → skeletonBeats() → Beat{region: null}
   → [người dùng vẽ region ở RegionCropper]           ← Beat.region
   → script/route.ts → ScriptBeatInput (KHÔNG mang region)   ← ✂️ ĐỨT Ở ĐÂY
   → toScriptSegments → Shot{region: null}
   → timeline.ts → render-video.mts → kenburns() → ffmpeg
```

- `1 band = 1 item = 1 beat = 1 shot`, map 1:1 → copy 1 chiều lúc generate là đủ.
- `export-bundle/route.ts:17` **bắt buộc** có script → không có đường vòng né script layer.
- Nguồn gốc đứt dây: refactor band-ingest 07-07 chốt "1 band = 1 nhịp, region null"
  (`docs/journals/2026-07-07-band-ingest-storyboard-simplification.md:15-16`).

## Quyết định đã chốt (không mở lại)

| Hạng mục | Chốt |
|---|---|
| Luồng | Chỉnh region/hiệu ứng **trước** khi tạo kịch bản → copy 1 chiều, KHÔNG xây cơ chế đồng bộ |
| Hiệu ứng | Per-nhịp, mặc định `auto`; KHÔNG có mặc định toàn dự án |
| Mode bất khả thi | **Disable + tooltip**, KHÔNG âm thầm blur-fill |
| `reverse` × `static`/`auto` | **No-op im lặng** + comment, không ném lỗi |
| Trim | **Chỉ nút thủ công** — auto-trim bị spike bác bỏ (7.3%) |
| Cơ chế ink | `< 250` gray — spike chứng minh đủ, KHÔNG cần color-distance/Otsu |
| Nguồn | Webtoon/manhwa MÀU, strip dọc, full-bleed ngang |

## Ngoài phạm vi

**Bị spike bác bỏ:** auto-trim lúc ingest; reference-color-distance + fuzz; Otsu; ngưỡng đáng-trim
80-85%; hằng số border riêng cho watermark; phát hiện viền đen scan.

**Loại từ brainstorm:** tách panel XY-cut; transition giữa shot (nằm ở khâu concat, việc khác); hiệu
ứng mới (shake/dolly/parallax); preset khung; tham số `strength`; mặc định FX toàn dự án; crop nguồn
huỷ-diệt.

**Nợ ghi nhận, không làm lần này:**
- `sourceKind: 'pages'` hardcode (`storyboard/route.ts:50`) — nhãn thừa sau refactor 07-07.
- 🔍 **`MAX_BAND_HEIGHT` đang quyết định hiệu ứng.** Spike: rất nhiều band có `tallness` đúng
  `3.11 = 2240/720` = chạm trần → **bị ép cắt**, không phải cắt tại gutter. Chuyển động camera đang bị
  điều khiển bởi một hằng số config chứ không phải nội dung truyện. **Có khi đáng hơn cả P3** — điều
  tra riêng sau P1+P2.

## Success Criteria

- [x] Vẽ region → tạo kịch bản → render: khung hình video **khớp** region (chứng minh bằng render
      band thật: region nửa trên vs cả band ra khung hình khác nhau đúng như vẽ)
- [x] Chọn "Lia dọc ↑" → video lia **lên** (frame đầu/cuối forward↔reverse hoán đổi, xem bằng mắt);
      "Tĩnh" → filtergraph không zoompan; `auto` = filtergraph **byte-identical** (string assert
      literal trong verify-script Test 7b + diff 16 band corpus thật)
- [x] Mode bất khả thi → item dropdown mờ + tooltip (`availableModes`); lib fallback auto an toàn
- [x] Nút "Vừa khít nội dung" co region trên band có lề (corpus thật: 11/16 band co 15–47%);
      band full-bleed → toast báo, không đụng
- [x] `.mtvproj` round-trip giữ `region` + `motion` (script kiểm chứng export→import, validate
      ngủ đông project.ts thức dậy đúng: vượt biên throw, null pass)
- [x] Toạ độ vẫn px working thật; PATCH beat tương thích ngược (motion là field thêm, optional)
- [x] `pnpm build` + `test:unit` (7 script, gồm `verify-ink-bbox` mới) + `verify-render.mts` xanh

## Lưới an toàn (thay cho tests-first)

Người dùng chọn plan mặc định, **không** `--tdd`. P1 đổi output render của mọi project đang có region
đã vẽ → bù bằng kiểm chứng bắt buộc:

| Gate | Lệnh | Chạy khi |
|---|---|---|
| Type + build | `nvm use 24 && pnpm build` | mỗi phase |
| **String assert `auto` byte-identical** | test thuần trên `kenburns()` | **P2 — gate quan trọng nhất** |
| Ken Burns CSS | `pnpm tsx scripts/verify-kenburns-css.mts` | P1, P2 |
| Render thật | `pnpm tsx scripts/verify-render.mts` | P1, P2 (bắt buộc) |
| Mắt người | render 1 chương thật, xem video | cuối P1, cuối P2 |

**Baseline bắt buộc trước khi sửa P1:** render 1 chương ở cây sạch, giữ MP4 làm mốc. Không có baseline
thì không có cách nào biết P1 làm hỏng hay làm đúng.

## Rủi ro

| Rủi ro | Mức | Giảm thiểu |
|---|---|---|
| P1 đổi output render mọi project có region đã vẽ | Cao | Chủ ý. Baseline MP4 trước khi sửa + thông báo trong UI |
| `motion` rớt im lặng khi export `.mtvproj` | Cao | `toStoryboardManifest`/`toScriptManifest` map **tường minh** từng field → thêm `motion` vào **cả 2** ngay bước đầu P2 + gate round-trip |
| Nhánh `auto` bị đổi vô tình → hồi quy video cũ | Cao | String assert byte-identical; return sớm cho `auto` |
| Sửa beat sau khi có kịch bản → script giữ giá trị cũ | Thấp | Đã chấp nhận. UI nói rõ "cần tạo lại kịch bản", không âm thầm |
| Region nhỏ → video mờ nhoè (scale lên 1080×1920) | Trung | Chưa xử lý (HOLD). Cân nhắc cảnh báo UI — đưa ra hỏi ở gate validate |
| Trim đổi mode ngoài ý muốn | Thấp | P3 xếp sau P2; preview + chip cập nhật tức thì |

## Ràng buộc

- **Next.js bản tuỳ biến** — đọc `node_modules/next/dist/docs/` trước khi code (AGENTS.md).
- **Node 24 qua Herd nvm** — `nvm use 24` trước mọi lệnh build.
- shadcn/ui + Tailwind; region phi-huỷ-diệt; `planKenburns`/`kenburns-css`/`ink-bbox` giữ **thuần**
  (không I/O) để test được và dùng chung server/client.
- Working tree đang có thay đổi TTS provider chưa commit (`lib/tts.ts`, `lib/tts-providers/`,
  `lib/schema.ts`) — P2 cũng sửa `lib/schema.ts`. Kiểm tra conflict trước khi bắt đầu.
- **Không commit ảnh truyện** vào git (bản quyền + dung lượng).

## Câu hỏi mở

- Region nhỏ → video mờ: có nên cảnh báo UI khi `region.w` < ~50% bề rộng band? (gate validate)
- UI cảnh báo "cần tạo lại kịch bản": dùng `beat.rev` so mốc lúc generate, hay banner tĩnh cho v1?
  (chốt lúc code P1)
- Padding nút "Vừa khít" (3-5%, floor 12-16px) chưa calibrate bằng mắt — chốt lúc code P3.

<!-- slug: storyboard-region-motion-autotrim -->
