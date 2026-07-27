# ✅ Phase 04 — Hợp nhất SKILL.md + `sync_codex_facade.py`

**Repo:** `~/.claude/skills/manga-to-video` · **Phụ thuộc:** không (làm lúc nào cũng được)

## Vì sao

`~/.codex/skills/manga-to-video/SKILL.md` là bản chép tay giữ **5 khác biệt** so với bản gốc.
Quy trình "chép lại rồi nhớ áp 5 khác biệt" đã hỏng: facade (20/07) trễ 2 feature — auto-region
v2.1 và toàn bộ style phụ đề. Hỏng im lặng, engine dùng chung nên không có lỗi nào bắn ra.

Soi lại thì 4/5 khác biệt **vô hại với Claude Code** → gộp hết vào bản gốc, facade thành bản sao
byte-for-byte, sync bằng `cp` + verify sha256. Hết đường drift.

## Hợp nhất — làm gì với từng khác biệt

| # | Khác biệt hiện có | Xử lý |
|---|---|---|
| 1 | Header "bản Codex — facade" | **Bỏ**, chỉ tồn tại vì có 2 file |
| 2 | `references/*.md` → đường tuyệt đối | **Gộp** — Claude Code đọc đường tuyệt đối bình thường |
| 3 | `export PYTHONDONTWRITEBYTECODE=1` trong khối `PY=` | **Gộp** — vô hại, còn tránh rác `__pycache__` |
| 4 | Khối "Sandbox" trong Prereqs | **Gộp**, đề rõ *(riêng Codex)* |
| 5 | Bỏ fallback subagent `manga-vision-reader` | **Viết lại thành điều kiện** — xem dưới |

Khác biệt #5 là chỗ duy nhất khó. Câu thay thế, đặt điều kiện **trước** hành động để model không
kịp lỡ tay spawn:

> **Thiếu `ZAI_API_KEY`** (script fail rõ đúng lý do): môi trường **có** subagent
> `manga-vision-reader` (Claude Code) → chia batch 5-8 slice, spawn tối đa 2-3 batch song song.
> Môi trường **không có** agent đó (Codex) → **DỪNG**, báo user khai key vào
> `~/.claude/skills/manga-to-video/.secrets.json`. Đừng đọc ảnh tay — vài trăm slice đốt sạch context.

Đồng thời chép sang facade 2 khối nội dung đang thiếu: **style phụ đề** (`--subs-style`,
`--subs-fonts-dir`, 3 quirk libass) và **auto-region v2.1** (`--no-auto-region`) — sau khi hợp
nhất thì việc này tự động, chỉ là hệ quả của `cp`.

## Files

- `SKILL.md` — hợp nhất như bảng trên.
- `scripts/sync_codex_facade.py` (mới) — copy `SKILL.md` sang `~/.codex/skills/manga-to-video/`,
  tạo thư mục nếu chưa có. Cờ `--check`: so sha256, lệch thì in cả hai hash + exit 1, không ghi.
  Viết bằng Python cho đồng bộ với phần còn lại của skill, không thêm ngôn ngữ mới.
- `SKILL.md` mục bảo trì — một dòng: sửa xong chạy `$PY $SCRIPTS/sync_codex_facade.py`.

Codex **không đi theo symlink** (đã probe) nên phải là file thật. **Không dùng hardlink**: editor
ghi kiểu write-new-then-rename sẽ phá hardlink âm thầm — đúng cái bug đang chữa.

## Các bước

1. Hợp nhất `SKILL.md`, đọc lại toàn bộ xem có chỗ nào mâu thuẫn giữa hai môi trường không.
2. Viết `sync_codex_facade.py`, chạy không cờ → facade cập nhật.
3. `sync_codex_facade.py --check` → exit 0.
4. `codex debug prompt-input | grep 'r0/manga-to-video'` → thấy đúng 1 dòng (không tốn model call).
5. `diff ~/.claude/skills/manga-to-video/SKILL.md ~/.codex/skills/manga-to-video/SKILL.md` → rỗng.

## Nghiệm thu

- Hai file giống hệt (`diff` rỗng, sha256 khớp).
- Codex nạp được skill; SKILL.md nó đọc **có** `--subs-style`, `--subs-preset`, `--no-auto-region`.
- Sửa một ký tự trong facade → `--check` exit 1 và in rõ hai hash.
- Đọc từ Claude Code: khối Sandbox và `PYTHONDONTWRITEBYTECODE` không gây hiểu nhầm; đường dẫn
  `references/` tuyệt đối vẫn mở được.

## Rủi ro

- **Rủi ro chính:** Codex đọc câu về subagent rồi vẫn cố spawn `manga-vision-reader` và fail.
  Giảm bằng cách đặt điều kiện trước hành động (đã viết ở trên), không phải sau. Nếu chạy thật
  vẫn thấy Codex cố spawn thì đổi sang chỉ dẫn phủ định trực tiếp: "Codex: KHÔNG có agent này".
- SKILL.md dài thêm ~15 dòng Codex-only mà Claude Code cũng đọc mỗi lần nạp. Chi phí token không
  đáng kể so với lệch tri thức.
- 3 skill khác ở `~/.codex/skills` (`react-doctor`, `remote-ssh`, `ui-ux-pro-max`) cùng bệnh.
  **Ngoài scope** — YAGNI, chưa cần giải chung.
