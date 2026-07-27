---
title: "AI + TTS Settings mở rộng"
description: "Google AI Studio/DeepSeek/Groq preset, nhập API key trong UI, tách provider Vision≠Biên kịch, đưa TTS vào Settings (key + dropdown giọng + nghe thử)"
status: done
completed: 2026-07-27
status_note: "6/6 phase xong. 5/7 AC nghiệm thu thật (AC3/AC4/AC5-CapCut/AC6/AC7). AC1+AC2 chờ GEMINI_API_KEY/ZAI_API_KEY của user. Code review DONE_WITH_CONCERNS: 2 lỗ hổng CAO + 4 TRUNG BÌNH đã sửa hết."
priority: P1
effort: "2-3d"
tags: [settings, ai-provider, tts, ui, tdd]
created: 2026-07-27
mode: tdd
brainstorm: ../reports/brainstorm-260727-2051-ai-tts-settings-mo-rong-report.md
supersedes: 260718-2041-ai-settings-ui
---

# AI + TTS Settings mở rộng

## Overview

Mở rộng Settings dialog từ "đổi provider/model AI" thành trung tâm cấu hình đủ dùng: thêm
preset Google AI Studio / DeepSeek / Groq, **nhập API key ngay trong UI** (hết cảnh sửa
`.env.local` + restart), **tách cấu hình Vision ≠ Biên kịch**, và **đưa TTS vào cùng dialog**
(key ElevenLabs + dropdown giọng thật + nghe thử).

Kế thừa trực tiếp `260718-2041-ai-settings-ui` (done 2026-07-18) — plan này thay thế mô hình
1-provider-cho-cả-2-stage của nó.

## Vấn đề (từ brainstorm)

1. Không có Google AI Studio (Gemini) — user muốn dùng key aistudio.google.com.
2. Không nhập được key trong UI → thêm provider = sửa `.env.local` + **restart dev server**
   (ENV không hot-reload, khác `.settings.json` hiệu lực ngay). Dialog mất nửa ý nghĩa.
3. Vision + Biên kịch buộc chung provider — `lib/settings.ts` cố tình bỏ qua
   `SCRIPT_BASE_URL`/`SCRIPT_API_KEY`, nên dùng UI là *mất* khả năng ENV từng có.
4. TTS ngoài settings — `config.tts` thuộc `RenderConfig` trang video, không persist; voice ID
   ElevenLabs gõ tay.

## Goals

| # | Goal | Priority |
|---|------|----------|
| 1 | Preset `google` (+`deepseek`, `groq`) dùng được end-to-end, không sửa `.env.local`, không restart | P1 |
| 2 | API key nhập/sửa/xoá trong UI; key **không bao giờ** rời server dạng thô | P1 |
| 3 | Vision và Biên kịch cấu hình độc lập (provider/model/key riêng), mặc định dùng chung | P1 |
| 4 | TTS trong Settings: provider + key + dropdown giọng thật + nghe thử; per-job vẫn override được | P1 |
| 5 | Backward-compat tuyệt đối: file v1 cũ, nhánh ENV thuần, `SETTINGS_FILE=/dev/null` không gãy | P1 |

## Phases

| # | Phase | Status | Depends |
|---|-------|--------|---------|
| 1 | [Phase 1: Xác minh endpoint + lib/ai-providers.ts](./phase-01-start.md) | Done | — |
| 2 | [Phase 2: Schema v2 + migration + lưu key](./phase-02-schema-v2-migration-luu-key.md) | Done | 1 |
| 3 | [Phase 3: Vision/Script đọc per-stage config](./phase-03-visionscript-doc-per-stage-config.md) | Done | 2 |
| 4 | [Phase 4: Routes masked GET/PUT + models + test](./phase-04-routes-masked-getput-models-test.md) | Done | 2, 3 |
| 5 | [Phase 5: TTS settings layer + voices + preview](./phase-05-tts-settings-layer-voices-preview.md) | Done | 2 |
| 6 | [Phase 6: UI tabs + provider-section + tts-section](./phase-06-ui-tabs-provider-section-tts-section.md) | Done | 4, 5 |

## Chế độ TDD — luật chung mọi phase

Mỗi phase: **viết/sửa test trước, chạy thấy đỏ, rồi mới code**.

Neo test đã có sẵn, mở rộng chứ không viết mới:
`scripts/verify-settings.mts` (151 dòng — đã test precedence settings>ENV, key theo provider,
gating `disableThinking`, file hỏng, round-trip, reset).

**Phân biệt 2 loại assertion — bắt buộc, đây là điểm dễ sai nhất của plan này:**

| Loại | Nghĩa | Cách xử |
|---|---|---|
| **Khoá** (regression) | Hành vi phải giữ nguyên: ENV thuần, fallback key, file hỏng→null, `/dev/null`, reset xoá file | Giữ y nguyên assertion. Đỏ = làm hỏng thật → sửa code, KHÔNG sửa test |
| **Cố ý đổi** | Hành vi thiết kế mới đổi | Sửa assertion **kèm comment nêu lý do**, review kỹ |

Danh sách "cố ý đổi" đã biết (chốt trước, không phát sinh thêm mà không hỏi):
- `verify-settings.mts` case 2 hiện assert `disableThinking === false` với openrouter →
  thiết kế mới gửi `{reasoning:{exclude:true}}`. Assertion này **phải** đổi.
- `AiSettings` shape phẳng v1 → lồng v2 ⇒ mọi `writeAiSettings({...} as AiSettings)` trong test
  phải viết lại theo shape mới, cộng case migration đọc file v1 thật.

## Kiến trúc chốt

### `.settings.json` v2

```ts
interface StageConfig {
  provider: AiProviderId;
  baseURL: string;      // preset PIN theo preset; chỉ 'custom' nhập tay (giữ luật cũ)
  model: string;
  apiKey: string;       // '' = fallback ENV theo keyEnv
  disableThinking: boolean;
}
interface AiSettings {
  version: 2;
  vision: StageConfig;
  script: StageConfig | null;   // null = dùng chung Vision (mặc định, giữ hành vi cũ)
  tts: { provider: string; voiceId: string; model: string; apiKey: string } | null;
}
```

`script: null` thay cờ `shareWithVision` — precedence hiển nhiên, không sinh state mâu thuẫn.

### Preset mới

| id | baseURL | keyEnv | Vision |
|---|---|---|---|
| `google` | `https://generativelanguage.googleapis.com/v1beta/openai/` | `GEMINI_API_KEY` | ✓ |
| `deepseek` | `https://api.deepseek.com/v1` | `DEEPSEEK_API_KEY` | ✗ text-only → UI cảnh báo nếu chọn cho Vision |
| `groq` | `https://api.groq.com/openai/v1` | `GROQ_API_KEY` | ✓ |

### `extraParams` — một chỗ duy nhất biết quirk của provider

Thay vì rải `isZaiProvider()` + đọc `MODEL_MAX_TOKENS` khắp `vision.ts`/`script.ts`:
`readVisionConfig()`/`readScriptConfig()` tính sẵn `extraParams: Record<string, unknown>`
(gộp cả param tắt-thinking lẫn `max_tokens`), `completeJson`/`completeJsonStream` chỉ
`...cfg.extraParams`. Toàn bộ tri thức provider nằm trong `lib/ai-providers.ts`.

| provider | param tắt thinking |
|---|---|
| `zai` / `zai-coding` | `{ thinking: { type: 'disabled' } }` |
| `google` | `{ reasoning_effort: 'none' }` |
| `openrouter` | `{ reasoning: { exclude: true } }` |
| còn lại | `{}` (no-op, UI ẩn switch) |

`max_tokens`: ENV `MODEL_MAX_TOKENS` → trống thì mặc định `google/zai/zai-coding = 16384`
(chặn bẫy `finish_reason=length` đã ghi trong `.env.example`), còn lại `undefined`.
**Không** thêm knob UI (user đã chốt).

### Luật an toàn API key

- Ghi `.settings.json` `mode: 0o600` (chmod cả file đã tồn tại).
- `GET /api/settings` **không bao giờ** trả key thật → `{hasKey: boolean, mask: '••••1234'}`.
- `PUT` sentinel **3 trạng thái**: `apiKey: null` = giữ nguyên · `"sk-..."` = key mới ·
  `""` = xoá về ENV. ← **rủi ro cao nhất plan** (client gửi lại chuỗi mask → ghi đè key hỏng).
- `resolveApiKey`: `cfg.apiKey || ENV[keyEnv] || ENV.OPENAI_API_KEY || ''`.
- Không log key ở bất kỳ đâu (error hiện chỉ nêu `keyEnv` — giữ nguyên).

### TTS — chèn đúng 1 tầng

```
overrides (renderConfig của job)  >  .settings.json.tts  >  ENV  >  default
```

Giữ nguyên panel TTS trang video làm override per-job, chỉ thêm dòng hint mặc định.

## Success Criteria

- [ ] AC1 — Chọn Google AI Studio + dán key + `gemini-2.5-flash` → vision 1 slice trả JSON hợp lệ, **không sửa `.env.local`, không restart**
      ⏸ **CHỜ KEY** — user chưa thêm `GEMINI_API_KEY` vào `.env.local`. Đường đi đã sẵn sàng, chỉ thiếu bước bấm nút.
- [ ] AC2 — Vision = z.ai `glm-4.5v` + Biên kịch = Gemini → log 2 stage in đúng 2 host khác nhau
      ⏸ **CHỜ KEY** — logic phủ bởi `verify-settings.mts` mục 14 (2 host, 2 key) + mục 20 (không thừa kế key chéo provider, chính là lỗ hổng H1 từng làm AC2 fail).
- [x] AC3 — `GET /api/settings` không chứa chuỗi key thật ở bất kỳ field nào (test assert)
      ✅ unit (assert trên **toàn chuỗi JSON** response, không từng field) + curl trên server thật
- [x] AC4 — Round-trip: lưu → mở lại → lưu tiếp mà **không chạm ô key** → key không đổi
      ✅ unit + **UI thật**: đổi model, key nguyên vẹn, file lên v2, quyền `-rw-------`
- [x] AC5 — TTS: nhập key ElevenLabs trong UI → dropdown giọng thật; "Nghe thử" phát tiếng; trang video không chọn gì → dùng đúng giọng mặc định Settings
      ✅ **nhánh CapCut** (user chốt không có key ElevenLabs): dropdown 8 giọng thật, nghe thử trả 48KB MPEG layer III, lần 2 HIT cache (13ms vs 2649ms), `readTtsConfig()` không override → đúng `capcut/BV562_streaming`. Nhánh ElevenLabs chỉ phủ bằng mock.
- [x] AC6 — `.settings.json` v1 hiện có mở lên vẫn chạy, không mất cấu hình
      ✅ file v1 **thật** của user; đọc KHÔNG ghi đè file. Kèm 2 đổi hành vi ngầm đã ghi `docs/known-gaps.md`.
- [x] AC7 — `SETTINGS_FILE=/dev/null` vẫn cho ENV thuần (e2e không gãy)
      ✅ `E2E_SCRIPT_VIDEO_ALL_PASS`, chạy 2 lần (trước và sau khi vá review)
- [x] `pnpm lint` + `pnpm build` + `pnpm test:unit` pass — 259 assertion, `npx tsc --noEmit` sạch

## Rủi ro

| Rủi ro | Mức | Xử |
|---|---|---|
| Round-trip mask ghi đè key thật | **Cao** | Sentinel 3 trạng thái + test AC4 viết TRƯỚC code (Phase 2) |
| Gemini `/models` trả 404 kể cả khi có key | Trung bình | Đường lùi native `/v1beta/models?key=` đã xác minh path tồn tại; Phase 1 chốt bằng key thật |
| `/models` không báo vision → user chọn model text cho Vision | Trung bình | Nút "Kiểm tra" gửi ảnh 1×1px thay vì text-only |
| Migration v1 làm hỏng file đang dùng | Trung bình | `sanitize` fail → fallback ENV, không throw; test với file v1 thật |
| Sửa test "cố ý đổi" quá tay, che mất regression thật | Trung bình | Bảng phân loại Khoá/Cố-ý-đổi ở trên; mọi sửa assertion phải có comment lý do |

**ĐÃ LOẠI:** "đụng harness parity TS↔Python" — đã kiểm: `scripts/gen-parity.mts` chỉ import
`auto-region/fonts/kenburns/schema/shot-split/subtitle-presets/subtitle-style/timeline`,
**không** import `settings`/`vision`/`script`. Không có rủi ro này.

## Ngoài phạm vi

- **Parity skill Python** — `~/.claude/skills/manga-to-video` không ăn theo settings mới
  (user chốt "để sau"). Ghi TODO ở Phase 6.
- AI settings theo project · multi-profile có tên · knob band-split/`MODEL_MAX_TOKENS`/
  `FFMPEG_PATH` trên UI · preset Anthropic + Ollama.

## Ghi chú dọn dẹp (không thuộc plan)

`plans/260725-2348-subtitle-burnin-style-expansion/plan.md` có `status: pending` nhưng
`status_note` ghi "Hoàn tất 2026-07-26" và commit `c9f78ef` xác nhận đã ship. Frontmatter cũ,
nên sửa lúc rảnh.

## Kết quả (2026-07-27)

**Test**: 259 assertion trong 4 script — `verify-ai-providers` 69 · `verify-settings` 98 ·
`verify-settings-routes` 51 · `verify-tts-settings` 41. Cả 4 đã vào `test:unit`.

**Code review** (`plans/reports/from-code-reviewer-to-cook-260727-ai-tts-settings-expansion-review.md`):
DONE_WITH_CONCERNS. Một lỗ hổng xuyên suốt — *key được coi là chuỗi độc lập thay vì cặp
(provider, key)* — gây 2 lỗi CAO độc lập nhau, đã sửa hết:

| # | Lỗi | Đã xử |
|---|---|---|
| H1 | Đổi provider không gõ lại key ⇒ key nhà A gửi sang nhà B. **Đây chính là AC2** | Chỉ thừa kế key khi provider trùng (3 nhánh); UI reset `hasKey`/`keyMask` |
| H2 | `provider:'custom'` + baseURL từ client + fallback ENV ⇒ đường rút `OPENAI_API_KEY` | Bỏ fallback ENV cho `custom` + `isCrossSiteRequest` → 403 ở 4 route probe |
| M1 | Suy provider từ chuỗi `api.z.ai` nuốt param tắt-thinking (hồi quy ENV thuần) | Nhánh ENV giữ nguyên hành vi cũ, không suy diễn |
| M2 | `load()` lỗi mà nút Lưu vẫn bấm ⇒ xoá sạch script + tts | Cờ `loaded` |
| M3 | File v1 tự nhận `max_tokens:16384` + `reasoning.exclude` | Giữ hành vi, ghi `docs/known-gaps.md` |
| M4 | Key ElevenLabs mồ côi dưới provider `capcut` | Sửa cùng H1 |
| M5 | `test:unit` gọi API CapCut thật (phantom test) | Đổi sang mock ElevenLabs |

**Plan tự mâu thuẫn — đã sửa spec, không phải code**: phase-02 (migration `scriptModel` rỗng)
và phase-05 (công thức `readTtsConfig` không thoả chính test #5 của nó). Reviewer xác nhận
cả hai quyết định lệch plan ở đây là ĐÚNG.

**Còn tồn**: `/api/settings/test` vẫn echo 200 ký tự thông điệp upstream (chờ user quyết —
đó chính là thứ làm nút "Kiểm tra" hữu ích); `modelsCache` không giới hạn kích thước.

<!-- slug: ai-tts-settings-expansion -->
