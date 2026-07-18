# AI Settings UI — đổi provider/model từ dialog, không sửa .env

Status: done (2026-07-18) | Mode: cook auto (user chốt scope trong hội thoại)

Kết quả: đủ 6 acceptance criteria; lint + build + test:unit (266+ assertions, có verify-settings mới) pass; smoke-test API qua `next start :3111` pass (GET/PUT/reset/models proxy 344 model). Code-review: DONE_WITH_CONCERNS — 3 finding Low, đã fix 2 (pin baseURL preset server-side trong sanitize; dời guard SETTINGS_FILE xuống sau block import), 1 ghi nhận không sửa (PUT không auth — đúng posture app local single-user, mọi route /api/jobs cũng vậy). Report: plans/reports/from-code-reviewer-to-orchestrator-260718-2041-ai-settings-ui-report.md

## Mục tiêu
Settings dialog (⚙️ trong header) cấu hình provider AI (OpenAI / Z.AI / Z.AI Coding / OpenRouter / Custom) + vision model + script model + cờ tắt thinking (chỉ GLM z.ai). Lưu server-side vào `content-extractor/.settings.json` (gitignored), ưu tiên hơn env, hiệu lực ngay không restart. **API key KHÔNG lưu trong settings** — vẫn ở `.env.local`; thêm key theo provider: `ZAI_API_KEY`, `OPENROUTER_API_KEY` (fallback `OPENAI_API_KEY`).

## Acceptance criteria
1. Lưu settings provider=openrouter + model → job vision/script tiếp theo gọi đúng baseURL OpenRouter + model đã chọn, key lấy từ `OPENROUTER_API_KEY` (fallback `OPENAI_API_KEY`), không cần restart.
2. Không có `.settings.json` → hành vi y hệt hiện tại (env-only, kể cả `SCRIPT_API_KEY`/`SCRIPT_BASE_URL`).
3. Có settings → settings đè env cho CẢ vision + script (bỏ qua `SCRIPT_BASE_URL`; `SCRIPT_API_KEY` cũng bỏ qua vì key phải khớp provider). Nút "Dùng theo ENV" xóa file → quay về (2).
4. `disableThinking` chỉ có tác dụng khi provider là z.ai (không gửi param `thinking` lạ sang OpenAI/OpenRouter).
5. Provider=openrouter → dropdown/datalist model lấy từ proxy `/api/settings/models` (lọc model có vision cho ô vision); script model gợi ý `openrouter/auto`.
6. Test/e2e cô lập qua env `SETTINGS_FILE`; `pnpm test:unit` (thêm verify-settings) + lint + build pass.

## Files
| Hành động | File |
|---|---|
| create | `content-extractor/lib/settings.ts` — đọc/ghi/sanitize `.settings.json`, presets, resolveApiKey, cache mtime |
| create | `content-extractor/app/api/settings/route.ts` — GET (settings + presets + keyStatus boolean) / PUT (lưu hoặc reset) |
| create | `content-extractor/app/api/settings/models/route.ts` — proxy OpenRouter /models, cache 10' |
| create | `content-extractor/components/settings-dialog.tsx` — dialog ⚙️ |
| edit | `content-extractor/components/app-shell.tsx` — gắn nút cạnh ThemeToggle |
| edit | `content-extractor/lib/vision.ts` — `readVisionConfig()` đọc settings trước env |
| edit | `content-extractor/lib/script.ts` — `readScriptConfig()` tương tự |
| edit | `content-extractor/.gitignore` (+`.settings.json`), `.env.example` (doc key mới + luật ưu tiên) |
| create | `content-extractor/scripts/verify-settings.mts` + wire vào `test:unit` |
| edit | e2e scripts: set `SETTINGS_FILE` trỏ path không tồn tại |

## Ràng buộc
- `lib/settings.ts` chỉ chạy server (dùng fs) — client tương tác qua API route.
- Không đổi public contract: signature `readVisionConfig`/`readScriptConfig` giữ nguyên (sync, cùng shape).
- Không in key ra response/log — keyStatus chỉ boolean.

## Rollback
Xóa 4 file mới + revert 4 file edit; `.settings.json` người dùng tự xóa.
