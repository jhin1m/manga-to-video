# PM Report — Cook completion: Storyboard RegionCropper UX

Date: 2026-07-09 13:39 · Plan: `plans/260709-1220-storyboard-region-cropper-ux/` · Status: **completed** (3/3 phases)

## Deliverables

| File | Change |
|------|--------|
| `content-extractor/lib/kenburns-css.ts` | MỚI — module thuần: `kenburnsFrameStyle`, `kenburnsFrameFromInput`, `kenburnsModeLabel`, `ASPECT_CSS` |
| `content-extractor/components/use-reduced-motion.ts` | MỚI — hook `prefers-reduced-motion` dùng chung (video page + ShotPreview) |
| `content-extractor/scripts/verify-kenburns-css.mts` | MỚI — 18 assertion exact-string, nối vào `test:unit` |
| `content-extractor/components/region-cropper.tsx` | 8 tay cầm resize delta-based + `ShotPreview` (canvas crop + RAF loop + chip nhãn + toggle tỉ lệ) |
| `content-extractor/app/video/[jobId]/page.tsx` | Dùng helper chung; xoá `ASPECT_CSS` cục bộ + khối CSS inline + `useSyncExternalStore` inline |
| `content-extractor/package.json` | `test:unit` thêm `verify-kenburns-css.mts` |

## Verification

| Gate | Kết quả |
|------|---------|
| `tsc --noEmit` | PASS |
| `eslint` (file đụng tới) | PASS |
| `next build` | PASS |
| `test:unit` (6 suites) | PASS |
| `test:e2e` (storyboard) | PASS (70+ assertions) |
| `test:render` | PASS (28+ assertions) |
| `test:e2e-video` | FAIL — **lỗi CÓ SẴN**, đã chứng minh bằng stash + chạy trên cây sạch: fail y hệt (`parseScriptJSON` HTTP 502, `lib/script.ts`). Không liên quan plan này. |
| code-reviewer | DONE_WITH_CONCERNS → đã fix Major-1 (resize delta-based) + Minor-2 (decode() fallback onload); Minor-3 (phantom scroll dọc ở mép dưới) chấp nhận cosmetic |

## Review fixes đã áp

1. **Major-1**: resize chuyển sang delta-based (`edge = baseEdge + Δpointer`) — click suông trên tay cầm không làm region đổi giá trị; kéo thật không giật nhát đầu.
2. **Minor-2**: `img.decode()` reject (Safari + strip lớn) → fallback `onload`, preview không còn đen vĩnh viễn.

## Tồn đọng / theo dõi

- `test:e2e-video` fail có sẵn ở `parseScriptJSON` (`lib/script.ts:116-118`) — cần điều tra riêng (mock-script-model trả format lệch?). Ngoài phạm vi plan.
- Nit (không chặn): cursor có thể nháy khi kéo resize nhanh; `previewAspect` chỉ init từ prop; multi-touch overwrite dragRef (flaw có sẵn).
