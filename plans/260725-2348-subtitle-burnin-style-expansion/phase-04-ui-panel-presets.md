---
phase: 4
title: "UI panel + presets"
status: pending
priority: P2
effort: "6h"
dependencies: [3]
---

# Phase 4: UI panel + presets

## Overview

Thay panel "Phụ đề" 7 control bằng panel đầy đủ 16 control có nhóm, cộng 5 preset bấm-một-nút. Card phụ đề hiện nằm inline trong `app/video/[jobId]/page.tsx` (878 dòng) — tách thành component riêng để trang không phình thêm.

## Requirements

- Functional
  - Font: `Select` từ `FONT_CATALOG`, mỗi item render bằng chính font đó.
  - Nhóm màu: màu chữ + độ mờ.
  - Nhóm kiểu: B / I / U / IN HOA (toggle), giãn chữ.
  - Nhóm viền-nền: radio 3 mode; control con đổi **nhãn** theo mode (`Màu viền` ↔ `Màu nền hộp`), không đổi field.
  - Nhóm vị trí: vị trí, lề dọc, lề ngang.
  - Wrap: tối đa ký tự/dòng (0 = tắt).
  - 5 preset: Sạch · Nền đen · Đậm nổi · Cổ trang · Tin tức.
- Non-functional
  - Panel không dài quá màn hình: gom vào nhóm, dùng `Collapsible` cho nhóm nâng cao nếu cần.
  - Không thêm dependency mới — dùng component shadcn đã có trong `components/ui/`.

## Architecture

Tách `components/video/subtitle-panel.tsx`:

```tsx
export function SubtitlePanel({ value, onChange }: { value: SubtitleStyle; onChange: (s: SubtitleStyle) => void })
```

Trang chỉ còn `<SubtitlePanel value={config.subtitles} onChange={(s) => set('subtitles', s)} />`.

Preset trong `lib/subtitle-presets.ts`:

```ts
export interface SubtitlePreset { id: string; label: string; style: Partial<SubtitleStyle> }
export const SUBTITLE_PRESETS: SubtitlePreset[]
```

| Preset | Nét chính |
|---|---|
| Sạch | Be Vietnam Pro, trắng, `border: 'outline'`, `outlineWidth: 2`, đen, không bóng |
| Nền đen | trắng, `border: 'box'`, `outlineColor: '#000000'`, `outlineOpacity: 0.6`, `outlineWidth: 3` |
| Đậm nổi | Kanit, `bold`, `uppercase`, `sizePct: 5.5`, viền đen 3, bóng 1 |
| Cổ trang | Merriweather, `#ffe9b0`, viền `#3b2412` 2, bóng 1 |
| Tin tức | Roboto, `border: 'box'`, `outlineColor: '#0b2545'` (= nền hộp), `outlineOpacity: 0.85`, `sizePct: 4` |

Lưu ý cho người implement: ở mode `box`, **màu nền hộp lấy từ `outlineColor`** (`OutlineColour`), không phải `shadowColor` — xem bảng kiểm chứng trong `plan.md`.

Bấm preset = merge `Partial` lên style hiện tại (giữ `burnIn`/`export` của người dùng). Không highlight preset "đang chọn" — sau khi sửa tay thì trạng thái đó vô nghĩa; chỉ là nút áp nhanh.

**Không** làm preset tự lưu: `renderConfig` không persist vào `.mtvproj` nên preset custom sẽ mất khi mở lại project.

## Related Code Files

- Create: `content-extractor/components/video/subtitle-panel.tsx`
- Create: `content-extractor/lib/subtitle-presets.ts`
- Modify: `content-extractor/app/video/[jobId]/page.tsx:667-744` — thay Card inline bằng component
- Modify: `content-extractor/lib/fonts.ts` — nếu cần thêm nhãn hiển thị cho Select

## Implementation Steps

1. Viết `lib/subtitle-presets.ts` với 5 preset.
2. Tạo `components/video/subtitle-panel.tsx`, bê nguyên các control cũ rồi thêm control mới, nhóm bằng separator/label nhỏ.
3. Font `Select`: `SelectItem` gắn `style={{ fontFamily: entry.family }}`.
4. Nhóm viền-nền: `RadioGroup` (hoặc 3 nút `Button size="xs"` như hàng aspect ở `:631-640` cho đồng bộ) + control con render theo mode; mode `none` ẩn control viền, vẫn hiện bóng.
5. Hàng preset: 5 `Button size="xs" variant="outline"`.
6. Thay Card cũ trong trang; kiểm không vỡ layout `lg:w-80`.
7. `pnpm lint` (chú ý rule mới cấm setState-trong-effect / ref-trong-render) + `next build`.

## Success Criteria

- [x] Panel hiển thị đủ 16 control, không tràn ngang ở `lg:w-80`
- [x] Select font hiển thị mỗi mục bằng chính font đó
- [x] Đổi mode viền → nhãn control con đổi đúng, không mất giá trị đã nhập
- [x] Bấm từng preset → state đổi đúng, `burnIn`/`export` giữ nguyên
- [x] `page.tsx` giảm số dòng (Card cũ đã tách ra), `pnpm lint` + `next build` PASS

## Risk Assessment

| Rủi ro | Giảm thiểu |
|---|---|
| Panel quá dài, khó dùng | Nhóm + `Collapsible` cho nhóm "Nâng cao" (giãn chữ, underline, wrap) |
| Người dùng tưởng preset là lưu được | Nhãn nhóm ghi "Preset dựng sẵn"; không có nút "Lưu preset" |
| Tách component làm vỡ luồng `set()` của trang | `SubtitlePanel` không giữ state riêng — controlled hoàn toàn |
