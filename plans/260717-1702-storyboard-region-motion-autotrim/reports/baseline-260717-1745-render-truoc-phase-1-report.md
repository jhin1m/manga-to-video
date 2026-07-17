# Baseline render trước Phase 1 (bước 1 bắt buộc)

- **Ngày:** 2026-07-17, trước mọi thay đổi code của plan 260717-1702
- **Corpus:** `~/Downloads/Vừa Gả Đã Làm Mẹ Kế Của Ba Nhóc Con Chap 1.1 Next Chap 2.1 - NetTruyen` (38 slice JPEG)
- **Cây:** working tree hiện tại (có sẵn thay đổi TTS provider chưa commit — giữ nguyên làm hằng số so sánh)

## Kết quả ingest (y hệt app: downscale 720 → stitch → detectBands)

38 slice → **16 band** (khác 27 band của spike — spike chạy settings khác:
minBandHeight=960/maxBandHeight=2240 qua env; ở đây dùng default hiện tại của repo).

## Mode per-band (region=null, aspect 9:16) — bằng chứng đơn điệu

| Mode | Số band |
|---|---|
| `pan-v` | **12/16** |
| `zoom` | 4/16 |
| `pan-h` | 0/16 |

## Artefact mốc (scratchpad phiên 13410961, không commit)

| File | Nội dung |
|---|---|
| `baseline/baseline-filtergraphs.json` | mode + chuỗi filtergraph `kenburns()` từng band (region null, 9:16, dur 4s, fps 30, zoom 1.12) — mốc so **byte-identical** cho nhánh auto |
| `baseline/bundle.zip` | bundle 16 band, 1 band = 1 segment, region null |
| `baseline/baseline-916.mp4` | render 9:16 fps 24, mock TTS, 32.00s — mốc so bằng mắt |

Script tái lập: `baseline-region-motion.mts` (scratchpad) — chạy lại sau P1/P2, JSON phải
byte-identical, MP4 phải giống hệt bằng mắt.

## Ghi chú

- ffmpeg local thiếu libass → burn-in degrade, `.srt` rời vẫn xuất — hành vi có sẵn, không liên quan plan.
- Mode counts xác nhận chẩn đoán brainstorm/spike: video hiện tại gần như toàn lia dọc.
