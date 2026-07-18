---
title: "Phase 3: Frontend — Storyboard Generate-all + stepper 3 bước"
status: done
priority: P1
dependencies: [1, 2]
---

# Phase 3: Frontend — Storyboard Generate-all + stepper 3 bước

## Overview

Thêm nút **"Generate all" + ô RPM** vào trang Storyboard (gọi route Phase 1), và rút `StageStepper`
còn **3 bước (Storyboard → Kịch bản → Video)**. Đây là nơi tiếp nhận batch vision từ màn Trích xuất cũ.

## Requirements

- Functional (Storyboard): nút "Generate all (N nhịp)" + Input RPM ở khu actions; gọi
  `POST /api/jobs/{id}/storyboard/generate {rpm}` rồi `attachStream()` để tiến độ live; disable khi `running`.
  Nút chỉ có nghĩa khi có ≥1 beat `pending|error`.
- Functional (Stepper): 3 node; `/` reachable qua logo (đã có); khoá bước theo readiness hiện có.
- Non-functional: tái dùng progress bar + `attachStream/pollUntilDone` sẵn có trên trang Storyboard.

## Architecture

### Storyboard page (`app/storyboard/[jobId]/page.tsx`)
- Thêm state `rpm` (default 30, mẫu page cũ) + `generating` (hoặc tái dùng `busy`).
- Hàm `generateAll()`: `POST /storyboard/generate` body `{rpm}` → set dto.progress từ response →
  `attachStream()` (đã có, dùng SSE `sb:{jobId}` + poll dự phòng). Bọc try/catch + toast như `recreate()`.
- Đặt nút + RPM trong prop `actions` của `PageShell` (cạnh "Tạo lại storyboard"/"Kịch bản"), hoặc trong
  Card tiến độ. Disable khi `running || busy`. Nhãn: `Generate all (${pendingCount})` với
  `pendingCount = beats.filter(b => !b.narration.trim() || b.error).length`.
- Placeholder narration khi rỗng đã có ("Chưa có lời đọc — bấm Generate hoặc điền tay") — khớp thông điệp mới.

### Stepper (`components/stage-stepper.tsx`)
- `STAGES` bỏ node `extract`; còn `storyboard|script|video` (index 0/1/2).
- `stageIndexFromPath`: `/storyboard/`→0, `/script/`→1, `/video/`→2, **else (kể cả `/`) → -1** (không node nào active trên trang upload).
- `jobIdFromPath` regex giữ nguyên (đã khớp storyboard|script|video).
- `unlocked(i)`: `i===current`→true; nếu `current===-1` (đang ở `/`) chỉ mở khi có bằng chứng dữ liệu:
  `i===0` cần `state.hasStoryboard`, `i===1` cần `storyboardDone`, `i===2` cần `scriptConfirmed`.
  Bỏ nhánh `i===0 ⇒ true` cũ (node 0 giờ là Storyboard, không phải "extract/home").
- Click node 0 → `router.push('/storyboard/'+jobId)` (không còn `router.push('/')`).
- Kiểm tra render khi `current===-1`: không set `aria-current`, `isDone = i < current` phải an toàn với current=-1 (mọi node → chưa done). Dùng `current >= 0 && i < current`.

## Related Code Files

- Modify: `content-extractor/app/storyboard/[jobId]/page.tsx` — thêm `rpm` + `generateAll()` + nút UI.
- Modify: `content-extractor/components/stage-stepper.tsx` — 3 node + logic index/unlocked.
- Reference: `POST /api/jobs/[id]/storyboard/generate` (Phase 1), `/storyboard/stream` (SSE có sẵn).

## Implementation Steps

1. Storyboard: thêm `const [rpm, setRpm] = useState(30)`; viết `generateAll()` (mẫu `recreate` + body rpm + `attachStream`).
2. Thêm Input RPM (mẫu page cũ, clamp 1..600) + `Button` "Generate all" vào `actions`. Disable `running||busy`.
3. Stepper: sửa `STAGES` (3 node), `stageIndexFromPath` trả -1 cho `/`, `unlocked` + `isDone` an toàn với current=-1, click node 0 → storyboard.
4. `tsc --noEmit` + `lint` sạch.
5. Smoke thủ công: upload → Tạo storyboard → Generate all → thấy từng nhịp fill; sửa 1 nhịp rồi Generate all lại → nhịp đã sửa giữ nguyên.

## Success Criteria

- [ ] "Generate all" chạy vision mọi beat pending/error, progress bar + list cập nhật live qua SSE
- [ ] RPM truyền xuống route; đang chạy thì nút disable, không double-fire
- [ ] Stepper 3 node; trên `/` không node nào active, các bước khoá tới khi có storyboard/script
- [ ] Click node Storyboard từ `/script` hay `/video` → về `/storyboard/{id}` đúng
- [ ] `tsc` + `lint` sạch

## Risk Assessment

- **Rủi ro:** `current === -1` gây lỗi so sánh `isDone`/`aria-current`. **Giảm thiểu:** guard `current >= 0` như bước 3; test tay trên `/`.
- **Rủi ro:** trùng SSE khi bấm Generate all lúc đang compose. **Giảm thiểu:** route trả 409 khi `queued|processing`; nút disable khi `running`.
- **Rủi ro:** người dùng bấm "Kịch bản" khi nhiều beat còn rỗng. **Chấp nhận:** `ready` gate hiện tại (`phase==='done' && beats>0`) vẫn cho qua — nhịp rỗng thành narration rỗng ở script; giữ hành vi cũ, không mở rộng scope.
