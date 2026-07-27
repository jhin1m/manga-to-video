---
phase: 6
title: "UI: tabs + provider-section + tts-section"
status: done
status_note: "Xong 2026-07-27. Nghiệm thu thật: AC3/AC4/AC6 PASS trên server thật, AC5 PASS nhánh CapCut (dropdown 8 giọng + nghe thử 48KB mp3 + cache HIT), AC7 PASS (e2e chạy 2 lần). AC1/AC2 CHƯA nghiệm thu — thiếu key. Code review: nút Lưu bấm được khi load lỗi → xoá sạch script+tts; đã thêm cờ loaded."
priority: P1
effort: "6h"
dependencies: [4, 5]
---

# Phase 6: UI tabs + provider-section + tts-section

## Overview

Dựng lại Settings dialog thành 2 tab (AI | TTS), với **một** component section provider dùng
lại 2 lần (Vision + Biên kịch). Phase cuối — nghiệm thu toàn bộ AC bằng chạy thật.

## Requirements

- Functional: chọn provider/model/key cho từng stage, nút Kiểm tra, switch tắt thinking hiện
  đúng provider hỗ trợ; tab TTS chọn provider/giọng/nghe thử; nút "Dùng theo ENV" vẫn còn.
- Non-functional: không thêm dependency mới; tuân lint repo (**cấm setState-trong-effect**,
  cấm ref-trong-render); ô key dùng `type="password"`, không autofill.

## Architecture

```
components/settings/
  settings-dialog.tsx     ~140 dòng — Tabs + load/save + state gốc
  provider-section.tsx    ~180 dòng — DÙNG LẠI 2 LẦN (vision, script)
  tts-section.tsx         ~150 dòng
```

Tách file vì `provider-section` **dùng lại 2 lần** — đó là lý do, không phải tách cho đẹp.
`components/settings-dialog.tsx` cũ xoá, cập nhật import ở `app-shell.tsx`.

Preset import **trực tiếp** từ `lib/ai-providers.ts` (data thuần, Phase 1) thay vì lấy qua
GET `/api/settings` như hiện tại. GET chỉ còn để lấy settings đã lưu + `envKeys`.

### Bố cục

```
[ AI ]  [ TTS ]
── Vision (đọc trang truyện) ──
Provider [Google AI Studio ▾]
API key  [••••1234        ] [Kiểm tra]
Model    [gemini-2.5-flash ▾ datalist]
Tắt thinking                     [ ●]

[✓] Biên kịch dùng chung cấu hình với Vision
── Biên kịch ── (hiện khi bỏ tick) …y hệt khối trên…
```

Dialog `sm:max-w-md` → `sm:max-w-2xl`. `tabs.tsx` **đã có** trong `components/ui/`.

### Quy ước state cho ô key (khớp sentinel Phase 2)

Ô key khởi tạo **rỗng** với placeholder là `keyMask`. Khi lưu:
- user không gõ gì → gửi `apiKey: null` (giữ nguyên)
- user gõ → gửi chuỗi đã gõ
- user bấm nút "Xoá key" → gửi `''`

**Không bao giờ** đổ `keyMask` vào `value` — đó chính là nguồn gốc bug ghi đè key.

### Chi tiết UI khác

- Model picker giữ `Input + datalist` (repo **không có** `command`/`popover`, không kéo dep mới).
  Nạp danh sách qua POST `/api/settings/models` khi đổi provider hoặc mở dialog.
- Provider `vision === false` (DeepSeek) chọn cho tab Vision → cảnh báo đỏ "không nhận ảnh".
- Switch tắt thinking chỉ hiện khi `thinkingParams(provider, true)` khác `{}`; nhãn phụ nêu
  cơ chế thật của provider đó.
- Cảnh báo thiếu key: giữ nguyên logic amber/đỏ hiện có, nhưng chỉ hiện khi **cả** ô key trống
  **và** `envKeys[keyEnv]` false.
- Fetch trong event handler, **không** `useEffect` (lint repo cấm setState-trong-effect —
  pattern `modelsFetched` ref hiện tại giữ nguyên).

## Related Code Files

- Create: `content-extractor/components/settings/{settings-dialog,provider-section,tts-section}.tsx`
- Delete: `content-extractor/components/settings-dialog.tsx`
- Modify: `content-extractor/components/app-shell.tsx` (import)
- Modify: `content-extractor/app/video/[jobId]/page.tsx` (1 dòng hint mặc định từ Settings)
- Modify: `content-extractor/.env.example`
- Modify: `content-extractor/docs/` — ghi TODO parity Python

## Implementation Steps

1. Tách `provider-section.tsx` (props: `stage`, `value`, `onChange`, `envKeys`, `disabled`).
2. `tts-section.tsx` — provider select, ô key, dropdown giọng (từ `/voices`), nút Nghe thử
   (`new Audio(URL.createObjectURL(blob))`).
3. `settings-dialog.tsx` — Tabs, checkbox "dùng chung", save gộp 1 PUT.
4. Sửa import ở `app-shell.tsx`, xoá file cũ.
5. Thêm dòng hint ở panel TTS trang video.
6. `.env.example`: thêm `GEMINI_API_KEY` / `DEEPSEEK_API_KEY` / `GROQ_API_KEY`, viết lại block
   đầu cho đúng luật ưu tiên mới (key giờ **có thể** nằm trong `.settings.json`).
7. Ghi TODO parity Python vào `docs/` (skill `~/.claude/skills/manga-to-video` chưa ăn theo
   settings mới — user chốt "để sau", đừng để lệch âm thầm).
8. `pnpm lint` + `pnpm build`.

### Nghiệm thu thật (chạy tay, cần key của user)

9. **AC1** — Google AI Studio + key + `gemini-2.5-flash` → chạy vision 1 slice thật, JSON hợp
   lệ, **không sửa `.env.local`, không restart**.
10. **AC2** — Vision z.ai `glm-4.5v` + Biên kịch Gemini → log 2 stage in 2 host khác nhau.
11. **AC4** — lưu → đóng → mở → lưu lại không chạm ô key → key vẫn chạy.
12. **AC5** — key ElevenLabs trong UI → dropdown giọng thật; Nghe thử phát tiếng; trang video
    không chọn gì → synth dùng đúng giọng mặc định Settings.
13. **AC6** — đặt lại file `.settings.json` v1 cũ → mở dialog thấy đúng cấu hình cũ, job chạy được.
14. **AC7** — `SETTINGS_FILE=/dev/null pnpm test:e2e-video` xanh.

## Success Criteria

- [ ] AC1, AC2, AC4, AC5, AC6, AC7 nghiệm thu thật — pass
- [ ] `provider-section.tsx` dùng đúng 2 lần, không copy-paste khối provider
- [ ] Ô key không bao giờ có `keyMask` trong `value` (đọc code xác nhận)
- [ ] Không thêm dependency mới vào `package.json`
- [ ] `pnpm lint` + `pnpm build` + `pnpm test:unit` pass
- [ ] `.env.example` mô tả đúng luật ưu tiên mới
- [ ] TODO parity Python đã ghi trong `docs/`

## Risk Assessment

| Rủi ro | Xử |
|---|---|
| **`keyMask` lọt vào `value` → PUT ghi đè key hỏng** | Quy ước state ở trên; server đã chặn chuỗi `'•'` (Phase 2 test 13) làm lưới an toàn thứ hai |
| Dialog phình to, khó dùng trên màn nhỏ | Tabs + section "Biên kịch" mặc định thu gọn; `max-w-2xl` vẫn vừa laptop |
| Lint react-hooks mới chặn pattern fetch | Giữ nguyên pattern `useRef` + fetch-trong-handler đang chạy được ở file cũ |
| Nghiệm thu AC cần key thật user chưa cấp | Gom hết bước cần key vào cuối phase; các bước 1-8 chạy độc lập |
| Sót chỗ dùng `disableThinking` cũ ở UI | `grep -rn "disableThinking\|isZai" components/` trước khi đóng phase |
