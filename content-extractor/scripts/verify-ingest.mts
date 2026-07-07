// Verify ingest downscale: ảnh dải dọc (ratio ≥ STRIP_RATIO) chỉ kẹp bề rộng,
// giữ nguyên chiều cao (không nghiền chữ trước khi stitch/cắt band);
// ảnh thường vẫn fit-inside MAX_EDGE như Stage 1.
// Verify xoá ảnh: deleteItem (job/upload) + deleteBeat (storyboard) — hard-delete +
// re-index/re-order, no-op khi id không tồn tại (mẫu recomputeDone nội bộ store).
import sharp from 'sharp';
import { downscale } from '../lib/pipeline';
import { createJob, deleteItem, setItemError, setItemResult } from '../lib/jobs';
import { createStoryboard, deleteBeat, type StoredBeat } from '../lib/storyboard-store';
import { emptyContent } from '../lib/schema';

let failures = 0;
const eq = (a: unknown, e: unknown, label: string) => {
  if (JSON.stringify(a) === JSON.stringify(e)) console.log(`  ✓ ${label}`);
  else {
    failures++;
    console.error(`  ✗ ${label}\n    expected: ${JSON.stringify(e)}\n    actual:   ${JSON.stringify(a)}`);
  }
};

const png = (w: number, h: number) =>
  sharp({ create: { width: w, height: h, channels: 3, background: { r: 240, g: 240, b: 240 } } })
    .png()
    .toBuffer();
const dims = async (buf: Buffer) => {
  const m = await sharp(buf, { limitInputPixels: false }).metadata();
  return { w: m.width, h: m.height };
};

console.log('Ingest downscale theo loại ảnh (MAX_EDGE=1568, STRIP_RATIO mặc định 2.5)');
// Slice webtoon cao: giữ nguyên (width 800 ≤ 1568, height không bị ép)
eq(await dims(await downscale(await png(800, 6000), 1568)), { w: 800, h: 6000 }, 'slice 800×6000 giữ nguyên chiều cao');
// Slice cao rộng hơn ngưỡng: kẹp width về 1568, height theo tỉ lệ
eq(await dims(await downscale(await png(2000, 12000), 1568)), { w: 1568, h: 9408 }, 'slice 2000×12000 → kẹp width 1568');
// Trang manga thường: fit-inside như Stage 1
eq(await dims(await downscale(await png(3000, 2000), 1568)), { w: 1568, h: 1045 }, 'ảnh ngang fit-inside');
eq(await dims(await downscale(await png(600, 900), 1568)), { w: 600, h: 900 }, 'ảnh nhỏ không phóng to');
// Sát ngưỡng ratio 2.5: 800×2000 (2.5 đúng ngưỡng → tall), 800×1999 (dưới ngưỡng → fit-inside)
eq(await dims(await downscale(await png(800, 2000), 1568)), { w: 800, h: 2000 }, 'ratio = 2.5 → nhánh dải dọc');
eq(await dims(await downscale(await png(800, 1999), 1568)), { w: 628, h: 1568 }, 'ratio < 2.5 → fit-inside');

console.log('\nXoá band (deleteItem): re-index, progress theo recomputeDone, no-op ngoài biên');
{
  const fakeItem = (n: number) => ({
    filename: `band-${n}.jpg`,
    buffer: Buffer.from('x'),
    mime: 'image/jpeg',
    width: 10,
    height: 10,
  });
  const job = createJob([fakeItem(1), fakeItem(2), fakeItem(3)]);
  setItemResult(job.id, 0, emptyContent()); // item0 done
  setItemError(job.id, 2, 'lỗi mock'); // item2 error
  // item1 vẫn pending — xoá đúng item này (giữa)
  const afterDelete = deleteItem(job.id, 1);
  eq(afterDelete?.items.length, 2, 'xoá 1 item giữa → còn 2');
  eq(afterDelete?.items.map((it) => it.index), [0, 1], 'index re-index liền mạch [0,1]');
  eq(afterDelete?.items.map((it) => it.filename), ['band-1.jpg', 'band-3.jpg'], 'giữ đúng 2 item còn lại');
  eq(afterDelete?.progress.total, 2, 'progress.total = 2');
  eq(afterDelete?.progress.done, 2, 'progress.done khớp recomputeDone (done + error, không pending)');

  const noop = deleteItem(job.id, 99); // ngoài biên
  eq(noop?.items.length, 2, 'xoá index ngoài biên → no-op, job không đổi');
  eq(noop?.progress.total, 2, 'progress.total không đổi khi no-op');

  const afterOne = deleteItem(job.id, 1); // xoá item cuối (band-3, status error)
  eq(afterOne?.items.length, 1, 'xoá item cuối → còn 1');
  eq(afterOne?.items.map((it) => it.index), [0], 're-index còn [0]');
  eq(afterOne?.progress.total, 1, 'progress.total = 1');

  const empty = deleteItem(job.id, 0); // xoá nốt phần tử cuối cùng
  eq(empty?.items.length, 0, 'xoá phần tử cuối cùng → rỗng, không crash');
  eq(empty?.progress.total, 0, 'progress.total = 0 khi rỗng');

  eq(deleteItem('job-không-tồn-tại', 0), undefined, 'jobId lạ → undefined');
}

console.log('\nXoá nhịp (deleteBeat): re-order, no-op khi beatId lạ');
{
  const fakeBeat = (id: string, order: number): StoredBeat => ({
    id,
    order,
    sourceIndex: order,
    region: null,
    narration: '',
    status: 'pending',
    rev: 0,
  });
  const sb = createStoryboard({
    jobId: 'sb-job-1',
    sourceKind: 'pages',
    working: [],
    beats: [fakeBeat('b0', 0), fakeBeat('b1', 1), fakeBeat('b2', 2)],
  });
  const afterDelete = deleteBeat(sb.jobId, 'b1'); // xoá nhịp giữa
  eq(afterDelete?.beats.length, 2, 'xoá 1 nhịp giữa → còn 2');
  eq(afterDelete?.beats.map((b) => b.order), [0, 1], 'order re-sequence liền mạch [0,1]');
  eq(afterDelete?.beats.map((b) => b.id), ['b0', 'b2'], 'giữ đúng 2 nhịp còn lại');
  eq(afterDelete?.progress.total, 2, 'progress.total = 2');

  const noop = deleteBeat(sb.jobId, 'beat-không-tồn-tại');
  eq(noop?.beats.length, 2, 'beatId lạ → no-op, state không đổi');
  eq(noop?.beats.map((b) => b.id), ['b0', 'b2'], 'danh sách nhịp giữ nguyên khi no-op');

  eq(deleteBeat('job-không-tồn-tại', 'b0'), undefined, 'jobId lạ → undefined');
}

console.log(failures === 0 ? '\nALL_PASS' : `\nFAILURES: ${failures}`);
process.exit(failures === 0 ? 0 : 1);
