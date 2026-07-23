import { NextResponse } from 'next/server';
import { writeBundle } from '@/lib/bundle';
import { defaultRenderConfig } from '@/lib/schema';
import { buildBundle, collectAudio, parseConfig, parseRenderForm } from '@/lib/storyboard-render-input';

export const runtime = 'nodejs';

// Export bundle.zip = ScriptManifest + band images + render-config (+ audio đã synth + BGM).
// GET: config qua query ?config=<json> (không BGM). POST multipart: field config + file bgm
// (Preview UI dùng POST để đính BGM blob). Bundle là hand-off self-contained cho CLI.
// buildBundle/collectAudio/parseConfig/parseRenderForm dùng chung với route render in-app
// (lib/storyboard-render-input.ts).

function zipResponse(id: string, zip: Buffer): Response {
  return new Response(new Uint8Array(zip), {
    headers: {
      'Content-Type': 'application/zip',
      'Content-Disposition': `attachment; filename="bundle-${id}.zip"`,
    },
  });
}

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  let config = defaultRenderConfig();
  const rawConfig = new URL(req.url).searchParams.get('config');
  if (rawConfig) {
    try {
      config = parseConfig(JSON.parse(rawConfig));
    } catch {
      return NextResponse.json({ error: 'Query config không phải JSON hợp lệ' }, { status: 400 });
    }
  }
  const built = buildBundle(id, config);
  if ('error' in built) return NextResponse.json({ error: built.error }, { status: built.status });
  const audio = await collectAudio(id, built.scriptManifest);
  return zipResponse(id, writeBundle({ ...built, audio }));
}

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  let config = defaultRenderConfig();
  let bgm: { filename: string; data: Buffer } | undefined;
  try {
    ({ config, bgm } = await parseRenderForm(req));
  } catch {
    return NextResponse.json(
      { error: 'Body phải là multipart form-data (config JSON + file bgm tuỳ chọn)' },
      { status: 400 },
    );
  }
  const built = buildBundle(id, config, bgm);
  if ('error' in built) return NextResponse.json({ error: built.error }, { status: built.status });
  const audio = await collectAudio(id, built.scriptManifest);
  return zipResponse(id, writeBundle({ ...built, audio }));
}
