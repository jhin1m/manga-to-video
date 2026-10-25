import AdmZip from 'adm-zip';
import { isOutputLanguage } from './output-language';
import type { RenderConfig, ScriptManifest } from './schema';
import { RENDER_CONFIG_VERSION, SCRIPT_VERSION } from './schema';
import { migrateSubtitleStyle } from './subtitle-style';

// Bundle zip = hand-off self-contained giữa Preview UI và CLI render:
//   manifest.json         — ScriptManifest (kịch bản đã duyệt)
//   render-config.json    — RenderConfig (tham số render)
//   band-<sourceIndex>.jpg — ảnh band mà shots tham chiếu
//   audio/seg-<id>.mp3    — (tuỳ chọn) TTS đã synth ở preview
//   bgm/<file>            — (tuỳ chọn) nhạc nền người dùng upload
// Gỡ dứt điểm Known Limitation "import phụ thuộc ENV": CLI chỉ cần file zip này.

export interface BundleData {
  scriptManifest: ScriptManifest;
  config: RenderConfig;
  images: Map<number, Buffer>; // sourceIndex → JPEG band
  audio?: Map<string, Buffer>; // segId → mp3
  bgm?: { filename: string; data: Buffer };
}

export function writeBundle(data: BundleData): Buffer {
  const zip = new AdmZip();
  zip.addFile('manifest.json', Buffer.from(JSON.stringify(data.scriptManifest, null, 2)));
  // bgm.path trong config trỏ đường dẫn TRONG zip để CLI tự tìm.
  const config: RenderConfig = data.bgm
    ? { ...data.config, bgm: { ...data.config.bgm, path: `bgm/${data.bgm.filename}` } }
    : data.config;
  zip.addFile('render-config.json', Buffer.from(JSON.stringify(config, null, 2)));
  for (const [sourceIndex, buffer] of data.images) {
    zip.addFile(`band-${sourceIndex}.jpg`, buffer);
  }
  if (data.audio) {
    for (const [segId, buffer] of data.audio) {
      zip.addFile(`audio/seg-${segId}.mp3`, buffer);
    }
  }
  if (data.bgm) {
    zip.addFile(`bgm/${data.bgm.filename}`, data.bgm.data);
  }
  return zip.toBuffer();
}

// Dùng chung với lib/project.ts (file .mtvproj cùng khuôn zip + JSON entry).
export function parseEntryJson<T>(zip: AdmZip, name: string, label = 'Bundle'): T {
  const entry = zip.getEntry(name);
  if (!entry) throw new Error(`${label} thiếu ${name}`);
  try {
    return JSON.parse(entry.getData().toString('utf8')) as T;
  } catch {
    throw new Error(`${label}: ${name} không phải JSON hợp lệ`);
  }
}

// Bundle là artifact CÓ THỂ chia sẻ giữa máy/người — mọi giá trị đi vào đường dẫn file
// phía CLI (jobId, seg.id, tên file bgm) phải bị chặn ở biên đọc: từ chối là an toàn hơn
// tự sửa (tránh jobId kiểu ../../x đổi hướng ghi/xoá đệ quy ra ngoài thư mục làm việc).
const SAFE_NAME = /^[\w.-]+$/;

// Dùng chung với lib/project.ts — mọi giá trị đi vào đường dẫn file đều phải qua đây.
export function assertSafeName(value: string, label: string): void {
  if (!SAFE_NAME.test(value) || value === '.' || value === '..') {
    throw new Error(`${label} chứa ký tự không hợp lệ cho đường dẫn (${value})`);
  }
}

// Mở bundle + validate: version khớp, mọi shot đều có ảnh band tương ứng.
export function readBundle(zipBuffer: Buffer): BundleData {
  const zip = new AdmZip(zipBuffer);
  const scriptManifest = parseEntryJson<ScriptManifest>(zip, 'manifest.json');
  const config = parseEntryJson<RenderConfig>(zip, 'render-config.json');
  if (scriptManifest.version !== SCRIPT_VERSION) {
    throw new Error(
      `Bundle: manifest version ${scriptManifest.version} không khớp SCRIPT_VERSION ${SCRIPT_VERSION}`,
    );
  }
  // Bundle CŨ hơn vẫn render được: chỉ phần style phụ đề đổi giữa các version, migrate là đủ.
  // Bundle MỚI hơn code thì từ chối — không đoán được field tương lai.
  if (config.version > RENDER_CONFIG_VERSION) {
    throw new Error(
      `Bundle: render-config version ${config.version} mới hơn RENDER_CONFIG_VERSION ${RENDER_CONFIG_VERSION} — cập nhật app rồi render lại`,
    );
  }
  if (config.version < RENDER_CONFIG_VERSION) {
    config.subtitles = migrateSubtitleStyle(config.subtitles);
    config.version = RENDER_CONFIG_VERSION;
  }
  // Bundle chia sẻ được giữa máy — ngôn ngữ lạ là bundle hỏng, không đoán thành 'vi' (sẽ đọc
  // lời kể tiếng khác bằng giọng Việt).
  if (scriptManifest.outputLanguage !== undefined && !isOutputLanguage(scriptManifest.outputLanguage)) {
    throw new Error(`Bundle: outputLanguage không hợp lệ (${String(scriptManifest.outputLanguage)})`);
  }
  assertSafeName(scriptManifest.jobId, 'jobId');
  for (const seg of scriptManifest.segments) {
    assertSafeName(seg.id, `segment id (đoạn ${seg.order + 1})`);
  }

  const images = new Map<number, Buffer>();
  const audio = new Map<string, Buffer>();
  let bgm: BundleData['bgm'];
  for (const entry of zip.getEntries()) {
    if (entry.isDirectory) continue;
    const bandMatch = entry.entryName.match(/^band-(\d+)\.jpg$/);
    if (bandMatch) {
      images.set(Number.parseInt(bandMatch[1], 10), entry.getData());
      continue;
    }
    const audioMatch = entry.entryName.match(/^audio\/seg-([\w.-]+)\.mp3$/);
    if (audioMatch) {
      audio.set(audioMatch[1], entry.getData());
      continue;
    }
    if (entry.entryName.startsWith('bgm/')) {
      const filename = entry.entryName.slice('bgm/'.length);
      assertSafeName(filename, 'tên file bgm');
      bgm = { filename, data: entry.getData() };
    }
  }

  for (const seg of scriptManifest.segments) {
    for (const shot of seg.shots) {
      if (!images.has(shot.sourceIndex)) {
        throw new Error(
          `Bundle: đoạn ${seg.order + 1} trỏ band ${shot.sourceIndex} nhưng thiếu band-${shot.sourceIndex}.jpg`,
        );
      }
    }
  }

  return {
    scriptManifest,
    config,
    images,
    ...(audio.size > 0 ? { audio } : {}),
    ...(bgm ? { bgm } : {}),
  };
}
