# CapCut TTS — Response Samples (Phase 1 capture)

**Ngày capture:** 2026-07-17 · **Nguồn:** K07VN/capcut-tts-api (Python client gốc, chạy với device profile mặc định)
**Kết luận gate:** ✅ API **CÒN SỐNG** — tiếp tục plan (không dừng).

> Token đã redact. Không commit credentials. Device profile mặc định trong repo nguồn hoạt động, không cần `--device-json`.

---

## 1. Endpoint + flow

- Base: `https://editor-api-sg.capcutapi.com`
- `POST /lv/v1/common_task/new` → trả `task.id` + `task.token`, `status: "queueing"`.
- `POST /lv/v1/common_task/query` (poll) → đến khi `status: "succeed"` hoặc `"failed"`.
- Audio = **URL tải về** (KHÔNG base64), tải bằng GET trần không cần header đặc biệt.

## 2. Request headers thật (từ `--dry-run`, port sang TS ở Phase 3)

Query string (URL-encoded) gồm device params + `babi_param` (JSON compact). Headers:

```
content-type: application/json
appvr: 8.7.0
ch: capcutpc_google
device-time: <unix_seconds>
lan: vi-VN
loc: VN
pf: 3
sign-ver: 1
tdid: 7647183892936328721
x-ss-stub: <MD5(body_text) hex lowercase>
x-ss-dp: 359289
x-khronos: <unix_seconds>            # = device-time
x-tt-trace-id: 00-<hex32>-<hex16>-01
user-agent: Cronet/TTNetVersion:1d7cc3b1 2025-07-16 QuicVersion:52c2b40d 2025-04-03
accept-encoding: gzip, deflate
store-country-code: vn
store-country-code-src: did
is-dispatch-us-ttp: 0
is-app-region-us-ttp: 0
app-sdk-version: 8.7.0                # chỉ có ở tts-new (appid=true)
appid: 359289                         # chỉ có ở tts-new (appid=true)
sign: <MD5("9e2c|{path[-7:]}|3|{appvr}|{device-time}|{tdid}|11ac")>
```

**Xác nhận signing (khớp Python gốc):**
- `x-ss-stub` = MD5 của **body text đúng như gửi đi** (compact JSON, `separators=(",",":")`, `ensure_ascii=False` → giữ nguyên UTF-8), hex **lowercase**.
- `sign` header = MD5 của `"9e2c|{7 ký tự cuối của path, KHÔNG gồm query}|3|{appvr}|{device-time}|{tdid}|11ac"`.
  - Ví dụ path `/lv/v1/common_task/new` → `path[-7:]` = `ask/new`.
  - Ví dụ path `/lv/v1/common_task/query` → `path[-7:]` = `sk/query`.
- `payload.sign` (bên trong body) = RSA PKCS#1 v1.5 encrypt (public key nhúng) của chuỗi
  `appid:{aid}&did:{device_id}&creditDisable:false&ssml:{MD5(ssml)}&extraInfo:{extra_info}`
  rồi base64. **Lưu ý:** đây là RSA *encrypt bằng public key* (không phải sign bằng private key) — port bằng `node:crypto` `publicEncrypt` với `RSA_PKCS1_PADDING`.
- `x-khronos` = `device-time` = `Math.floor(Date.now()/1000)` (Unix **giây**).

**RSA public key (PEM, nhúng hằng số):**
```
-----BEGIN PUBLIC KEY-----
MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEAmTd34Lw4b7IuldSXh/zY
CMla+ITdGG5TeWz6ad+OySd4r+IrY45AoqrYUxhQ2dl+7z+i7r/5vEa8rr39BYfB
8AGMQLmZA8HmgpWBsqrn/V6daUALkKnkLb70Fn32CJigIuGXAYqxUdGuI340aC+0
v5Es3puJsHyzf01/AelE4Cdc6bZhQrASJLBh8R3BQToYClmDVSDUQk28o8sl/guA
Z4n303Vj+6Siv1HayPCdV6kpVVnMBAG4+umUbwGmn132N3fgpzLarFF3XyWmS1zh
D/J07iM/rP8GDO9IskHNHd2phrO0G6KzrcFAnTBHjVv+hCBEfzN/no3FNA9AuC36
mwIDAQAB
-----END PUBLIC KEY-----
```

## 3. SSML (từ Python `tts_new_body`)

```xml
<speak version="1.0" xmlns="http://www.w3.org/2001/10/synthesis" xml:lang="en-US">
    <voice name="{voice}" mock_tone_info="" platform="sami" resource_id="{rid}" emotion="" emotion_scale="0" style="" role="" moyin_emotion="" is_clone_tone="false" need_subtitle_timestamp="false">
        <prosody rate="{rate}">{escape_xml(text)}</prosody>
    </voice>
</speak>
```
- `escape_xml`: `& < > " '` → `&amp; &lt; &gt; &quot; &apos;`.
- 1 segment = 1 `<voice>` block. Ta synth từng đoạn riêng (như ElevenLabs) → chỉ cần 1 block.

**Body ngoài (`common_task/new`):** `{ bind_id: uuid, can_queue: true, enter_from: "text_to_speech", tasks: [{ context: uuid, payload: <compact-json-string của inner payload>, req_key: "sami_text_to_speech", task_version: "v3" }] }`.
Inner payload: `{ audio_format:"mp3", babi_param:<compact-json-string>, credit_disable:false, extra_info:'{"benefit_info":{}}', need_merge_voice:false, need_subtitle_timestamp:false, scene:"text_to_speech", ssml:<...>, sign:<RSA-base64> }`.
`babi_param` (query + trong payload): `{feature_entrance:"editor", feature_entrance_detail:"editor-feature-text_to_speech", feature_key:"text_to_speech", scenario:"video_editor"}`.

**Query body (`common_task/query`):** `{ tasks: [{ bind_id:"", id: task_id, req_key:"sami_text_to_speech", task_version:"v3", token }] }`.

## 4. Response `new` (queueing) — redacted

```json
{
  "ret": "0", "errmsg": "success", "svr_time": 1784277495,
  "data": { "tasks": [ {
      "id": "6a59e9f72c08b301d8995db0_8_0",
      "status": "queueing",
      "token": "<REDACTED>",
      "estimated_time": 10814, "inqueue_amount": 163, "inqueue_time_ms": 9291
  } ], "failed_tasks": [] }
}
```
- Lấy `data.tasks[0].id` + `data.tasks[0].token` để poll.

## 5. Response `query` — SUCCEED

Envelope: `{ ret:"0", errmsg:"success", ... }`. Task fields (không payload):
```json
{ "id":"...", "status":"succeed", "progress":100, "duration":10579,
  "failed_node_key":"sami_text_to_speech", "actual_inqueue_time_ms":10496 }
```
> ⚠️ **QUAN TRỌNG:** `failed_node_key` xuất hiện KỂ CẢ khi succeed → **không** dùng field này để phán lỗi. Chỉ tin `status`.

`payload` là **JSON string**, parse ra:
```json
{
  "audio_subtitles": [ {
      "speech_url": "https://v16m-default.tiktokcdn.com/.../?...&mime_type=audio_mpeg&...",
      "speech_vid": "v1c70cg5000cd9cuhr7og65jjk6jecb0",
      "utterances": null,
      "duration": 2376,
      "hit_cache": true,
      "platform": "sami",
      "invalid_input": false,
      "text": "Xin chào, đây là bài kiểm tra giọng đọc.",
      "code": 0, "msg": "",
      "speaker_id": "BV074_streaming"
  } ],
  "scene": "text_to_speech"
}
```

**JSON path audio:** `JSON.parse(data.tasks[0].payload).audio_subtitles[0].speech_url`.
`.duration` là ms (khớp ffprobe). Per-segment cũng có `code`/`msg` (0 = ok) → có thể check thêm.

## 6. Response `query` — FAILED

```json
{ "id":"...", "status":"failed", "progress":0,
  "err_code":40402004, "err_msg":"TTSInvalidSpeaker",
  "failed_node_key":"sami_text_to_speech", "payload": null }
```
- Khi `status==="failed"`: đọc `err_msg` + `err_code` cho message lỗi. `payload` = null.

## 7. Audio download — xác nhận format

- `curl` trần (KHÔNG header): `HTTP 200`, `content-type: video/mp4` (❗sai lệch — bỏ qua header này).
- `ffprobe`: `format_name=mp3`, `duration=2.376` → khớp `duration:2376` trong payload.
- `file`: `MPEG ADTS, layer III, v2, 160 kbps, 24 kHz, Monaural`. → **mp3 hợp lệ**, ffprobe của lib đo được duration bình thường.
- Kích thước mẫu: 47520 bytes cho câu ~2.4s.

## 8. Status values + poll timing (chọn interval/timeout Phase 3)

- Status quan sát: `queueing` (khởi tạo) → `succeed` (thành công) | `failed` (lỗi). Không thấy `processing`, nhưng parser nên coi *mọi status ≠ succeed/failed* là "poll tiếp".
- `new` trả `estimated_time` ~10.8s, `inqueue_amount` 163 (hàng đợi).
- Thực đo: từ `new` đến `succeed` ~10–13s (câu dài); câu ngắn ~8–20s kể cả queue.
- **Chốt Phase 3:** interval **1500ms**, timeout tổng **120s** (khớp AbortSignal ElevenLabs) — dư an toàn.

## 9. Catalog giọng Việt — verify thực nghiệm (câu "Xin chào các bạn.")

| voice_type | resource_id | display_name | Kết quả |
|---|---|---|---|
| `BV074_streaming` | 7102355709945188865 | Cô Gái Hoạt Ngôn | ✅ OK |
| `BV075_streaming` | 7102355803792740865 | Thanh Niên Tự Tin | ✅ OK |
| `vi_female_huong` | 7264854897953083905 | Giọng Nữ Phổ Thông | ✅ OK |
| `BV421_vivn_streaming` | 7252594014782755330 | Nhỏ Ngọt Ngào | ✅ OK |
| `BV562_streaming` | 7483736254694035984 | Mai | ✅ OK |
| `BV560_streaming` | 7483736167565758992 | Alex Đại Đế | ✅ OK |
| `multi_female_yangguangnv_uranus_bigtts` | 7637456432522218773 | Ban Mai | ✅ OK |
| `multi_female_sisi_uranus_bigtts` | 7637455857285860629 | Bản Tin nữ | ✅ OK |
| `vi-VN-HoaiMyNeural` | 7371666434650280464 | Hoai My | ❌ FAILED (TTSInvalidSpeaker) |
| `vi-VN-NamMinhNeural` | 7371666524727153168 | Nam Minh | ❌ FAILED (TTSInvalidSpeaker) |

**→ Catalog Phase 3/4 dùng 8 giọng ✅.** Loại 2 giọng `*Neural` (device profile mặc định không có quyền — `err_msg: TTSInvalidSpeaker`).
Repo nguồn `Voice.json` liệt kê 24 giọng Việt (129 tổng); chỉ đưa vào catalog những giọng verify được, mở rộng dần khi cần.

## 10. Ghi chú port sang TS (Phase 3)

- `x-ss-stub` = `crypto.createHash('md5').update(bodyText,'utf8').digest('hex')` — bodyText phải là **chính chuỗi JSON gửi đi** (compact, no space).
- `sign` header = MD5 chuỗi ghép, chú ý `path[-7:]` KHÔNG gồm query string.
- `payload.sign` = `crypto.publicEncrypt({ key, padding: RSA_PKCS1_PADDING }, Buffer.from(signInput,'utf8')).toString('base64')`.
- JSON body: dùng `JSON.stringify` mặc định (không space) → khớp `compact_json` của Python. Cẩn thận: Python `ensure_ascii=False` giữ UTF-8 raw; `JSON.stringify` của JS cũng giữ UTF-8 raw → khớp. MD5 tính trên bytes UTF-8.
- Tải audio: `fetch(speech_url)` trần, `Buffer.from(await res.arrayBuffer())`.
