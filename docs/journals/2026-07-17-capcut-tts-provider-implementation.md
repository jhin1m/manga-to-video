# Journal: CapCut TTS Provider + TTS Provider Abstraction — Implementation

**Ngày:** 2026-07-17 · **Plan:** `plans/260717-1515-capcut-tts-provider-tts-provider-abstraction/`

## Làm gì

Thêm CapCut TTS (free, giọng Việt) làm provider thứ 2 bên cạnh ElevenLabs qua provider abstraction. 5 phase, tất cả done, full gate offline + e2e pass.

- `lib/tts-providers/`: `types.ts` (interface), `catalog.ts` (data giọng client-safe), `elevenlabs.ts` (move `fetchTts`), `capcut.ts` (port Python → TS thuần `node:crypto`), `index.ts` (registry).
- `lib/tts.ts`: orchestration giữ nguyên (cache/atomic/probe), resolve provider + cache key có branch legacy cho elevenlabs.
- UI: dropdown provider ở trang video; CapCut → dropdown catalog giọng + ẩn model.
- `scripts/mock-capcut.mjs` + Test 9 verify (offline).

## Quyết định & phát hiện đáng ghi

1. **Gate Phase 1 (capture API thật):** API CapCut CÒN SỐNG. Audio là **URL mp3** (`payload.audio_subtitles[0].speech_url`, tải trần), KHÔNG base64. `failed_node_key` xuất hiện cả khi succeed → chỉ tin `status`. Terminal status là `succeed`/`failed` (không phải `success`/`done`).

2. **RSA của CapCut là `publicEncrypt` (PKCS#1 v1.5 type-2), KHÔNG phải sign bằng private key.** Port bằng `crypto.publicEncrypt(..., RSA_PKCS1_PADDING)`. Smoke test API thật xác nhận signing đúng (ra mp3 2.5s).

3. **`.mtvproj` KHÔNG lưu `renderConfig`** (cả `ProjectFile` lẫn `ProjectData`) — `tts.voiceId/model` cũ cũng vậy. Plan giả định sai điểm này. **User chốt giữ nguyên phạm vi:** provider là state trang video, persist vào `bundle.zip` (`render-config.json`) lúc Export → CLI render honor đúng. Không đổi format `.mtvproj`. Bundle cũ thiếu `provider` → fallback elevenlabs.

4. **Cache key ElevenLabs giữ NGUYÊN** `sha256(text\0voice\0model)` (không đốt lại cache trả phí); provider khác thêm prefix. Verify byte-identical.

5. **Bug từ code review (đã sửa):** cache key CapCut ban đầu không phản ánh giọng mặc định resolve từ `CAPCUT_VOICE` env (khi voiceId rỗng) → đổi env có thể HIT nhầm audio giọng cũ. Fix: thêm `resolveVoiceId?(cfg)` vào interface, `synthSegment` dùng giọng hiệu dụng cho key. ElevenLabs không khai báo → key không đổi. Cũng reset voiceId/model khi đổi provider ở UI (tránh gửi voice sai provider).

## Catalog

8 giọng Việt verify được (2 giọng `*Neural` bị API từ chối `TTSInvalidSpeaker`, đã loại). Repo nguồn liệt kê 24 giọng Việt — mở rộng khi cần.

## Lệch với plan

- Lệnh verify thật là `pnpm test:script` / `pnpm test:unit` (plan gọi nhầm `pnpm verify-script`).
- Thêm `CAPCUT_POLL_INTERVAL_MS`/`CAPCUT_TIMEOUT_MS` (đọc từ env lúc chạy) để mock/test offline chạy nhanh.

## Kết quả

`pnpm lint` + `pnpm build` + `pnpm test:unit` (191 assert, gồm Test 9 CapCut) + e2e-video (`E2E_SCRIPT_VIDEO_ALL_PASS`) — không hồi quy.
