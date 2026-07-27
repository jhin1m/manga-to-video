---
phase: 3
title: "Vision/Script đọc per-stage config"
status: done
status_note: "Xong 2026-07-27. Code review phát hiện hồi quy nhánh ENV thuần: suy provider từ chuỗi "api.z.ai" nuốt param tắt-thinking với endpoint GLM khác host. Đã bỏ suy diễn, nhánh ENV giữ nguyên hành vi cũ từng chữ; test mục 18 khoá bằng host open.bigmodel.cn."
priority: P1
effort: "4h"
dependencies: [2]
---

# Phase 3: Vision/Script đọc per-stage config

## Overview

`readVisionConfig()` / `readScriptConfig()` đọc đúng nhánh stage của mình (provider/model/key
riêng), và tri thức quirk provider dồn hết vào `extraParams` tính sẵn — `vision.ts` không còn
biết provider nào là z.ai.

## Requirements

- Functional: 2 stage cấu hình độc lập; `script === null` → dùng y cấu hình vision;
  param tắt-thinking đúng theo provider; `max_tokens` mặc định theo provider khi ENV trống.
- Non-functional: nhánh ENV thuần (không có settings) **không đổi một chữ nào**, kể cả
  `SCRIPT_BASE_URL`/`SCRIPT_API_KEY`.

## Architecture

`VisionConfig` / `ScriptConfig` bỏ `disableThinking: boolean` khỏi vai trò "cờ nghiệp vụ",
thêm:

```ts
extraParams: Record<string, unknown>;  // gộp param tắt-thinking + max_tokens
```

`completeJson` / `completeJsonStream` thay
```ts
...(disableThinking ? { thinking: { type: 'disabled' } } : {}),
...(maxTokens ? { max_tokens: maxTokens } : {}),
```
bằng `...cfg.extraParams`. **Một chỗ duy nhất** (`lib/ai-providers.ts`) biết quirk provider.

Xây `extraParams`:
```
thinkingParams(cfg.provider, cfg.disableThinking)
+ { max_tokens: ENV.MODEL_MAX_TOKENS ?? defaultMaxTokens(cfg.provider) }   // bỏ nếu undefined
```

Nhánh ENV thuần (không settings) giữ provider ngầm định: `zai` nếu `OPENAI_BASE_URL` trỏ z.ai,
ngược lại `openai` — **chỉ** để chọn param thinking cho cờ `VISION_DISABLE_THINKING` cũ.
Hành vi kết quả y hệt v1 (trước đây cờ env gửi thẳng param GLM).

## Related Code Files

- Modify: `content-extractor/lib/vision.ts` (`readVisionConfig`, `completeJson`,
  `completeJsonStream`, hint lỗi dòng ~238)
- Modify: `content-extractor/lib/script.ts` (`readScriptConfig`)
- Modify: `content-extractor/scripts/verify-settings.mts`
- Modify: `content-extractor/scripts/verify-script.mts` (nếu chạm `ScriptConfig`)

## Implementation Steps

### Bước 1 — Test trước (TDD)

**KHOÁ:**
1. Không settings → `readVisionConfig()` / `readScriptConfig()` y hệt hiện tại (baseURL, model,
   key, cả `SCRIPT_BASE_URL` back-compat). Assertion case 1 hiện có giữ nguyên.
2. Thiếu key → lỗi nêu đúng tên biến env.

**MỚI:**
3. Settings vision=`zai-coding`/`glm-4.5v`, script=`google`/`gemini-2.5-flash` (2 provider khác
   nhau, 2 key khác nhau) → `readVisionConfig().baseURL` là host z.ai,
   `readScriptConfig().baseURL` là host Google, key mỗi bên lấy đúng `ZAI_API_KEY`/`GEMINI_API_KEY`. **AC2**
4. `script === null` → `readScriptConfig()` trả provider/baseURL/key **giống hệt** vision, chỉ
   `model` rơi về `SCRIPT_MODEL` env khi `model` rỗng.
5. `extraParams` z.ai + `disableThinking:true` → chứa `thinking:{type:'disabled'}`,
   **không** chứa `reasoning_effort`.
6. `extraParams` google + `disableThinking:true` → chứa `reasoning_effort:'none'`,
   **không** chứa `thinking`.
7. `extraParams` openai + `disableThinking:true` → **không** chứa `thinking` lẫn
   `reasoning_effort` (giữ tinh thần "không rò param GLM sang provider khác" của case 2 cũ).
8. `max_tokens`: `ENV.MODEL_MAX_TOKENS='4096'` → `extraParams.max_tokens === 4096` với mọi
   provider (ENV thắng).
9. `max_tokens`: ENV trống + provider `google` → `extraParams.max_tokens === 16384`;
   provider `openai` → **không có** khoá `max_tokens`.

Chạy → đỏ.

### Bước 2 — Code

10. `readVisionConfig`: `stageConfig(settings,'vision')` → `resolveApiKey(cfg)` → build
    `extraParams`. Model fallback: `cfg.model || ENV.VISION_MODEL || 'gpt-4o-mini'` (giữ chuỗi cũ).
11. `readScriptConfig`: y hệt với `'script'`, fallback `ENV.SCRIPT_MODEL || 'gpt-4o'`.
12. `completeJson`/`completeJsonStream`: nhận `extraParams`, spread. Xoá tham số
    `disableThinking`/`maxTokens` khỏi chữ ký.
13. Sửa hint lỗi `lib/vision.ts:238` — hiện ghi "công tắc disableThinking ở Settings hiện chỉ
    áp cho z.ai", sau phase này là **sai**. Viết lại theo map provider thật.
14. Chạy tới xanh.

## Success Criteria

- [ ] AC2 xanh: 2 stage, 2 provider, 2 host, 2 key
- [ ] 5 assertion `extraParams` (5-9) xanh
- [ ] Assertion KHOÁ nhánh ENV thuần không sửa dòng nào
- [ ] `grep -n "isZaiProvider" lib/vision.ts lib/script.ts` → **không còn kết quả**
- [ ] Gỡ shim re-export `isZaiProvider` khỏi `lib/settings.ts` (Phase 1 tạo tạm để không vỡ
      import giữa chừng) — `grep -rn "isZaiProvider" content-extractor/` chỉ còn `ai-providers.ts`
- [ ] Hint lỗi dòng ~238 đã cập nhật, không còn nói "chỉ áp cho z.ai"
- [ ] `pnpm test:unit` + `pnpm lint` + `pnpm build` pass

## Risk Assessment

| Rủi ro | Xử |
|---|---|
| Nhánh ENV thuần đổi hành vi ngầm khi suy provider | Assertion KHOÁ case 1 giữ nguyên; suy provider CHỈ dùng để chọn param, không đổi baseURL/model/key |
| `extraParams` rò param lạ sang provider không hiểu → 400 | Test 5-7 kiểm cả chiều khẳng định lẫn phủ định (`không chứa`) |
| Đổi chữ ký `completeJson` vỡ call-site khác | TypeScript bắt; chỉ dùng trong `vision.ts`/`script.ts` |
| Gemini vẫn cụt JSON dù đã có max_tokens mặc định | AC1 (Phase 6) chạy thật 1 slice; nếu vẫn cụt, tăng mặc định và ghi lại số đo |
