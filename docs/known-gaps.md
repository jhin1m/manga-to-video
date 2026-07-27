# Known gaps — lệch đã biết và CỐ Ý

Nơi ghi những chỗ hai bản cài đặt (hoặc hai tầng) lệch nhau một cách có chủ đích, để lần sau
đụng vào không tưởng là bug. Mỗi mục: lệch ở đâu · vì sao chấp nhận · điều kiện đóng lại.

## Skill Python `manga-to-video` chưa ăn theo `.settings.json` v2

**Từ**: 2026-07-27 (plan `260727-2055-ai-tts-settings-expansion`)

Bản web (`content-extractor/`) đọc cấu hình AI + TTS từ `.settings.json` v2:
nhà cung cấp / model / **API key** / giọng đọc cấu hình được từ Settings dialog, Vision và
Biên kịch tách riêng. Skill Python (`~/.claude/skills/manga-to-video`) vẫn chỉ đọc ENV và
biến riêng của nó.

**Hệ quả cụ thể**: đổi nhà cung cấp trong Settings web thì skill Python **không** đổi theo.
Chạy cùng một chương qua hai đường có thể ra hai model khác nhau.

**Vì sao chấp nhận**: người dùng chốt "để sau". Hai đường vốn đã tách bạch về mục đích —
web là đường chính có UI, skill là đường CLI/agent.

**KHÔNG ảnh hưởng harness parity TS↔Python** (`pnpm gen:parity` / `tests/run_all.py`):
harness chỉ so `auto-region / fonts / kenburns / schema / shot-split / subtitle-presets /
subtitle-style / timeline` — không chạm `settings` / `vision` / `script` / `tts`. Đã kiểm
bằng danh sách import của `scripts/gen-parity.mts`.

**Đóng lại khi**: skill Python đọc được `.settings.json` (ít nhất nhánh `vision`/`script`
provider + model + key), hoặc hai đường được chốt là dùng cấu hình riêng vĩnh viễn.

## File `.settings.json` v1 nhận thêm param mà không ai bấm gì

**Từ**: 2026-07-27 (cùng plan)

AC6 chỉ hứa "không mất cấu hình". Hai thứ **đổi hành vi ngầm** khi file v1 được migrate:

1. **`max_tokens: 16384` tự áp** cho provider `google` / `zai` / `zai-coding` khi
   `MODEL_MAX_TOKENS` để trống (`defaultMaxTokens` trong `lib/ai-providers.ts`). Mục đích là
   chặn bẫy `finish_reason=length`, nhưng nó là **trần**, không phải sàn: nếu endpoint vốn
   cho output dài hơn 16384, một chương dài trước đây chạy được nay có thể chạm trần →
   `ModelOutputError`. Rủi ro tập trung ở stage **biên kịch** (output dài), gần như không có
   ở vision. Chữa: đặt `MODEL_MAX_TOKENS` cao hơn trong `.env.local`.
2. **Cờ `disableThinking: true` của file v1 bắt đầu có tác dụng thật với OpenRouter.** Dialog
   cũ vẫn lưu cờ này kể cả khi ẩn switch, và trước đây nó là no-op với mọi provider không phải
   z.ai. Nay OpenRouter nhận `{reasoning:{exclude:true}}` → chất lượng output biên kịch có thể
   đổi. Chữa: tắt công tắc "Tắt reasoning" trong Settings.

Nhánh **ENV thuần** (không có `.settings.json`) KHÔNG dính cả hai — nhánh đó cố tình giữ
nguyên hành vi cũ từng chữ, xem `envExtraParams` trong `lib/settings.ts`.

## Đổi giọng mặc định giữa chừng một job → video trộn 2 giọng

**Từ**: 2026-07-27 (cùng plan) · mức: thấp, chưa sửa

`setSegmentAudio` (`app/api/jobs/[id]/storyboard/tts/route.ts`) không ghi lại giọng đã dùng
cho mỗi segment. Synth vài segment → đổi giọng mặc định trong Settings → synth bù các segment
còn lại ⇒ video ghép 2 giọng, không có cảnh báo nào.

Vốn đã tồn tại trước plan này (phải sửa `.env.local` + restart), nhưng nay chỉ cần một cú
click nên xác suất chạm phải cao hơn hẳn.

**Đóng lại khi**: lưu `voiceId`/`provider` cạnh `mp3Path` trong storyboard store và cảnh báo
khi segment lệch giọng.
