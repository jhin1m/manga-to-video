import sharp, { type OverlayOptions } from 'sharp';

// Gộp các slice dải dọc (webtoon/manhua/PDF cắt dải) thành MỘT canvas dọc — "working image"
// cho smart-split + crop band. Manga trang rời KHÔNG đi qua đây (giữ trang).

export interface StitchedCanvas {
  buffer: Buffer; // PNG — canvas rất cao, JPEG giới hạn ~65k px và nén chữ kém hơn
  width: number;
  height: number;
}

export async function stitchSlices(slices: Buffer[]): Promise<StitchedCanvas> {
  if (slices.length === 0) throw new Error('Không có slice nào để ghép');
  const metas = await Promise.all(
    slices.map(async (buf, i) => {
      const m = await sharp(buf, { limitInputPixels: false }).metadata();
      if (!m.width || !m.height) throw new Error(`Không đọc được kích thước slice thứ ${i + 1}`);
      return { width: m.width, height: m.height };
    }),
  );
  const width = Math.max(...metas.map((m) => m.width));
  const height = metas.reduce((sum, m) => sum + m.height, 0);

  // Slice hẹp hơn canvas được căn giữa trên nền trắng (mẫu SmartStitch).
  let top = 0;
  const composites: OverlayOptions[] = slices.map((buf, i) => {
    const overlay: OverlayOptions = {
      input: buf,
      left: Math.floor((width - metas[i].width) / 2),
      top,
    };
    top += metas[i].height;
    return overlay;
  });

  const buffer = await sharp({
    create: {
      width,
      height,
      channels: 3,
      background: { r: 255, g: 255, b: 255 },
    },
    limitInputPixels: false,
  })
    .composite(composites)
    .png()
    .toBuffer();

  return { buffer, width, height };
}
