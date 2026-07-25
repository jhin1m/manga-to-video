// Catalog font kèm sẵn trong repo. CÙNG file .ttf phục vụ hai phía:
//   - preview: @font-face trong app/globals.css trỏ /fonts/<file>.ttf
//   - render:  libass đọc qua fontsdir = public/fonts
// Nhờ vậy preview và MP4 dùng đúng một file font → không còn cảnh "máy này một kiểu".
//
// `family` phải khớp TUYỆT ĐỐI tên family bên trong file TTF (libass match theo family name,
// không theo tên file). Giá trị dưới đây đọc bằng `fc-scan --format '%{family[0]}'`.
//
// Mọi họ ở đây đã kiểm bằng fc-query là có đủ glyph tiếng Việt (ệ ữ ẫ đ Đ). KHÔNG thêm
// Anton / Bebas Neue / Archivo Black / Alfa Slab One / Fredoka / Bungee — chúng thiếu dấu
// tiếng Việt dù rất hay được chọn cho phụ đề.
//
// Module THUẦN (không node:*) vì panel phụ đề phía client import trực tiếp. Đường dẫn thư
// mục font trên đĩa cho libass nằm ở lib/ffmpeg.ts (phía server).

export interface FontEntry {
  family: string; // dùng cho FontName của ASS và font-family của CSS
  files: { regular: string; bold: string }; // tên file trong public/fonts
  category: 'sans' | 'serif' | 'condensed' | 'display';
  note: string; // gợi ý dùng, hiện trong UI
}

export const FONT_CATALOG: FontEntry[] = [
  {
    family: 'Be Vietnam Pro',
    files: { regular: 'BeVietnamPro-Regular.ttf', bold: 'BeVietnamPro-Bold.ttf' },
    category: 'sans',
    note: 'Mặc định — thiết kế cho tiếng Việt',
  },
  {
    family: 'Roboto',
    files: { regular: 'Roboto-Regular.ttf', bold: 'Roboto-Bold.ttf' },
    category: 'sans',
    note: 'Trung tính, dễ đọc',
  },
  {
    family: 'Montserrat',
    files: { regular: 'Montserrat-Regular.ttf', bold: 'Montserrat-Bold.ttf' },
    category: 'sans',
    note: 'Hình học, đậm nổi',
  },
  {
    family: 'Nunito',
    files: { regular: 'Nunito-Regular.ttf', bold: 'Nunito-Bold.ttf' },
    category: 'sans',
    note: 'Bo tròn, thân thiện',
  },
  {
    family: 'Oswald',
    files: { regular: 'Oswald-Regular.ttf', bold: 'Oswald-Bold.ttf' },
    category: 'condensed',
    note: 'Hẹp cao, thay Anton/Bebas (2 font đó thiếu dấu)',
  },
  {
    family: 'Barlow Condensed',
    files: { regular: 'BarlowCondensed-Regular.ttf', bold: 'BarlowCondensed-Bold.ttf' },
    category: 'condensed',
    note: 'Hẹp, nhét nhiều chữ một dòng',
  },
  {
    family: 'Kanit',
    files: { regular: 'Kanit-Regular.ttf', bold: 'Kanit-Bold.ttf' },
    category: 'display',
    note: 'Dày nặng, hợp caption nổi bật',
  },
  {
    family: 'Merriweather',
    files: { regular: 'Merriweather-Regular.ttf', bold: 'Merriweather-Bold.ttf' },
    category: 'serif',
    note: 'Có chân, tông cổ trang',
  },
];

export const DEFAULT_FONT = 'Be Vietnam Pro';

export const FONT_CATEGORY_LABEL: Record<FontEntry['category'], string> = {
  sans: 'Không chân',
  condensed: 'Hẹp',
  display: 'Nổi bật',
  serif: 'Có chân',
};
