---
phase: 2
title: "Bundle binary + resolver"
status: completed
priority: P1
effort: "2h"
dependencies: [1]
---

# Phase 2: Bundle binary + resolver

## Overview
Thêm resolver đường dẫn ffmpeg/ffprobe vào `lib/ffmpeg.ts` (điểm tập trung duy nhất spawn 2 bin) theo thứ tự `env → system PATH → bundled`, cache per-process, và sửa message ENOENT thành per-OS.

## Requirements
- Functional: mọi lệnh ffmpeg/ffprobe trong app (TTS probe, render, burn subs, mux, CLI `scripts/render-video.mts`) dùng bin đã resolve.
- Non-functional: macOS hiện tại không đổi hành vi (PATH-first); không thêm dependency ngoài phase 1; module load không được crash khi package bundled thiếu.

## Architecture
Thứ tự resolve (chốt ở brainstorm, không đảo):
```
FFMPEG_PATH / FFPROBE_PATH (env) → 'ffmpeg'/'ffprobe' trên PATH → bundled
```
- Kiểm "PATH có bin": spawn `<bin> -version` 1 lần, ENOENT → fallback; cache kết quả per-process (pattern như `filterListCache` sẵn có).
- Bundled: `ffmpeg-static` (default export: string|null), `@ffprobe-installer/ffprobe` (`.path`). Load lazy qua `createRequire`/dynamic import trong try/catch — thiếu package/binary → coi như không có bundled.
- Hết cả 3 nguồn → throw message theo `process.platform`: win32 `winget install ffmpeg` (hoặc scoop/choco), darwin `brew install ffmpeg`, linux `apt/dnf`, luôn kèm gợi ý đặt `FFMPEG_PATH`.
- Sửa nhánh ENOENT trong `runCommand` (`lib/ffmpeg.ts:38-41`): chỉ còn xảy ra khi env override trỏ sai — message nêu rõ path đang dùng.

Gợi ý shape (cook quyết chi tiết, giữ chữ ký public không đổi):
```ts
async function resolveBin(kind: 'ffmpeg' | 'ffprobe'): Promise<string> // cache Map
// các hàm export đổi runCommand('ffmpeg', ...) → runCommand(await resolveBin('ffmpeg'), ...)
```

## Related Code Files
- Modify: `content-extractor/lib/ffmpeg.ts` — resolver + thay bin literal tại: `assertFfmpeg`, `hasFilter`, `probeDurationSec`, `probeStreams`, `renderShot`, `concatVideo`, `buildAudioTrack`, `duckBgm`, `burnSubs`, `mux`
- Không đụng: `lib/render.ts`, `lib/tts.ts`, routes — chỉ gọi qua lib/ffmpeg.ts (trừ khi grep phát hiện call site lọt lưới)

## Implementation Steps
1. Viết `resolveBin` + cache + lazy load bundled path, export thêm cho test nếu cần (`__resetBinCacheForTest` hoặc tương đương theo convention repo).
2. Grep toàn repo `runCommand('ffmpeg'` / `'ffprobe'` + `spawn(` xác nhận không còn literal nào ngoài lib/ffmpeg.ts.
3. Thay tất cả call site trong lib/ffmpeg.ts dùng resolved bin.
4. Sửa message ENOENT + message "hết nguồn" per-OS.
5. Chạy `pnpm run test:unit`, `pnpm run test:render` trên macOS.

## Success Criteria
- [x] macOS bình thường: resolve ra `ffmpeg` PATH (brew), render pass như trước
- [x] `FFMPEG_PATH=/path/sai` → lỗi nêu rõ path sai, không silent fallback (env là override cứng)
- [x] Giả lập PATH không có ffmpeg (spawn với env PATH rỗng trong test) → resolve ra bundled, `assertFfmpeg()` pass
- [x] Module load không crash khi thiếu package bundled (mock/uninstall thử)

## Risk Assessment
- Đổi hàm sync→async ở chỗ resolve có thể lan chữ ký: giữ mọi hàm export vốn đã async — chỉ thêm `await resolveBin()` nội bộ, không đổi public API.
- `ffmpeg-static` trả null trên platform không hỗ trợ: nhánh bundled phải null-safe.
- Env override trỏ file không executable: message ENOENT mới phải bao được case này (in path + errno).
