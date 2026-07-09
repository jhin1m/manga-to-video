// Verify file project .mtvproj (unit, không server):
//   writeProject/readProject round-trip (strip + pages, có/không script, có/không audio)
//   validate: version lệch, thiếu ảnh working, path traversal (jobId/segId/audio key),
//   index band không liền mạch, region vượt biên
//   bất biến "không re-ingest": đổi env MAX_EDGE không ảnh hưởng toạ độ region đọc lại
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import AdmZip from 'adm-zip';
import { readProject, writeProject, type ProjectData } from '../lib/project';
import type { Beat, ProjectFile, ScriptSegment } from '../lib/schema';
import {
  MANIFEST_VERSION,
  PROJECT_VERSION,
  SCRIPT_VERSION,
  STORYBOARD_VERSION,
  toManifest,
  toScriptManifest,
  toStoryboardManifest,
} from '../lib/schema';

let failures = 0;
const eq = (a: unknown, e: unknown, label: string) => {
  if (JSON.stringify(a) === JSON.stringify(e)) console.log(`  ✓ ${label}`);
  else {
    failures++;
    console.error(`  ✗ ${label}\n    expected: ${JSON.stringify(e)}\n    actual:   ${JSON.stringify(a)}`);
  }
};
const ok = (c: boolean, label: string) => eq(c, true, label);
const throws = (fn: () => unknown, needle: string, label: string) => {
  try {
    fn();
    failures++;
    console.error(`  ✗ ${label} — không ném lỗi`);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    ok(msg.includes(needle), `${label} (${msg.slice(0, 80)})`);
  }
};

const jpeg = (marker: number) => Buffer.from([0xff, 0xd8, 0xff, marker]); // bytes giả — lib không decode ảnh

function beat(init: Partial<Beat> & { id: string; order: number; sourceIndex: number }): Beat {
  return { region: null, narration: 'Lời đọc.', ...init } as Beat;
}

function seg(init: Partial<ScriptSegment> & { id: string; order: number }): ScriptSegment {
  return {
    narration: 'Đoạn kể.',
    shots: [{ sourceIndex: 0, region: null, weight: 1 }],
    ...init,
  } as ScriptSegment;
}

// Fixture pages: 2 band 600×900, beat 1 có region, script 1 đoạn + audio.
function pagesFixture(): ProjectData {
  const createdAt = '2026-07-08T00:00:00.000Z';
  const jobId = 'job-pages';
  const beats = [
    beat({ id: 'b0', order: 0, sourceIndex: 0, region: { x: 10, y: 20, w: 300, h: 400 } }),
    beat({ id: 'b1', order: 1, sourceIndex: 1 }),
  ];
  const segments = [seg({ id: 'seg-a', order: 0 })];
  const items = [
    { index: 0, filename: 'band-1.jpg', content: { description: 'Cảnh 1', dialogue: ['Hi'], note: '' }, },
    { index: 1, filename: 'band-2.jpg', content: null, error: 'vision lỗi' },
  ];
  const project: ProjectFile = {
    version: PROJECT_VERSION,
    jobId,
    createdAt,
    sourceKind: 'pages',
    working: [
      { sourceIndex: 0, width: 600, height: 900 },
      { sourceIndex: 1, width: 600, height: 900 },
    ],
    items: [
      { index: 0, mime: 'image/jpeg', width: 600, height: 900 },
      { index: 1, mime: 'image/jpeg', width: 600, height: 900 },
    ],
    scriptConfirmed: true,
    audio: { 'seg-a': { key: 'cafe0123', durationSec: 3.2, text: 'Đoạn kể.' } },
  };
  return {
    project,
    manifest: toManifest({ id: jobId, createdAt, items }),
    storyboard: toStoryboardManifest({ jobId, createdAt, sourceKind: 'pages', beats }),
    script: toScriptManifest({ jobId, createdAt, segments }),
    working: new Map([
      [0, jpeg(0x01)],
      [1, jpeg(0x02)],
    ]),
    items: new Map([
      [0, jpeg(0x01)],
      [1, jpeg(0x02)],
    ]),
    audio: new Map([['seg-a', Buffer.from('mp3-bytes')]]),
  };
}

console.log('Test 1: round-trip pages (script + confirmed + audio)');
{
  const data = pagesFixture();
  const zip = writeProject(data);
  const back = readProject(zip);
  eq(back.project.version, PROJECT_VERSION, 'project version');
  eq(back.project.sourceKind, 'pages', 'sourceKind');
  eq(back.project.scriptConfirmed, true, 'cờ confirmed sống qua round-trip');
  eq(back.storyboard.beats, data.storyboard.beats, 'beats khớp nguyên vẹn (id/region/narration)');
  eq(back.script?.segments, data.script?.segments, 'script segments khớp');
  eq(back.project.audio, data.project.audio, 'audio meta (key/durationSec/text) khớp');
  ok(back.audio?.get('seg-a')?.equals(Buffer.from('mp3-bytes')) === true, 'bytes mp3 khớp');
  ok(back.working.get(1)?.equals(jpeg(0x02)) === true, 'bytes working khớp');
  ok(back.items.get(0)?.equals(jpeg(0x01)) === true, 'bytes band khớp');
  eq(back.manifest.items.map((m) => [m.index, m.filename]), [[0, 'band-1.jpg'], [1, 'band-2.jpg']], 'manifest Stage 1 song song index');
}

console.log('Test 2: round-trip strip (không script/audio) + bất biến không-re-ingest');
{
  const createdAt = '2026-07-08T00:00:00.000Z';
  const beats = [
    beat({ id: 's0', order: 0, sourceIndex: 0, region: { x: 0, y: 0, w: 800, h: 500 } }),
    beat({ id: 's1', order: 1, sourceIndex: 0, region: { x: 0, y: 1900, w: 800, h: 500 } }),
  ];
  const data: ProjectData = {
    project: {
      version: PROJECT_VERSION,
      jobId: 'job-strip',
      createdAt,
      sourceKind: 'strip',
      working: [{ sourceIndex: 0, width: 800, height: 2400 }],
      items: [
        { index: 0, mime: 'image/jpeg', width: 800, height: 1200 },
        { index: 1, mime: 'image/jpeg', width: 800, height: 1200 },
      ],
    },
    manifest: toManifest({
      id: 'job-strip',
      createdAt,
      items: [
        { index: 0, filename: 'band-1.jpg', content: null },
        { index: 1, filename: 'band-2.jpg', content: null },
      ],
    }),
    storyboard: toStoryboardManifest({ jobId: 'job-strip', createdAt, sourceKind: 'strip', beats }),
    working: new Map([[0, jpeg(0x10)]]),
    items: new Map([
      [0, jpeg(0x11)],
      [1, jpeg(0x12)],
    ]),
  };
  const zip = writeProject(data);

  // Đổi env ingest — nếu read/import có re-ingest thì toạ độ sẽ lệch; ở đây phải giữ nguyên.
  const prevMaxEdge = process.env.MAX_EDGE;
  process.env.MAX_EDGE = '512';
  const back = readProject(zip);
  process.env.MAX_EDGE = prevMaxEdge;

  eq(
    back.storyboard.beats.map((b) => b.region),
    beats.map((b) => b.region),
    'đổi MAX_EDGE không ảnh hưởng region (không re-ingest)',
  );
  eq(back.script, undefined, 'không script.json → script undefined');
  eq(back.audio, undefined, 'không audio → undefined');
  eq(back.project.working[0], { sourceIndex: 0, width: 800, height: 2400 }, 'meta canvas strip giữ nguyên');
}

console.log('Test 3: validate từ chối input hỏng');
{
  const base = pagesFixture();

  const vBad = pagesFixture();
  vBad.project = { ...vBad.project, version: 99 };
  throws(() => readProject(writeProject(vBad)), 'PROJECT_VERSION', 'version lệch → từ chối');

  const noWorking = pagesFixture();
  noWorking.working.delete(1);
  throws(() => readProject(writeProject(noWorking)), 'working/1.jpg', 'thiếu ảnh working khai báo → từ chối');

  const oob = pagesFixture();
  oob.storyboard = {
    ...oob.storyboard,
    beats: oob.storyboard.beats.map((b, i) =>
      i === 0 ? { ...b, region: { x: 0, y: 700, w: 600, h: 400 } } : b,
    ),
  };
  throws(() => readProject(writeProject(oob)), 'vượt biên', 'region vượt biên → từ chối');

  const traversalJob = pagesFixture();
  traversalJob.project = { ...traversalJob.project, jobId: '../../etc' };
  throws(() => readProject(writeProject(traversalJob)), 'jobId', 'jobId path-traversal → từ chối');

  const traversalKey = pagesFixture();
  traversalKey.project = {
    ...traversalKey.project,
    audio: { 'seg-a': { key: '../evil', durationSec: 1, text: 'x' } },
  };
  throws(() => readProject(writeProject(traversalKey)), 'audio key', 'audio key path-traversal → từ chối');

  const gap = pagesFixture();
  gap.project = {
    ...gap.project,
    items: [
      { index: 0, mime: 'image/jpeg', width: 600, height: 900 },
      { index: 2, mime: 'image/jpeg', width: 600, height: 900 },
    ],
  };
  gap.items = new Map([
    [0, jpeg(0x01)],
    [2, jpeg(0x03)],
  ]);
  throws(() => readProject(writeProject(gap)), 'liền mạch', 'index band có lỗ hổng → từ chối');

  const shotOob = pagesFixture();
  shotOob.script = {
    ...shotOob.script!,
    segments: shotOob.script!.segments.map((s) => ({
      ...s,
      shots: [{ sourceIndex: 9, region: null, weight: 1 }],
    })),
  };
  throws(() => readProject(writeProject(shotOob)), 'trỏ working 9', 'shot trỏ working thiếu → từ chối');

  const shotRegionOob = pagesFixture();
  shotRegionOob.script = {
    ...shotRegionOob.script!,
    segments: shotRegionOob.script!.segments.map((s) => ({
      ...s,
      shots: [{ sourceIndex: 0, region: { x: 0, y: 700, w: 600, h: 400 }, weight: 1 }],
    })),
  };
  throws(() => readProject(writeProject(shotRegionOob)), 'region shot', 'shot.region vượt biên → từ chối');

  const badDims = pagesFixture();
  badDims.project = {
    ...badDims.project,
    working: badDims.project.working.map((w, i) => (i === 0 ? { ...w, height: 0 } : w)),
  };
  throws(() => readProject(writeProject(badDims)), 'kích thước working', 'working meta 0px → từ chối');

  // Sanity: fixture gốc vẫn đọc được (các case hỏng không phải do fixture sai sẵn)
  ok(readProject(writeProject(base)).storyboard.beats.length === 2, 'fixture gốc hợp lệ');
}

console.log('Test 4: entry lạ trong zip bị bỏ qua (không nổ, không lộ path)');
{
  const zip = new AdmZip(writeProject(pagesFixture()));
  zip.addFile('../../evil.txt', Buffer.from('x'));
  zip.addFile('extra/notes.md', Buffer.from('y'));
  const back = readProject(zip.toBuffer());
  eq(back.working.size, 2, 'working chỉ nhận entry đúng khuôn working/<n>.jpg');
  eq(back.items.size, 2, 'items chỉ nhận entry đúng khuôn items/band-<n>.jpg');
}

console.log('Test 5: version hằng số khớp hợp đồng schema');
{
  eq(PROJECT_VERSION, 1, 'PROJECT_VERSION 1');
  ok(
    MANIFEST_VERSION === 1 && STORYBOARD_VERSION === 1 && SCRIPT_VERSION === 1,
    'các version thành phần đúng như project.json tham chiếu',
  );
}

// Dọn tmp nếu có (giữ khuôn verify-*; hiện không ghi đĩa nhưng để sẵn cho case sau)
{
  const dir = await mkdtemp(path.join(os.tmpdir(), 'verify-project-'));
  await writeFile(path.join(dir, 'touch'), '');
  await rm(dir, { recursive: true, force: true });
}

console.log(failures === 0 ? '\nVERIFY_PROJECT_ALL_PASS' : `\nVERIFY_PROJECT_FAILURES: ${failures}`);
process.exit(failures === 0 ? 0 : 1);
