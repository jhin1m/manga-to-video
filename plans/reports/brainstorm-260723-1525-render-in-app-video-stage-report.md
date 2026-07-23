# Brainstorm: Render video tại chỗ ở stage video (bỏ vòng export zip → CLI)

- Ngày: 2026-07-23 15:25
- Trạng thái: ĐÃ DUYỆT thiết kế (Approach A). Sẵn sàng chuyển `/ak:plan --tdd`.
- Phạm vi: `content-extractor/` (Next.js 16, tool local 1 người, job trong RAM).

## Problem statement

Hiện muốn render MP4 phải: trang `/video/[jobId]` → "Export để render" tải `bundle-<jobId>.zip` → chạy tay `npm run render -- bundle.zip`. Ba bước, đổi context UI↔terminal. Mong: bấm 1 nút ở stage video là render ra MP4 luôn.

## Bối cảnh codebase (scout)

- **Engine render ĐÃ server-side Node:** `lib/ffmpeg.ts` spawn ffmpeg (bản 8.1.2 có sẵn `/opt/homebrew/bin`), `lib/kenburns.ts`/`lib/timeline.ts`/`lib/tts.ts` thuần Node. "Chỉ CLI" chỉ vì `scripts/render-video.mts` đọc từ `bundle.zip` còn route đọc từ store RAM.
- **`export-bundle/route.ts` đã đọc thẳng store** (`getStoryboard`/`getWorkingImage`/`getSegmentAudio`) → route render đọc y hệt, bỏ zip.
- **Hạ tầng NDJSON progress vừa build** (`lib/ndjson-stream.ts` server + `lib/ndjson-client.ts` client) — dùng cho upload/generate/script. Pattern fire-and-forget + stream có sẵn ở `storyboard/generate/route.ts`.
- **Trang video đã đủ UI config** (aspect/fps/kenburns/phụ đề/BGM/TTS) + `RenderConfig` + nút Synth/Export. Thiếu: nút Render + progress. `components/ui/progress.tsx` có sẵn.
- **`bundle.zip` là định dạng lưu/di động** đang document ("bundle.zip chính là bản lưu"). TTS cache đĩa (`TTS_CACHE_DIR`) nên re-render đổi aspect vẫn hit cache.

→ Rủi ro thấp: chủ yếu nối dây + 1 refactor DRY.

## Requirements đã chốt

1. **Output:** nút "Render MP4" ở `/video/[jobId]` → engine ffmpeg server-side → tự tải `output.mp4` + `.srt` + `.timeline.json`. Không cần zip/CLI.
2. **Acceptance:** progress theo shot (i/N) + phase; MP4 GIỐNG HỆT kết quả CLI (cùng engine); nút Hủy kill được ffmpeg; render lần 2 khi đang chạy bị chặn (409 + disable nút).
3. **Ngoài scope:** không inline player MP4 (chỉ tải file); không background job sống qua đóng tab; không parallel nhiều shot; không đổi thuật toán kenburns/timeline.
4. **Ràng buộc:** không thêm dep (ffmpeg qua spawn); dùng lại NDJSON; **DRY** — CLI + route chung 1 engine; zip export + CLI vẫn còn nhưng **lùi xuống "nâng cao"** (render in-app là hành động chính).
5. **Touchpoints:** `scripts/render-video.mts`, `lib/ffmpeg.ts`, `app/video/[jobId]/page.tsx`, tham chiếu `export-bundle/route.ts`, `lib/ndjson-*.ts`, `components/ui/progress.tsx`.

## Approach đã chọn — A (streaming route + shared `lib/render.ts`)

Tách `main()` của `render-video.mts` thành `lib/render.ts::renderVideo(input, opts)` source-agnostic. CLI đọc bundle → `RenderInput`; route đọc store → `RenderInput`. Cả hai gọi cùng `renderVideo`.

**Luồng:**
```
POST /storyboard/render (multipart config+bgm)
  → route đọc store → RenderInput{segments,config,images,bundledAudio,bgm}
  → createNdjsonStream() → trả response ngay, chạy nền:
     renderVideo(input,{onProgress:write, signal})
       TTS(cache)→buildTimeline→renderShot×N→concat→buildAudioTrack→duckBgm→burnSubs→mux
       (mỗi mốc: onProgress→write {phase,i,n})
       ghi .render/<jobId>-<aspect>/output.*
  → final NDJSON {done, downloads:{mp4,srt,timeline}}
client readNdjsonBody → <Progress> + "shot i/N" → done: tự tải MP4 + [Tải .srt][Tải timeline]
GET /storyboard/render/output?file=mp4|srt|timeline → serve từ disk
```

**Cancel + lock:**
- `ffmpeg.ts::runCommand(bin,args,signal?)` → `child.kill('SIGKILL')` khi abort; thread `AbortSignal` qua `renderShot/concat/buildAudioTrack/duckBgm/burnSubs/mux`.
- Route tạo `AbortController`; stream `cancel()` (client đóng/bấm Hủy → fetch abort) → `controller.abort()` → kill ffmpeg.
- Lock: `Set<jobId>` cấp module (hoặc field store) → 409 nếu đang render; client disable nút.

**Giao 3 file:** trình duyệt hay chặn multi-download → tự tải MP4 (file chính), `.srt`/`.timeline` là nút bấm tay. Không gói zip (khỏi tái lập "zip").

## Bản đồ thay đổi

| File | Việc |
|------|------|
| `lib/render.ts` (mới) | `renderVideo(input,opts)` trích từ render-video.mts + `onProgress` + `signal` |
| `lib/ffmpeg.ts` | các hàm nhận `AbortSignal`, kill child khi abort |
| `scripts/render-video.mts` | thu gọn ~50 dòng: parseArgs→readBundle→RenderInput→renderVideo (onProgress=console.log) |
| `app/api/jobs/[id]/storyboard/render/route.ts` (mới) | POST streaming render từ store, guard 409 |
| `app/api/jobs/[id]/storyboard/render/output/route.ts` (mới) | GET serve mp4/srt/timeline |
| `app/video/[jobId]/page.tsx` | nút Render (chính) + Progress + Hủy + tự tải + hạ Export zip vào dropdown "Nâng cao" |
| `lib/render-lock.ts` (mới, nhỏ) hoặc field store | Set jobId đang render |
| `README.md` | bước render in-app + sửa câu "chỉ CLI là chân lý" (engine dùng chung) |

## Rủi ro / mitigation

- **DRY refactor là gate chính** → `npm run test:render` phải vẫn xanh sau khi tách (bằng chứng engine không đổi). Lý do khuyến nghị `--tdd`.
- **Render theo vòng đời request** (đóng tab→abort): đúng ý, đã chốt ngoài scope background.
- **Dọn rác** `.render/<jobId>-<aspect>/`: giữ để download; render mới cùng job+aspect xóa cũ trước. Local nên chấp nhận.
- **Restart mất RAM:** đúng bản chất tool, không đổi.

## Phương án bị loại

- **B (background job + SSE/poll):** render sống qua đóng tab + queue nhiều job — over-engineer cho tool 1 người đang ngồi xem + đã có lock. YAGNI.
- **C (route spawn lại CLI, scrape stdout):** vẫn phải ghi zip ra đĩa (ngược mục tiêu), progress scrape log giòn, cancel phải kill cây tsx→ffmpeg, 2 process. Thua A mọi mặt trừ "khỏi refactor".

## Success metrics

- Bấm Render → MP4 + .srt + .timeline tải về, KHÔNG chạm terminal.
- MP4 in-app == MP4 CLI (cùng bundle/config): kiểm bằng `test:render` vẫn pass + so byte/độ dài 1 mẫu.
- Hủy giữa chừng: ffmpeg process biến mất (`pgrep ffmpeg` sạch), UI về trạng thái nghỉ.
- Render lần 2 khi đang chạy: 409 + nút disable.

## Next steps

1. `/ak:plan --tdd` với report này làm input — lock hành vi engine (test:render/test:e2e-video) trước, rồi refactor `lib/render.ts`, sau đó route + UI + cancel/lock.
2. Sau plan: cân nhắc `validate`/`red-team` (do ak:plan tự surface).

## Unresolved

- Chưa chốt: có dọn `.render/<jobId>-<aspect>/` cũ theo TTL/khi thoát, hay chỉ ghi-đè khi render lại cùng aspect (đề xuất: ghi-đè, bỏ TTL — YAGNI). Quyết ở phase plan nếu cần.
