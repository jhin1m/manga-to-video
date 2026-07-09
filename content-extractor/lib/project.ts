import AdmZip from 'adm-zip';
import { assertSafeName, parseEntryJson } from './bundle';
import type {
  Manifest,
  ProjectFile,
  ScriptManifest,
  StoryboardManifest,
} from './schema';
import {
  MANIFEST_VERSION,
  PROJECT_VERSION,
  SCRIPT_VERSION,
  STORYBOARD_VERSION,
} from './schema';

// File project .mtvproj = zip tự chứa toàn bộ phiên làm việc (data + ảnh + audio).
// Khác bundle.zip (hand-off CLI render, chỉ script + band): project rehydrate được cả
// Job Stage 1 lẫn Storyboard/Script/Audio mà KHÔNG re-ingest — ảnh working embed thẳng
// nên không phụ thuộc MAX_EDGE/SPLIT_HEIGHT, toạ độ region khớp tuyệt đối.
//
//   project.json               — ProjectFile (version, meta ảnh, audio meta, cờ confirmed)
//   manifest.json              — Manifest Stage 1 (filename/content/error từng band)
//   storyboard.json            — StoryboardManifest (beats)
//   script.json                — (tuỳ) ScriptManifest
//   working/<sourceIndex>.jpg  — ảnh working storyboard (strip = canvas, pages = band)
//   items/band-<index>.jpg     — ảnh band Job Stage 1 (pages: trùng working, chấp nhận)
//   audio/seg-<segId>.mp3      — (tuỳ) audio TTS đã synth

export interface ProjectData {
  project: ProjectFile;
  manifest: Manifest;
  storyboard: StoryboardManifest;
  script?: ScriptManifest;
  working: Map<number, Buffer>; // sourceIndex → JPEG working
  items: Map<number, Buffer>; // index → JPEG band Stage 1
  audio?: Map<string, Buffer>; // segId → mp3 (meta ở project.audio)
}

export function writeProject(data: ProjectData): Buffer {
  const zip = new AdmZip();
  zip.addFile('project.json', Buffer.from(JSON.stringify(data.project, null, 2)));
  zip.addFile('manifest.json', Buffer.from(JSON.stringify(data.manifest, null, 2)));
  zip.addFile('storyboard.json', Buffer.from(JSON.stringify(data.storyboard, null, 2)));
  if (data.script) {
    zip.addFile('script.json', Buffer.from(JSON.stringify(data.script, null, 2)));
  }
  for (const [sourceIndex, buffer] of data.working) {
    zip.addFile(`working/${sourceIndex}.jpg`, buffer);
  }
  for (const [index, buffer] of data.items) {
    zip.addFile(`items/band-${index}.jpg`, buffer);
  }
  if (data.audio) {
    for (const [segId, buffer] of data.audio) {
      zip.addFile(`audio/seg-${segId}.mp3`, buffer);
    }
  }
  return zip.toBuffer();
}

// Mở project + validate đủ TRƯỚC khi caller đụng store: version khớp, tên an toàn cho
// đường dẫn, mọi beat/shot có ảnh working tương ứng và region nằm trong biên (mẫu readBundle).
export function readProject(zipBuffer: Buffer): ProjectData {
  const zip = new AdmZip(zipBuffer);
  const project = parseEntryJson<ProjectFile>(zip, 'project.json', 'Project');
  if (project.version !== PROJECT_VERSION) {
    throw new Error(
      `Project: version ${project.version} không khớp PROJECT_VERSION ${PROJECT_VERSION}`,
    );
  }
  if (project.sourceKind !== 'pages' && project.sourceKind !== 'strip') {
    throw new Error("Project: sourceKind phải là 'pages' hoặc 'strip'");
  }
  assertSafeName(project.jobId, 'Project: jobId');

  const manifest = parseEntryJson<Manifest>(zip, 'manifest.json', 'Project');
  if (manifest.version !== MANIFEST_VERSION) {
    throw new Error(
      `Project: manifest version ${manifest.version} không khớp MANIFEST_VERSION ${MANIFEST_VERSION}`,
    );
  }
  const storyboard = parseEntryJson<StoryboardManifest>(zip, 'storyboard.json', 'Project');
  if (storyboard.version !== STORYBOARD_VERSION) {
    throw new Error(
      `Project: storyboard version ${storyboard.version} không khớp STORYBOARD_VERSION ${STORYBOARD_VERSION}`,
    );
  }
  let script: ScriptManifest | undefined;
  if (zip.getEntry('script.json')) {
    script = parseEntryJson<ScriptManifest>(zip, 'script.json', 'Project');
    if (script.version !== SCRIPT_VERSION) {
      throw new Error(
        `Project: script version ${script.version} không khớp SCRIPT_VERSION ${SCRIPT_VERSION}`,
      );
    }
    for (const seg of script.segments) {
      assertSafeName(seg.id, `Project: segment id (đoạn ${seg.order + 1})`);
    }
  }

  const working = new Map<number, Buffer>();
  const items = new Map<number, Buffer>();
  const audio = new Map<string, Buffer>();
  for (const entry of zip.getEntries()) {
    if (entry.isDirectory) continue;
    const workingMatch = entry.entryName.match(/^working\/(\d+)\.jpg$/);
    if (workingMatch) {
      working.set(Number.parseInt(workingMatch[1], 10), entry.getData());
      continue;
    }
    const itemMatch = entry.entryName.match(/^items\/band-(\d+)\.jpg$/);
    if (itemMatch) {
      items.set(Number.parseInt(itemMatch[1], 10), entry.getData());
      continue;
    }
    const audioMatch = entry.entryName.match(/^audio\/seg-([\w.-]+)\.mp3$/);
    if (audioMatch) {
      audio.set(audioMatch[1], entry.getData());
    }
  }

  // Meta working phải có bytes tương ứng + kích thước dương (biên cho mọi check region);
  // beat/shot trỏ sourceIndex nào là phải có ảnh đó.
  const workingDims = new Map(project.working.map((w) => [w.sourceIndex, w]));
  for (const w of project.working) {
    if (!Number.isFinite(w.width) || !Number.isFinite(w.height) || w.width < 1 || w.height < 1) {
      throw new Error(`Project: kích thước working ${w.sourceIndex} không hợp lệ`);
    }
    if (!working.has(w.sourceIndex)) {
      throw new Error(`Project: thiếu working/${w.sourceIndex}.jpg khai báo trong project.json`);
    }
  }
  for (const beat of storyboard.beats) {
    const dims = workingDims.get(beat.sourceIndex);
    if (!dims || !working.has(beat.sourceIndex)) {
      throw new Error(
        `Project: nhịp #${beat.order + 1} trỏ working ${beat.sourceIndex} nhưng thiếu ảnh/meta tương ứng`,
      );
    }
    const r = beat.region;
    if (r && (r.x < 0 || r.y < 0 || r.w < 1 || r.h < 1 || r.x + r.w > dims.width || r.y + r.h > dims.height)) {
      throw new Error(
        `Project: region nhịp #${beat.order + 1} vượt biên ảnh working ${beat.sourceIndex} (${dims.width}×${dims.height})`,
      );
    }
  }
  if (script) {
    for (const seg of script.segments) {
      for (const shot of seg.shots) {
        const dims = workingDims.get(shot.sourceIndex);
        if (!dims || !working.has(shot.sourceIndex)) {
          throw new Error(
            `Project: đoạn ${seg.order + 1} trỏ working ${shot.sourceIndex} nhưng thiếu ảnh/meta tương ứng`,
          );
        }
        const r = shot.region;
        if (
          r &&
          (r.x < 0 || r.y < 0 || r.w < 1 || r.h < 1 || r.x + r.w > dims.width || r.y + r.h > dims.height)
        ) {
          throw new Error(
            `Project: region shot của đoạn ${seg.order + 1} vượt biên ảnh working ${shot.sourceIndex} (${dims.width}×${dims.height})`,
          );
        }
      }
    }
  }

  // Band Stage 1: meta ↔ bytes ↔ manifest song song theo index. Index phải liền mạch
  // 0..n-1 vì import dựng lại Job theo vị trí mảng (createJob tự đánh index).
  const sortedIndexes = project.items.map((it) => it.index).sort((a, b) => a - b);
  if (sortedIndexes.some((idx, i) => idx !== i)) {
    throw new Error('Project: index band Stage 1 phải liền mạch 0..n-1');
  }
  for (const it of project.items) {
    if (!items.has(it.index)) {
      throw new Error(`Project: thiếu items/band-${it.index}.jpg khai báo trong project.json`);
    }
    if (!manifest.items.some((m) => m.index === it.index)) {
      throw new Error(`Project: manifest.json thiếu item index ${it.index}`);
    }
  }

  // Audio: meta ↔ bytes khớp, key/segId an toàn cho đường dẫn cache.
  if (project.audio) {
    for (const [segId, meta] of Object.entries(project.audio)) {
      assertSafeName(segId, 'Project: audio segId');
      assertSafeName(meta.key, `Project: audio key (seg ${segId})`);
      if (!Number.isFinite(meta.durationSec) || meta.durationSec < 0) {
        throw new Error(`Project: durationSec audio seg ${segId} không hợp lệ`);
      }
      if (typeof meta.text !== 'string') {
        throw new Error(`Project: audio seg ${segId} thiếu text gốc lúc synth`);
      }
      if (!audio.has(segId)) {
        throw new Error(`Project: thiếu audio/seg-${segId}.mp3 khai báo trong project.json`);
      }
    }
  }

  return {
    project,
    manifest,
    storyboard,
    ...(script ? { script } : {}),
    working,
    items,
    ...(audio.size > 0 ? { audio } : {}),
  };
}
