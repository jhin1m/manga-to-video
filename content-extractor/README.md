# Manga Content Extractor

Tool nội bộ, một người vận hành. Pipeline: **Nhận chapter → Storyboard → Kịch bản → Video.**

**Nhận chapter (`/`):** nhận nhiều ảnh đánh số / file zip / file PDF → **gộp toàn bộ thành một canvas dọc rồi chia lại thành band tại gutter** (khoảng trắng ngang dày) — mỗi band giữ trọn một đơn vị nội dung (nhân vật kèm bong bóng), không cắt ngang bubble/chữ → xem trước lưới band, xoá band thừa, nhập ngữ cảnh chương, chọn **ngôn ngữ đầu ra** (`vi` mặc định / `en` / `id`) → **Tạo storyboard**. Trang này KHÔNG gọi vision.

**Ngôn ngữ đầu ra (theo job):** áp cho mô tả + thoại vision (thoại được dịch sang ngôn ngữ đã chọn), kịch bản, recap và giọng TTS. Lưu trong `.mtvproj` và bundle; file cũ không có field = `vi`. Trang video chỉ liệt kê giọng CapCut đúng ngôn ngữ job; giọng đã lưu sai ngôn ngữ tự đổi sang giọng đầu tiên của ngôn ngữ đó (`id` mặc định Shinta). Marker recap `Kết chương: ` giữ nguyên ở mọi ngôn ngữ.

**Storyboard:** danh sách nhịp hình ảnh + lời đọc (dành cho TTS + video tạo Ken Burns). Mỗi band từ lúc upload = 1 nhịp — biên nhịp đã chuẩn từ ingest nên không cần tách/gộp tay. Nhịp khởi tạo **pending sạch** (chưa có lời đọc); bấm **Generate all** (batch vision toàn bộ nhịp pending/lỗi, giãn nhịp theo RPM, tiến độ live) hoặc **Generate ✨** từng nhịp, hoặc điền tay. Nội dung vision (`mô tả + thoại`, theo ngôn ngữ đầu ra của job) được lưu lại để bước Kịch bản dùng — không gọi vision lần hai.

**Stage 2:** **Kịch bản AI + Video.** Model text (biên kịch) đọc nội dung mọi band → viết kịch bản kể mạch lạc, **gộp/tách band** thành `ScriptSegment[]` (1 lời kể ↔ 1+ shot) → người duyệt/sửa/chốt ở UI → preview video xấp xỉ (`/video/{jobId}`, Ken Burns CSS + phụ đề live + BGM) → export **bundle.zip** → CLI ffmpeg render **MP4 + .srt + timeline.json**. Bất biến sync: audio TTS là nhạc trưởng — narration khớp cứng với segment, audio phân bổ cho các shot theo weight.

Không DB, không auth, không queue. Job sống trong RAM — restart server là mất; **file JSON export / bundle.zip chính là bản lưu**.

## Chạy

Yêu cầu Node 24 (`.nvmrc` đã pin; máy dùng Herd nvm thì `nvm use 24`). **ffmpeg/ffprobe tự bundle qua npm** (`ffmpeg-static` + `@ffprobe-installer/ffprobe`) — cài xong dependency là render được trên cả macOS lẫn Windows, không cần cài ffmpeg tay. Máy đã có ffmpeg hệ thống (vd `brew install ffmpeg`) thì bản đó được **ưu tiên** (thứ tự resolve: `FFMPEG_PATH`/`FFPROBE_PATH` → PATH → bundled). Burn-in phụ đề cần build có libass; bản ưu tiên thiếu libass thì engine tự rơi xuống bản bundled cho riêng bước burn (cả hai thiếu mới bỏ burn-in và giữ `.srt` rời, có cảnh báo). Lưu ý: `ffmpeg-static` tải binary (~45MB) từ GitHub releases lúc `pnpm install` — mạng bị chặn thì bundled không có, app vẫn chạy được bằng ffmpeg trên PATH (hỗ trợ `HTTPS_PROXY` khi install).

```bash
npm install
cp .env.example .env.local   # rồi điền OPENAI_API_KEY (+ ELEVENLABS_API_KEY nếu dựng video)
npm run dev                  # http://localhost:3000
```

## Cấu hình (ENV — đổi nhà cung cấp không cần sửa code)

> **Đổi nhanh từ UI:** nút **AI** (⚙️) trên header mở Settings dialog — chọn provider
> (OpenAI / Z.AI / OpenRouter / Custom) + vision model + script model, lưu vào
> `.settings.json` (gitignored, không chứa key) và **ưu tiên hơn ENV**, hiệu lực ngay không
> cần restart. Key vẫn khai trong `.env.local` theo provider: `OPENAI_API_KEY`,
> `ZAI_API_KEY`, `OPENROUTER_API_KEY` (thiếu key riêng → fallback `OPENAI_API_KEY`).
> Nút "Dùng theo ENV" trong dialog xóa `.settings.json` → quay về cấu hình ENV dưới đây.
> Test/e2e đặt `SETTINGS_FILE=/dev/null` để chạy ENV thuần.

**Vision LLM (Generate — Storyboard)**

| Biến | Ý nghĩa | Mặc định |
|------|---------|----------|
| `OPENAI_API_KEY` | API key (bắt buộc) | — |
| `OPENAI_BASE_URL` | Endpoint OpenAI-compatible | `https://api.openai.com/v1` |
| `VISION_MODEL` | Model vision | `gpt-4o-mini` |
| `MAX_EDGE` | Cạnh dài tối đa ảnh gửi model (px, downscale trước khi encode). Ảnh dải dọc (ratio ≥ `STRIP_RATIO`) chỉ kẹp **bề rộng** theo ngưỡng này; giữ nguyên chiều cao để stitch/smart-split không mất chữ. Payload vision luôn ≤ `MAX_EDGE` | `1568` |
| `VISION_CONCURRENCY` | Số ảnh gọi vision song song | `4` |
| `VISION_RPM` | Nhịp tối đa khi bấm Generate all (requests/phút) — giãn thời điểm bắt đầu mỗi request để chặn 429; chỉnh nhanh mỗi lượt bằng ô "Nhịp" cạnh nút Generate all (trang Storyboard) | `30` |
| `VISION_DISABLE_THINKING` | Tắt "thinking/reasoning" của model (GLM z.ai) để tiết kiệm ~50% token | `false` |

Chuyển sang Z.AI GLM: `OPENAI_BASE_URL=https://api.z.ai/api/paas/v4` + `VISION_MODEL=glm-4.5v` + `VISION_DISABLE_THINKING=true`.

**Kịch bản AI (Stage 2 — biên kịch)**

| Biến | Ý nghĩa | Mặc định |
|------|---------|----------|
| `SCRIPT_MODEL` | Model text viết kịch bản (gộp/tách band thành đoạn kể) | `gpt-4o` |
| `SCRIPT_API_KEY` / `SCRIPT_BASE_URL` | Chỉ đặt khi biên kịch dùng NHÀ CUNG CẤP KHÁC vision — mặc định dùng chung `OPENAI_*` | — |
| `SCRIPT_DISABLE_THINKING` | Tắt thinking/reasoning của model biên kịch | `false` |

**TTS (Stage 2 — giọng đọc): 2 provider**

Hai provider chọn được. Chọn **per-project** bằng dropdown ở trang video (rỗng = theo ENV), hoặc mặc định qua `TTS_PROVIDER`. Provider abstraction: thêm provider mới = 1 file trong `lib/tts-providers/`. Cache đĩa dùng chung (preview synth 1 lần → CLI tái dùng); key ElevenLabs giữ nguyên công thức cũ nên **không đốt lại cache đã trả phí**.

- **ElevenLabs** — trả phí theo ký tự, chất lượng cao. Voice ID tự do từ voice library.
- **CapCut** — **miễn phí**, có sẵn giọng Việt, Anh, Indonesia (dropdown catalog lọc theo ngôn ngữ job). ⚠️ **API nội bộ reverse-engineered, KHÔNG chính thức — có thể ngừng hoạt động bất cứ lúc nào.** Khi CapCut lỗi, hệ thống **không tự fallback** (tránh âm thầm đốt quota trả phí): báo lỗi rõ kèm gợi ý đổi `TTS_PROVIDER=elevenlabs` (đường lùi).

| Biến | Ý nghĩa | Mặc định |
|------|---------|----------|
| `TTS_PROVIDER` | Provider mặc định khi project không chọn riêng: `elevenlabs` \| `capcut` | `elevenlabs` |
| `ELEVENLABS_API_KEY` | API key (bắt buộc khi synth bằng ElevenLabs) | — |
| `ELEVENLABS_VOICE_ID` | Giọng đọc | `21m00Tcm4TlvDq8ikWAM` (Rachel) |
| `ELEVENLABS_MODEL` | Cả 3 tier chọn qua ENV: `eleven_multilingual_v2` (chất lượng) / `eleven_turbo_v2_5` (rẻ ~50%) / `eleven_flash_v2_5` (nhanh, nháp) | `eleven_multilingual_v2` |
| `ELEVENLABS_BASE_URL` | Endpoint — chỉ đổi khi test với mock | `https://api.elevenlabs.io` |
| `CAPCUT_VOICE` | Giọng CapCut mặc định (khi project không chọn giọng) | `BV074_streaming` |
| `CAPCUT_RESOURCE_ID` | resource_id mặc định (chỉ dùng khi `CAPCUT_VOICE` ngoài catalog gắn sẵn) | `7102355709945188865` |
| `CAPCUT_DEVICE_JSON` | Path file JSON override device profile CapCut (tuỳ chọn) | — |
| `CAPCUT_BASE_URL` | Endpoint CapCut — chỉ đổi khi test với mock | `https://editor-api-sg.capcutapi.com` |
| `TTS_CACHE_DIR` | Cache mp3 trên đĩa theo hash provider+text+voice+model: preview synth 1 lần, CLI tái dùng, **không gọi API lần 2** | `.cache/tts` |
| `SUBS_FONTS_DIR` | **Override** thư mục font cho burn-in. Bỏ trống là đủ dùng — repo đã kèm 8 họ font Việt trong `public/fonts` | `public/fonts` |

**Ingest gộp + chia band (mọi upload)**

| Biến | Ý nghĩa | Mặc định |
|------|---------|----------|
| `PDF_SCALE` | Hệ số phóng khi render PDF (1 = 72dpi; 2 = 144dpi đủ nét trước downscale) | `2` |
| `STRIP_RATIO` | Tỉ lệ cao/rộng ≥ ngưỡng này coi là ảnh dải dọc: downscale chỉ kẹp bề rộng, giữ chiều cao | `2.5` |
| `MIN_GUTTER_HEIGHT` | Run hàng "an toàn" phải dày ≥ ngưỡng này (px) mới đủ tư cách làm điểm cắt (gutter thật, không phải khe hẹp trong panel) | `24` |
| `MIN_BAND_HEIGHT` | Không cắt trước ngưỡng này (px) — giữ trọn nhân vật + bong bóng. Bỏ trống → `0.6 × SPLIT_HEIGHT` | `960` |
| `MAX_BAND_HEIGHT` | Buộc cắt khi band vượt ngưỡng này (px) — chặn band quá cao làm chữ nát khi thu về `MAX_EDGE`. Bỏ trống → `1.4 × SPLIT_HEIGHT` | `2240` |
| `MIN_INK_DENSITY` | Band có mật độ mực (tỉ lệ pixel không-trắng) dưới ngưỡng → gộp vào band liền kề (diệt band gần trắng thừa) | `0.02` |
| `SPLIT_HEIGHT` | (Tương thích ngược) chỉ còn dùng để suy `MIN_BAND_HEIGHT`/`MAX_BAND_HEIGHT` khi hai biến đó bỏ trống | `1600` |
| `LINE_TOLERANCE` | Hàng "an toàn" khi chênh lệch 2 pixel liền kề ≤ ngưỡng này (0-255; 25 ≈ 90% sensitivity) | `25` |
| `IGNORABLE_BORDER` | Bỏ qua N px sát mép trái/phải khi xét safe-line (viền, watermark dọc mép) | `5` |

## Luồng sử dụng (Nhận chapter — `/`)

1. Kéo thả ảnh (`1.jpg, 2.jpg, …` — thứ tự đọc theo natural sort tên file) hoặc 1 file `.zip` / `.pdf` (file rác macOS trong zip tự bị lọc).
2. **Tải lên & xem trước** → tạo job: downscale từng ảnh → **gộp toàn bộ thành một canvas dọc → chia band tại gutter** (khoảng trắng ngang dày; `band-1.jpg, band-2.jpg, …`) — **không gọi vision**; hiện lưới thumbnail band theo thứ tự đọc. Thừa band? Bấm **✕** trên ô band để xoá.
3. Nhập **ngữ cảnh chương** (nhân vật, xưng hô — tuỳ chọn, dùng cho cả Generate lẫn kịch bản).
4. **Tạo storyboard** → nhảy sang `/storyboard/{jobId}`. Quay lại `/` bằng logo trên top bar.

## Luồng sử dụng (Storyboard)

1. Tạo storyboard qua nút **"Tạo storyboard"** (trang chính) hoặc trực tiếp `/api/jobs/{id}/storyboard` → **mỗi band = 1 nhịp**, region `null` (trọn band), nhịp ở trạng thái **pending sạch** (chưa có lời đọc, không lỗi).
2. Bấm **Generate all (N nhịp)** (chỉnh ô **Nhịp** req/phút nếu cần) → batch vision cho mọi nhịp pending/lỗi, tiến độ live (SSE + poll dự phòng), request giãn nhịp tránh 429. Lỗi từng nhịp được cô lập; nhịp đã có lời đọc / đã sửa tay KHÔNG bị đè. Nội dung vision đồng thời được lưu để bước Kịch bản dùng lại (không gọi vision lần 2).
3. Trang `/storyboard/{jobId}` bố cục **master–detail**: cột trái = danh sách nhịp gọn (thumbnail + reorder ▲▼), cột phải = chi tiết nhịp đang chọn.
4. Biên tập nhịp (panel chi tiết):
   - **Region**: **kéo khung trên ảnh** để chọn vùng, kéo trong khung để di chuyển; toggle "Cả trang"; nút **"Vừa khít nội dung"** co region bám vùng có mực (bỏ lề trắng, chỉ thủ công); khối "Nâng cao" giữ numeric x/y/w/h (đồng bộ 2 chiều, chỉnh bằng bàn phím). Region đi thẳng vào khung hình video khi tạo kịch bản.
   - **Hiệu ứng (Ken Burns)**: chip trên ô preview là **dropdown chọn mode** per-nhịp (Auto · Lia dọc · Lia ngang · Zoom · Tĩnh) + nút **đảo hướng** (lia ↑/←, zoom-out). Mặc định Auto tự suy từ hình dáng vùng; mode bất khả thi với vùng đang chọn bị mờ kèm tooltip. Sửa nhịp khi đã có kịch bản → banner nhắc **tạo lại kịch bản** để thay đổi đi vào video.
   - **Narration** (lời đọc): sửa tay, durationHint tự cập nhật theo độ dài.
   - **Generate ✨**: gọi vision cho riêng nhịp đó (crop vùng nhịp → mô tả + thoại) — dùng khi nhịp lỗi hoặc muốn soạn lại từ ảnh (đè bản hiện có vì người dùng chủ động bấm).
   - **Xoá**: bỏ hẳn một nhịp khỏi storyboard (re-order phần còn lại; chỉ khi không đang compose).
5. **Lưu project** (top bar) → tải `project-<jobId>.mtvproj` (zip tự chứa: data + ảnh working/band + audio đã synth). Store server là in-memory — file này là bản lưu duy nhất của phiên làm việc.
6. **Mở project** (top bar) → chọn 1 file `.mtvproj` → hydrate lại Job + Storyboard + Kịch bản + Audio, **không cần chọn lại ảnh rời, không re-ingest, không phụ thuộc env** — toạ độ region khớp tuyệt đối. Tự điều hướng tới stage phù hợp (storyboard / kịch bản / video).

Không bắt buộc Generate all trước khi tạo kịch bản: nhịp chưa Generate sẽ được vision fallback tự mô tả ở bước Kịch bản (lỗi cô lập); chỉ Generate lẻ vài nhịp cần thiết cũng được, không đốt vision cho cả chapter.

## Luồng sử dụng (Stage 2 — Kịch bản AI + Video)

1. Ở trang **`/script/{jobId}`** (mở qua stepper khi storyboard xong), bấm **"Tạo kịch bản AI"** → model text đọc content mọi band (band thiếu content được vision fallback tự mô tả, lỗi cô lập) → đề xuất `ScriptSegment[]` (gộp band liền kề / tách band dày).
2. Duyệt kịch bản: **sửa narration inline · gộp với đoạn dưới · tách tại biên shot (✂) · re-order (▲▼) · xoá**. Band bỏ sót có cảnh báo count-mismatch. Không ưng → **"Tạo lại kịch bản"**.
3. **"Xác nhận kịch bản"** → mở nút **"Dựng video"** → `/video/{jobId}` (sửa đoạn nào sau đó phải xác nhận lại).
4. Trang preview: phát duyệt Ken Burns **xấp xỉ CSS** (nói rõ trên UI — MP4 do engine render mới là chân lý, preview chỉ xấp xỉ), chỉnh **phụ đề (font/cỡ/màu/vị trí/lề) live**, **khung hình 9:16 · 16:9 · 1:1**, **BGM** (file + volume + duck), zoom. Hai chế độ: **im lặng** (durationHint, free) ↔ **"Synth audio"** (ElevenLabs → timing thật, nghe được; vào cache đĩa).
5. **Render MP4 (đường chính — 1 nút):** bấm **"Render MP4"** ở stage video → engine ffmpeg chạy **server-side** đọc thẳng store RAM, stream tiến trình theo shot (thanh progress + "Render cảnh i/N"), xong **tự tải `results-{jobId}-{aspect}.zip`** (chứa `output.mp4` + `.srt` + `.timeline.json`). Có nút **Hủy** (kill ffmpeg) + khóa **1-render/job** (bấm lần 2 khi đang chạy → 409). Không chạm terminal. Engine dùng chung `lib/render.ts` với CLI nên MP4 in-app **khớp** MP4 CLI.
6. **Nâng cao (render máy khác / batch)** — menu "Nâng cao" ở stage video:
   - **Export bundle zip** → tải `bundle-{jobId}.zip` (manifest + ảnh band + render-config + audio đã synth + BGM) rồi render bằng CLI:
   ```bash
   npm run render -- bundle-<jobId>.zip --aspect 9:16 --out out.mp4
   npm run render -- bundle-<jobId>.zip --dry-run     # chỉ timeline.json + .srt, không TTS/ffmpeg
   ```
   Flags: `--aspect 9:16|16:9|1:1` · `--fps N` · `--bgm file` · `--subs srt|burn|both` · `--keep` (giữ `.render/<jobId>/` debug). Cùng bundle đổi `--aspect` ra 2 MP4 — TTS ăn cache, **không gọi ElevenLabs lại**. Đầu ra: `out.mp4` + `out.srt` (caption **tách theo câu**, luôn xuất) + `out.timeline.json` (bảng review khớp timing video).

## API (Nhận chapter — job)

| Method | Route | Chức năng |
|--------|-------|-----------|
| POST | `/api/jobs` | multipart (`images[]` / `zip` / `pdf`) → tạo job ở phase `ready` (downscale → gộp canvas → chia band, **không** gọi vision) → trả về `{jobId, progress, items}` — item là band |
| GET | `/api/jobs/{id}` | trạng thái + item |
| PATCH | `/api/jobs/{id}` | body `{context}` → lưu ngữ cảnh chương (tiêm vào vision + biên kịch) |
| DELETE | `/api/jobs/{id}/items/{i}` | xoá band (re-index phần còn lại). `404` index ngoài biên |
| GET | `/api/jobs/{id}/items/{i}/image` | thumbnail JPEG (downscale) |

## API (Storyboard)

| Method | Route | Chức năng |
|--------|-------|-----------|
| POST | `/api/jobs/{id}/storyboard` | không body → tạo storyboard từ job (1 band = 1 nhịp). Job chưa có content → beats `pending` sạch, phase `done` ngay; job import có content → compose template nền. Trả về `{jobId, createdAt, sourceKind, progress, working, beats}` |
| POST | `/api/jobs/{id}/storyboard/generate` | body `{rpm?}` → **Generate all**: batch vision mọi beat pending/error (giãn nhịp RPM, lỗi cô lập từng beat, beat done không bị đè, scene lưu vào working để Kịch bản reuse). `400` thiếu cấu hình vision, `409` khi đang chạy |
| GET | `/api/jobs/{id}/storyboard` | trạng thái + beat hiện tại |
| GET | `/api/jobs/{id}/storyboard/stream` | SSE tiến độ compose/generate |
| PATCH | `/api/jobs/{id}/storyboard/beats/{beatId}` | sửa beat `{narration?, region?, motion?, order?}` (region chuẩn: x/y ≥ 0, w/h ≥ 1, trong biên ảnh nguồn; motion `null` = auto hoặc `{mode: 'pan-v'\|'pan-h'\|'zoom'\|'static', reverse?}`) |
| DELETE | `/api/jobs/{id}/storyboard/beats/{beatId}` | xoá nhịp (re-order phần còn lại). `404` beat/storyboard không có, `409` khi đang compose |
| POST | `/api/jobs/{id}/storyboard/beats/{beatId}/generate` | **Generate bằng vision**: crop vùng nhịp → mô tả + thoại → narration (lỗi cô lập vào beat) |
| POST | `/api/jobs/{id}/storyboard/beats/{beatId}/retry` | compose lại từ content đã có của band (không gọi vision) |
| GET | `/api/jobs/{id}/storyboard/beats/{beatId}/crop` | preview crop JPEG theo region hiện tại |
| POST | `/api/jobs/{id}/storyboard/beats/reorder` | body `{beatId, to}` → sắp xếp lại |
| GET | `/api/jobs/{id}/storyboard/working/{i}/image` | preview working image (ảnh band) |

## API (Project file — .mtvproj)

| Method | Route | Chức năng |
|--------|-------|-----------|
| GET | `/api/project/export?jobId={id}` | tải `project-{jobId}.mtvproj` (zip: project.json + manifest.json + storyboard.json + script.json + `working/*.jpg` + `items/band-*.jpg` + `audio/seg-*.mp3`) |
| POST | `/api/project/import` | multipart field `file` (.mtvproj) → hydrate Job + Storyboard + Script + Audio (audio ghi lại vào `TTS_CACHE_DIR` để tiếp tục HIT cache) → `{jobId, stage}` |

## API (Stage 2 — Kịch bản + TTS + Bundle)

| Method | Route | Chức năng |
|--------|-------|-----------|
| POST | `/api/jobs/{id}/storyboard/script` | Tạo kịch bản AI: content tươi từng band (+ vision fallback band thiếu) → model text gộp/tách → `{jobId, confirmed, segments}`. `409` khi đang compose/generate |
| GET | `/api/jobs/{id}/storyboard/script` | kịch bản hiện tại |
| PATCH | `/api/jobs/{id}/storyboard/script/segments/{segId}` | sửa `{narration}` → `edited=true`, durationHint tính lại |
| DELETE | `/api/jobs/{id}/storyboard/script/segments/{segId}` | xoá đoạn (re-order) |
| POST | `/api/jobs/{id}/storyboard/script/segments/merge` | body `{segIds:[a,b]}` — gộp 2 đoạn liền kề |
| POST | `/api/jobs/{id}/storyboard/script/segments/split` | body `{segId, atShotIndex}` — tách tại biên shot |
| POST | `/api/jobs/{id}/storyboard/script/segments/reorder` | body `{segId, to}` |
| POST | `/api/jobs/{id}/storyboard/script/confirm` | chốt kịch bản (mọi mutator sau đó tự reset cờ) |
| POST | `/api/jobs/{id}/storyboard/tts` | body `{segIds?, provider?, voiceId?, model?}` → synth từng đoạn (lỗi cô lập, cache đĩa) → `{results:[{segId, durationSec, audioUrl, cached}]}` |
| GET | `/api/jobs/{id}/storyboard/tts/{segId}/audio` | stream mp3 từ cache (preview "có audio") |
| GET | `/api/jobs/{id}/storyboard/export-bundle` | bundle.zip (config qua `?config=<json>`) |
| POST | `/api/jobs/{id}/storyboard/export-bundle` | multipart `config` + file `bgm` → bundle.zip kèm BGM + audio đã synth (audio stale theo narration bị loại) |
| POST | `/api/jobs/{id}/storyboard/render` | multipart `config` + file `bgm` → **NDJSON stream** tiến trình render (theo shot) → dòng cuối `{done, downloads.zip}`. Đọc store RAM → `renderVideo` (chung engine CLI) → ghi `.render/{id}-{aspect}/` + gói `results.zip`. Khóa 1-render/job (409). Client đóng kết nối → kill ffmpeg + gỡ khóa |
| GET | `/api/jobs/{id}/storyboard/render/output?file=zip&aspect=<slug>` | serve `results-{id}-{aspect}.zip` (MP4 + .srt + .timeline.json). Whitelist file/aspect/id chống path traversal; thiếu → 404 |

## Manifest (nội bộ `.mtvproj` — không còn route export riêng)

```json
{
  "version": 1,
  "jobId": "uuid",
  "createdAt": "ISO-8601",
  "itemCount": 3,
  "items": [
    { "index": 0, "filename": "band-1.jpg", "content": { "description": "…", "dialogue": ["…"], "note": "" } }
  ]
}
```

Nằm trong `.mtvproj` (`manifest.json`) để round-trip Lưu/Mở project. `content` thường là `null`
(vision chạy ở Storyboard, ghi vào working — không ghi ngược item); import cũ có content vẫn đọc được.

## StoryboardManifest (hợp đồng cho TTS/video)

```json
{
  "version": 1,
  "jobId": "uuid",
  "createdAt": "ISO-8601",
  "sourceKind": "strip|pages",
  "beatCount": 5,
  "beats": [
    {
      "id": "uuid",
      "order": 0,
      "sourceIndex": 0,
      "region": { "x": 0, "y": 100, "w": 1024, "h": 800 },
      "narration": "Lời đọc…",
      "sourceDialogue": ["…"],
      "durationHint": 3,
      "error": null
    }
  ]
}
```

**Hợp đồng:**
- `version` = 1 (Stage 2: TTS/video dùng phiên bản này)
- `sourceKind`: export mới luôn là `'pages'` (mỗi band 1 nhịp); `'strip'` chỉ còn ở manifest cũ (import vẫn đọc được)
- `beatCount` = số nhịp
- **beats**:
  - `id`: UUID nhịp (truy vết retry/generate)
  - `order`: thứ tự hiển thị (tăng từ 0)
  - `sourceIndex`: trỏ working image (index band)
  - `region`: null = trọn band; nếu có = `{x, y, w, h}` (px, người biên tập chọn manual)
  - `narration`: lời đọc cuối cùng (template pre-fill + sửa tay)
  - `sourceDialogue`: truy vết thoại gốc từ 2A/manifest (opt)
  - `durationHint`: ước lượng giây (15 ký tự/giây tiếng Việt; Stage 2 tinh chỉnh)
  - `error`: nếu beat bị lỗi (stage 1.5, opt)

## Kiến trúc

**Chung:**
- `lib/schema.ts` — hợp đồng dữ liệu (Manifest, StoryboardManifest, Beat, BeatRegion…; không import Node).
- `lib/jobs.ts` — store in-memory job + item (Map trên globalThis, sống sót HMR) + event bus tiến độ.
- `lib/vision.ts` — vision LLM client (OpenAI-compatible, adaptive json-mode, retry 429/5xx/mạng, parse chịu ```json fences).
- `lib/pipeline.ts` — unzip/lọc ảnh, natural sort, downscale sharp, **ingest gộp + chia band** (`ingestBandItems`: stitch → smart-split → crop), p-limit + cổng nhịp (rpm).

**Ingest & Storyboard:**
- `lib/pdf.ts` — render PDF → Buffer ảnh dùng `pdf-to-img` (Node 24).
- `lib/source-kind.ts` — ngưỡng `STRIP_RATIO` cho nhánh downscale ảnh dải dọc.
- `lib/stitch.ts` — nối các ảnh thành một canvas dọc (căn giữa slice hẹp).
- `lib/smart-split.ts` — cắt band theo NGỮ CẢNH (kế thừa primitive safe-line của SmartStitch, jhin1m/manhwa-sticher): dò gutter (khoảng trắng dày) làm điểm cắt, bỏ qua khe hẹp nhân vật↔bong bóng, gộp band non nội dung.
- `lib/narration.ts` — compose narration: nhánh vision (Generate all + Generate lẻ) crop vùng nhịp → describeImage → persist scene vào working (Kịch bản reuse); nhánh template từ content có sẵn (import); rev-guard per-beat.
- `lib/storyboard-store.ts` — in-memory storyboard + working image + kịch bản Stage 2 (script + mutators gộp/tách/sửa + audio đã synth; Map per-jobId, sống sót HMR).

**Stage 2 (kịch bản + video):**
- `lib/script.ts` — biên kịch: `readScriptConfig` (ENV `SCRIPT_*`), vision fallback band thiếu content (lỗi cô lập), `generateScript` (model text → gộp/tách shotIndices, validate biên).
- `lib/tts.ts` — orchestration TTS: **cache đĩa** (sha256 [provider+]text+voice+model, ghi atomic `.tmp`→rename, metadata độ dài), resolve provider (arg > `TTS_PROVIDER` > elevenlabs), gọi `provider.synth`; text rỗng không synth.
- `lib/tts-providers/` — provider abstraction: `types.ts` (interface), `catalog.ts` (data giọng client-safe), `elevenlabs.ts`, `capcut.ts` (port TS thuần `node:crypto`, không auto-fallback), `index.ts` (registry). Thêm provider mới = 1 file + 1 dòng registry.
- `lib/bundle.ts` — đóng/mở bundle.zip (manifest + render-config + band + audio + bgm), validate version + band khớp shots.
- `lib/timeline.ts` — **thuần, dùng chung UI+CLI**: `buildTimeline` (audio nhạc trưởng, sàn, phân bổ shot theo weight), `splitSentences`/`allocateCaptions`/`toSrt` (caption tách theo câu, canh giờ tỉ lệ ký tự), `wrapCaption`/`formatCaption` (IN HOA + ngắt dòng, áp cho cả `.srt` lẫn preview), `toTimelineJson`.
- `lib/subtitle-style.ts` — **thuần, nguồn DUY NHẤT của style phụ đề**: `toAssForceStyle` (burn-in) và `toPreviewCss` (preview) sinh từ cùng một `SubtitleStyle`, cộng `migrateSubtitleStyle` (config v1 → v2 + kẹp biên). Lưu ý ASS: `OutlineColour` là màu viền ở `border=outline` nhưng là **màu nền hộp** ở `border=box`; `BackColour` luôn là màu bóng.
- `lib/fonts.ts` + `public/fonts/` — 8 họ font OFL đủ dấu tiếng Việt kèm repo. Cùng file `.ttf` phục vụ `@font-face` của preview và `fontsdir` của libass → preview khớp MP4, render giống nhau trên mọi máy. Thêm font mới phải kiểm glyph tiếng Việt (`pnpm test:fonts`).
- `lib/subtitle-presets.ts` — 5 preset style dựng sẵn cho panel phụ đề.
- `lib/kenburns.ts` — **thuần**: suy hướng pan/zoom từ region+aspect, blur-fill khi lệch tỉ lệ, kẹp vận tốc pan → chuỗi filtergraph ffmpeg.
- `lib/ffmpeg.ts` — wrapper spawn + resolver binary (env `FFMPEG_PATH`/`FFPROBE_PATH` → PATH hệ thống → bundled npm, cache per-process): assert/probe/renderShot/concat/audio-track/duck (sidechain)/burn subs/mux. `resolveSubtitleBin()` chọn riêng binary có libass cho bước burn (degrade khi không nguồn nào có). Nhận `AbortSignal` (optional) → kill child ffmpeg khi hủy.
- `lib/render.ts` — **orchestration render dùng chung** (source-agnostic): `renderVideo(input, opts)` chạy TTS (cache) → timeline → Ken Burns per shot → concat + BGM duck + burn → MP4 + .srt + timeline.json. `onProgress` phát `RenderEvent` theo mốc; `signal` hủy giữa chừng. CLI **và** route in-app đều là client mỏng của hàm này.
- `lib/storyboard-render-input.ts` — đọc store RAM → dữ liệu render (dùng chung export-bundle + route render): `buildBundle`/`collectAudio`/`parseConfig`/`parseRenderForm`.
- `lib/render-lock.ts` — khóa 1-render/job (`Map<jobId, AbortController>` trên globalThis).
- `scripts/render-video.mts` — CLI render: client mỏng của `lib/render.ts` — parse args + dựng `RenderInput` từ bundle + map `RenderEvent` → log; `--dry-run` không gọi TTS/ffmpeg.

**Routes & UI:**
- `app/api/jobs/**` — route job (POST upload / GET / PATCH context / DELETE item / GET image).
- `app/api/jobs/{id}/storyboard**` — route storyboard (POST create + generate-all / PATCH+DELETE beat / POST generate-retry-reorder / GET crop-stream-working).
- `app/api/jobs/{id}/storyboard/script**`, `tts**`, `export-bundle` — route Stage 2 (kịch bản + TTS + bundle).
- `app/api/jobs/{id}/storyboard/render` (+ `render/output`) — render MP4 in-app: POST stream NDJSON tiến trình → `results.zip`; GET serve zip. Khóa 1-render/job + Cancel qua AbortController.
- `app/api/project/export|import` — file project `.mtvproj` (lưu/mở cả phiên làm việc, `lib/project.ts`).
- `app/layout.tsx` + `components/app-shell.tsx` — app shell chung (top bar Lưu/Mở project + stepper 3 bước Storyboard→Kịch bản→Video + theme toggle + toast); token shadcn/ui trong `app/globals.css`.
- `app/page.tsx` — UI Nhận chapter: upload (gộp + chia band) → xem trước lưới band + xoá band + ngữ cảnh chương → Tạo storyboard.
- `app/storyboard/[jobId]/page.tsx` — UI storyboard master–detail: Generate all (batch vision + RPM), list nhịp (trái) + chi tiết nhịp (phải) với chọn vùng kéo-thả (`components/region-cropper.tsx`), Generate ✨ per-beat, reorder.
- `app/script/[jobId]/page.tsx` — trang Kịch bản AI: duyệt/gộp/tách/sửa/chốt → Dựng video.
- `app/video/[jobId]/page.tsx` — Preview UI video: player Ken Burns CSS xấp xỉ + caption theo câu + panel khung hình/phụ đề/BGM/TTS → Synth audio → **Render MP4** (server-side, progress theo shot + Hủy, tự tải results.zip); Export bundle zip + CLI hint trong menu "Nâng cao".

## Kiểm thử

**Unit tests** (ingest, banding, narration, script/timeline/bundle/kenburns/tts-cache):
```bash
npm run test:unit     # gồm cả verify-script (Stage 2) + verify-project (.mtvproj)
                      # + verify-subtitle-style (mapping ASS, migrate v1→v2, wrap, preset)
                      # + verify-fonts (family name khớp TTF, đủ dấu Việt, libass chọn đúng file)
                      # + verify-subtitle-render (ĐO pixel frame thật: cỡ chữ đúng % khung,
                      #   vị trí trên/giữa/dưới, độ dày viền, nền hộp — SKIP nếu thiếu libass)
npm run test:script   # riêng Stage 2 unit (mock model + mock ElevenLabs + mock CapCut, không mạng thật)
npm run test:project  # riêng round-trip + validate file project .mtvproj
```
Kiểm tra downscale/bound, chia band theo gutter, xoá band/nhịp, narration compose; Stage 2: generateScript (validate biên shotIndices), buildTimeline (audio nhạc trưởng/sàn/weight), toSrt caption tách câu, bundle round-trip, kenburns pan/zoom/blur-fill, TTS cache MISS/HIT (ElevenLabs + CapCut: flow new→poll→audio, key prefix provider, task fail/timeout kèm gợi ý đổi provider).

**E2E render (Stage 2, mock ElevenLabs — cần ffmpeg, thiếu tự SKIP):**
```bash
npm run test:render   # dry-run + MP4 9:16 + 16:9 + BGM duck + cache HIT (không gọi API thật)
```

**E2E test** (đầu tào cuối):
```bash
npm run mock:vision   # Mock OpenAI vision (port 3106)
PORT=3105 OPENAI_API_KEY=mock-key OPENAI_BASE_URL=http://localhost:3106/v1 \
VISION_MODEL=mock-vision VISION_RPM=600 SPLIT_HEIGHT=1000 npm run dev
npm run test:e2e      # upload band/storyboard pending sạch/Generate all + lẻ/reorder/xoá band+nhịp/lưu-mở project/PDF/route cũ 404
```

**E2E route Stage 2** (kịch bản + TTS + bundle qua server thật — thêm mock script :3108 + mock ElevenLabs :3107 và env `SCRIPT_*`/`ELEVENLABS_*` trỏ mock vào lệnh start ở trên):
```bash
npm run mock:script && npm run mock:elevenlabs   # (2 terminal riêng)
npm run test:e2e-video   # tạo kịch bản/duyệt-gộp-tách/confirm/tts cache/export-bundle (34 assert)
```

Test scripts: `content-extractor/scripts/` (`verify-ingest.mts`, `verify-banding.mts`, `verify-narration.mts`, `verify-script.mts`, `verify-render.mts`, `mock-openai-vision.mjs`, `mock-elevenlabs.mjs`, `mock-script-model.mjs`, `e2e-storyboard.mts`, `e2e-script-video.mts`).

## Known Limitations (v1, ghi nhận cho Stage 2)

- **Import phụ thuộc env (đã gỡ hẳn):** render đi qua **bundle.zip self-contained**; mở lại phiên làm việc đi qua **`.mtvproj` self-contained** (ảnh working embed) — không còn đường nào re-ingest hay phụ thuộc `MAX_EDGE`/settings cắt band.
- **Memory canvas:** Mỗi upload stitch toàn bộ chapter thành một canvas rồi raw-decode khi smart-split — chapter rất dài tốn RAM tạm thời (dev tool chấp nhận, ghi chú).
- **Xoá band sau khi đã tạo storyboard:** Storyboard là snapshot lúc tạo — xoá band ở lưới upload KHÔNG cập nhật ngược storyboard đã có (working buffer giữ bằng tham chiếu nên không lỗi). Bấm "Tạo storyboard" lại để đồng bộ.
- **PDF trong zip:** Bỏ qua (chỉ nhận PDF upload trực tiếp).
- **UI beat:** chọn vùng bằng kéo-vẽ khung + kéo-di chuyển; **resize handle 4 góc chưa có** — chỉnh kích thước qua vẽ lại hoặc numeric "Nâng cao".
- **Preview ≠ render:** Ken Burns CSS ở `/video/{jobId}` là xấp xỉ (duyệt bố cục/timing/style); MP4 do engine render (**in-app "Render MP4"** hoặc CLI, chung `lib/render.ts`) mới là chân lý. UI có ghi chú rõ.
- **Burn-in cần libass:** Bản ffmpeg chính thiếu libass (vd `brew ffmpeg` build không có) → engine tự dùng **bản bundled** (`ffmpeg-static`) cho riêng bước burn, các bước khác giữ nguyên engine. Cả hai nguồn đều thiếu → cảnh báo, bỏ burn-in, vẫn xuất `.srt` rời.
- **Hai quirk của libass đã đo và bù trong `lib/subtitle-style.ts`** (video render TRƯỚC bản này sẽ khác đi nếu render lại):
  - *Cỡ chữ*: libass render nhỏ hơn 1,5 lần so với công thức `PlayResY=288`, nên cỡ chữ chia **432**. Trước đây "Cỡ chữ 4,5%" thực tế chỉ ra ~3% chiều cao khung; giờ đúng nhãn và khớp preview.
  - *Vị trí*: `force_style` dùng hệ căn lề **SSA v4 cũ** (2 = dưới-giữa, 6 = trên-giữa, 10 = giữa-giữa), không phải numpad V4+. Trước đây chọn "Trên" ra chữ **giữa khung căn trái**, chọn "Giữa" ra **trên căn trái**.
  - `pnpm test:subtitle-render` đo lại pixel của frame thật để canh gác cả hai con số này.
- **Ngoài scope vòng sau:** transition giữa shot · multi-voice · nhạc theo cảm xúc · batch cả bộ · preview render-accurate (WebGL) · nhiều track BGM · AI tự chọn nhạc.
