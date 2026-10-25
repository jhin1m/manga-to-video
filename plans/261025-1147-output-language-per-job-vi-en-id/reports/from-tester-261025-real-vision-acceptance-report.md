# Nghiệm thu thật: vision/biên kịch/TTS/render đa ngôn ngữ (en, id)

Ngày: 2026-10-25. Branch `feat/output-language-per-job` (da8a5c8). Không sửa code production.
Vision thật qua OpenRouter `google/gemini-2.5-flash` (settings `provider=openrouter`). Key không in ra log/report.
Scratchpad phiên: `/private/tmp/claude-501/-Users-jhin1m-Desktop-ducanh-project-manga-to-video/485e2897-7beb-4ae9-a296-9d0c06bd02db/scratchpad/`.

## Tóm tắt AC

| AC | Kết quả | Bằng chứng chính |
|---|---|---|
| AC2 (en: vision, kịch bản, recap tiếng Anh) | PASS | job en qua app + skill vision en |
| AC3 (id: vision, kịch bản, TTS Shinta) | PASS (TTS chưa ASR) | job id qua app + skill vision id, TTS `id_female_noor` |
| AC7 (e2e thật en: voice, duration, audio stream) | PASS có giới hạn | mp4 h264 1080x1920 + aac, mean -22.6 dB. Không xác minh được nội dung nói (không có ASR) |
| Build `pnpm build` | PASS, exit 0 | `accept-build.log`, 1 warning Turbopack NFT (đã ghi nhận ở báo cáo cũ) |

## 1. Job id (app, :3105, settings thật)

Job `3018716f-e78a-43a4-9d14-7b8adb225c4f`. 5 ảnh nguồn → 14 slice. `outputLanguage=id` (PATCH xác nhận).
- Vision: 14/14 beat, 0 lỗi, 30s. Dump: `accept-id/storyboard.json`.
- Từ tiếng Anh trong narration: 0 / 578 từ (từ khóa đối chiếu). Dấu tiếng Việt: 0.
- Dialogue: 30/151 từ thuộc tiếng Indonesia, 0 từ tiếng Anh. 11/14 beat có dialogue.
- Mẫu nguyên văn:
  - beat 0 narration: "Seorang pria muda dengan rambut merah-coklat mengenakan kaus gelap sedang menatap ke bawah..."
  - beat 0 dialogue: `"Artinya dia harus belajar lebih banyak lagi..."`, `"Aku hanya harus belajar, jadi apa masalahnya?"`
  - beat 2 dialogue: `"Kita perlu mempelajari mata pelajaran lain selain bahasa Korea dan penyelidikan."`
- Kịch bản: 12 segment (`accept-id/script-draft.json`). Mẫu segment 1: "Sementara itu, seorang wanita lain dengan ekspresi serius merasa bahwa waktu terus berjalan..."
- Recap: 1252 ký tự, có marker `Kết chương:` đúng 1 lần, còn lại tiếng Indonesia (`accept-id/recap.md`).
- TTS: `POST storyboard/tts {provider:"capcut", segIds:[2 đầu]}` → HTTP 200.
  - Voice: `readTtsConfig({provider:'capcut', lang:'id'})` → `id_female_noor` (Shinta). Đây là kiểm tra cấu hình, không đọc được voice từ file audio.
  - seg 775e4a0e: 17.568s; seg ecd29d0f: 11.256s. ffprobe khớp: mp3, 24 kHz. Mean volume -16.5 dB (có tiếng).
  - Lưu ý: cache TTS không ghi voice id.

## 2. Job en (app)

Job `9068ad7b-4c91-4a67-a7b0-a81ede1818a5`. `outputLanguage=en`.
- Vision: 14/14, 0 lỗi, 30s (`accept-en-app/storyboard.json`).
- Narration: 292 từ tiếng Anh hit, 0 từ tiếng Indonesia, 0 dấu Việt.
- Dialogue tiếng Anh (54 hit). Nguồn là tiếng Anh nên dialogue giữ nguyên, đây là hành vi đúng.
  - beat 0 narration: "A man with short red hair and a black t-shirt is shown from the chest up..."
- Kịch bản: 6 segment. Mẫu: "A young man, acknowledging the necessity for extensive studying, seems frustrated..."
- Recap: 818 ký tự, tiếng Anh, marker `Kết chương:` có mặt (`accept-en-app/recap.md`).
- TTS CapCut (2 segment đầu, sau đó 6 segment để render): voice `BV029_streaming` (từ `readTtsConfig` lang en).
  - seg f373fe54: 22.704s; seg 990b8785: 16.8s. ffprobe: mp3 24 kHz. Mean volume -18.3 dB.
- Render (`POST storyboard/render`, multipart rỗng → config mặc định): HTTP 200, `done`, `totalSec` 129.408.
  - `output.mp4`: h264 1080x1920 + aac 44.1 kHz, duration 129.408s. Mean volume -22.6 dB, max -3.4 dB.
  - `output.srt`: 15 cue tiếng Anh. Thư mục `accept-en-app/render-out/`.

## 3. Skill Python (vision thật)

Env override: `ZAI_API_KEY` = key OpenRouter (env thắng `.secrets.json`), `OPENAI_BASE_URL=https://openrouter.ai/api/v1`, `VISION_MODEL=google/gemini-2.5-flash`. Chạy `python3 -I`.
- Request có `thinking:{type:disabled}` (từ `mtv/vision_zai.py`). OpenRouter trả 200, không từ chối param này. Không kiểm chứng được là reasoning có tắt hay không.
- `--lang id --only 000,001,002` (workdir `skill-id/`): 3/3 OK. `validate --stage content` → `OK content: 3/14 slice described, tất cả pass schema`.
  - 000 dialogue: `["ARTINYA DIA HARUS BELAJAR LEBIH BANYAK...", "AKU HANYA PERLU BELAJAR, JADI APA MASALAHNYA?"]`
  - 001 description: "Seorang wanita berambut hitam panjang mengenakan baju hitam tanpa lengan terlihat menunduk..."
  - Tổng: 0 từ tiếng Anh, 20 từ tiếng Indonesia, 0 dấu Việt (trên 117 từ).
- `--lang en --only 000,001,002` (workdir `skill-en/`): 3/3 OK, validate PASS.
  - 001 description: "A close-up shot of a woman with long dark hair, styled with bangs..."
- Log: `skill-id.vision.log`, `skill-en.vision.log`, `skill-id.validate.log`.

## 4. Phát hiện

- Không có trường hợp model trộn ngôn ngữ (không kích hoạt mục D). Không cần sửa prompt `localizePrompt`.
- Vision thất bại đường cũ (manifest đổi ngôn ngữ khi lỗi, báo cáo cũ 6.1) không được tái hiện ở đường thành công này. Chưa kiểm tra lại.
- TTS mặc định của app là ElevenLabs. Không có `ELEVENLABS_API_KEY` thì mọi segment lỗi "Thiếu ELEVENLABS_API_KEY". Phải chọn `provider=capcut` (trong body hoặc Settings). Đây là cấu hình, không phải lỗi outputLanguage, nhưng người dùng job `en`/`id` sẽ gặp ngay nếu chưa chọn CapCut.
- Không có ASR, nên không xác nhận được giọng nói thật là tiếng Anh/Indonesia. Chỉ xác nhận: voice id theo cấu hình, duration khớp ffprobe, có tín hiệu audio.
- Chi phí: 2 job × 14 slice vision + 6 slice skill (3+3), 8 segment CapCut (2 id + 6 en; 2 en đã cache), 1 render 129s. Nguồn: 5 ảnh/job.

## 5. Không làm

- Render `id` (plan chỉ yêu cầu TTS).
- Hồi quy job `vi` cache HIT trên app (đã có từ báo cáo trước).
- Kiểm chứng `vision_zai` tắt reasoning trên OpenRouter.

## Câu hỏi chưa giải quyết

1. Có muốn ASR (hoặc người nghe) để xác nhận giọng CapCut thật sự đọc tiếng Anh/Indonesia? Hiện chỉ có bằng chứng cấu hình.
2. Khi chưa cấu hình TTS, mặc định ElevenLabs có phải là ý muốn? Với job `en`/`id` nên tự chọn CapCut không?
3. OpenRouter có tắt reasoning khi nhận `thinking:{type:disabled}` không? Cần đo token/latency để biết.

Status: DONE_WITH_CONCERNS
Summary: Vision thật qua OpenRouter PASS cho en và id (app 14/14 beat mỗi job, skill 3/3 slice mỗi ngôn ngữ). Kịch bản, recap (marker `Kết chương:` giữ nguyên) và TTS CapCut (id: Shinta, en: BV029) đều ra file có duration và tín hiệu audio. AC2/AC3 PASS, AC7 PASS có giới hạn (không ASR).
Concerns/Blockers: TTS mặc định ElevenLabs không có key, job en/id phải chọn CapCut tường minh. Không xác nhận nội dung giọng nói bằng ASR.
