# Code Review — Manga Content Extractor (Stage 1, greenfield)

- **Ngày review:** 2026-07-06
- **Phạm vi:** `content-extractor/` — lib (schema/jobs/vision/pipeline), 7 API route, UI (page/layout), config, env. ~1.100 LOC TS/TSX.
- **Phương pháp:** đọc toàn bộ source, đối chiếu locked decisions + acceptance trong `plan.md`, chạy `tsc --noEmit` (pass, exit 0), xác minh `.gitignore` bằng `git check-ignore`.
- **Threat model áp dụng:** tool nội bộ localhost, một người dùng — KHÔNG báo thiếu auth/rate-limit/DB (locked decision).

## Tổng quan

Codebase sạch, bám sát locked decisions, kiến trúc đúng KISS. Các quyết định khó nhất đều được cài đặt đúng: subscribe-trước-snapshot-sau trong SSE (không mất event cuối), `recomputeDone` suy progress từ trạng thái item (tự khớp sau retry/PATCH thay vì đếm cộng dồn), `toItemDTO` whitelist field tường minh (không lộ buffer), downscale một lần dùng chung 3 mục đích, adaptive json-mode đúng spec. Không tìm thấy lỗi Critical/High.

Tồn tại một cụm finding Medium: (1) `.env.example` — nguồn tài liệu ENV duy nhất — đang bị chính `.gitignore` loại khỏi git; (2) hàm `send` trong SSE gọi `controller.enqueue` không có try/catch, nếu ném lỗi sẽ lan ngược vào call-site mutation state và có thể phá vỡ hợp đồng cô lập lỗi; (3) UI không có cơ chế reconnect/poll khi SSE đứt giữa chừng và không thể re-attach job sau khi refresh trang.

---

## Findings

### Critical

Không có.

### High

Không có.

### Medium

#### M1. `.env.example` bị git-ignore — mất tài liệu contract ENV khi commit lần đầu

- **File:** `content-extractor/.gitignore:34` (`.env*`), ảnh hưởng `content-extractor/.env.example`
- **Bằng chứng:** `git check-ignore -v` → `content-extractor/.gitignore:34:.env*  content-extractor/.env.example`. Repo root (`manga-to-video/.git`) hiện chưa commit gì (`?? content-extractor/`).
- **Mô tả:** Pattern `.env*` của scaffold ignore luôn `.env.example`. README chỉ là boilerplate create-next-app, không có doc ENV nào khác; error message trong `lib/vision.ts:16` cũng trỏ người dùng "xem .env.example". `.env.example` là nơi DUY NHẤT tài liệu hóa contract "switch OpenAI⇄Z.AI bằng ENV" (base URL Z.AI, model glm-4.5v) — acceptance criterion 3.
- **Failure scenario:** Commit đầu tiên → `.env.example` không vào git → clone mới không có mẫu ENV, không biết `OPENAI_BASE_URL`/`VISION_MODEL` cho Z.AI, error message trỏ đến file không tồn tại.
- **Đề xuất:** thêm `!.env.example` vào `.gitignore` ngay dưới dòng `.env*`. (`.env.local` chứa key thật vẫn được ignore đúng — đã xác minh.)

#### M2. SSE `send` gọi `controller.enqueue` không guard — lỗi listener lan ngược vào state mutation, blast radius vượt qua hợp đồng cô lập lỗi

- **File:** `app/api/jobs/[id]/stream/route.ts:30-34` (send), liên đới `lib/jobs.ts:56-61` (updateProgress emit), `lib/pipeline.ts:67-72`
- **Mô tả:** `bus.emit()` chạy listener đồng bộ. `send` chỉ guard bằng cờ `closed`; bản thân `controller.enqueue` không nằm trong try/catch. Nếu `enqueue` ném (controller đã closed/errored mà `cancel()`/`abort` chưa kịp set cờ — tình huống "Controller is already closed" từng được ghi nhận với SSE trên Next), exception truyền đồng bộ: `enqueue` → `send` → `bus.emit` → `updateProgress` → `setItemResult` — tức là **ném ra ngay tại call-site trong pipeline**.
- **Failure scenario cụ thể:** `pipeline.ts:68-69` — vision trả kết quả THÀNH CÔNG, `setItemResult` ném (vì emit) → rơi vào `catch` → `setItemError` đánh dấu item lỗi dù đã có kết quả; `setItemError` lại emit → ném lần hai → thoát khỏi limit-callback → `Promise.all` reject → `processChapter` reject → route POST đánh dấu cả job `phase:'failed'`. Một client SSE chết vào đúng thời điểm xấu phá vỡ cả hai bảo đảm: "1 ảnh lỗi không giết job" và kết quả đúng của item. Ngoài ra, listener ném trong `EventEmitter.emit` chặn các listener còn lại (tab SSE thứ hai mất event đó).
- **Xác suất kích hoạt thấp** (đường close/cancel/abort hiện tại phủ khá kín, single-thread không interleave giữa chừng emit) **nhưng blast radius cao và fix rẻ.**
- **Đề xuất:** bọc `controller.enqueue` trong try/catch bên trong `send`; khi catch → gọi `close()`. Nguyên tắc: listener của bus không bao giờ được ném.

```ts
const send = (p: JobProgress) => {
  if (closed) return;
  try {
    controller.enqueue(encoder.encode(`data: ${JSON.stringify(p)}\n\n`));
  } catch {
    close(); // controller chết — tự gỡ subscription, không lan lỗi vào emitter
    return;
  }
  if (p.phase === 'done' || p.phase === 'failed') close();
};
```

#### M3. UI: SSE đứt giữa chừng → progress đóng băng, không reconnect/poll; refresh trang → mất hẳn handle tới job đang chạy

- **File:** `app/page.tsx:125-130` (`es.onerror`), `app/page.tsx:42` (jobId chỉ nằm trong React state)
- **Mô tả:** `onerror` đóng EventSource ngay lập tức và gọi `refreshItems` MỘT lần. Nếu job vẫn đang `processing` (SSE đứt do transient — điển hình là dev-server recompile/HMR khi đang chạy job dài), UI hiển thị "Đang xử lý x/y…" vĩnh viễn, không cập nhật nữa, không hiện nút Export/Chapter mới (vì `running=true`). `jobId` không nằm trong URL nên refresh trang quay về màn upload — job vẫn chạy và hoàn tất phía server nhưng không còn cách nào xem/sửa/export qua UI → người dùng chạy lại từ đầu → tốn gấp đôi chi phí vision API.
- **Failure scenario:** chapter 60 trang đang chạy, sửa một file bất kỳ khiến dev server recompile → SSE drop → progress đứng im ở 23/60; refresh → mất job; chạy lại 60 call vision.
- **Đề xuất (chọn 1, giữ KISS):** (a) trong `onerror`, nếu status lấy từ `refreshItems` vẫn là `queued/processing` thì poll `GET /api/jobs/:id` mỗi 2s đến khi `done/failed`; hoặc (b) đặt `jobId` vào query string (`?job=`) và khôi phục qua `refreshItems` + mở lại SSE khi mount.

### Low

#### L1. SSE: signal đã aborted trước khi `start()` chạy → listener sống "zombie" đến khi job kết thúc

- **File:** `app/api/jobs/[id]/stream/route.ts:37`
- **Mô tả:** `addEventListener('abort', close)` với signal ĐÃ aborted sẽ không bao giờ fire (event đã dispatch trước đó). Nếu runtime cũng không gọi `cancel()` (response bị bỏ trước khi stream được đọc), subscription tồn tại đến khi job đạt `done/failed` (lúc đó `send` tự `close()` — tự hồi phục, nên chỉ Low; kết hợp M2 thì zombie send là ứng viên kích hoạt enqueue-throw).
- **Đề xuất:** đầu `start()`: `if (req.signal.aborted) { close(); return; }` và dùng `{ once: true }` cho listener.

#### L2. Store không bao giờ evict job — buffer ảnh tích lũy đến khi restart server

- **File:** `lib/jobs.ts:27` (store Map, không có `delete`)
- **Mô tả:** Mỗi chapter giữ toàn bộ buffer JPEG đã downscale (~10-30MB/chapter với MAX_EDGE 1568). "Chapter mới" trên UI không xóa job cũ. Trong threat model single-operator + restart-as-persistence là chấp nhận được (plan đã lock), nhưng session dev dài chạy nhiều chapter sẽ phình RAM không giới hạn.
- **Đề xuất (tùy chọn):** khi `createJob`, xóa các job cũ hơn N job gần nhất (giữ 3-5 job), hoặc `DELETE /api/jobs/:id` gọi từ `resetAll`.

#### L3. `jsonModeSupported` bị tắt vĩnh viễn bởi BẤT KỲ lỗi 400 nào, kể cả 400 không liên quan đến `response_format`

- **File:** `lib/vision.ts:82-85`
- **Mô tả:** Đúng theo locked decision ("on 400 retry without + disable process-wide") nên KHÔNG phải vi phạm spec. Nhưng 400 do nguyên nhân khác (ảnh bị từ chối, payload quá lớn, content policy) cũng flip cờ → mọi call sau mất json-mode âm thầm, tăng tỷ lệ lệch parse. Robust-parse đỡ được phần lớn nên chỉ Low.
- **Đề xuất (refinement, không bắt buộc):** chỉ flip cờ khi message lỗi chứa `response_format`/`json_object`; ngược lại rethrow.

#### L4. `classifyError` không có nhánh 400 — hiển thị raw message tiếng Anh của SDK

- **File:** `lib/vision.ts:117-124`
- **Mô tả:** 401/429/5xx có message tiếng Việt; 400 (ảnh bị endpoint từ chối sau downscale, prompt bị chặn…) rơi xuống `err.message` gốc — dài, tiếng Anh, đôi khi kèm request-id. Chỉ ảnh hưởng UX badge lỗi.
- **Đề xuất:** thêm `if (s === 400) return 'Yêu cầu bị từ chối (400) — ảnh hoặc prompt không được endpoint chấp nhận';`

#### L5. Parse index item bằng `parseInt` lỏng — `/items/1e2` khớp item 1, `/items/1.9` khớp item 1

- **File:** `app/api/jobs/[id]/items/[i]/route.ts:43`, `.../image/route.ts:12`, `.../retry/route.ts:16`
- **Mô tả:** `Number.parseInt` dừng ở ký tự không phải số → URL "sai" vẫn trúng một item hợp lệ thay vì 404. Tool nội bộ, client tự sinh URL đúng → chỉ là inconsistency.
- **Đề xuất:** dùng `/^\d+$/.test(i)` trước khi parse (một helper chung cho 3 route).

#### L6. PATCH item đang `pending` giữa lúc pipeline chạy → kết quả vision sau đó GHI ĐÈ bản sửa tay

- **File:** `app/api/jobs/[id]/items/[i]/route.ts:63-65` + `lib/pipeline.ts:68-69`
- **Mô tả:** Không reachable qua UI (bảng chỉ render sau khi job xong — `refreshItems` chỉ chạy ở done/failed), nhưng ở tầng API: PATCH set `status:'done'` cho item chưa xử lý, sau đó `setItemResult` từ pipeline ghi đè content của người dùng (last-write-wins). Đồng thời `progress.done` có thể chạm `total` khi phase còn `processing` (cosmetic).
- **Đề xuất (tùy chọn):** pipeline bỏ qua item có `status === 'done'` khi bắt đầu xử lý, hoặc chấp nhận và ghi chú — với single-operator hiện tại rủi ro gần bằng 0.

#### L7. Zip có thư mục lồng nhau bị flatten theo basename → trùng tên file tạo 2 hàng cùng `filename`

- **File:** `lib/pipeline.ts:29-30`
- **Mô tả:** `a/1.jpg` và `b/1.jpg` đều thành `1.jpg`, cả hai được giữ (server không dedupe — UI chỉ dedupe file upload trực tiếp). Sort ổn định nên thứ tự tie giữ theo thứ tự entry trong zip. Manifest vẫn phân biệt được bằng `index`, nhưng downstream nào key theo `filename` sẽ nhầm.
- **Đề xuất:** với zip 1 chapter chuẩn (phẳng) không xảy ra; nếu muốn chặt chẽ, reject zip có basename trùng với message rõ ràng.

### Informational

- `pipeline.ts:66` — `currentIndex` dưới concurrency là "item bắt đầu gần nhất", nhảy không tuyến tính. UI hiện không dùng `currentIndex` nên vô hại.
- `package.json` — `@types/node: ^20` trong khi runtime pin Node 24 (`.nvmrc`); và Validation Log trong plan ghi "typescript 6.0" nhưng project dùng `^5`. `tsc --noEmit` pass; chỉ là drift giữa plan-log và lockfile.
- `README.md` — boilerplate create-next-app nguyên bản (nhắc Geist font không dùng, hướng dẫn deploy Vercel không liên quan). Nên thay bằng 10 dòng: mục đích tool, setup ENV, `nvm use 24`, `npm run dev`.
- `app/api/jobs/route.ts:70-73` — fire-and-forget `processChapter` chỉ an toàn trên server Node tự host (`next dev`/`next start`); deploy serverless sẽ bị kill sau response. Đúng scope localhost hiện tại, ghi lại để tránh bất ngờ khi ai đó deploy thử.
- `.../image/route.ts:17` — `new Uint8Array(item.buffer)` copy buffer mỗi request + `Cache-Control: no-store` khiến thumbnail (bất biến sau ingest) bị refetch. Có thể cache immutable, nhưng không đáng ưu tiên.

---

## Đánh giá acceptance criteria

| # | Criterion | Kết quả | Ghi chú |
|---|-----------|---------|---------|
| 1 | `npm run dev` không lỗi type/runtime | ✓ | Đã verify trước đó (tsc/lint/build/E2E); review này chạy lại `tsc --noEmit` → exit 0. |
| 2 | Ordering 1,2,10 | ✓ | `naturalCompare` (`pipeline.ts:16-18`) dùng `localeCompare(…, {numeric:true, sensitivity:'base'})` — numeric collation cho 1<2<10 đúng, không phụ thuộc locale với chuỗi số; sort V8 stable nên tie ("01" vs "1") giữ thứ tự vào. UI sort mirror cùng logic (`page.tsx:57-59`). |
| 3 | Switch ENV OpenAI⇄Z.AI zero code change | ✓* | Không có hardcode ngoài fallback default (`vision.ts:23` model `gpt-4o-mini`, baseURL trống → SDK default). `readVisionConfig()` đọc ENV mỗi call. *Cảnh báo M1: `.env.example` (tài liệu duy nhất về giá trị Z.AI) đang bị git-ignore.* |
| 4 | Cô lập lỗi per-image + retry | ✓ | `processChapter` try/catch quanh từng item (`pipeline.ts:67-72`); không có đường code nào để 1 lỗi vision giết job (M2 là ngoại lệ lý thuyết qua ngả SSE, không phải qua vision). Lỗi downscale lúc INGEST fail cả request 400 — chủ đích, trước khi job tồn tại, không vi phạm criterion. Retry endpoint hoạt động, `recomputeDone` giữ progress nhất quán. |
| 5 | Export manifest versioned đúng shape | ✓ | `toManifest` (`schema.ts:58-75`) trả đúng `{version, jobId, createdAt, itemCount, items:[{index, filename, content, error?}]}`; `error` chỉ xuất hiện khi có (spread có điều kiện); `content` có thể `null` cho item lỗi — đúng khai báo `ManifestItem`. |

## Contract nội bộ (mục b/c của checklist)

| Kiểm tra | Kết quả |
|----------|---------|
| ItemDTO không lộ buffer | ✓ — `toItemDTO` (`jobs.ts:94-102`) whitelist field tường minh, không spread StoredItem. |
| schema.ts không import kiểu Node | ✓ — zero import; `toManifest` nhận shape structural, kiểu Buffer nằm hết ở `jobs.ts`. |
| SSE unsubscribe khi abort | ✓ — abort→close→unsub, cancel→unsub; edge L1 (signal aborted sẵn) tự hồi phục khi job done. |
| progress.done nhất quán sau retry/PATCH | ✓ — `recomputeDone` đếm lại từ trạng thái item, không cộng dồn; retry fail-lại không đổi done; PATCH không double-count. |
| Race: p-limit + updateProgress | ✓ — mutation đồng bộ single-thread, không torn state; `currentIndex` cosmetic. |
| Race: SSE subscribe vs snapshot | ✓ — subscribe TRƯỚC (`stream/route.ts:36`), snapshot SAU (`:39`) đọc `job.progress` tại thời điểm gửi → không mất event cuối; event trùng vô hại (payload là full state, idempotent). |
| Race: `jsonModeSupported` dưới concurrency | ✓ chấp nhận được — wave đầu tối đa N call chịu thêm 1 lần 400 rồi cờ ổn định; không deadlock/không sai kết quả. |

## Kết luận

Implementation đạt cả 5 acceptance criteria, tôn trọng đầy đủ locked decisions, không có finding Critical/High. Ba việc nên làm trước khi commit/ship nội bộ:

1. **M1** — thêm `!.env.example` vào `.gitignore` (1 dòng, làm ngay trước commit đầu tiên).
2. **M2** — bọc `controller.enqueue` trong try/catch tại `stream/route.ts` (3 dòng, đóng nốt lỗ hổng lý thuyết phá cô lập lỗi).
3. **M3** — poll fallback khi SSE đứt giữa chừng (hoặc jobId vào query string) để job dài không bị mất handle.

Các finding Low/Info xử lý tùy quỹ thời gian; L3 giữ nguyên theo locked decision trừ khi gặp vấn đề thực tế với endpoint cụ thể.

### Metrics

- Typecheck: pass (`tsc --noEmit` exit 0)
- Lint/build/E2E: pass (verify trước đó, không phát hiện mâu thuẫn khi đọc code)
- Test coverage: 0% unit test trong repo (E2E bằng mock server bên ngoài) — chấp nhận được với scope tool nội bộ; nếu thêm, ưu tiên `parseSceneJSON` và `naturalCompare` (pure function, dễ test nhất, rủi ro hồi quy cao nhất).
