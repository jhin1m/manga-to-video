---
phase: 4
title: "Routes: masked GET/PUT + models + test kết nối"
status: done
status_note: "Xong 2026-07-27. Tách lib/ai-probe.ts khỏi route để test được bằng mock (route PIN baseURL nên không chĩa vào mock được). Code review phát hiện lỗ hổng CAO: provider "custom" nhận baseURL từ client mà vẫn fallback OPENAI_API_KEY → đường rút key. Đã chặn 2 lớp: bỏ fallback ENV cho custom + isCrossSiteRequest 403."
priority: P1
effort: "5h"
dependencies: [2, 3]
---

# Phase 4: Routes masked GET/PUT + models + test kết nối

## Overview

Mở đường HTTP cho schema v2: GET không bao giờ rò key, PUT hiểu sentinel 3 trạng thái,
`/models` hoạt động cho **mọi** provider (không chỉ OpenRouter), thêm `/test` để user biết
sai key hay sai model **ngay lúc lưu** thay vì 3 phút sau.

## Requirements

- Functional: GET trả settings đã mask + trạng thái key ENV; PUT validate + ghi; POST
  `/models` nhận draft chưa lưu; POST `/test` gửi 1 request bé (kèm ảnh 1×1px cho stage Vision).
- Non-functional: mọi lỗi upstream trả tiếng Việt kèm mã HTTP gốc; `/models` hỏng → không chặn
  UI (datalist chỉ là gợi ý); **không route nào** log hay trả key thô.

## Architecture

### `GET /api/settings`

```jsonc
{
  "settings": {
    "version": 2,
    "vision": { "provider": "google", "baseURL": "…", "model": "gemini-2.5-flash",
                "hasKey": true, "keyMask": "••••a1b2", "disableThinking": true },
    "script": null,
    "tts": { "provider": "elevenlabs", "voiceId": "…", "model": "…",
             "hasKey": true, "keyMask": "••••9f3c" }
  },
  "presets": [ … ],                    // từ lib/ai-providers.ts
  "envKeys": { "OPENAI_API_KEY": true, "GEMINI_API_KEY": false, … }
}
```

Trường `apiKey` **bị thay** bằng `hasKey` + `keyMask` — không phải mask tại chỗ, mà **xoá khoá
đi**, để lỡ quên chỗ nào cũng không có gì để rò. `keyMask` = `'••••' + key.slice(-4)`,
key ngắn hơn 8 ký tự → `'••••'` trơn (không lộ phần nào).

### `PUT /api/settings`

Body dùng `apiKey` sentinel (Phase 2). Route chỉ chuyển tiếp xuống `writeAiSettings`, để
validate/throw ở tầng lib — không nhân đôi luật.

### `POST /api/settings/models`

Đổi từ GET → POST vì cần **draft chưa lưu** (user vừa chọn provider, chưa bấm Lưu).
Body: `{ provider, baseURL, apiKey? }` (`apiKey` null → dùng key đã lưu / ENV).

| provider | Nguồn |
|---|---|
| `openrouter` | giữ nguyên endpoint public + `architecture.input_modalities` → cờ `vision` thật |
| `google` | theo kết luận Phase 1: compat `/models` hoặc native `/v1beta/models` |
| còn lại | `GET {baseURL}/models` + `Authorization: Bearer` |

`/models` các provider (trừ OpenRouter) **không** khai báo vision → response gắn
`vision: null` (= không biết), UI ghim `preset.visionModels` lên đầu thay vì lọc.
Cache in-memory 10' giữ nguyên, **key cache theo `provider+baseURL`** (không theo key — tránh
lẫn danh sách giữa 2 tài khoản).

### `POST /api/settings/test`

Body `{ stage, provider, baseURL, model, apiKey? }` → 1 chat completion `max_tokens: 1`.
`stage === 'vision'` → kèm 1 ảnh PNG 1×1px data-URI ⇒ bắt luôn lỗi "model không nhận ảnh"
(vì `/models` không cho biết điều đó).

Phân loại lỗi trả về UI:

| Upstream | Thông điệp |
|---|---|
| 401 / 403 | "API key sai hoặc thiếu quyền" |
| 400 / 404 + tên model trong message | "Model không tồn tại ở nhà cung cấp này" |
| 400 + nói về ảnh/image/modality | "Model này không nhận ảnh — chọn model vision" |
| timeout / DNS | "Không kết nối được `{host}`" |

## Related Code Files

- Modify: `content-extractor/app/api/settings/route.ts`
- Modify: `content-extractor/app/api/settings/models/route.ts` (GET → POST)
- Create: `content-extractor/app/api/settings/test/route.ts`
- Create: `content-extractor/scripts/verify-settings-routes.mts`
- Modify: `content-extractor/package.json` (thêm vào `test:unit`)

## Implementation Steps

### Bước 1 — Test trước (TDD)

`verify-settings-routes.mts` — gọi trực tiếp hàm `GET`/`PUT`/`POST` của route (Request/Response
thuần, **không** dựng server), `SETTINGS_FILE` trỏ tmpdir. Upstream giả bằng
`scripts/mock-openai-vision.mjs` đã có.

1. **AC3**: lưu settings có key `'sk-secret-abcd1234'` → `JSON.stringify(await GET())`
   **không chứa** chuỗi `'sk-secret-abcd1234'`; có `hasKey: true`; `keyMask === '••••1234'`.
2. Key 4 ký tự → `keyMask === '••••'` (không lộ ký tự nào).
3. `hasKey === false` + `keyMask === ''` khi chưa có key.
4. **AC4 qua HTTP**: PUT với `apiKey: null` → GET lại `hasKey` vẫn `true`; đọc file thấy key cũ.
5. PUT với `apiKey: '••••1234'` → **400**, thông điệp nêu rõ không nhận chuỗi mask.
6. PUT `{settings: null}` → xoá file (nút "Dùng theo ENV" cũ vẫn chạy).
7. PUT body không phải JSON → 400 (giữ hành vi cũ).
8. POST `/models` provider `openrouter` (mock) → danh sách có cờ `vision` boolean.
9. POST `/models` provider khác → cờ `vision === null`; upstream lỗi → **502 + UI không chặn**
   (route trả `{error}`, không throw).
10. POST `/test` mock 401 → `{ok:false}` + thông điệp nhóm "API key sai".
11. POST `/test` `stage:'vision'` → request gửi lên **có** phần `image_url` (mock assert).

Chạy → đỏ.

### Bước 2 — Code

12. Sửa `GET`: dựng DTO đã xoá `apiKey`, thêm `hasKey`/`keyMask`; `envKeys` mở rộng thêm
    `GEMINI_API_KEY`/`DEEPSEEK_API_KEY`/`GROQ_API_KEY`; `presets` lấy từ `lib/ai-providers.ts`.
13. Sửa `PUT`: chuyển tiếp nguyên body xuống `writeAiSettings`, map lỗi → 400.
14. Viết lại `models/route.ts` thành POST + nhánh theo provider + cache theo `provider+baseURL`.
15. Viết `test/route.ts`.
16. Chạy tới xanh.

## Success Criteria

- [ ] AC3 xanh (test 1-3) — GET không rò key ở bất kỳ field nào
- [ ] AC4 xanh qua HTTP (test 4-5)
- [ ] `/models` chạy cho ≥3 provider, lỗi upstream không chặn UI (test 8-9)
- [ ] `/test` phân loại đúng ≥2 nhóm lỗi và gửi ảnh cho stage vision (test 10-11)
- [ ] `pnpm test:unit` + `pnpm lint` + `pnpm build` pass
- [ ] Smoke thật qua `next start`: GET/PUT/models/test với key thật của user

## Risk Assessment

| Rủi ro | Xử |
|---|---|
| Quên xoá `apiKey` ở một nhánh DTO nào đó | Test 1 assert trên **chuỗi JSON toàn bộ response**, không assert từng field |
| Cache `/models` lẫn giữa 2 tài khoản | Key cache theo `provider+baseURL`; không cache theo key (không đưa key vào cache key) |
| PUT không auth | Đúng posture app local single-user — mọi route `/api/jobs` cũng vậy (đã ghi nhận ở code-review plan 260718). Next không bật CORS → preflight chặn cross-origin |
| `/test` tốn tiền | `max_tokens: 1` + ảnh 1×1px ⇒ chi phí xấp xỉ 0 |
