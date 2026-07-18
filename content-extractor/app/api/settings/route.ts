import { NextResponse } from 'next/server';
import {
  PROVIDER_PRESETS,
  readAiSettings,
  writeAiSettings,
  type AiSettings,
} from '@/lib/settings';

// GET/PUT cấu hình AI từ Settings dialog. Key KHÔNG bao giờ đi qua đây — chỉ trả boolean
// "env này có key chưa" để UI cảnh báo thiếu key trước khi người dùng lưu provider mới.

function keyStatus(): Record<string, boolean> {
  return Object.fromEntries(
    ['OPENAI_API_KEY', 'ZAI_API_KEY', 'OPENROUTER_API_KEY'].map((k) => [k, Boolean(process.env[k])]),
  );
}

export async function GET() {
  return NextResponse.json({
    settings: readAiSettings(),
    presets: PROVIDER_PRESETS,
    keys: keyStatus(),
  });
}

export async function PUT(req: Request) {
  let body: { settings?: unknown };
  try {
    body = (await req.json()) as { settings?: unknown };
  } catch {
    return NextResponse.json({ error: 'Body không phải JSON hợp lệ' }, { status: 400 });
  }
  try {
    // settings=null → xóa file, quay về cấu hình theo ENV.
    writeAiSettings(body.settings === null ? null : (body.settings as AiSettings));
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Settings không hợp lệ' },
      { status: 400 },
    );
  }
  return NextResponse.json({ settings: readAiSettings(), keys: keyStatus() });
}
