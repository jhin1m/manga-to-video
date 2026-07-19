import { NextResponse } from 'next/server';
import { generateRecap, readScriptConfig } from '@/lib/script';
import { getStoryboard } from '@/lib/storyboard-store';

export const runtime = 'nodejs';

// Xuất recap chương cho series-memory: tóm lời kể của script đã có (≤250 từ, format
// khớp <series>/.mtv/summaries/ của skill). Trả {recap} — client tự tải thành file .md;
// app không ghi ra đĩa vì không biết folder series (ingest qua upload).
export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const state = getStoryboard(id);
  if (!state?.script?.length) {
    return NextResponse.json(
      { error: 'Chưa có kịch bản — tạo kịch bản ở trang Storyboard trước rồi mới xuất recap' },
      { status: 404 },
    );
  }
  // Đòi config sớm để fail với thông điệp rõ (mẫu route script).
  try {
    readScriptConfig();
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Cấu hình script không hợp lệ';
    return NextResponse.json({ error: message }, { status: 400 });
  }
  try {
    const recap = await generateRecap(state.script);
    return NextResponse.json({ recap });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Xuất recap thất bại';
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
