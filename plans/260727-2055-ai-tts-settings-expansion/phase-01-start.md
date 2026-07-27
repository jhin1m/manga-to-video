---
phase: 1
title: "Xác minh endpoint + lib/ai-providers.ts"
status: done
status_note: "Xong 2026-07-27. Bước 0 (probe endpoint bằng key thật) CHƯA chạy — user chưa cấp GEMINI_API_KEY/ZAI_API_KEY. Đã bù bằng cách code cả 2 nhánh /models cho google (compat → 404 thì tự lùi về native, suy URL từ baseURL nên không cần biết trước). baseURL google bỏ slash cuối (plan.md ghi có, mâu thuẫn assertion của chính phase này)."
priority: P1
effort: "3h"
dependencies: []
---

# Phase 1: Xác minh endpoint + `lib/ai-providers.ts`

## Overview

Chốt sự thật về 3 endpoint mới bằng gọi thật (có key), rồi tách toàn bộ tri thức provider ra
một module **data thuần** để `settings.ts` / `vision.ts` / `script.ts` / UI cùng đọc một nguồn.

## Requirements

- Functional: preset mới (`google`, `deepseek`, `groq`) khai báo đủ `baseURL` + `keyEnv` +
  cờ vision; map param tắt-thinking theo provider; map `max_tokens` mặc định theo provider.
- Non-functional: module **chỉ `import type`**, không node builtin → client component import
  trực tiếp được (đúng khuôn `lib/tts-providers/catalog.ts` đang có), không phải fetch preset
  qua HTTP như hiện tại.

## Kiểm chứng đã có (probe không key, 2026-07-27)

| Endpoint | HTTP | Kết luận |
|---|---|---|
| `api.deepseek.com/v1/models` | 401 | path đúng ✓ |
| `api.groq.com/openai/v1/models` | 401 | path đúng ✓ |
| `api.z.ai/api/paas/v4/models` | 401 | path đúng ✓ — **bonus**: dropdown model dùng được cho cả z.ai |
| `generativelanguage.../v1beta/openai/chat/completions` (POST) | 400 | endpoint chat **có thật** ✓ |
| `generativelanguage.../v1beta/openai/models` (GET) | **404** | chưa kết luận — cần key thật |
| `generativelanguage.../v1beta/models` (native, GET) | 403 | path tồn tại → **đường lùi** |

## Architecture

```ts
// lib/ai-providers.ts — data thuần, không fs/crypto/net
export type AiProviderId =
  | 'openai' | 'zai' | 'zai-coding' | 'openrouter'
  | 'google' | 'deepseek' | 'groq' | 'custom';

export interface ProviderPreset {
  id: AiProviderId;
  label: string;
  baseURL: string;          // '' với custom
  keyEnv: string;
  vision: boolean;          // false = text-only → UI cảnh báo khi chọn cho stage Vision
  visionModels: string[];   // gợi ý ghim đầu datalist (/models không báo vision)
  scriptModels: string[];
}

// Param tắt "thinking/reasoning" theo provider. Rỗng = provider không hỗ trợ (no-op).
export function thinkingParams(id: AiProviderId, disable: boolean): Record<string, unknown>;

// Trần token output mặc định. undefined = giữ mặc định endpoint.
export function defaultMaxTokens(id: AiProviderId): number | undefined;
```

`PROVIDER_PRESETS` / `getPreset` / `isZaiProvider` chuyển từ `lib/settings.ts` sang đây;
`lib/settings.ts` re-export để không vỡ import cũ trong cùng phase.

## Related Code Files

- Create: `content-extractor/lib/ai-providers.ts`
- Create: `content-extractor/scripts/verify-ai-providers.mts`
- Modify: `content-extractor/lib/settings.ts` (chuyển preset đi, re-export)
- Modify: `content-extractor/package.json` (thêm `verify-ai-providers.mts` vào `test:unit`)

## Implementation Steps

### Bước 0 — Xác minh sống (cần key thật của user, làm TRƯỚC khi code)

1. Xin user key Gemini (aistudio.google.com/app/apikey). **Không in key ra hội thoại**, truyền
   qua biến môi trường, chỉ báo mã HTTP.
2. `GET {google}/models` với `Authorization: Bearer $KEY` → ghi lại status.
   - 200 → nhánh `google` dùng chung code `/models` với các provider khác.
   - 404 → nhánh `google` gọi native `GET /v1beta/models?key=$KEY`, map
     `models[].name` (`models/gemini-2.5-flash`) → `id` bỏ prefix `models/`.
3. `POST {google}/chat/completions` model `gemini-2.5-flash`, 1 ảnh 1×1px + `max_tokens:1`
   → xác nhận nhận ảnh qua đường OpenAI-compat.
4. Lặp 2-3 cho `deepseek` (chỉ text) và `groq`.
5. **Ghi kết quả vào phase này** (bảng trên) trước khi viết code.

### Bước 1 — Test trước (TDD)

`scripts/verify-ai-providers.mts`:
- Mọi preset có `keyEnv` khác rỗng; `custom` có `baseURL === ''`, các preset khác khác rỗng.
- `baseURL` không có slash cuối (khớp chuẩn hoá của `sanitize`).
- `thinkingParams('openai', true)` → `{}` (**không rò param GLM sang OpenAI** — giữ tinh thần
  assertion cũ ở `verify-settings` case 2).
- `thinkingParams('zai', true)` → `{thinking:{type:'disabled'}}`;
  `thinkingParams('google', true)` → `{reasoning_effort:'none'}`;
  `thinkingParams('openrouter', true)` → `{reasoning:{exclude:true}}`.
- `thinkingParams(*, false)` → `{}` với **mọi** provider.
- `defaultMaxTokens`: `google`/`zai`/`zai-coding` = 16384; `openai`/`openrouter` = undefined.
- `deepseek.vision === false`; `google.vision === true`; `groq.vision === true`.

Chạy → đỏ (module chưa có).

### Bước 2 — Code

6. Viết `lib/ai-providers.ts` cho test xanh.
7. `lib/settings.ts` import từ đó + re-export `PROVIDER_PRESETS`/`getPreset`/`isZaiProvider`
   để `verify-settings.mts` và route hiện tại chưa phải đổi trong phase này.
8. Thêm script vào `test:unit`; chạy `pnpm test:unit` → toàn bộ phải xanh (chưa đổi hành vi).

## Success Criteria

- [ ] Bảng xác minh endpoint điền đủ 3 provider mới bằng gọi thật có key, ghi trong file này
- [ ] Chốt được nhánh `/models` cho `google` (compat hay native fallback)
- [ ] `verify-ai-providers.mts` xanh; `pnpm test:unit` xanh (chưa đổi hành vi cũ)
- [ ] `lib/ai-providers.ts` không import node builtin nào (grep xác nhận)
- [ ] `pnpm lint` + `pnpm build` pass

## Risk Assessment

| Rủi ro | Xử |
|---|---|
| User chưa có key Gemini | Bước 0 chặn phase — hỏi user lấy key trước; không đoán mò endpoint |
| Gemini compat `/models` 404 cả khi có key | Đường lùi native `/v1beta/models` đã xác minh path tồn tại (403 khi không key) |
| Groq/DeepSeek đổi baseURL sau này | Preset tập trung 1 file; `custom` luôn là đường thoát |
| Vô tình in key ra log/hội thoại | Chỉ truyền qua env, chỉ báo mã HTTP, không echo body chứa key |
