# Debug: CapCut TTS "shark block only" (ret=-6)

**Ngày:** 2026-07-18 · **Lệnh gặp lỗi:** `npm run render -- bundle.zip --aspect 16:9`
**Trạng thái:** ✅ Root cause XÁC NHẬN bằng thực nghiệm · Fix đã kiểm chứng chạy được

## Triệu chứng
`[render] LỖI: CapCut API lỗi: shark block only.` — dừng ngay đoạn đầu tiên, không synth được audio nào.

## Root cause
Endpoint `POST /lv/v1/common_task/new` trả **HTTP 200** nhưng envelope `{"ret":"-6","errmsg":"shark block only"}`.
`shark` = hệ thống risk-control (风控) của ByteDance. Nó chặn vì **`device_id` bị hardcode dùng chung**:

- `lib/tts-providers/capcut.ts` `DEFAULT_DEVICE.device_id = '7647183892936328721'` (kèm `tdid` = giá trị đó, `iid = '7647185302080423697'`).
- Đây đúng là device_id ví dụ trong repo gốc K07VN/capcut-tts-api (`capcut_common_task_client.py:36`). Cả cộng đồng xài chung một device → ByteDance flag rate-limit.
- **Không phải lỗi ký (signing) của port TS.** Port ký byte-identical với Python; đổi mỗi device_id là chạy.

**Vì sao Phase 1 (17/07) chạy được mà nay hỏng:** phụ thuộc thời gian/usage — hôm qua device dùng chung chưa bị chặn, hôm nay đã bị. Không phải regression code.

Xác nhận từ upstream issues:
- #3 "Dùng nhiều bị ret=-6" — comment @KhoaDayy: *"random cái device id sang 1 dãy khác bất kì là được"*; nhiều user bị chặn đồng loạt.
- #7 "chạy tuần tự có polling và delay vẫn dính shark block" — chậm 24 text/phút vẫn dính.

## Bằng chứng thực nghiệm
Cùng code `capcutProvider.synth('Xin chào, đây là kiểm tra.')`:

| Device | Kết quả `/common_task/new` |
|--------|----------------------------|
| Default hardcode (`7647183892936328721`) | `ret:-6  shark block only` (lặp 4 lần do retry) |
| Random `device_id`/`tdid`/`iid` (qua `CAPCUT_DEVICE_JSON`) | `ret:0 success` → poll `succeed` → tải MP3 **36960 bytes** OK |

## Fix đề xuất (chưa áp dụng — chờ /ak:fix)
Thay device hardcode bằng **device identity ngẫu nhiên, PERSIST ra file local gitignored** (vd `.cache/capcut-device.json`), tự tạo lần đầu:
- Ổn định per-user (ít giống bot hơn so với đổi device mỗi request), nhưng unique cross-user (thoát block dùng chung).
- Chỉ random 3 field snowflake: `device_id`, `tdid = device_id`, `iid`. Giữ nguyên `aid`/app version… (là app-level, dùng chung hợp lệ).
- Đã có sẵn cửa `CAPCUT_DEVICE_JSON` (`loadDevice()`), nhưng mặc định vẫn rơi về device chung → cần đổi default sang random-persist.

**Fix tạm ngay để render bundle hiện tại:** tạo file JSON `{"device_id":"<19 số>","tdid":"<cùng>","iid":"<19 số>"}` rồi
`export CAPCUT_DEVICE_JSON=/path/device.json` trước khi `npm run render`. (Hoặc dùng `TTS_PROVIDER=elevenlabs` như HINT.)

## Finding phụ (robustness)
`ret:-6` được ném dưới dạng `Error` KHÔNG có `.status` → `isRetryable()` (lib/vision.ts) coi là lỗi mạng → **retry 4 lần vô ích** đập vào device đã bị chặn. Khi fix, nên coi ret=-6 là non-retryable (hoặc trigger xoay device), đừng retry mù.

## Câu hỏi mở
- Chọn chiến lược device: random-persist per-user (khuyến nghị) hay random per-process? Persist ổn định hơn nhưng cần quyết vị trí file + có xoay khi lại dính block không.
