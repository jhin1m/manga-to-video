import type { TtsVoice } from './types';

// Metadata provider TTS dạng DỮ LIỆU THUẦN (chỉ import type, không node builtin) → client
// component (trang video) import an toàn, KHÔNG kéo node:crypto của provider vào bundle client.
// Đây là nguồn chung: provider (server) và UI (client) cùng đọc từ đây, không lệch nhau.

// Nhãn provider — dùng cho cả provider object (server) lẫn dropdown UI.
export const PROVIDER_LABELS = {
  elevenlabs: 'ElevenLabs',
  capcut: 'CapCut (free, tiếng Việt)',
} as const;

// Catalog giọng Việt CapCut — CHỈ giọng verify được thực nghiệm (Phase 1). resourceId đi kèm
// từng giọng: chọn giọng nào gửi đúng resource_id giọng đó.
export const CAPCUT_VOICES: TtsVoice[] = [
  { id: 'BV074_streaming', label: 'Cô Gái Hoạt Ngôn', resourceId: '7102355709945188865' },
  { id: 'BV075_streaming', label: 'Thanh Niên Tự Tin', resourceId: '7102355803792740865' },
  { id: 'vi_female_huong', label: 'Giọng Nữ Phổ Thông', resourceId: '7264854897953083905' },
  { id: 'BV421_vivn_streaming', label: 'Nhỏ Ngọt Ngào', resourceId: '7252594014782755330' },
  { id: 'BV562_streaming', label: 'Mai', resourceId: '7483736254694035984' },
  { id: 'BV560_streaming', label: 'Alex Đại Đế', resourceId: '7483736167565758992' },
  { id: 'multi_female_yangguangnv_uranus_bigtts', label: 'Ban Mai', resourceId: '7637456432522218773' },
  { id: 'multi_female_sisi_uranus_bigtts', label: 'Bản Tin nữ', resourceId: '7637455857285860629' },
];

export interface TtsProviderOption {
  id: string;
  label: string;
  voices?: TtsVoice[]; // có catalog = UI render dropdown giọng; không = ô voiceId tự do
}

// Danh sách provider cho dropdown UI (thứ tự hiển thị). ElevenLabs không catalog (voiceId tự do).
export const TTS_PROVIDER_OPTIONS: TtsProviderOption[] = [
  { id: 'elevenlabs', label: PROVIDER_LABELS.elevenlabs },
  { id: 'capcut', label: PROVIDER_LABELS.capcut, voices: CAPCUT_VOICES },
];
