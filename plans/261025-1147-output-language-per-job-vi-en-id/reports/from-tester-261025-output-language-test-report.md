# Báo cáo kiểm thử: ngôn ngữ đầu ra theo job (vi/en/id)

Ngày: 2026-10-25. Phạm vi: thay đổi chưa commit trên `main` (content-extractor + skill Python). Không sửa code production.

## Tóm tắt

| Hạng mục | Kết quả |
|---|---|
| `pnpm test:unit` (16 script) | PASS, exit 0, 737 check ✓, 0 ✗ |
| `pnpm lint` | PASS, exit 0, không cảnh báo |
| `npx tsc --noEmit -p .` | PASS, exit 0 |
| `pnpm build` | PASS, exit 0; 1 warning NFT (xem mục Build) |
| `SETTINGS_FILE=/dev/null pnpm test:e2e-video` | PASS, 34 ✓, 0 ✗ |
| `pnpm test:e2e` (storyboard) | PASS, 83 ✓, 0 ✗ |
| `pnpm test:render` | PASS, 23 ✓, 0 ✗ |
| `pnpm test:parity` | PASS |
| `tests/run_all.py` (skill) | PASS 4/4 |
| Hồi quy vi (prompt byte-level so với HEAD) | PASS, 8/8 chuỗi giống hệt |
| Thật: vision en/id (z.ai) | BLOCKED: HTTP 401 từ z.ai |
| Thật: kịch bản en + TTS CapCut en | PASS (hand-written script) |
| Thật: TTS CapCut id | PASS |
| Thật: TTS CapCut vi cache HIT | PASS |

## 1. Automated

Môi trường: Node 24.18.0 (nvm Herd).

- `pnpm test:unit`: 12.7s. Chuỗi `&&`, 16 script. Các script in marker `ALL_PASS` gồm fonts, parity, subtitle-render, subtitle-style, project. Các script khác thoát 0 không có marker. Không có dòng ✗ hay FAIL.
- Vùng phủ theo plan (đã kiểm trong code test):
  - `verify-script.mts` Test 1d: hash vi cho vision, biên kịch, recap, có và không context, cả trường hợp `lang='vi'` tường minh. Test kiểm en/id: chứa `DỊCH sang <tên>`, `PHẢI dịch`, `ngôi thứ ba`, `Kết chương:`, và không còn cụm chỉ dẫn đặc thù tiếng Việt.
  - `verify-tts-settings.mts` section 2 (hằng số `GOLDEN` ElevenLabs, có ở HEAD) và section 15 (`pickVoiceForLang`, `readTtsConfig({lang})`, ngôn ngữ không có giọng → throw kèm gợi ý ElevenLabs).
  - `verify-project.mts`: round-trip `outputLanguage`, file cũ → undefined, giá trị lạ → throw; bundle; PATCH `/api/jobs/[id]` (200 với en, 400 với `ja`, body hỏng không ghi field nào).
- Build: `next build` thành công. Warning Turbopack "Encountered unexpected file in NFT list" truy vết qua `next.config.ts` → `lib/settings.ts` → `app/api/settings/models/route.ts`. Cả ba file không nằm trong diff, nên khả năng cao là có sẵn từ trước. Chưa đối chiếu với build trên HEAD.

### Lưu ý về phủ test
- PATCH `outputLanguage` được test trong `verify-project.mts`, không nằm ở `verify-settings-routes.mts` như plan gợi ý. Plan cho phép "hoặc file route tương ứng", nên chấp nhận.
- `e2e-script-video.mts` và `e2e-storyboard.mts` không có tham chiếu `outputLanguage` nào. Luồng job en/id qua API tới TTS/render chưa được e2e phủ.

## 2. Mock e2e

- Môi trường: 3 mock (vision :3106, biên kịch :3108, TTS :3107) và `next start -p 3105` trên build vừa tạo, `SETTINGS_FILE=/dev/null`, `TTS_CACHE_DIR` trỏ vào scratchpad. Không đụng :3000. Đã tắt toàn bộ sau khi chạy xong.
- `test:e2e-video`: A-E đều PASS (upload, Generate all, script, sửa/tách/gộp/reorder/confirm, TTS synth + cache HIT, export bundle).
- `test:e2e`: PASS, gồm xóa nhịp khi đang Generate → 409, beatId lạ → 404, progress.total sau xoá.
- `test:render`: PASS (cache HIT TTS, BGM ducking, burn phụ đề, duration 6.00).
- Không dùng dev server `next dev` (script ghi `.next` đè bản build).

## 3. Skill Python

- `tests/run_all.py` bằng `scratchpad/venv/bin/python3`, `PYTHONDONTWRITEBYTECODE=1`: `RUN_ALL PASS: 4/4`. Gồm test_parity (golden caption, OUTPUT_LANGUAGES, CAPCUT_VOICES, pick_voice_for_lang, golden prompt vision theo ngôn ngữ), smoke validate 16 case, auto-region v2.1, parity với snapshot TS, facade Codex.
- Venv `~/.claude/skills/.venv` vẫn hỏng (không sửa, đúng yêu cầu).

## 4. Hồi quy vi (bằng chứng mới)

Test 1d so hash với hash cũng vừa đo trên working tree. Hash đó chưa tồn tại ở HEAD nên không chứng minh gì về HEAD. Để kiểm đúng, tôi xuất `HEAD:content-extractor` ra `scratchpad/head/` (`git archive`, không đụng repo) và so chuỗi đầu ra thật:

- Script throwaway: `scratchpad/throwaway/vi-regression.mts`.
- Kết quả: `VI_REGRESSION_OK`. 8/8 chuỗi giống hệt từng ký tự:
  - vision không context (len 1255), có context (1486);
  - biên kịch không context (1576), có context (1985);
  - recap (650);
  - mỗi trường hợp so với cả gọi có `lang='vi'` lẫn gọi mặc định.
- Hash mẫu: vision `7b3e8896d8a9eaf7`, biên kịch `6dd6f0699fdcf860`, recap `5b1d4a64aedfd41c`, giống hash trong test.
- Cache key ElevenLabs: golden `fd4be6e9…` vẫn PASS trong `verify-tts-settings` section 2.
- Cache TTS vi (CapCut, xem mục 5): giọng mặc định `BV074_streaming`, chạy lần 2 là cache HIT.

## 5. Thật: nghiệm thu

### 5.1 Chương nguồn
- Thư mục `~/Downloads/Vừa Gả Đã Làm Mẹ Kế…` trong memory KHÔNG còn tồn tại. Không tìm được chương tiếng Việt tương đương.
- Dùng thay thế: `~/Downloads/atsu/ImageAssistant_Batch_Image_Downloader/atsu.moe/Human_Natural_Enemy_-_Chapter_43/`, truyện tiếng Anh, 30 strip 800x5000. Copy 5 ảnh đầu (10100-10104.jpeg) vào `scratchpad/src-en-chapter/` (thư mục mới, rỗng).
- Ingest chạy với `python3 -I`: 5 ảnh → canvas 800×24040 → 14 slice (14 trimmed), `stages.ingest = done`, workdir `scratchpad/accept-en`.

### 5.2 Vision en: BLOCKED
- `vision.py --workdir accept-en --lang en --only 000,001,002`: exit 1. Cả 3 slice: `HTTP 401: Authentication Failed`. Manifest ghi `output_language=en`, `content/` rỗng.
- Đã kiểm: `ZAI_API_KEY` có trong `~/.claude/skills/manga-to-video/.secrets.json` (key tồn tại, không in giá trị). Không có env override `OPENAI_BASE_URL`/`VISION_MODEL`. Endpoint mặc định `https://api.z.ai/api/coding/paas/v4`.
- Probe 1 request text tối thiểu (không ảnh): `status 401`, body `{"error":{"code":"1000","message":"Authentication Failed"}}`. Key bị từ chối deterministic. Không phải lỗi mạng hay timeout.
- Hệ quả: không có output vision thật, nên không xác minh được description/dialogue tiếng Anh, không chạy `--lang id` vision, không chạy `validate --stage content` có ý nghĩa.
- Không lấy key từ nơi khác (`.env.local` của app) vì ngoài phạm vi đã được ủy quyền.

### 5.3 Kịch bản en (hand-written, không phải output model)
- Plan bước 4 cho phép viết tay `script.json`. Tôi viết 4 segment phủ đủ 14 slice (`[0,1,2]`, `[3..6]`, `[7,8,9]`, `[10..13]`), narration tiếng Anh placeholder. Đây là văn bản kiểm thử TTS, không phải kết quả biên kịch.
- `validate.py --stage script`: `OK script: 4 segment phủ đủ 14 slice, ước tính ~26s audio`, exit 0.

### 5.4 TTS CapCut en
- `tts.py --workdir accept-en` (không truyền `--lang`, lấy từ manifest): `OK tts: 4 segment (0 cache hit) | provider capcut, voice BV029_streaming | tổng audio ~23.3s`.
- `audio-manifest.json`: `provider=capcut`, `voice_id=BV029_streaming`.
- Catalog: `BV029_streaming` = "American Female", `lang=en`.
- ffprobe (mp3 mono, 24 kHz, 160 kbps, mp3):

| Segment | Số ký tự | duration_sec (manifest) | ffprobe | ký tự/giây |
|---|---|---|---|---|
| seg-000 | 106 | 6.48 | 6.480 | 16.4 |
| seg-001 | 83 | 5.784 | 5.784 | 14.3 |
| seg-002 | 86 | 5.64 | 5.640 | 15.2 |
| seg-003 | 82 | 5.40 | 5.400 | 15.2 |

- Không có ASR trong môi trường nên chưa xác minh nội dung giọng nói là tiếng Anh bằng tai/ASR. Chỉ xác minh được voice id và catalog.

### 5.5 Lặp nhanh id
- Workdir `scratchpad/accept-id`: manifest `output_language=id`, script 1 segment tiếng Indonesia, 14 slice.
- `validate --stage script`: OK. `tts.py`: `voice id_female_icha_uranus_bigtts`, 1 segment, tổng ~6.7s, `duration_sec=6.744`. Catalog: lang `id`.
- Vision id: BLOCKED (cùng lý do 401).

### 5.6 Hồi quy vi (TTS thật)
- Workdir `scratchpad/accept-vi`: manifest `output_language=vi`, 1 segment tiếng Việt.
- Lần 1: `0 cache hit | voice BV074_streaming`. Lần 2: `1 cache hit`. Cache vi hoạt động và giọng mặc định không đổi.

## 6. Phát hiện mới

### 6.1 Manifest đổi ngôn ngữ kể cả khi vision thất bại (mức độ: trung bình)
- Tái hiện: `accept-mixed` có manifest `output_language=vi`, chạy `vision.py --only 000 --lang en` với 401. Kết quả: cảnh báo `workdir đang là 'vi', đổi sang 'en'`, và sau khi chạy manifest là `en`. Không có slice nào được đọc.
- Nguyên nhân (đọc code): `vision.py` dòng ~121 gán `manifest["output_language"] = lang` trước khi mô tả, và `save_manifest` luôn chạy ở cuối (kể cả khi `failures` không rỗng).
- Hệ quả: nếu workdir đã có content vi, manifest sẽ nói `en`. `tts.py` (không `--lang`) lúc đó chọn giọng en cho lời kể vi. Cảnh báo chỉ hiện trên stderr.
- Đề xuất: chỉ ghi `output_language` khi có ít nhất một slice mô tả thành công, hoặc ghi khi `--force`. Không sửa trong phiên này (không đổi production code).
- Không phải lỗi trong luồng bình thường. Chỉ xảy ra khi đổi ngôn ngữ giữa chừng và toàn bộ slice thất bại.

### 6.2 `validate --stage content` pass vô nghĩa
- `validate.py --workdir accept-en --stage content` → `OK content: 0/14 slice described, tất cả pass schema`, exit 0.
- Validator không báo thiếu coverage content. Một workdir chưa vision vẫn qua. Chỉ là ghi nhận, không phải lỗi chắc chắn vì có thể là thiết kế (validate từng file có mặt).

### 6.3 Thiếu e2e phủ `outputLanguage`
- Xem mục "Lưu ý về phủ test". Luồng job en/id từ API tới TTS/render không được e2e mock phủ.

## 7. Checklist plan phase-07

- [x] Unit: vi hash, prompt en/id, recap marker (verify-script).
- [x] Unit: pickVoiceForLang, readTtsConfig({lang}), ElevenLabs không đổi (verify-tts-settings).
- [x] Unit: round-trip `.mtvproj`, giá trị lạ throw, PATCH 200/400 (verify-project).
- [~] PATCH trong verify-settings-routes: chuyển sang verify-project (plan cho phép).
- [x] `pnpm test:parity` + `run_all.py`.
- [x] `pnpm test:unit && pnpm lint && pnpm build` (Node 24).
- [x] E2E mock: `test:e2e-video` (SETTINGS_FILE=/dev/null), `test:e2e`, `test:render`.
- [ ] Vision en thật: BLOCKED (z.ai 401).
- [ ] Kiểm description/dialogue tiếng Anh thật: BLOCKED (phụ thuộc vision).
- [x] Manifest `output_language=en` (ghi bởi vision.py trước khi lỗi, xem 6.1).
- [~] TTS CapCut en thật: PASS với kịch bản viết tay. Nội dung giọng chưa xác minh bằng ASR.
- [ ] Vision id thật: BLOCKED.
- [x] TTS CapCut id thật: PASS.
- [x] Job vi: TTS cache HIT lần 2.
- [ ] Render en thật và nghe audio: không thực hiện (ngoài danh sách task, và phụ thuộc kịch bản thật).
- [ ] Job vi cũ trong app với bundle thật: không thực hiện, chỉ có đường mock e2e.

## 8. Việc cần làm tiếp (ưu tiên)

1. Thay key z.ai hoặc làm mới key trong `~/.claude/skills/manga-to-video/.secrets.json`, rồi chạy lại vision en và id trên `scratchpad/accept-en` (slice 000-002) và `--lang id` trên một slice trong workdir mới. Sau đó chạy `validate --stage content` và kiểm tra description/dialogue có là tiếng Anh/Indonesia.
2. Sửa 6.1 trong skill (ghi `output_language` chỉ khi có thành công) và thêm test trong `tests/` của skill.
3. Thêm e2e hoặc verify cho luồng `outputLanguage` của job qua API tới route TTS/render (mock vision/TTS).
4. Xem xét cảnh báo NFT của Turbopack có sẵn từ trước không (build HEAD).

## Câu hỏi chưa giải quyết

- Key z.ai trong `.secrets.json` bị từ chối (code 1000). Key đã hết hạn, bị thu hồi, hay thuộc gói khác? Cần chủ key kiểm tra.
- Thư mục chương `Vừa Gả…` trong memory `corpus-that-downloads-baseline` không còn trên đĩa. Có còn ở nơi khác không?
- Có cần xác minh giọng TTS là tiếng Anh/Indonesia bằng ASR không? Môi trường hiện không có ASR.
- Hành vi ghi `output_language` khi vision thất bại (6.1) có được coi là bug cần sửa, hay là chấp nhận được vì đã có cảnh báo?

## Artifact

- Log: `scratchpad/unit.log`, `lint.log`, `tsc.log`, `build.log`, `e2e-video.log`, `e2e-storyboard.log`, `render.log`, `parity.log`, `py-run-all.log`, `accept-ingest.log`, `accept-vision-en.log`, `accept-tts-en.log`, `accept-tts-id.log`.
- Workdir: `scratchpad/accept-en`, `accept-id`, `accept-vi`, `accept-mixed`.
- Throwaway: `scratchpad/throwaway/vi-regression.mts`, `scratchpad/throwaway/zai_probe.py`.

Status: BLOCKED
Summary: Automated (unit 737 ✓, lint, tsc, build, 3 e2e/render, parity, skill 4/4) PASS. Hồi quy vi chứng minh byte-identical với HEAD. Thật: TTS CapCut en/id và cache vi PASS với kịch bản viết tay; vision en/id bị z.ai 401 nên không có bằng chứng description/dialogue tiếng Anh.
Concerns/Blockers: (1) z.ai key trong .secrets.json bị từ chối, code 1000 — chặn vision thật. (2) vision.py ghi output_language kể cả khi toàn bộ slice lỗi, có thể gây giọng TTS sai (6.1). (3) e2e không phủ outputLanguage. Chi tiết và câu hỏi mở ở trên.
