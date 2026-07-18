# Code Review — AI Settings UI (uncommitted)

Reviewer: code-reviewer | 2026-07-18 | repo: manga-to-video / content-extractor

## Phạm vi
- Files mới: `lib/settings.ts`, `app/api/settings/route.ts`, `app/api/settings/models/route.ts`, `components/settings-dialog.tsx`, `scripts/verify-settings.mts`
- Files sửa: `lib/vision.ts`, `lib/script.ts`, `components/app-shell.tsx`, `.gitignore`, `.env.example`, `README.md`, `package.json`, `scripts/e2e-storyboard.mts`, `scripts/e2e-script-video.mts`, `scripts/verify-script.mts`
- LOC: ~+430 / -9

## Kết quả gate (Node 24.18.0)
- `npm run lint` → sạch, 0 lỗi
- `npx tsc --noEmit` → 0 lỗi type
- `npm run test:unit` → EXIT 0 (chạy được với `.settings.json` thật đang tồn tại → guard `/dev/null` hoạt động)
- `npx tsx scripts/verify-settings.mts` → tất cả assertion PASS (6 nhóm case)

## Đối chiếu Acceptance Criteria
| # | Tiêu chí | Kết luận |
|---|---|---|
| 1 | Settings quyết baseURL/model/key mỗi request, hiệu lực ngay | ĐẠT — reader gọi mỗi request; cache mtime, PUT null cache trước khi ghi |
| 2 | Không file → ENV y hệt (kể cả SCRIPT_API_KEY/SCRIPT_BASE_URL) | ĐẠT — nhánh ENV giữ nguyên; verify-settings case 1 xác nhận |
| 3 | Có settings → bỏ qua SCRIPT_* | ĐẠT — case 2 xác nhận, đã document ở .env.example/README |
| 4 | disableThinking chỉ áp z.ai | ĐẠT — `isZaiProvider(...) && flag`; case 2 (openrouter→false), case 4 (zai→true) |
| 5 | Không lộ API key qua API/log/file | ĐẠT — file chỉ 5 field (provider/baseURL/vision/script/thinking), không có apiKey; GET chỉ trả boolean; log chỉ in path khi file hỏng |
| 6 | 4 route reader không hồi quy, signature 2 hàm không đổi | ĐẠT — reader vẫn no-arg; grep xác nhận 4 caller nguyên vẹn |
| 7 | Không lint/type/build error mới | ĐẠT — lint + tsc + test:unit đều xanh |

## Critical / High
Không có.

## Medium
Không có blocking.

## Low / Informational (không chặn land)

1. **Server sanitize không "pin" baseURL preset cho provider non-custom** — `lib/settings.ts:62-65`.
   `sanitize` giữ nguyên `obj.baseURL` cho MỌI provider nếu client gửi giá trị. UI đã đặt readOnly + reset baseURL theo preset khi đổi provider, nên luồng bình thường an toàn; nhưng một PUT thủ công `{provider:'openai', baseURL:'https://x'}` sẽ được lưu và dùng với `OPENAI_API_KEY`. Lưu ý: đây KHÔNG phải quyền mới — provider `custom` vốn đã cho phép baseURL tùy ý + OPENAI key theo thiết kế; đây chỉ là vấn đề tính toàn vẹn nhãn (label 'openai' nhưng URL bất kỳ). Nếu muốn siết: với provider != 'custom', luôn ép `baseURL = preset.baseURL`, bỏ qua giá trị client.

2. **`/api/settings` PUT không có auth** — `app/api/settings/route.ts:26`. Ai truy cập được server local đều đổi được provider/baseURL. Nhất quán với toàn bộ app (các route /api/jobs cũng không auth) → chấp nhận được với tool local single-user. Chỉ nêu để orchestrator ý thức trust boundary khi tool này được expose ra ngoài localhost.

3. **Câu lệnh nằm giữa 2 import trong `scripts/verify-script.mts:35`** (`process.env.SETTINGS_FILE ??= '/dev/null'` xen giữa các `import`). Hoạt động đúng vì settings đọc lazy (không module nào đọc SETTINGS_FILE lúc import-time), và lint không bật `import/first` nên không báo lỗi. Chỉ là smell về đọc code; nếu sau này có module đọc env lúc import-time thì guard sẽ hụt. Có thể chuyển lên đầu file cho rõ ràng.

## Kiểm tra bổ sung (đều PASS)
- `lib/settings.ts` (fs) chỉ import server-side: chỉ `app/api/settings/route.ts`, `lib/vision.ts`, `lib/script.ts`, `verify-settings.mts` import; `settings-dialog.tsx` (client) tự khai interface + gọi qua `fetch` → không kéo fs vào client bundle. `models/route.ts` không import settings và không cần key.
- Edge case file hỏng/rỗng: `readAiSettings` try/catch → trả null (fallback ENV), không sập pipeline; verify case 5 phủ JSON hỏng / rỗng / provider lạ / custom thiếu baseURL.
- TOCTOU stat→read: nếu file bị xóa giữa chừng → readFileSync throw → catch → null. An toàn.
- Cache mtime: PUT gọi `writeAiSettings` (đặt cache=null) rồi `readAiSettings` cùng process → luôn đọc mới; sửa file ngoài → mtime đổi → re-read. Hợp lý cho single-process local.
- `.settings.json` thật (139B) còn nguyên sau khi chạy test — verify scripts dùng SETTINGS_FILE tạm/`/dev/null`, không đụng file dev.
- Sentinel `'env'` (PROVIDER_ENV) đúng idiom TTS_PROVIDER_ENV; comment tiếng Việt đúng phong cách repo.
- models route lỗi mạng → 502, client reset `modelsFetched` để thử lại; datalist chỉ gợi ý nên offline vẫn dùng được.

## Unresolved Questions
1. Có ý định expose content-extractor ra ngoài localhost không? Nếu có, các route /api/settings (và toàn bộ /api/jobs) cần lớp auth — hiện toàn bộ không auth.
2. Có muốn siết baseURL preset ở server (Low #1) để nhãn provider luôn khớp URL không, hay giữ nguyên vì `custom` đã cho baseURL tùy ý?
