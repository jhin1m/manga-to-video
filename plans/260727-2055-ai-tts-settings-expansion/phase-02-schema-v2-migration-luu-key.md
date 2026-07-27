---
phase: 2
title: "Schema v2 + migration + lưu key"
status: done
status_note: "Xong 2026-07-27. 2 điểm lệch spec: (1) migration scriptModel rỗng KHÔNG về null (spec cũ sai, vi phạm AC6 — đã sửa spec); (2) assertion disableThinking của case 2 dời sang Phase 3 để không có trạng thái trung gian gửi nhầm param GLM. Code review phát hiện lỗ hổng CAO: sentinel thừa kế key sang provider khác — đã sửa, test mục 19-21."
priority: P1
effort: "5h"
dependencies: [1]
---

# Phase 2: Schema v2 + migration + lưu key

## Overview

Đổi `.settings.json` từ shape phẳng v1 sang v2 lồng (vision/script/tts riêng), thêm lưu API key
trong file, giữ **tuyệt đối** backward-compat với file v1 và nhánh ENV thuần.

**Phase rủi ro cao nhất của plan.** Mọi thứ sau đây đứng trên nó.

## Requirements

- Functional: đọc/ghi v2; đọc file v1 → migrate trong bộ nhớ, không mất cấu hình;
  `apiKey` lưu trong file, ưu tiên hơn ENV, rỗng = fallback ENV; ghi file `mode 0o600`.
- Non-functional: file hỏng/rỗng/shape lạ → `null` (fallback ENV), **không throw**;
  `SETTINGS_FILE=/dev/null` vẫn cho ENV thuần; không log key.

## Architecture

```ts
interface StageConfig {
  provider: AiProviderId;
  baseURL: string;      // preset PIN theo preset; chỉ 'custom' nhập tay
  model: string;
  apiKey: string;       // '' = fallback ENV theo keyEnv
  disableThinking: boolean;
}
interface AiSettings {
  version: 2;
  vision: StageConfig;
  script: StageConfig | null;   // null = dùng chung Vision
  tts: { provider: string; voiceId: string; model: string; apiKey: string } | null;
}

// Config hiệu dụng cho từng stage — script null thì trả chính vision.
export function stageConfig(s: AiSettings, stage: 'vision' | 'script'): StageConfig;

// cfg.apiKey || ENV[keyEnv] || ENV.OPENAI_API_KEY || ''
export function resolveApiKey(cfg: StageConfig): { apiKey: string; keyEnv: string };
```

### Migration v1 → v2 (trong `sanitize`)

Thiếu `version` → coi là v1:
```
vision = { provider, baseURL, model: visionModel, apiKey: '', disableThinking }
script = { ...vision, model: scriptModel }     // KHÔNG rút gọn về null khi scriptModel rỗng
tts    = null
```

**Sửa so với bản đầu (2026-07-27):** ban đầu ghi `scriptModel ? … : null`. Sai: ở v1
`scriptModel` rỗng nghĩa là *rơi về `SCRIPT_MODEL` env*, còn `script: null` ở v2 nghĩa là
*dùng y model của vision* — hai thứ khác nhau, migrate về `null` sẽ đổi model biên kịch của
file v1 đang chạy (vi phạm AC6). `script: null` từ nay CHỈ sinh ra khi người dùng tick
"dùng chung" trên UI.
Migration chỉ trong bộ nhớ khi đọc. File trên đĩa nâng lên v2 ở lần `writeAiSettings` kế tiếp
— **không** tự ghi đè lúc đọc (đọc là thao tác chỉ-đọc, không gây side effect bất ngờ).

### Sentinel key 3 trạng thái (`writeAiSettings`)

| Giá trị client gửi | Ý nghĩa |
|---|---|
| `apiKey: null` | **giữ nguyên** key đang lưu (đọc file cũ ra ghép vào) |
| `apiKey: "sk-..."` | key mới |
| `apiKey: ""` | xoá → fallback ENV |

Chuỗi bắt đầu bằng `'•'` bị **từ chối** (`throw`) — chặn đúng lỗi client lỡ gửi lại chuỗi mask.

## Related Code Files

- Modify: `content-extractor/lib/settings.ts` (~124 → ~220 dòng)
- Modify: `content-extractor/scripts/verify-settings.mts` (mở rộng)
- Create: `content-extractor/plans/../fixtures` — không cần file riêng, fixture v1 viết inline
  trong test bằng `writeFileSync`

## Implementation Steps

### Bước 1 — Test trước (TDD), phân loại rõ Khoá vs Cố-ý-đổi

**Assertion KHOÁ — giữ nguyên, đỏ nghĩa là code sai:**
1. Không có file → `readAiSettings() === null`, vision/script chạy ENV thuần (case 1 hiện tại,
   gồm cả back-compat `SCRIPT_BASE_URL`/`SCRIPT_API_KEY`).
2. File hỏng / rỗng / provider lạ / custom thiếu baseURL → `null`, không throw (case 5).
3. `writeAiSettings(null)` xoá file; sau đó về ENV thuần (case 6).
4. Trailing slash bị cắt, model được trim (case 6).
5. Thiếu mọi key → lỗi **nêu đúng tên biến env** (case 3).
6. `SETTINGS_FILE=/dev/null` → coi như chưa cấu hình.

**Assertion CỐ Ý ĐỔI — sửa kèm comment lý do:**
7. Mọi `writeAiSettings({...} as AiSettings)` viết lại theo shape v2 lồng.
8. Case 2 (openrouter) hiện assert `disableThinking === false`. **Dời sang Phase 3** — chính
   phase này nói hiệu lực thể hiện ở `extraParams`, mà `extraParams` chỉ ra đời ở Phase 3.
   Đổi ở Phase 2 sẽ khiến `completeJson` gửi thật param GLM sang OpenRouter trong khoảng
   giữa hai phase.

**Assertion MỚI:**
9. **Migration**: ghi file JSON v1 thật (`{provider:'zai-coding', baseURL:'…', visionModel:'glm-4.5v',
   scriptModel:'glm-4.6', disableThinking:true}`) → `readAiSettings()` trả v2 đúng:
   `vision.model==='glm-4.5v'`, `script.model==='glm-4.6'`, `script.provider==='zai-coding'`,
   `vision.apiKey===''`.
10. Migration khi `scriptModel` rỗng → `script.model === ''` (KHÔNG phải `script === null`),
    và `readScriptConfig()` vẫn rơi về `SCRIPT_MODEL` env y như v1.
11. **Round-trip key (AC4)**: ghi key `'sk-real-123'` → `writeAiSettings` với `apiKey: null`
    → đọc lại key vẫn `'sk-real-123'`.
12. `apiKey: ''` → xoá key, `resolveApiKey` rơi về ENV.
13. `apiKey` bắt đầu bằng `'•'` → `writeAiSettings` **throw**.
14. `resolveApiKey`: `cfg.apiKey` thắng ENV; rỗng → `ENV[keyEnv]`; thiếu → `OPENAI_API_KEY`.
15. `stageConfig(s,'script')` với `script===null` trả **đúng object vision**.
16. File ghi ra có mode `0o600` (`statSync(file).mode & 0o777`).
17. File v2 đã tồn tại với mode `0o644` → `writeAiSettings` chmod về `0o600`.

Chạy `pnpm test:settings` → đỏ.

### Bước 2 — Code

18. Viết `StageConfig`/`AiSettings` v2 + `sanitizeStage` (pin baseURL theo preset, trim model,
    cắt slash — tái dùng logic v1, không viết lại).
19. `sanitize`: nhận cả v1 lẫn v2, v1 → migrate. Fail → `null` + `console.warn` (giữ nguyên
    hành vi, **warn không được chứa key**).
20. `writeAiSettings`: xử sentinel (đọc file cũ khi `apiKey === null`), reject chuỗi mask,
    `writeFileSync(..., { mode: 0o600 })` + `chmodSync` cho file đã có.
21. `stageConfig` + `resolveApiKey(cfg)` (đổi chữ ký từ `(provider)` sang `(cfg)`).
22. Chạy tới xanh.

## Success Criteria

- [ ] 6 assertion KHOÁ xanh, **không sửa** nội dung assertion nào trong nhóm đó
- [ ] Migration v1 (2 case) xanh — AC6
- [ ] Round-trip key (3 case) xanh — AC4
- [ ] mode 0o600 (2 case) xanh
- [ ] Mọi assertion nhóm "cố ý đổi" có comment nêu lý do ngay trên dòng
- [ ] `pnpm test:unit` + `pnpm lint` + `pnpm build` pass
- [ ] `grep -n "apiKey" lib/settings.ts` — không có dòng nào đưa key vào `console.*`

## Risk Assessment

| Rủi ro | Xử |
|---|---|
| **Sentinel `null` ghi đè key thật** | Test 11 viết trước code; thêm test 13 chặn chuỗi mask lọt vào |
| **Sentinel `null` thừa kế key SANG NHÀ CUNG CẤP KHÁC** (phát hiện lúc code review) | Chỉ thừa kế khi `provider` trùng; khác provider → rỗng → rơi về ENV của nhà đó. Test mục 19-21 `verify-settings.mts` |
| Migration hỏng file đang dùng của user | Đọc là chỉ-đọc, không tự ghi đè; fail → `null` → ENV thuần (đường lùi cũ) |
| `resolveApiKey` đổi chữ ký làm vỡ call-site | Chỉ 2 call-site (`vision.ts:36`, `script.ts:39`), sửa ở Phase 3; TypeScript bắt hết |
| Sửa nhầm assertion KHOÁ để "cho xanh" | Bảng phân loại + yêu cầu comment lý do; reviewer soi nhóm KHOÁ trước |
