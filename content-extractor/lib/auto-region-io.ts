import sharp from 'sharp';
import type { BeatRegion, ScriptSegment } from './schema';
import { autoRegionWithin, type AutoRegionSettings } from './auto-region';
import type { RawImage } from './ink-bbox';

/** Buffer JPEG/PNG → RawImage RGBA cho autoRegion (server-side). */
export async function rawImageFromBuffer(buffer: Buffer): Promise<RawImage> {
  const { data, info } = await sharp(buffer, { limitInputPixels: false })
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  return {
    data: new Uint8ClampedArray(data.buffer, data.byteOffset, data.byteLength),
    width: info.width ?? 0,
    height: info.height ?? 0,
    channels: 4,
  };
}

export async function autoRegionFromBuffer(
  buffer: Buffer,
  base: BeatRegion | null = null,
  settings?: Partial<AutoRegionSettings>,
): Promise<BeatRegion | null> {
  const img = await rawImageFromBuffer(buffer);
  if (img.width < 8 || img.height < 8) return null;
  return autoRegionWithin(img, base, settings);
}

/**
 * Gán region né bubble cho mọi shot (trong base region nếu đã có từ shot-split / beat).
 * images: sourceIndex → buffer band.
 */
export async function applyAutoRegionsToSegments(
  segments: ScriptSegment[],
  images: Map<number, Buffer>,
  settings?: Partial<AutoRegionSettings>,
): Promise<ScriptSegment[]> {
  const cache = new Map<number, RawImage>();
  const out: ScriptSegment[] = [];
  for (const seg of segments) {
    const shots = [];
    for (const shot of seg.shots) {
      let img = cache.get(shot.sourceIndex);
      if (!img) {
        const buf = images.get(shot.sourceIndex);
        if (!buf) {
          shots.push(shot);
          continue;
        }
        img = await rawImageFromBuffer(buf);
        cache.set(shot.sourceIndex, img);
      }
      const region = autoRegionWithin(img, shot.region ?? null, settings);
      shots.push({
        ...shot,
        region: region ? { ...region } : shot.region ? { ...shot.region } : null,
      });
    }
    out.push({ ...seg, shots });
  }
  return out;
}
