# Code review: chọn ngôn ngữ đầu ra theo job (vi/en/id)

Ngày: 2026-10-25 · Phạm vi: `git diff` trong `content-extractor/` (bỏ qua `.claude/agent-memory/**`) + `lib/output-language.ts` mới + skill Python `~/.claude/skills/manga-to-video` + `~/.claude/agents/manga-vision-reader.md` + facade Codex.

## Kết luận

Không có lỗi mức CAO. Phía TS chắc chắn: prompt vi giống hệt từng byte, cache key ElevenLabs không đổi, mọi call-site đã cập nhật, typecheck, lint, build và test đều xanh. Vẫn còn **3 lỗi TRUNG BÌNH**: hai lỗi làm UI hoặc skill nói một đằng làm một nẻo (người dùng nghe giọng hoặc ngôn ngữ khác với điều UI hay yêu cầu nói), một lỗi parity phủ chưa đủ. Có thêm vài điểm THẤP.

## Đã kiểm chứng (bằng chạy, không tin vào mô tả)

| Hạng mục | Cách kiểm | Kết quả |
|---|---|---|
| AC1 prompt vi giống từng byte | `git archive HEAD lib` ra scratchpad, tính lại 5 hash của Test 1d bằng code HEAD | Khớp cả 5 (`7b3e…`, `c928…`, `6dd6…`, `3879…`, `5b1d…`) → hash là của bản TRƯỚC khi đổi, test có giá trị thật |
| Câu nghe thử vi (cache preview) | `xxd` chuỗi ở HEAD `lib/tts.ts` so với `output-language.ts` | Giống từng byte (cùng NFC) |
| Cache key ElevenLabs | Đọc code: `catalogVoices('elevenlabs')` = undefined → `pickVoiceForLang` trả nguyên voiceId; preview: `voiceLang` undefined → dùng câu mẫu cũ | Không đổi key |
| Cache key CapCut vi | `voiceId=''` + vi → `picked === candidate` → giữ `''` → `resolveVoiceId` như cũ | Không đổi key (trừ trường hợp hiếm CAPCUT_VOICE là giọng en/id cho job vi) |
| Bất biến cache key | `synthSegment` tính key qua `provider.resolveVoiceId(cfg)` sau khi `readTtsConfig` đã đổi giọng | Key luôn phản ánh đúng giọng sẽ synth |
| Call-site | `git grep` describeImage/readTtsConfig/generateScript/generateRecap/buildPrompt/toScriptManifest/buildBundle/createJob | Đã cập nhật đủ; các chỗ không truyền lang (voices route, export toScriptManifest của .mtvproj) là có chủ ý |
| Python ↔ TS `pickVoiceForLang` | Fuzz vi sai 240 tổ hợp (3 provider × 20 voiceId gồm `''`/custom/có khoảng trắng × 4 lang gồm `xx`) | 0 lệch |
| `pnpm test:unit` | Node 24 | exit 0, PARITY_ALL_PASS |
| `tsc --noEmit` | tsconfig có `**/*.mts` → phủ cả scripts | exit 0 |
| `pnpm lint` | | sạch |
| `pnpm build` | (không có dev server :3000) | thành công |
| Python `test_parity.py` | | PASS (gồm golden prompt vision 3 ngôn ngữ × 2 context, catalog, pick_voice) |
| Python `sync_codex_facade.py --check` | | khớp |
| Python smoke validate | | **KHÔNG chạy được**: `~/.claude/skills/.venv/bin/python3` trỏ tới `/opt/homebrew/opt/python@3.14` đã gỡ (máy giờ có 3.15); không interpreter nào có `jsonschema`. Lỗi môi trường, không do diff (validate.py không đổi) |
| (g) job vắng sau restart | Đọc `lib/jobs.ts` + `lib/storyboard-store.ts` | Cả hai đều in-memory trên globalThis, không có đường xoá job → không thể có storyboard mà thiếu job. Các route `getJob(id)?.outputLanguage` lùi về vi/không ràng buộc là đủ |

---

## TRUNG BÌNH

### M1. Trang video ghi tên giọng không phải giọng server thực sự synth
`content-extractor/app/video/[jobId]/page.tsx:475-476, 769, 785` so với `content-extractor/lib/tts.ts:52-64` + `lib/tts-providers/catalog.ts:66-78`

Comment trong catalog nói rõ ý đồ: "dùng CHUNG cho server và UI, để hai bên không chọn khác giọng nhau". UI thì không dùng `pickVoiceForLang` mà tự đoán:

- **Job en, chọn CapCut, giọng để rỗng** → UI ghi `Mặc định (American Female)` (= `capcutVoices[0]`). Server lại xét `candidate = st.voiceId (Settings) || CAPCUT_VOICE`. Settings đang là `en_us_010`, hoặc `CAPCUT_VOICE=en_us_007` → server **giữ** giọng đó (đúng ngôn ngữ), nên synth "Charming Male" trong khi UI ghi "American Female". Nếu CAPCUT_VOICE là giọng tự đặt ngoài catalog (rất có thể là giọng Việt) → server giữ nguyên, **đọc tiếng Anh bằng giọng Việt**, UI vẫn ghi "American Female".
- **Cảnh báo `voiceMismatch`** ("synth sẽ dùng giọng mặc định"): với giọng catalog sai ngôn ngữ, server lấy **giọng đầu của ngôn ngữ** (job vi → `BV074`), KHÔNG lấy Settings/CAPCUT_VOICE. Thế mà ở job vi, ô "Giọng mặc định" mang nghĩa CAPCUT_VOICE/Settings. Hai nghĩa "mặc định" khác nhau.
- Thêm một điểm lệch ngay trong server: rỗng → tôn trọng giọng Settings/ENV nếu đúng ngôn ngữ, nhưng override sai ngôn ngữ → bỏ qua Settings/ENV dù đúng ngôn ngữ, nhảy thẳng về giọng đầu. AC4 ghi "rỗng/sai → giọng đầu của ngôn ngữ đó", nên cả hai nhánh đều chưa khớp chữ của AC.

Cách sửa (chọn một):
1. Thêm `GET /api/settings/tts/resolve?provider&voiceId&lang` (hoặc trả kèm trong DTO), gọi `readTtsConfig({..., lang})` rồi `resolveVoiceId`, để UI hiển thị đúng giọng hiệu dụng. Đây là nguồn sự thật duy nhất.
2. Tối thiểu: đổi nhãn thành trung tính (`Mặc định theo Settings/ENV — nếu sai ngôn ngữ thì dùng <giọng đầu>`), bỏ chữ "giọng mặc định" trong cảnh báo, ghi thẳng "sẽ dùng `<capcutVoices[0].label>`" cho nhánh catalog sai ngôn ngữ. Đồng thời sửa câu chữ AC4 trong plan cho khớp hành vi thật.

### M2. Skill Python: đường fallback subagent làm mất ngôn ngữ đầu ra mà không báo gì
`~/.claude/skills/manga-to-video/scripts/vision.py:92-96`, `SKILL.md:147-149`, `scripts/tts.py:132`

Chỉ `vision.py` ghi `manifest.output_language`, và nó `fail("api-key-missing")` **trước** khi đọc hoặc ghi manifest. Thiếu `ZAI_API_KEY` → SKILL.md bảo chuyển sang subagent `manga-vision-reader`, nhưng danh sách "Prompt giao việc PHẢI có" chỉ gồm workdir, slice id và ngữ cảnh, **không có ngôn ngữ**. Agent không được giao ngôn ngữ thì mặc định tiếng Việt (`manga-vision-reader.md:26`). Kịch bản kéo theo:
- User yêu cầu tiếng Anh nhưng máy không có key → content vi → bước 4 đọc `manifest.output_language` (vắng = vi) → kịch bản vi → `tts.py` lang=vi → giọng vi. Video ra **tiếng Việt hoàn toàn**, không có cảnh báo nào.

Cách sửa:
- `SKILL.md:148`: thêm "ngôn ngữ đầu ra" vào danh sách bắt buộc của prompt giao việc. Thêm một dòng: orchestrator tự ghi `manifest.output_language` khi đi đường fallback (hoặc truyền `tts.py --lang`).
- Hoặc gọn hơn: trong `vision.py`, chuyển việc đọc manifest, validate `--lang` và ghi `output_language` lên **trước** bước kiểm key. Khi đó fail vì thiếu key vẫn ghi lại ngôn ngữ cho các bước sau.
- Nhớ chạy `sync_codex_facade.py` sau khi sửa SKILL.md.

### M3. Parity chưa phủ logic chọn giọng, chỉ phủ dữ liệu catalog
`~/.claude/skills/manga-to-video/tests/test_parity.py:161-166`, `content-extractor/scripts/gen-parity.mts:208-211`

Snapshot `i18n` chỉ chứa `output_languages` và `capcut_voices` (dữ liệu). Các case `pick_voice_for_lang` là kỳ vọng viết tay, chép từ `verify-tts-settings.mts`, nên sửa logic `pickVoiceForLang` bên TS (vd thêm nhánh "giọng sai ngôn ngữ → ưu tiên Settings") thì `pnpm gen:parity` + `test_parity` **vẫn xanh**. Logic chọn candidate (`tts.py:135` so với `tts.ts:55`) cũng không có golden nào, và đã lệch thật: Python `.strip()` CAPCUT_VOICE, TS thì không (xem L4). Repo này đã từng có drift TS↔Py lọt qua golden, nên đây là đúng loại lỗi cần chặn.

Cách sửa: thêm `goldens.pick_voice` vào `gen-parity.mts`, sinh bằng chính `pickVoiceForLang` trên tích Descartes (provider × [`''`, custom, mọi id catalog] × lang). `test_parity.py` lặp qua đó thay cho case viết tay. Fuzz 240 tổ hợp ở trên chính là bộ input này.

---

## THẤP

### L1. Không bump SCRIPT_VERSION: CLI cũ đọc bundle en/id sẽ đọc sai giọng mà không báo
`content-extractor/lib/schema.ts:218-220`, `lib/bundle.ts:73`, `lib/storyboard-render-input.ts:24`
Reader cũ kiểm `version === SCRIPT_VERSION` (vẫn 1) và bỏ qua field lạ. Bundle en, `renderConfig.tts.voiceId=''`, render bằng checkout cũ ở máy khác → CAPCUT_VOICE/BV074 đọc lời kể tiếng Anh. Cách hiện tại an toàn cho reader **mới** và cho mọi bundle vi; rủi ro chỉ có khi máy render không cùng phiên bản. Gợi ý không cần bump: trong `buildBundle`, khi lang ≠ vi, ghi giọng đã resolve (`readTtsConfig({..., lang}).voiceId`) vào `config.tts.voiceId` của bundle. CLI cũ khi đó cũng dùng đúng giọng, còn cache key không đổi vì cùng giọng.

### L2. Trang video ghi "(đổi ở trang Nhận chapter)" nhưng thực tế không đổi được
`app/video/[jobId]/page.tsx:759`
`jobId` ở trang chủ là state cục bộ, chỉ được set khi upload (`app/page.tsx:164`). Quay lại trang chủ chỉ thấy khu upload mới; job đã tạo (hoặc mở từ .mtvproj) không có UI nào để đổi ngôn ngữ. Sửa câu chữ ("chọn khi tải chapter") hoặc bỏ cụm này.

### L3. Nút "Tạo storyboard" không bị khoá khi PATCH ngôn ngữ đang chạy
`app/page.tsx:416` (chỉ `sbBusy || items.length === 0`) so với `:431` (`langBusy || sbBusy`)
Đổi ngôn ngữ rồi bấm ngay "Tạo storyboard" → PATCH lỗi thì dropdown trả về giá trị cũ, nhưng trang đã chuyển sang storyboard và job vẫn là vi. Vision chưa chạy nên không hỏng dữ liệu, nhưng người dùng tưởng đang chạy en. Sửa: `disabled={sbBusy || langBusy || items.length === 0}`.

### L4. Lệch nhỏ TS↔Py: `.strip()` CAPCUT_VOICE
`~/.claude/skills/manga-to-video/scripts/tts.py:135` strip; `content-extractor/lib/tts.ts:55` không strip; `tts_capcut.resolve_voice_id` (Python) cũng không strip. Với `CAPCUT_VOICE=" BV074_streaming"` + job en: Python đổi sang BV029, TS coi đây là giọng ngoài catalog, giữ nguyên, rồi đọc giọng Việt. Thống nhất một phía (khuyên strip ở cả hai, kể cả trong `resolveVoiceId`).

### L5. `tts.py` không validate `manifest.output_language`
`scripts/tts.py:132`: `--lang` có `choices` nhưng giá trị lấy từ manifest thì không kiểm. Manifest có `"ja"` (sửa tay) → CapCut báo `"chưa có giọng Tiếng Việt"` (do `get_output_language` lùi về vi, sai ngôn ngữ trong thông báo); ElevenLabs chạy tiếp mà không báo gì. Thêm kiểm tra giống `vision.py:114-115`.

### L6. Test 16 là tautology
`scripts/verify-tts-settings.mts:294`: `TTS_PREVIEW_SAMPLE` được **định nghĩa** bằng `getOutputLanguage('vi').previewSample`, nên phép so luôn đúng và không giữ được literal cũ. Đổi thành so với literal cứng `'Đây là giọng đọc thử cho video recap truyện tranh.'` (đã kiểm bằng `xxd`: hiện đang khớp).

### L7. Comment PATCH nói đổi giữa chừng "không hỏng dữ liệu", nhưng với ngôn ngữ điều đó không đúng
`app/api/jobs/[id]/route.ts:20-23`: với `context` thì đúng, với `outputLanguage` thì đổi khi "Generate all" đang chạy sẽ cho content trộn hai ngôn ngữ (UI không cho, nhưng API cho). Không cần chặn, vì UI là caller duy nhất. Chỉ cần chỉnh comment cho thật, hoặc trả 409 khi storyboard đang ở phase `processing`.

---

## Đối chiếu AC

| AC | Trạng thái | Ghi chú |
|---|---|---|
| AC1 | ĐẠT | Hash khớp HEAD (đã kiểm độc lập) |
| AC2/AC3 | ĐẠT (mức code) | Prompt vision/biên kịch/recap localize đúng, nhãn `Kết chương: ` giữ nguyên. Chưa kiểm e2e model thật |
| AC4 | MỘT PHẦN | Lọc giọng đúng; lỗi gợi ý ElevenLabs có. Nhãn "mặc định" sai so với giọng thật (M1); "rỗng → giọng đầu" không đúng khi Settings/ENV có giọng cùng ngôn ngữ |
| AC5 | ĐẠT | .mtvproj + bundle round-trip, file cũ → vi, giá trị lạ bị từ chối. Route export/import chỉ được phủ gián tiếp |
| AC6 | MỘT PHẦN | `--lang` có, parity catalog + prompt vision có. Logic chọn giọng không nằm trong golden (M3); fallback subagent mất ngôn ngữ (M2) |
| AC7 | MỘT PHẦN | unit/tsc/lint/build xanh. Smoke Python không chạy được vì venv hỏng. Chưa thấy bằng chứng e2e en thật trong lượt review này |

## Câu hỏi còn mở
1. Hành vi mong muốn cho "rỗng" ở job en là gì: luôn lấy giọng đầu (theo đúng chữ AC4), hay tôn trọng giọng Settings/ENV nếu cùng ngôn ngữ (hành vi hiện tại)? Cần chốt trước khi sửa M1.
2. Có máy nào render bundle bằng checkout cũ không? Nếu không thì L1 bỏ qua được.
3. Venv skill (`~/.claude/skills/.venv`) cần tạo lại với python3.15 để smoke validate chạy được. Đây là việc ngoài phạm vi diff, nhưng là điều kiện để AC7 có bằng chứng.
