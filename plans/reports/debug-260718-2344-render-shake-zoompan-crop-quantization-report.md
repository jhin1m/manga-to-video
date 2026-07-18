# Debug: video render bị shake, Storyboard preview thì không

**Kết luận:** Shake KHÔNG phải bug logic timeline/plan — là **lượng tử hoá toạ độ integer-pixel per-frame của filter ffmpeg** (`zoompan` cho mode zoom, `crop` cho mode pan) trong `content-extractor/lib/kenburns.ts`. Preview Storyboard dùng CSS transform (`kenburns-css.ts`) — float subpixel + GPU bilinear → mượt tuyệt đối, nên chỉ bản xuất bị.

## Bằng chứng (đo trên `content-extractor/output-16x9.mp4`, 1920x1080@30fps)

Phương pháp: phase correlation subpixel giữa từng cặp frame liên tiếp (script `measure_shake.py`, scratchpad session này — crop 640x640 tâm khung, Hanning window, parabolic subpixel fit).

### Video thật
- Cửa sổ 2s–6s (shot 0, zoom+blur-fill): dy pattern lặp `+0.14 +0.14 +0.14 +0.14 -0.87` — trườn xuống ~0.14px/frame rồi **giật ngược ~0.9px** mỗi 4–6 frame; dx tương tự chu kỳ ~7 frame. jitter std dy=0.64, max=1.14px.
- Cửa sổ 25s–29s (shot đơn 17.7s): cùng chữ ký, snap max 0.96px, thưa hơn (shot dài → zoom chậm → ít snap hơn).
- (Cửa sổ 100s có outlier -152px = điểm cắt chuyển shot, không phải shake.)

### Tái tạo trong scratchpad (ảnh giả manga, filter EXACT từ `kenburns()` + args EXACT của `renderShot`)
| Case | Filter path | Kết quả đo |
|---|---|---|
| band 800x2000, zoom blur-fill (fg `scale=864:2160` → `zoompan s=432x1080`) | zoompan ×2 SS | giống hệt video thật: creep +0.14, snap -0.87 |
| band 1000x1050, zoom | zoompan ×2 SS | như trên (snap ±0.85) |
| band 800x1300, pan-v (`crop=1920:1080:0:'0+2040*(t/7.639)'`) | crop theo t, KHÔNG supersample | bước nhảy **xen kẽ 8px/10px** quanh mean 8.9px/frame (±1px judder, jitter std 1.9) |

### Thí nghiệm knock-out (chứng minh nhân quả)
- Zoom supersample ×2→×4 (`scale=1728:4320` trước zoompan): jitter std dy 0.66→0.24, snap max 0.88→0.31px — **giảm tuyến tính theo hệ số supersample** ⇒ đúng là lượng tử hoá integer.
- Pan thêm ×2 SS (scale 3840, crop 3840x2160 với travel ×2, downscale 1920x1080): dy từ xen kẽ 8/10 → đều -9.00, lệch 1px chỉ ~mỗi 10 frame (std 0.996→0.301).

## Cơ chế
Tốc độ chuyển động Ken Burns rất chậm (zoom 1.12 trong 7–18s ⇒ dịch chuyển thực < 1px/frame). `zoompan` và `crop` làm tròn crop-rect về integer pixel mỗi frame ⇒ chuyển động mượt bị biến thành "đứng yên vài frame rồi giật 1px". Trên nét manga đen-trắng tương phản cao, ±0.9px là thấy rõ. Supersample ×2 hiện có cho zoompan chỉ giảm một nửa lỗi; pan hoàn toàn KHÔNG có supersample (comment dòng 7 `kenburns.ts` "Pan dùng crop theo t (mượt, không jitter như zoompan)" — sai: crop cũng lượng tử hoá integer, đã đo được).

## Hướng fix đề xuất (chưa áp)
1. `kenburns.ts` mode zoom: nâng supersample ×2 → ×4 (cả nhánh thường lẫn blur-fill fg). Lưu ý nhánh thường 16:9: `scale=7680:4320` trước zoompan — RAM/CPU tăng, cân nhắc ×4 chỉ khi khung nhỏ hoặc kết hợp zoompan out 2× + downscale.
2. Mode pan: render pan ở 2×–4× (scale 2×W → crop 2× khung với travel expr ×2 → downscale về W×H).
3. Cập nhật gate hồi quy trong `scripts/verify-script.mts` (đang assert chuỗi filter byte-identical: `crop=1080:1920:0:`, v.v.).
4. Nghiệm thu bằng chính script đo: snap max < 0.3px cho zoom, ripple pan ≤ 0.5px.

## Addendum 260718-2355: benchmark chi phí fix (lo ngại "video quá nặng")

Supersample KHÔNG đổi kích thước/bitrate file ra (vẫn 1920x1080) — chỉ tốn thêm thời gian render. Đo trên shot 7.639s, M-series, libx264 veryfast:

| Case | Thời gian render | Jitter (dy snap max / std) |
|---|---|---|
| Zoom blur-fill hiện tại (SS ×2) | 1.92s | 0.88px / 0.66 |
| Zoom blur-fill SS ×4 | 2.55s (+33%) | 0.43px / 0.24 |
| **Zoom SS ×4 + `tmix=frames=2` sau zoompan** | 2.63s (+37%) | **0.14px / 0.024 — mượt như preview** |
| Zoom band gần vuông SS ×4 (fg 4112×4320, worst common) | 3.85s | — |
| Zoom full-frame không blur-fill SS ×4 (7680×4320, nhánh hiếm) | 2.46s | — |
| Pan-v SS dọc-trục ×4 (scale H×4 → crop → downscale) | 1.34s | ripple 0.55px trên 8.9px/frame (từ ±1px) |
| geq subpixel thuần CPU | 9.23s (×4.8) | LOẠI — output sai (mất fg) + quá chậm |
| libplacebo (subpixel GPU) | — | LOẠI — brew ffmpeg bottle không có libplacebo/Vulkan |

Ước tính cả video 789s (~104 shot): tổng render chậm thêm ~1.5–3 phút. KHÔNG dùng tmix cho pan (motion 9px/frame → ghost 4.5px thấy rõ); chỉ tmix cho zoom (motion <0.5px/frame → ghost vô hình).

**Fix chốt đề xuất:** zoom = SS ×4 + tmix=2; pan = SS ×4 theo trục pan; file ra không đổi.

## Addendum 260719-0012: ĐÃ TRIỂN KHAI FIX

`lib/kenburns.ts`: hằng `SUPERSAMPLE = 4`. Pan-v/pan-h: scale ×4 theo trục pan (base/travel/crop nhân 4) → downscale về khung. Zoom (cả 2 nhánh): scale ×2→×4 trước zoompan + `tmix=frames=2` sau. Static không đổi. `scripts/verify-script.mts`: cập nhật literal đóng đinh + assertion pan-v.

Nghiệm thu (render lại case tổng hợp qua module đã sửa, đo phase correlation):
- Zoom: giật 0.88px → **0.14px max** (std 0.02–0.04) — ngang preview.
- Pan-v: xen kẽ ±1px → đều 8.9px/frame, ripple ≤0.55px.
- Frame trích xuất sắc nét, không mềm do resample/tmix.
- Gates: 277 unit ✓ (verify-script literal mới), verify-kenburns-css PASS, verify-render RENDER_ALL_PASS (e2e 9:16 + 16:9 qua renderShot thật), eslint sạch.
- Video cũ muốn hết shake phải re-render từ bundle (`npm run render -- bundle.zip --aspect 16:9`).

## Unresolved
- Biên độ snap đo được ~0.9px hơi lớn hơn lý thuyết 0.5px cho ×2 SS — nhiều khả năng do cộng dồn làm tròn cả `x/y` lẫn `iw/zoom` (kích thước crop) trong zoompan; không ảnh hưởng kết luận (quan hệ tuyến tính với SS đã đo được).
- Chưa xác nhận band dims thật của bundle (không còn trên đĩa) — nhưng chữ ký đo video thật khớp 1:1 với tái tạo zoom+blur-fill.
