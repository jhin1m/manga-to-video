# Brainstorm: AI + TTS Settings mở rộng

Ngày: 2026-07-27 · Trạng thái: **ĐÃ DUYỆT** — sẵn sàng chuyển sang plan
Phạm vi: `content-extractor` (Next.js web app). Skill Python **ngoài phạm vi**.

## 1. Vấn đề

Settings dialog hiện tại (`components/settings-dialog.tsx`, 309 dòng) chỉ đổi được
provider/model AI. Ba giới hạn thật:

1. **Không có Google AI Studio (Gemini)** — user muốn dùng key từ aistudio.google.com.
2. **Không nhập được API key trong UI** → thêm provider = sửa `.env.local` + **restart dev
   server** (ENV không hot-reload, khác `.settings.json` có hiệu lực ngay). Dialog mất một
   nửa ý nghĩa.
3. **Vision và Biên kịch buộc dùng chung provider** — `lib/settings.ts` cố tình bỏ qua
   `SCRIPT_BASE_URL`/`SCRIPT_API_KEY`, nên dùng UI là *mất* khả năng ENV từng có.
4. **TTS không nằm trong settings** — `config.tts` thuộc `RenderConfig` của trang
   `/video/[jobId]`, không persist (khớp: `.mtvproj` không lưu renderConfig). Đổi project là
   phải chọn giọng lại; voice ID ElevenLabs gõ tay.

## 2. Bối cảnh codebase (scout)

- `lib/settings.ts` — `.settings.json` cạnh app, cache theo mtime, hỏng file → fallback ENV im
  lặng. Key **không bao giờ** trong file này; `resolveApiKey()` đọc ENV theo provider, fallback
  `OPENAI_API_KEY`.
- Consumer settings: **chỉ** `lib/vision.ts:34` và `lib/script.ts:37`.
- Preset hiện có: `openai`, `zai`, `zai-coding`, `openrouter`, `custom`.
- `app/api/settings/models/route.ts` — chỉ OpenRouter, endpoint public, cache 10'.
- `lib/tts.ts` chuỗi ưu tiên: `overrides > ENV > default`. Provider cắm được
  (`lib/tts-providers/`), CapCut có catalog giọng tĩnh, ElevenLabs không.
- `components/ui/` **có** `tabs.tsx`; **không có** `command`/`popover` → giữ `Input + datalist`
  cho model picker, không kéo thêm dep.
- 26 ENV đang dùng; `MODEL_MAX_TOKENS`, `VISION_RPM`, `VISION_CONCURRENCY`, `MAX_EDGE` không
  có mặt trên UI.

## 3. Quyết định của user

| Câu hỏi | Chốt |
|---|---|
| Nhập API key trong UI? | **Có** — lưu `.settings.json`, mask khi trả về client |
| Tách provider Vision ≠ Biên kịch? | **Có** — 2 section, có nút "dùng chung" |
| Phạm vi TTS | **Đầy đủ**: provider + key + dropdown giọng + nghe thử |
| Knob nâng cao lên UI | **Không thêm** (`MODEL_MAX_TOKENS` xử bằng mặc định tự động trong code) |
| Preset thêm | Google AI Studio + DeepSeek + Groq |
| Parity skill Python | **Để sau** — ghi TODO |

## 4. Thiết kế chốt

### 4.1 `.settings.json` v2

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
  script: StageConfig | null;  // null = dùng chung Vision (mặc định, giữ hành vi cũ)
  tts: { provider: string; voiceId: string; model: string; apiKey: string } | null;
}
```

`script: null` thay cho cờ `shareWithVision` — precedence hiển nhiên, không sinh state mâu thuẫn.

**Migration v1→v2** trong `sanitize()`: thiếu `version` →
`vision = {provider, baseURL, model: visionModel, apiKey:'', disableThinking}`,
`script = scriptModel ? {...vision, model: scriptModel} : null`. Fail → fallback ENV (hành vi
cũ), **không throw**.

### 4.2 Preset mới

| id | baseURL | keyEnv | Vision |
|---|---|---|---|
| `google` | `https://generativelanguage.googleapis.com/v1beta/openai/` | `GEMINI_API_KEY` | ✓ |
| `deepseek` | `https://api.deepseek.com/v1` | `DEEPSEEK_API_KEY` | ✗ text-only → UI cảnh báo nếu chọn cho Vision |
| `groq` | `https://api.groq.com/openai/v1` | `GROQ_API_KEY` | ✓ (llama-4-scout) |

Preset = data thuần → tách `lib/ai-providers.ts` (chỉ `import type`, không node builtin) theo
đúng khuôn `lib/tts-providers/catalog.ts` → client import trực tiếp, khỏi fetch preset qua HTTP.

### 4.3 Hai thứ BẮT BUỘC generalize (không làm thì Gemini cắm vào là hỏng)

**a) `disableThinking`** — hiện gate cứng z.ai + gửi param GLM. Thay bằng map trong
`ai-providers.ts`:

```
zai / zai-coding → { thinking: { type: 'disabled' } }
google           → { reasoning_effort: 'none' }
openrouter       → { reasoning: { exclude: true } }
còn lại          → {}          // no-op, UI ẩn switch
```

Kèm: sửa hint lỗi `lib/vision.ts:238` (đang nói "công tắc chỉ áp cho z.ai" → sẽ sai).

**b) Trần token tự động** (user chốt không thêm knob UI): `MODEL_MAX_TOKENS` (ENV) → trống thì
mặc định theo provider `google / zai / zai-coding = 16384`, còn lại `undefined`. Chặn đúng bẫy
`finish_reason=length` mà `.env.example` đã cảnh báo. ENV vẫn override.

### 4.4 Luật an toàn cho API key

- Ghi `.settings.json` với `mode: 0o600` (chmod cả file đã tồn tại).
- `GET /api/settings` **không bao giờ** trả key thật → `{hasKey: boolean, mask: '••••1234'}`.
- `PUT` sentinel **3 trạng thái**: `apiKey: null` = giữ nguyên · `"sk-..."` = key mới ·
  `""` = xoá, quay về ENV. ← **chỗ dễ sinh bug nhất** (client gửi lại chuỗi mask → ghi đè key
  hỏng), bắt buộc test round-trip.
- `resolveApiKey`: `cfg.apiKey || ENV[keyEnv] || ENV.OPENAI_API_KEY || ''` — ENV vẫn nguyên vẹn
  là đường lùi.
- CSRF: Next không bật CORS → preflight chặn PUT cross-origin. Không cần token thêm.
- Không log key ở bất kỳ đâu (error hiện chỉ nêu `keyEnv` — giữ nguyên).

### 4.5 Route

| Route | Việc |
|---|---|
| `POST /api/settings/models` (sửa từ GET) | Nhận **draft** `{provider, baseURL, apiKey?}` chưa lưu → `GET {baseURL}/models` với key server-side. OpenRouter giữ nhánh cũ (có cờ vision thật). Provider khác `/models` không khai báo vision → hiện full list, ghim ID vision đã biết lên đầu. Lỗi mạng → im lặng lùi datalist tĩnh (hành vi hiện tại). |
| `POST /api/settings/test` (mới) | 1 chat completion `max_tokens:1`, kèm **ảnh 1×1px** khi test stage Vision → bắt luôn lỗi "model không nhận ảnh". Phân biệt 401 (key) / 400-404 (model) / timeout. |
| `POST /api/settings/tts/voices` (mới) | ElevenLabs `GET /v1/voices` → dropdown giọng thật. |
| `POST /api/settings/tts/preview` (mới) | `synthSegment()` 1 câu mẫu tiếng Việt → trả thẳng `audio/mpeg` (đúng khuôn `app/api/jobs/[id]/storyboard/tts/[segId]/audio/route.ts`). Vào cache đĩa → nghe lại miễn phí. |

### 4.6 TTS — chèn đúng 1 tầng

```
overrides (renderConfig của job)  >  .settings.json.tts  >  ENV  >  default
```

**Giữ nguyên** panel TTS ở trang video làm override per-job, chỉ thêm dòng hint
"(mặc định: <từ Settings>)".

### 4.7 UI

`Dialog` → `Tabs` (AI | TTS), `sm:max-w-md` → `sm:max-w-2xl`.

```
[ AI ]  [ TTS ]
── Vision (đọc trang truyện) ──
Provider [Google AI Studio ▾]
API key  [••••1234        ] [Kiểm tra]
Model    [gemini-2.5-flash ▾ datalist]
Tắt thinking                     [ ●]

[✓] Biên kịch dùng chung cấu hình
── Biên kịch ── (hiện khi bỏ tick) …y hệt khối trên…
```

Modularize: `components/settings/provider-section.tsx` **dùng lại 2 lần** (vision + script) —
đó là lý do tách file, không phải tách cho đẹp. Cộng `tts-section.tsx`. `settings-dialog.tsx`
còn lại chỉ lo tabs + save.

## 5. Files đụng

`lib/ai-providers.ts` (mới) · `lib/settings.ts` · `lib/vision.ts` · `lib/script.ts` ·
`lib/tts.ts` · `app/api/settings/route.ts` · `app/api/settings/models/route.ts` ·
`app/api/settings/{test,tts/voices,tts/preview}/route.ts` (mới) ·
`components/settings/{settings-dialog,provider-section,tts-section}.tsx` ·
`app/video/[jobId]/page.tsx` (1 dòng hint) · `.env.example` · `scripts/verify-settings.mts`

## 6. Acceptance criteria

1. Chọn Google AI Studio + dán key + `gemini-2.5-flash` → vision 1 slice trả JSON hợp lệ,
   **không sửa `.env.local`, không restart**.
2. Vision = z.ai `glm-4.5v` + Biên kịch = Gemini → log 2 stage in đúng 2 host khác nhau.
3. `GET /api/settings` không chứa chuỗi key thật ở bất kỳ field nào (test assert).
4. Round-trip: lưu → mở lại → lưu tiếp mà **không chạm ô key** → key không đổi.
5. TTS: nhập key ElevenLabs trong UI → dropdown giọng thật; "Nghe thử" phát ra tiếng; trang
   video không chọn gì → dùng đúng giọng mặc định từ Settings.
6. `.settings.json` v1 hiện có mở lên vẫn chạy, không mất cấu hình.
7. `SETTINGS_FILE=/dev/null` vẫn cho ENV thuần (e2e không gãy).

## 7. Xác minh endpoint (đã probe thật, không dùng key — 2026-07-27)

| Endpoint | HTTP | Kết luận |
|---|---|---|
| `api.deepseek.com/v1/models` | 401 | path đúng ✓ |
| `api.groq.com/openai/v1/models` | 401 | path đúng ✓ |
| `api.z.ai/api/paas/v4/models` | 401 | path đúng ✓ — **bonus**: dropdown model dùng được cho cả z.ai |
| `generativelanguage.../v1beta/openai/chat/completions` (POST) | 400 | endpoint chat **có thật** ✓ |
| `generativelanguage.../v1beta/openai/models` (GET) | **404** | chưa kết luận được — cần key thật |
| `generativelanguage.../v1beta/models` (native, GET) | 403 | path tồn tại → **đường lùi** liệt kê model cho Google |

→ Phase 0 của plan: dùng key Gemini thật của user xác minh `/v1beta/openai/models`; 404 kể cả
khi có key → route models nhánh `google` gọi native `/v1beta/models?key=` và map về
`{id,name,vision}`.

## 8. Ngoài phạm vi (TODO ghi lại)

- **Parity skill Python** — `~/.claude/skills/manga-to-video` chưa ăn theo settings mới; phải
  cập nhật `scripts/vision.py` + golden test nếu muốn đồng bộ. Ghi vào docs để không quên lệch
  TS↔Python.
- AI settings theo từng project · multi-profile có tên · knob band-split /
  `MODEL_MAX_TOKENS` / `FFMPEG_PATH` trên UI · Anthropic + Ollama preset.

## 9. Rủi ro

| Rủi ro | Xử |
|---|---|
| Round-trip mask ghi đè key thật | Sentinel 3 trạng thái + test bắt buộc (AC#4) |
| Gemini `/models` 404 kể cả khi có key | Đường lùi native `/v1beta/models` đã xác minh path tồn tại (mục 7) |
| `/models` không báo vision → user chọn model text cho Vision | Nút "Kiểm tra" gửi ảnh 1×1px thay vì text-only |
| Migration v1 làm hỏng file đang dùng | `sanitize` fail → fallback ENV, không throw; test với file v1 thật |
| Sửa `disableThinking` đụng harness parity TS↔Python | Đã chốt TS-only; ghi TODO ở mục 8 |

## 10. Câu hỏi còn mở

Không có.
