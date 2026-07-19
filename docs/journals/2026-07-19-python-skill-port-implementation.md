# Port engine manga-to-video sang Python skill: thực thi trọn 7 phase + 3 gate PASS

**Date**: 2026-07-19 21:45
**Severity**: Low
**Component**: Python skill `~/.claude/skills/manga-to-video/` + parity harness `tools/parity-port/`
**Status**: Resolved — plan 260719-2024 hoàn thành, cả 3 gate nghiệm thu PASS

## What Happened

Thực thi plan `260719-2024-port-manga-to-video-engine-sang-python-skill-tu-chua` (7 phase) trong 1 session:
venv + baseline TS → skeleton + validate.py → ingest.py → tts.py → render.py → SKILL.md + vision agent
→ pilot A-Z trên corpus 38 slice. Kết quả: skill tự chứa chạy được trọn pipeline, video pilot 175s
16:9 + SRT, không sửa file nào trong `content-extractor/`.

Số liệu gate: (1) banding 0px lệch cả 26 cut/27 band trên cả 3 mode so sánh; (2) shake pilot p95
0.0796px vs baseline TS 0.9805px (ngưỡng 1.1×); (3) pilot A-Z + kill/resume test pass. Bonus: chuỗi
filter kenburns Python **byte-identical** TS trên 10 case. Code-reviewer chấm 8.5/10, không
Critical/High; đã fix 2 Medium (tmp file không unique trong `save_json_atomic`, shots-dir không
namespace theo aspect+pid) + 3 chỗ `round()` → `js_round` cho parity.

## Root Cause / Vì sao parity đạt tuyệt đối

Ba quyết định kỹ thuật quyết định kết quả 0px:
1. **Grayscale integer** `(299R+587G+114B)//1000` bằng numpy int32 — không dùng `PIL convert('L')`.
2. **`js_round` = floor(x+0.5)** thay `round()` Python (banker's rounding) ở MỌI chỗ port `Math.round`.
3. **Harness dump artifacts trung gian** (downscaled JPEG + canvas PNG từ sharp) → so parity thuật toán
   trên cùng bytes trước, rồi mới so full-pipeline — cô lập được biến JPEG codec ngay từ đầu.
   Hoá ra libjpeg-turbo hai bên decode giống hệt nên full-pipeline cũng 0px luôn.

## Phát hiện ngoài dự kiến

- `output-16x9.*` (mốc so sánh z.ai trong plan) là **chương truyện khác** ("Kajin") chứ không phải
  corpus "Vừa Gả" — so kịch bản từng câu bất khả thi, chỉ so được quy tắc hình thức (bản Python giữ
  ngôi ba chuẩn hơn: SRT z.ai có caption tách dòng làm lộ ngoặc kép lơ lửng).
- ffmpeg 8.1.2 brew trên máy này **thiếu libass** → burn-in degrade đúng thiết kế (port `hasFilter`
  check phát huy tác dụng ngay pilot đầu tiên).
- Agent registry chỉ load lúc session start → `manga-vision-reader` tạo giữa session phải fallback
  general-purpose cho 3/4 batch; batch 4 chạy agent thật OK sau khi registry refresh.

## Lessons Learned

- Port cross-language muốn parity pixel-perfect thì việc ĐẦU TIÊN là dump baseline + artifacts trung
  gian từ engine gốc, không phải viết code port. Mọi quyết định rounding sau đó có chỗ đối chiếu ngay.
- Parity filter-string (diff byte) rẻ hơn và chắc hơn parity video render — chốt được tầng sinh lệnh
  trước khi tốn thời gian đo shake.
- CapCut sign (MD5 + RSA PKCS#1 v1.5) port đúng ngay lần đầu nhờ giữ nguyên THỨ TỰ field trong
  compact JSON (dict Python giữ insertion order = JSON.stringify).
