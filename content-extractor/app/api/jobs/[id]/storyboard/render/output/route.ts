import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { NextResponse } from 'next/server';

export const runtime = 'nodejs';

// Serve results.zip (MP4 + .srt + .timeline.json) do POST .../render ghi ra
// .render/<jobId>-<aspect>/results.zip. Chặn path traversal: file enum cứng ('zip'),
// aspect regex ^\d+x\d+$, jobId whitelist [\w.-]; resolve rồi assert nằm trong .render/.

const RENDER_ROOT = '.render';

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const url = new URL(req.url);
  const file = url.searchParams.get('file');
  const aspect = url.searchParams.get('aspect') ?? '';

  if (file !== 'zip') {
    return NextResponse.json({ error: 'Tham số file không hợp lệ (chỉ hỗ trợ zip)' }, { status: 400 });
  }
  if (!/^\d+x\d+$/.test(aspect)) {
    return NextResponse.json({ error: 'Tham số aspect không hợp lệ' }, { status: 400 });
  }
  if (!/^[\w.-]+$/.test(id) || id === '.' || id === '..') {
    return NextResponse.json({ error: 'jobId không hợp lệ' }, { status: 400 });
  }

  const rootAbs = path.resolve(RENDER_ROOT);
  const zipPath = path.resolve(rootAbs, `${id}-${aspect}`, 'results.zip');
  // Belt-and-suspenders: dù id/aspect đã whitelist, vẫn assert path nằm trong .render/.
  if (!zipPath.startsWith(rootAbs + path.sep)) {
    return NextResponse.json({ error: 'Đường dẫn không hợp lệ' }, { status: 400 });
  }

  let data: Buffer;
  try {
    data = await readFile(zipPath);
  } catch {
    return NextResponse.json(
      { error: 'Chưa có kết quả render cho job/aspect này (render lại trước khi tải)' },
      { status: 404 },
    );
  }

  return new Response(new Uint8Array(data), {
    headers: {
      'Content-Type': 'application/zip',
      'Content-Disposition': `attachment; filename="results-${id}-${aspect}.zip"`,
    },
  });
}
