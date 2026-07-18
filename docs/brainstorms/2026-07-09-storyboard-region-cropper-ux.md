# Brainstorm — Nâng cấp RegionCropper trong Storyboard (trị "mơ hồ + sơ sài")

- **Ngày:** 2026-07-09
- **Trạng thái:** Đã chốt hướng — chờ lập plan
- **Flags:** (none)
- **Touchpoint chính:** `content-extractor/components/region-cropper.tsx`

## 1. Bối cảnh & than phiền gốc

Người dùng thấy chức năng chọn vùng trong Storyboard ("Kéo trên ảnh để chọn vùng · kéo trong khung
để di chuyển") **mơ hồ và sơ sài, khó dùng**. Ban đầu đề xuất thay nó bằng "Edit ảnh cắt phần thừa".

Sau khi decompress (problem-first), làm rõ: đề xuất "thay bằng crop" là **solution-jumping** — gộp
nhầm 2 việc khác nhau. Region KHÔNG mơ hồ về chức năng; nó là lớp cinematography lõi. Vấn đề thật
nằm ở **UX**.

## 2. Region thực chất là gì (để không bỏ nhầm)

Region = bbox `{x,y,w,h}` phi-huỷ-diệt trên ảnh working (band). Làm 2 việc cùng lúc:
1. **Khung hình:** chỉ phần trong vùng lên video; phần ngoài tự bị loại (nên vô tình đã "cắt thừa").
2. **Chuyển động camera:** `planKenburns` suy pan/zoom từ **hình dạng** vùng — cao→lia dọc,
   ngang→lia ngang, vuông→zoom (`content-extractor/lib/kenburns.ts:49-91`).

→ Bỏ region = mất per-nhịp framing + Ken Burns → video thành slideshow, `kenburns.ts` thành code
chết. **Không thay, không bỏ.**

## 3. Chẩn đoán 2 gốc rễ (chữa khác nhau)

- **"Mơ hồ" = kết quả vô hình.** Kéo hộp nhưng không thấy khung hình cuối / camera lia hay zoom /
  hướng nào. Thao tác mù.
- **"Sơ sài" = hộp không phải công cụ crop thật.** `region-cropper.tsx` chỉ có **vẽ mới** hoặc
  **nhấc cả hộp**; KHÔNG có tay cầm kéo giãn cạnh/góc → muốn sửa phải vẽ lại. Không preset, không
  cursor gợi ý.

## 4. Mỏ vàng tái dùng (DRY)

Trang video preview **đã có** cơ chế chạy Ken Burns bằng CSS transform dựa trên `planKenburns` +
container theo tỉ lệ khung (`content-extractor/app/video/[jobId]/page.tsx:303-335`). Preview động
cho Storyboard **không dựng mới** — rút logic này ra hàm dùng chung.

## 5. Ba framing đã cân nhắc

- **Frame A — Crop nguồn huỷ-diệt:** cắt band 1 lần, áp mọi nhịp. Hợp rác lặp (header/footer/
  watermark). Nặng: phải re-map region cũ, thêm API + lưu ảnh sửa. → Để sau, chỉ khi có bằng chứng
  rác lặp thật.
- **Frame B — Đổi UX region (CHỌN):** region vốn đã loại rác ngoài vùng; làm nó minh bạch + thao
  tác được. Rẻ, KISS, trị đúng "mơ hồ + sơ sài".
- **Frame C — Đơn giản hoá mô hình (1 ảnh = 1 shot tự animate):** bỏ region per-nhịp. Mất năng lực
  nhiều-shot/trang. Đổi sản phẩm nhiều nhất. → Không chọn (user muốn sửa feature, không đổi mô hình).

## 6. Quyết định — Frame B, "Tầng 1 đầy đủ"

Người dùng chốt **Tầng 1 đầy đủ**:

1. **Preview shot sống** — rút logic Ken Burns CSS từ trang video ra hàm chung; chiếu vùng đang
   chọn vào ô preview đúng tỉ lệ khung, **chạy lặp** cú pan/zoom. → trị "mơ hồ".
2. **Tay cầm resize 8 hướng** (4 góc + 4 cạnh) + đổi con trỏ theo mode (vẽ/di chuyển/kéo giãn). →
   trị "sơ sài".
3. **Nhãn chuyển động** — chip tính từ `planKenburns`: "Lia dọc ↓ / Lia ngang → / Zoom ⊙". Minh
   bạch hành vi tự động.

## 7. Ngoài phạm vi (Tầng 2 — YAGNI, để sau)

- Preset khung (Cả trang / Nửa trên / Vừa khít nội dung).
- Tự gợi ý region khi tạo nhịp (bao sát vùng mực — tái dùng ink của `smart-split`).
- Ghi đè chuyển động thủ công (ép pan/zoom + độ mạnh).
- Crop nguồn huỷ-diệt (Frame A).

## 8. Acceptance criteria

- Vẽ / kéo giãn / di chuyển hộp → preview cập nhật và lặp đúng pan/zoom mà `planKenburns` sinh cho
  hình dạng hộp đó.
- Hộp có 8 tay cầm; kéo tay cầm chỉ đổi cạnh/góc tương ứng; kéo trong hộp = di chuyển; kéo chỗ
  trống = vẽ mới. Con trỏ phản ánh mode.
- Chip nhãn khớp mode `planKenburns` trả về.
- Ô số x/y/w/h (Nâng cao) vẫn đồng bộ 2 chiều — giữ đường a11y bàn phím.
- Toạ độ vẫn quy về px ảnh working thật (giữ nguyên `toWorking`); hợp đồng `BeatRegion` và PATCH
  beat KHÔNG đổi.

## 9. Ràng buộc & phụ thuộc

- **Tỉ lệ khung đích** cho preview: Storyboard chưa có (chọn ở bước video). → mặc định 9:16 + nút
  đổi nhanh, hoặc đọc default project. Chốt lúc lập plan.
- Next.js bản tuỳ biến — **đọc `node_modules/next/dist/docs/` trước khi code** (theo AGENTS.md).
- Tái dùng `planKenburns`; **rút logic Ken Burns CSS ở trang video thành module chung**, không nhân
  bản. Cân nhắc export thêm helper nhãn mode.
- shadcn/ui + Tailwind; giữ phi-huỷ-diệt.

## 10. Touchpoints

- `content-extractor/components/region-cropper.tsx` — UI chính (tay cầm + preview + chip).
- `content-extractor/app/video/[jobId]/page.tsx:303-335` — rút logic Ken Burns CSS ra dùng chung.
- Module chung mới (vd `content-extractor/lib/kenburns-css.ts`) — suy CSS transform từ plan.
- `content-extractor/lib/kenburns.ts` — reuse `planKenburns`; có thể thêm helper nhãn mode.
- `content-extractor/app/storyboard/[jobId]/page.tsx` — truyền tỉ lệ khung / wire preview.

## 11. Rủi ro

- Preview CSS chỉ **xấp xỉ** (như trang video đã ghi chú) — không khớp 100% bản render CLI. Chấp
  nhận: mục tiêu là duyệt bố cục, không phải bản chuẩn.
- Tay cầm resize + map toạ độ khi ảnh co giãn responsive: chuẩn nhưng cần test kỹ ở strip cao.
- Đồng bộ 3 chiều (hộp ↔ ô số ↔ preview) dễ lệch nếu không dùng chung một nguồn state `region`.

## 12. Bước tiếp theo

Lập plan (`/ck:plan`) từ report này. Không có test coverage nặng cho region-cropper hiện tại → bản
mặc định phù hợp; cân nhắc `--tdd` nếu muốn khoá hành vi map toạ độ trước khi thêm tay cầm.
