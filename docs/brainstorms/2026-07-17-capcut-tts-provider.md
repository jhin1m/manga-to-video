# Brainstorm: CapCut TTS Provider + TTS Provider Abstraction

**Ngày:** 2026-07-17 · **Trạng thái:** Đã chốt, chờ plan
**Nguồn tham khảo:** https://github.com/K07VN/capcut-tts-api (Python CLI ~500 dòng, reverse-engineered CapCut internal API)

## Vấn đề & Yêu cầu

- `lib/tts.ts` hard-code ElevenLabs (trả phí theo ký tự). Muốn thêm CapCut TTS (free, giọng Việt) và mở đường thêm provider khác sau này.
- **Chọn provider per-project**: dropdown trong UI trang video, lưu vào `renderConfig.tts.provider` trong `.mtvproj`; rỗng = ENV `TTS_PROVIDER`.
- **Không tự fallback** khi CapCut lỗi — báo lỗi rõ kèm gợi ý đổi `TTS_PROVIDER=elevenlabs`.
- **Phạm vi: chỉ TTS.** STT (word timestamps → subtitle karaoke) là hướng mở sau, kiến trúc không được chặn.
- Port signing sang TypeScript thuần (`node:crypto`), không thêm runtime Python, không dependency mới.

## Các hướng đã cân nhắc

| Hướng | Kết luận |
|---|---|
| **A. Interface `TtsProvider` + registry** | ✅ Chọn. Orchestration chung (cache/retry/ffprobe) ở `lib/tts.ts`, provider chỉ lo text → Buffer mp3. Thêm provider mới = 1 file. |
| B. Mỗi provider tự cache riêng | ❌ Lặp logic cache/retry, vi phạm DRY. |
| C. Đổi baseUrl qua ENV (như mock hiện tại) | ❌ CapCut là flow async (new → poll), khác hẳn ElevenLabs sync. |
| Tích hợp: spawn Python subprocess / microservice FastAPI | ❌ Bắt buộc Python runtime / thêm service phải vận hành — YAGNI. Port TS được chọn. |

## Thiết kế đã chốt

### Kiến trúc
- `lib/tts.ts`: giữ `synthSegment` (cache đĩa, atomic write `.tmp→rename`, `withRetry`, `probeDurationSec`), nhận provider từ config.
- `lib/tts-providers/elevenlabs.ts`: di chuyển `fetchTts` hiện có, hành vi không đổi.
- `lib/tts-providers/capcut.ts`: port từ Python client:
  - Build SSML: `<voice name="{voice}" resource_id="{rid}" platform="sami"><prosody rate="{rate}">{text}</prosody></voice>`
  - Ký: `x-ss-stub` = MD5(body); header sign = MD5("9e2c|{last7charsOfPath}|3|{appvr}|{deviceTime}|{tdid}|11ac"); sign-string RSA PKCS#1 v1.5 encrypt bằng public key nhúng (lấy từ repo nguồn); headers `x-khronos`/`device-time` = Unix seconds.
  - `POST /lv/v1/common_task/new` → poll `/lv/v1/common_task/query` (nhịp ~1.5s, timeout tổng 120s) → tải audio → Buffer.
  - Device profile mặc định nhúng sẵn (theo repo nguồn), override qua `CAPCUT_DEVICE_JSON`.
- Provider khai báo `{ id, label, voices?, defaultVoice }` cho UI render.

### Schema + UI
- `renderConfig.tts` thêm `provider: ''` — rỗng = ENV → file `.mtvproj` cũ mở bình thường, **không cần migration**.
- Trang video (`app/video/[jobId]/page.tsx`): dropdown provider cạnh ô voiceId/model. Chọn capcut → voiceId thành dropdown catalog giọng Việt, ô model ẩn (CapCut không có model tier).

### Cache — không đốt lại tiền ElevenLabs
- Key cũ `sha256(text\0voice\0model)` **giữ nguyên cho elevenlabs** (cache đã trả phí không vô hiệu).
- Provider khác: `sha256(provider\0text\0voice\0model)`.

### ENV mới (.env.example)
```
TTS_PROVIDER=elevenlabs          # elevenlabs | capcut
CAPCUT_VOICE=BV074_streaming
CAPCUT_RESOURCE_ID=7102355709945188865
#CAPCUT_DEVICE_JSON=             # path device profile tùy chọn
#CAPCUT_BASE_URL=                # chỉ đổi khi test với mock
```

### Lỗi & kiểm thử
- CapCut fail (HTTP lỗi, task fail, poll timeout) → Error message rõ nguyên nhân + gợi ý `TTS_PROVIDER=elevenlabs`. Không auto-fallback (tránh âm thầm đốt quota trả phí).
- `scripts/mock-capcut.mjs` theo mẫu `mock-elevenlabs.mjs`: mô phỏng new/query/audio → verify-script + e2e chạy offline.
- verify-script: thêm case capcut (cache key có provider, key elevenlabs backward-compat).

## Rủi ro & việc phải verify khi implement

1. **API unofficial** — CapCut đổi signing là chết. Chấp nhận: ElevenLabs là đường lùi, rủi ro cô lập trong 1 file provider.
2. **Response audio chưa xác nhận** (URL tải hay base64, JSON path nào) — bước đầu implementation: chạy Python client gốc 1 lần, capture response thật rồi mới viết parser.
3. **Catalog giọng Việt phải verify thực nghiệm** — chỉ `BV074_streaming` được repo nguồn xác nhận (kèm resource_id 7102355709945188865). Bắt đầu 1–2 giọng verified, mở rộng dần. Không có catalog công khai.
4. Rate limit không rõ — synth tuần tự như hiện tại, chưa cần throttle (YAGNI).

## Tiêu chí nghiệm thu

- Chọn provider capcut trong UI → synth preview + CLI render ra mp3 nghe được tiếng Việt, cache HIT lần 2 không gọi API.
- `TTS_PROVIDER` rỗng/elevenlabs → hành vi và cache key y hệt trước refactor (verify-script pass).
- File `.mtvproj` cũ (không có trường provider) mở và render bình thường.
- CapCut lỗi → message tiếng Việt rõ ràng, không silent fallback.

## Ngoài phạm vi

- STT / word timestamps (subtitle karaoke) — provider capability riêng khi có nhu cầu thật.
- Auto-fallback giữa provider; RPM throttle cho CapCut.
