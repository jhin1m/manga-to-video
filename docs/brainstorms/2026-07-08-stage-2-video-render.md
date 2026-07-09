# Brainstorm — Stage 2: Storyboard → Kịch bản AI → Video (render MP4)

- **Ngày:** 2026-07-08
- **Trạng thái:** Đã chốt thiết kế, sẵn sàng `/ck:plan`
- **Tiền đề:** Stage 1 (extract band) + Stage 1.5 (storyboard = `beats[]` thô + narration template) đã xong. Đây là Stage 2 đã ghi "ngoài scope" ở brainstorm 1.5.
- **Nguồn context:** `content-extractor/lib/schema.ts` (`StoryboardManifest`/`Beat`), `lib/narration.ts`, README §"StoryboardManifest", brainstorm `2026-07-06-stage-1.5-storyboard-narration.md`.

---

## 1. Vấn đề

Từ storyboard (nhịp hình có thứ tự), làm ra **file MP4 xem được**: một **kịch bản kể chuyện mạch lạc** (AI tổng hợp từ content mọi panel), lời đọc TTS khớp hình, timeline chuẩn, kèm **preview để tinh chỉnh** trước khi render.

### Làm rõ 3 câu hỏi gốc

| Câu hỏi | Chốt |
|---|---|
| "Tạo kịch bản cho video từ Storyboard" | **Storyboard CHƯA phải kịch bản.** Narration hiện tại là *template chú thích per-band* (rời rạc). Cần **bước AI Biên kịch**: đọc content toàn chương → viết kịch bản kể liền mạch (§3). |
| "Gộp ảnh, chia panel thành video" | Band đã chia sẵn (Stage 1). Stage 2 **không chia lại pixel**; AI Biên kịch được **gộp/tách band theo đơn vị tự sự** (index-based) → mỗi *segment* → 1+ shot; render Ken Burns per shot (§3, §4). |
| "Timestamp phải khớp video" | Audio là nhạc trưởng. Narration↔segment khớp cứng; audio segment phân bổ cho các shot của nó. `timeline.json` ≡ timeline video (§5). |

**Kết luận:** Stage 2 = **Biên kịch AI + timing + render + preview**, không phải "phân tích ảnh".

---

## 2. Quyết định đã chốt

| Trục | Chốt | Lý do |
|---|---|---|
| **Kịch bản** | **Bước AI Biên kịch** (mới): đọc content mọi band → viết kịch bản mạch lạc, **được gộp/tách panel** | Storyboard chỉ mô tả rời từng panel; cần tổng hợp thành giọng kể xâu chuỗi |
| Model biên kịch | **OpenAI-compatible text riêng** (`SCRIPT_MODEL`) | Giữ pattern ENV-swappable; dùng model text mạnh cho văn kể; đổi provider không sửa code |
| Ánh xạ script↔hình | **Segment → shots[]** (index-based) + **xác nhận tay** gộp/tách | AI lo nghĩa (index band tin cậy), không vẽ pixel; người duyệt vì regroup dễ sai |
| Khung hình | **Cấu hình được** (`aspect: 9:16\|16:9\|1:1`) | Band dọc hợp 9:16 nhất; tham số hoá → một logic framing chạy mọi tỉ lệ |
| TTS | **ElevenLabs** (`eleven_multilingual_v2`) | Đa ngôn ngữ hỗ trợ VN; endpoint `with-timestamps` cho SRT chính xác |
| Render engine | **ffmpeg zoompan thuần** | KISS, deterministic, không browser, dep nhẹ |
| Vị trí | **Hybrid: Preview UI (app Next) + CLI render cuối** | Preview + tinh chỉnh font/BGM live cần UI; CLI giữ render deterministic |
| Hand-off | **Bundle zip** (script-manifest + ảnh band + config + audio) | CLI không re-ingest, không lệ thuộc ENV |
| Phụ đề | **Luôn xuất .srt + tuỳ chọn burn-in**, chỉnh font/size/màu/vị trí + **preview live** | Vừa linh hoạt (YouTube) vừa gán được (Shorts) |
| BGM | **Tuỳ chỉnh**: file + âm lượng + mức ducking | Sidechain ducking dưới narration |

---

## 3. Pipeline tổng (Storyboard → Video)

```
Stage 1.5  storyboard: beats[] thô (band + region), narration template
     │
     ▼  ── BƯỚC MỚI: AI BIÊN KỊCH (SCRIPT_MODEL, text) ──
     │   đọc content mọi beat theo thứ tự → đề xuất ScriptSegment[]:
     │     • gộp/tách band theo đơn vị tự sự (tham chiếu INDEX band, không pixel)
     │     • viết narration mạch lạc cả chương, xuất theo từng segment
     │   → người duyệt/sửa grouping + text  (cửa xác nhận tay, cảnh báo lệch count)
     ▼
   ScriptManifest (hợp đồng biên kịch — §6)
     │
     ▼  ── PREVIEW UI (app Next, /video/[jobId]) ──
     │   phát duyệt segment→shots (Ken Burns CSS xấp xỉ), overlay phụ đề live,
     │   chỉnh font/size/màu/vị trí, BGM (file/âm lượng/duck), aspect/fps/voice,
     │   2 chế độ: "im lặng" (durationHint, free) / "có audio" (synth TTS, timing thật)
     │   → Export bundle.zip (+ render-config.json)
     ▼
   ── CLI RENDER CUỐI (scripts/render-video.mts, ffmpeg — nguồn chân lý) ──
     đọc bundle → per-segment TTS (cache) → phân bổ audio cho shots →
     Ken Burns per shot → concat + mux audio + BGM duck → burn-in nếu bật
     → output-<aspect>.mp4 + subtitles.srt + timeline.json

   lib/tts.ts + CACHE ĐĨA DÙNG CHUNG (hash narration+voice+model):
   preview synth 1 lần → CLI tái dùng → KHÔNG tốn tiền ElevenLabs lần 2
```

---

## 4. Render per segment (CLI)

```
segment có narration + shots[] (mỗi shot = 1 band + region)
1. TTS ElevenLabs(narration) → seg-i.mp3    (rỗng → sàn im lặng; cache theo hash)
2. ffprobe → audioLen[i]
3. dur_seg[i] = max(audioLen[i] + pad_đầu(~0.3s) + pad_cuối(~0.5s), sàn)
4. Phân bổ dur_seg cho shots[] theo weight (mặc định đều), sàn_shot mỗi shot
5. Mỗi shot: Ken Burns từ (region ?? cả band) + aspect đích:
      focus cao/hẹp → pan dọc ; rộng → pan ngang ; gần vuông → zoom-in nhẹ
      aspect ≠ band-ratio (vd 16:9 từ band dọc) → blur-fill nền + căn giữa
   ffmpeg zoompan → shot-i-k.mp4 (đúng phần thời lượng của shot)
```

Ghép cuối: `concat` mọi shot theo thứ tự; đặt `seg-i.mp3` tại `start` của segment → **audio/video khớp** (tổng shot của segment = dur_seg). BGM ducking. Phụ đề: luôn xuất `.srt` (1 caption/segment); `burnIn` → đốt chữ theo font/size/màu/vị trí từ config. Xuất `output-<aspect>.mp4` + `timeline.json`.

---

## 5. Timestamp — trả lời trực tiếp Q3

```
1. narration segment → TTS → seg-i.mp3
2. ffprobe → audioLen[i] (giây, thật)
3. dur_seg[i] = max(audioLen[i] + pad, sàn)
4. start_seg[0]=0 ; start_seg[i]=start_seg[i-1]+dur_seg[i-1]
5. trong segment: chia dur_seg cho shots → mốc đổi hình (sub-timestamp)
6. Ken Burns mỗi shot kéo đúng phần của nó
7. sinh subtitles.srt (theo segment) + timeline.json
```

**Bất biến:** audio là nhạc trưởng; narration khớp cứng với **segment**; trong segment hình đổi = b-roll tự nhiên. `durationHint` chỉ dùng cho preview im lặng. **Kịch bản xuất ra khớp video vì cả hai sinh từ cùng `ScriptManifest` phân mảnh theo segment** — không căn khớp thủ công. `timeline.json` = "kịch bản video" review được: `seg# | narration | shots | start | end | camera-move`.

---

## 6. Hợp đồng dữ liệu (mới)

### 6.1 `ScriptManifest` (Biên kịch → Preview/Video)

```jsonc
{
  "version": 1, "jobId": "…", "createdAt": "…",
  "segmentCount": 5,
  "segments": [{
    "id": "uuid", "order": 0,
    "narration": "Lời kể mạch lạc AI viết (1+ câu)…",
    "shots": [                       // 1 shot = gộp nhiều; nhiều segment cùng sourceIndex = tách
      { "sourceIndex": 3, "region": null, "weight": 1 },
      { "sourceIndex": 4, "region": { "x": 0, "y": 0, "w": 1024, "h": 800 }, "weight": 1 }
    ],
    "sourceBeatIds": ["…"],          // truy vết beat gốc đã gộp
    "durationHint": 6,
    "edited": true                   // người dùng đã xác nhận grouping/text
  }]
}
```

### 6.2 `render-config.json` (Preview UI → CLI)

```jsonc
{
  "version": 1,
  "aspect": "9:16", "fps": 30,
  "subtitles": { "export": true, "burnIn": false, "font": "Be Vietnam Pro",
                 "sizePct": 4.5, "color": "#FFFFFF", "outline": "#000000",
                 "position": "bottom", "marginPct": 6 },
  "bgm": { "path": "bgm.mp3", "volume": 0.3, "duckDb": -12 },
  "tts": { "voiceId": "…", "model": "eleven_multilingual_v2" },
  "kenburns": { "zoom": 1.08 },
  "segmentOverrides": {}             // opt: theo segment.id → { durationSec?, shotWeights? }
}
```

### 6.3 Bundle zip
`manifest = ScriptManifest` · `render-config.json` · `band-*.jpg` (working image) · `audio/seg-*.mp3` (opt — nếu preview đã synth).

---

## 7. Ranh giới module

| File | Trách nhiệm | Dùng bởi |
|---|---|---|
| `lib/script.ts` (mới) | AI Biên kịch: gọi `SCRIPT_MODEL` (OpenAI-compatible text), gom content beats → đề xuất `ScriptSegment[]` (gộp/tách index-based) | route + UI |
| `lib/tts.ts` (mới) | ElevenLabs client, cache đĩa theo hash, đo độ dài (ffprobe) | UI route + CLI |
| `lib/bundle.ts` (mới) | Đọc/ghi bundle zip (adm-zip sẵn có) | UI export + CLI |
| `lib/timeline.ts` (mới) | dur_seg → phân bổ shots → start/end → `timeline.json` + `subtitles.srt` | CLI (+ preview) |
| `lib/kenburns.ts` (mới) | Camera-move từ region+aspect → zoompan; blur-fill | CLI |
| `lib/ffmpeg.ts` (mới) | Wrapper spawn ffmpeg/ffprobe (segment, concat, mux, duck, burn-in) | CLI |
| `scripts/render-video.mts` (mới) | CLI entry: parse config, orchestrate, ghép cuối | — |
| `app/video/[jobId]/page.tsx` (mới) | Preview UI: player CSS Ken Burns, chỉnh phụ đề/BGM, export bundle | — |
| `app/api/.../{script,tts,export-bundle}/route.ts` (mới) | Biên kịch AI + synth TTS preview + xuất bundle | UI |
| `app/storyboard/[jobId]/page.tsx` (sửa) | Nút "Tạo kịch bản AI" (regroup+viết) → duyệt segment → "Dựng video" | — |

Không đụng `schema.ts` v1 (`StoryboardManifest`/`Beat` giữ nguyên, chỉ đọc). `ScriptManifest` + `render-config.json` là hợp đồng mới, versioned độc lập.

---

## 8. Phương án đã loại

| Chủ đề | Loại | Lý do |
|---|---|---|
| Kịch bản | Giữ template per-band | Rời rạc, không phải giọng kể; đúng phản hồi của user |
| Ánh xạ script↔hình | Viết tự do rồi căn câu↔hình | Căn khớp mong manh — dự án đã tránh model↔pixel không tin cậy |
| Ánh xạ | Beat cố định, không regroup | User muốn văn mượt hơn → cho gộp/tách (có cửa duyệt tay) |
| Chia hình | Stage 2 detect panel lại | Dữ liệu đã sạch từ Stage 1 |
| Timing | `durationHint` làm timeline cuối | Lệch audio thật → hình rời lời |
| Engine | Remotion / html-video | Chromium + dep lớn, nặng cho recap |
| Vị trí | CLI thuần / render trong request Next | Không preview live / không hợp model in-RAM |
| Preview | CLI `--preview` draft MP4 | Chỉnh font phải render lại, chậm, không live |
| Hand-off | CLI re-ingest / đọc job in-memory | Trùng logic hoặc coupling CLI↔server |
| Phụ đề | Chỉ burn-in cứng | Kém linh hoạt so với .srt + tuỳ chọn burn-in |

---

## 9. Rủi ro & giảm thiểu

| Rủi ro | Giảm thiểu |
|---|---|
| **AI regroup sai** (gộp nhầm panel) | Cửa xác nhận tay bắt buộc; UI gộp/tách + undo dễ; cảnh báo khi count segment lệch nhiều so với beat |
| **Segment nhiều hình → đổi hình đột ngột giữa câu** | Phân bổ theo weight + sàn_shot; kẹp min thời gian/hình; cho chỉnh weight tay |
| Preview CSS ≠ ffmpeg zoompan | Preview chỉ duyệt bố cục/timing/style; MP4 CLI là chân lý — ghi rõ |
| ElevenLabs tính tiền/ký tự | Cache đĩa dùng chung; preview "im lặng" free; `--dry-run` |
| Chất lượng giọng VN / văn kể | `eleven_multilingual_v2`; `SCRIPT_MODEL` model mạnh; nghe/đọc thử trước khi render cả chương |
| ffmpeg zoompan jitter | Supersample/scale trước zoompan; pin biểu thức; verify sample |
| Band cao + narration ngắn → pan quá nhanh | Kẹp vận tốc pan; vượt ngưỡng → zoom thay full-pan |
| 16:9 từ band dọc mất nội dung | Blur-fill + căn giữa; mặc định khuyến nghị 9:16 |
| Burn-in font tiếng Việt (dấu) | Font đủ dấu (Be Vietnam Pro…); nhúng font cho ffmpeg `ass` |
| ffmpeg/ffprobe system dep | Ghi prerequisite (`brew install ffmpeg`); CLI kiểm tra, báo lỗi rõ |
| Phình scope (thêm tầng biên kịch) | Tách phase rõ; biên kịch có thể bỏ qua (giữ narration cũ) nếu chỉ muốn video nhanh |

---

## 10. Acceptance criteria (vòng này)

- [ ] Nút "Tạo kịch bản AI": `SCRIPT_MODEL` đọc content mọi beat → đề xuất `ScriptSegment[]` (gộp/tách index-based) + narration mạch lạc.
- [ ] Người dùng duyệt/sửa grouping + text; cảnh báo khi count lệch.
- [ ] Export bundle = ScriptManifest + band-*.jpg + render-config.json (+ audio nếu đã synth).
- [ ] Preview UI `/video/[jobId]`: phát duyệt segment→shots (Ken Burns CSS), overlay phụ đề.
- [ ] Preview chỉnh **font/size/màu/vị trí phụ đề** thấy ngay; chỉnh **BGM (file/âm lượng/duck)**.
- [ ] Preview 2 chế độ: "im lặng" (free) và "có audio" (synth → timing thật).
- [ ] `render-video.mts <bundle.zip>` → MP4 phát được; tổng thời lượng ≈ Σ dur_seg.
- [ ] Segment nhiều shot → hình đổi đúng phân bổ; narration khớp toàn segment.
- [ ] aspect 9:16↔16:9 từ cùng bundle đều chạy.
- [ ] Luôn xuất `subtitles.srt` (1 caption/segment) đúng số; `burnIn=true` → chữ cháy đúng style.
- [ ] `timeline.json` đúng shape; **khớp** timing video.
- [ ] TTS **cache hit**: preview đã synth → CLI không gọi lại ElevenLabs.
- [ ] BGM ducking dưới narration; `--dry-run` ra timeline/srt không gọi ElevenLabs.

## 11. Ngoài scope (vòng sau)

Transition/hiệu ứng giữa shot · multi-voice (phân vai thoại theo nhân vật) · nhạc theo cảm xúc cảnh · batch cả bộ · preview render-accurate (WebGL) · nhiều track BGM · AI tự chọn nhạc.

## 12. Touchpoints

- **Mới (lib/CLI):** `scripts/render-video.mts`, `lib/{script,tts,bundle,timeline,kenburns,ffmpeg}.ts`, `scripts/verify-{script,render}.mts` (+ mock ElevenLabs & mock SCRIPT_MODEL kiểu `mock-openai-vision.mjs`).
- **Mới (UI/route):** `app/video/[jobId]/page.tsx`, `app/api/jobs/[id]/storyboard/{script,tts,export-bundle}/route.ts`.
- **Sửa:** `app/storyboard/[jobId]/page.tsx` (nút "Tạo kịch bản AI" + "Dựng video"), `.env.example` (`SCRIPT_MODEL`, `ELEVENLABS_*`), `README.md` (Stage 2), `package.json` (`render`, `test:render`, `test:script`).
- **Không đụng:** `schema.ts` v1.

## 13. Đề xuất phase cho /ck:plan

1. **AI Biên kịch** (`lib/script.ts` + `ScriptManifest` schema + route): `SCRIPT_MODEL` gom content → segments (gộp/tách index-based). Mock model để test.
2. **UI duyệt kịch bản** (sửa storyboard page): hiện segment đề xuất, gộp/tách/sửa text, cảnh báo count.
3. **Hợp đồng bundle + `render-config.json` + TTS dùng chung** (`lib/bundle.ts`, `lib/tts.ts` cache đĩa, route tts/export-bundle).
4. **Preview UI** `/video/[jobId]`: player CSS Ken Burns, chỉnh phụ đề/BGM live, 2 chế độ, export. *(phụ thuộc 1–3)*
5. **CLI render lõi** (`lib/{timeline,kenburns,ffmpeg}.ts` + `scripts/render-video.mts`): per-segment TTS→phân bổ shots→segment mp4 + timeline + srt. *(phụ thuộc 3, song song với 4)*
6. **CLI ghép cuối**: concat + mux audio + BGM ducking + burn-in.
7. **Verify + docs**: mock ElevenLabs + mock SCRIPT_MODEL, sample nhỏ → MP4 + smoke preview; cập nhật README.
