# Brainstorm — Xoá ảnh + Cắt band giữ ngữ cảnh

- **Ngày**: 2026-07-07
- **Trạng thái**: Đã duyệt → chuyển `/ck:plan --tdd`
- **Phạm vi**: `content-extractor/` (Next.js 16 App Router)

## 1. Vấn đề

Hai yêu cầu độc lập:

1. **Xoá ảnh** khỏi khu upload (preview band) và khỏi storyboard (từng nhịp). Hiện KHÔNG có
   `deleteItem`/`deleteBeat` ở store, không nút xoá ở UI.
2. **Thuật toán cắt band cắt tuỳ tiện, thiếu ngữ cảnh**: band tách nhân vật khỏi bong bóng
   thoại của họ → vision mô tả band thiếu ngữ cảnh (thoại mồ côi / nhân vật không thoại) →
   narration dở. Muốn mỗi band chứa đủ một đơn vị nội dung (nhân vật kèm bong bóng).

## 2. Bối cảnh codebase (scout)

- Luồng ingest thống nhất (`lib/pipeline.ts::ingestBandItems`): mọi upload → downscale →
  `stitchSlices()` gộp thành MỘT canvas dọc → `detectBands()` cắt thành band → mỗi band =
  1 job item = 1 nhịp storyboard. (Quyết định 2026-07-07, gỡ nút tách/gộp thủ công.)
- Cắt band (`lib/smart-split.ts`, port SmartStitch): `isSafeLine(y)` = hàng ngang mọi cặp
  pixel liền kề chênh ≤ `LINE_TOLERANCE`. `findSplitPosition` cắt mỗi ~`SPLIT_HEIGHT`=1600px
  tại safe-line gần nhất, cách điểm cắt trước ≥ 40%×1600.
- **Root cause Feature 2**: `isSafeLine` nhận BẤT KỲ khoảng trắng ngang nào — khe hẹp giữa
  nhân vật↔bong bóng bị coi ngang hàng gutter dày giữa hai panel → cắt nhầm vào khe hẹp.
- **Ràng buộc Feature 1**: `StoredItem.index` là vị trí mảng (`job.items[index]`), và
  `composeBeat` nhánh pages đọc `getJob().items[beat.sourceIndex].content`. ⇒ hai bề mặt xoá
  phải tách biệt: xoá item ở upload TRƯỚC khi tạo storyboard; xoá beat trong storyboard.
- Store in-memory trên `globalThis`, không DB. Test: `scripts/verify-banding.mts` (assert
  hành vi SmartStitch cũ), `scripts/verify-ingest.mts`, e2e `scripts/e2e-storyboard.mts`.

## 3. Các hướng đã cân nhắc

### Feature 2 — thuật toán cắt

| Hướng | Ưu | Nhược | Kết luận |
|---|---|---|---|
| A. Bơm `SPLIT_HEIGHT` | 1 dòng env | Vẫn cắt tuỳ tiện tại khe hẹp; band cao nghiền chữ khi downscale | Band-aid, loại |
| **B. Gutter dày + gộp band non** | Fix đúng bản chất, giữ primitive đã test, env-tunable | Cần tinh chỉnh ngưỡng theo loại truyện; viết lại test banding | **CHỌN** |
| C. Content-blob (connected component) | Chính xác ngữ nghĩa nhất | `sharp` không có CC labeling → tự viết, nặng | Vi phạm YAGNI, loại |

### Feature 1 — xoá ảnh
Tính năng còn thiếu đơn thuần, không có hướng thay thế đáng cân nhắc. Quyết định: hard-delete,
re-index, không undo/soft-delete (v1, store in-memory tạo lại rẻ).

## 4. Quyết định của người dùng

- Bề mặt xoá: **khu upload (preview band) + storyboard (từng nhịp)**. KHÔNG xoá ở bảng kết quả vision.
- Triệu chứng xác nhận: **nhân vật tách rời bong bóng** (đúng root cause).
- Hướng cắt: **B — gutter dày + gộp band non**.
- Tinh chỉnh: **env-only + defaults hợp lý** (không thêm UI band-size, không preview vạch cắt).

## 5. Giải pháp chốt

### Feature 1 — Xoá ảnh

**Store**
- `lib/jobs.ts` → `deleteItem(id, index)`: splice `job.items`, gán lại `.index`, cập nhật
  `progress.total`/`done`/`currentIndex`. Chặn khi phase `queued`/`processing`.
- `lib/storyboard-store.ts` → `deleteBeat(jobId, beatId)`: splice `beats`, gán lại `order`
  0..n-1, cập nhật progress. Working image để orphan (không GC — KISS).

**Route** (thêm handler `DELETE` cạnh `PATCH` sẵn có)
- `app/api/jobs/[id]/items/[i]/route.ts` → `DELETE`, chặn khi đang chạy, trả `JobStatusDTO`.
- `app/api/jobs/[id]/storyboard/beats/[beatId]/route.ts` → `DELETE`, chặn khi `queued/processing`,
  trả `StoryboardDTO`.

**UI**
- `app/page.tsx`: nút ✕ trên mỗi ô band ở lưới preview (phase `ready`), disabled khi `busy`.
- `app/storyboard/[jobId]/page.tsx`: nút "Xoá" trong hàng nút mỗi nhịp, disabled khi `running`.
- Không confirm modal, không undo.

### Feature 2 — Cắt band theo gutter (`lib/smart-split.ts`)

1. **Dò gutter run**: quét từng hàng, gom safe-line liền nhau thành khoảng trắng `[yStart,yEnd]`;
   chỉ run dày `≥ MIN_GUTTER_HEIGHT` mới là ứng viên cắt; vị trí cắt = tâm run.
2. **Chọn cắt greedy**: từ `currentY`, bỏ qua gutter trước `currentY + MIN_BAND_HEIGHT`
   (⇒ khe hẹp nhân vật↔bong bóng không bị cắt). Trong cửa sổ `[min, max]` chọn gutter dày nhất;
   không có → cắt cứng tại `MAX_BAND_HEIGHT`.
3. **Gộp band non**: band cuối < `MIN_BAND_HEIGHT` gộp ngược; band mật độ mực < `MIN_INK_DENSITY`
   gộp vào hàng xóm ⇒ diệt band trắng thừa.

**Env knobs** (backward-compat: thiếu min/max suy từ `SPLIT_HEIGHT` ×0.6/×1.4):
`MIN_GUTTER_HEIGHT`(~24), `MIN_BAND_HEIGHT`(~900), `MAX_BAND_HEIGHT`(~2200), `MIN_INK_DENSITY`(~0.02);
giữ `LINE_TOLERANCE`, `IGNORABLE_BORDER`.

**Bất biến giữ nguyên**: `detectBands()`/`BeatRegion` không đổi chữ ký; band full-width,
liền mạch, Σh = chiều cao canvas (không hở/chồng); grayscale integer giữ nguyên.

## 6. Rủi ro & rollback

- **Viết lại `scripts/verify-banding.mts`** (rủi ro chính): assert cũ theo SmartStitch không còn
  đúng. Test mới khoá hành vi mới — lý do làm TDD.
- **Tinh chỉnh ngưỡng**: default có thể chưa hợp mọi webtoon; env-tunable để chỉnh nhanh.
- **Manga trang rời**: mục tiêu "nhân vật kèm bong bóng" chỉ rõ nghĩa với webtoon dải dọc; hướng B
  vẫn chạy cho trang rời nhưng chỉ lợi rõ với strip. Không phân nhánh medium (giữ quyết định
  "ingest thống nhất" 2026-07-07).
- Rollback: cả 2 feature khu trú, revert theo file; không đụng schema/manifest contract.

## 7. Tiêu chí nghiệm thu

**Feature 1**
- Preview `ready`: bấm ✕ → band biến mất, phần còn lại re-index 0..n-1, progress.total cập nhật;
  disabled khi đang chạy. Xoá band cuối → danh sách rỗng, không crash.
- Storyboard: "Xoá" → nhịp biến mất, `order` re-sequence; disabled khi `queued/processing`.

**Feature 2**
- Canvas synthetic [block nhân vật | khe hẹp < MIN_GUTTER | block bong bóng]: KHÔNG cắt giữa hai block.
- Gutter dày ≥ MIN_GUTTER sau MIN_BAND_HEIGHT: LÀ điểm cắt.
- Mọi band ∈ [MIN_BAND_HEIGHT, MAX_BAND_HEIGHT] trừ band cuối.
- Band liền mạch, Σh = chiều cao; band gần trắng bị gộp.
- `verify-banding` mới PASS; `eslint` + `tsc --noEmit` + `next build` sạch.

## 8. Ngoài phạm vi

Không connected-component; không UI band-size/preview vạch cắt; không phân nhánh pages/strip;
không undo/multi-select/GC buffer; không xoá ở bảng kết quả vision.

## 9. Touchpoints

`lib/jobs.ts`, `lib/storyboard-store.ts`, `app/api/jobs/[id]/items/[i]/route.ts`,
`app/api/jobs/[id]/storyboard/beats/[beatId]/route.ts`, `app/page.tsx`,
`app/storyboard/[jobId]/page.tsx`, `lib/smart-split.ts`, `scripts/verify-banding.mts`,
`.env.example`, `README.md`.
