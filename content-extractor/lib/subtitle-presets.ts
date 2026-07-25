// Preset style phụ đề dựng sẵn — bấm một nút áp cả bộ. Chỉ là điểm khởi đầu: người dùng
// chỉnh tiếp thoải mái, không có khái niệm "đang ở preset nào".
//
// KHÔNG làm preset tự lưu: renderConfig hiện không được ghi vào .mtvproj nên preset người
// dùng tự tạo sẽ mất khi mở lại project — muốn có phải đổi format .mtvproj trước.
//
// Preset chỉ đụng phần TẠO HÌNH; `export`/`burnIn`/`maxCharsPerLine` do người dùng quyết
// nên cố tình không nằm trong preset.
import type { SubtitleStyle } from './schema';

export interface SubtitlePreset {
  id: string;
  label: string;
  hint: string;
  style: Partial<SubtitleStyle>;
}

export const SUBTITLE_PRESETS: SubtitlePreset[] = [
  {
    id: 'clean',
    label: 'Sạch',
    hint: 'Chữ trắng viền đen mỏng — hợp mọi nền',
    style: {
      font: 'Be Vietnam Pro',
      sizePct: 4.5,
      color: '#ffffff',
      opacity: 1,
      bold: false,
      italic: false,
      underline: false,
      uppercase: false,
      letterSpacing: 0,
      border: 'outline',
      outlineWidth: 2,
      outlineColor: '#000000',
      outlineOpacity: 1,
      shadowDepth: 0,
      position: 'bottom',
      marginPct: 8,
      sideMarginPct: 6,
    },
  },
  {
    id: 'boxed',
    label: 'Nền đen',
    hint: 'Hộp đen mờ sau chữ — đọc rõ trên tranh rối',
    style: {
      font: 'Roboto',
      sizePct: 4.2,
      color: '#ffffff',
      opacity: 1,
      bold: false,
      italic: false,
      underline: false,
      uppercase: false,
      letterSpacing: 0,
      // Ở BorderStyle=3 (hộp), MÀU HỘP lấy từ outlineColor — xem ghi chú trong subtitle-style.ts.
      border: 'box',
      outlineWidth: 3,
      outlineColor: '#000000',
      outlineOpacity: 0.6,
      shadowDepth: 0,
      position: 'bottom',
      marginPct: 8,
      sideMarginPct: 8,
    },
  },
  {
    id: 'punchy',
    label: 'Đậm nổi',
    hint: 'IN HOA, viền dày, cỡ lớn — kiểu clip ngắn',
    style: {
      font: 'Kanit',
      sizePct: 5.5,
      color: '#ffffff',
      opacity: 1,
      bold: true,
      italic: false,
      underline: false,
      uppercase: true,
      letterSpacing: 0.5,
      border: 'outline',
      outlineWidth: 3,
      outlineColor: '#000000',
      outlineOpacity: 1,
      shadowDepth: 1,
      shadowColor: '#000000',
      position: 'bottom',
      marginPct: 12,
      sideMarginPct: 8,
    },
  },
  {
    id: 'classic',
    label: 'Cổ trang',
    hint: 'Serif vàng ngà, viền nâu — tông kiếm hiệp',
    style: {
      font: 'Merriweather',
      sizePct: 4.2,
      color: '#ffe9b0',
      opacity: 1,
      bold: false,
      italic: false,
      underline: false,
      uppercase: false,
      letterSpacing: 0,
      border: 'outline',
      outlineWidth: 2,
      outlineColor: '#3b2412',
      outlineOpacity: 1,
      shadowDepth: 1,
      shadowColor: '#000000',
      position: 'bottom',
      marginPct: 8,
      sideMarginPct: 7,
    },
  },
  {
    id: 'news',
    label: 'Tin tức',
    hint: 'Băng xanh đậm, chữ nhỏ gọn dưới khung',
    style: {
      font: 'Barlow Condensed',
      sizePct: 4,
      color: '#ffffff',
      opacity: 1,
      bold: true,
      italic: false,
      underline: false,
      uppercase: false,
      letterSpacing: 0,
      border: 'box',
      outlineWidth: 3,
      outlineColor: '#0b2545',
      outlineOpacity: 0.85,
      shadowDepth: 0,
      position: 'bottom',
      marginPct: 6,
      sideMarginPct: 5,
    },
  },
];
