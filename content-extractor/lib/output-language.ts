// Ngôn ngữ ĐẦU RA của pipeline (vision dịch thoại, biên kịch, recap, giọng TTS) — chọn theo
// từng job. Dữ liệu thuần, không node builtin → client component import an toàn (như
// tts-providers/catalog.ts). Thêm ngôn ngữ = thêm 1 dòng ở đây + giọng CapCut tương ứng.
//
// ja/zh/ko CHƯA hỗ trợ có chủ ý: cần font CJK cho phụ đề + ngắt dòng không dựa khoảng trắng
// (lib/timeline.ts) — thêm dòng vào đây thôi là chưa đủ.

export interface OutputLanguageInfo {
  id: string;
  label: string; // nhãn ở dropdown UI
  // Tên ngôn ngữ chèn vào prompt — prompt viết bằng tiếng Việt nên tên cũng bằng tiếng Việt,
  // kèm tên gốc để model không hiểu nhầm.
  promptName: string;
  // Câu mẫu nút "Nghe thử" cho giọng thuộc ngôn ngữ này. Bản vi là chuỗi cũ của
  // TTS_PREVIEW_SAMPLE — đổi là mất cache nghe thử đã synth.
  previewSample: string;
}

export const OUTPUT_LANGUAGES = [
  {
    id: 'vi',
    label: 'Tiếng Việt',
    promptName: 'tiếng Việt',
    previewSample: 'Đây là giọng đọc thử cho video recap truyện tranh.',
  },
  {
    id: 'en',
    label: 'English',
    promptName: 'tiếng Anh (English)',
    previewSample: 'This is a sample voice for a manga recap video.',
  },
  {
    id: 'id',
    label: 'Bahasa Indonesia',
    promptName: 'tiếng Indonesia (Bahasa Indonesia)',
    previewSample: 'Ini adalah contoh suara untuk video rekap komik.',
  },
] as const satisfies readonly OutputLanguageInfo[];

export type OutputLanguage = (typeof OUTPUT_LANGUAGES)[number]['id'];

export const DEFAULT_OUTPUT_LANGUAGE: OutputLanguage = 'vi';

export function isOutputLanguage(v: unknown): v is OutputLanguage {
  return OUTPUT_LANGUAGES.some((l) => l.id === v);
}

// Dữ liệu cũ (job/.mtvproj/bundle trước khi có field) hoặc thiếu → 'vi' = hành vi cũ.
// API nhận input từ client KHÔNG dùng hàm này: giá trị lạ ở đó phải là lỗi 400, không nuốt.
export function normalizeOutputLanguage(v: unknown): OutputLanguage {
  return isOutputLanguage(v) ? v : DEFAULT_OUTPUT_LANGUAGE;
}

export function getOutputLanguage(id: OutputLanguage): OutputLanguageInfo {
  return OUTPUT_LANGUAGES.find((l) => l.id === id) ?? OUTPUT_LANGUAGES[0];
}

// Dựng prompt ngôn ngữ khác TỪ prompt vi bằng thay thế chuỗi CHÍNH XÁC. Prompt vi giữ nguyên
// từng byte (đã tinh chỉnh qua nhiều lượt đo thật) và là nguồn duy nhất — không nhân bản cả
// prompt cho từng ngôn ngữ. Thiếu chuỗi gốc là THROW: ai sửa câu vi mà quên cặp thay thế thì
// test đỏ ngay, thay vì prompt en âm thầm còn sót quy tắc tiếng Việt.
export function localizePrompt(source: string, pairs: Array<[from: string, to: string]>): string {
  let out = source;
  for (const [from, to] of pairs) {
    if (!out.includes(from)) {
      throw new Error(`localizePrompt: không thấy chuỗi gốc "${from.slice(0, 60)}" — prompt vi đã đổi?`);
    }
    out = out.split(from).join(to);
  }
  return out;
}
