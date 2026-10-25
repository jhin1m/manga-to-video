import type { OutputLanguage } from '../output-language';
import type { TtsVoice } from './types';

// Metadata provider TTS dạng DỮ LIỆU THUẦN (chỉ import type, không node builtin) → client
// component (trang video) import an toàn, KHÔNG kéo node:crypto của provider vào bundle client.
// Đây là nguồn chung: provider (server) và UI (client) cùng đọc từ đây, không lệch nhau.

// Nhãn provider — dùng cho cả provider object (server) lẫn dropdown UI.
export const PROVIDER_LABELS = {
  elevenlabs: 'ElevenLabs',
  capcut: 'CapCut (free)',
} as const;

// Catalog giọng CapCut — CHỈ giọng verify được thực nghiệm (synth thật thành công). resourceId
// đi kèm từng giọng: chọn giọng nào gửi đúng resource_id giọng đó. Giọng đầu tiên của mỗi
// ngôn ngữ là giọng mặc định khi job đổi sang ngôn ngữ đó (pickVoiceForLang).
export const CAPCUT_VOICES: TtsVoice[] = [
  { id: 'BV074_streaming', label: 'Cô Gái Hoạt Ngôn', resourceId: '7102355709945188865', lang: 'vi' },
  { id: 'BV075_streaming', label: 'Thanh Niên Tự Tin', resourceId: '7102355803792740865', lang: 'vi' },
  { id: 'vi_female_huong', label: 'Giọng Nữ Phổ Thông', resourceId: '7264854897953083905', lang: 'vi' },
  { id: 'BV421_vivn_streaming', label: 'Nhỏ Ngọt Ngào', resourceId: '7252594014782755330', lang: 'vi' },
  { id: 'BV562_streaming', label: 'Mai', resourceId: '7483736254694035984', lang: 'vi' },
  { id: 'BV560_streaming', label: 'Alex Đại Đế', resourceId: '7483736167565758992', lang: 'vi' },
  { id: 'multi_female_yangguangnv_uranus_bigtts', label: 'Ban Mai', resourceId: '7637456432522218773', lang: 'vi' },
  { id: 'multi_female_sisi_uranus_bigtts', label: 'Bản Tin nữ', resourceId: '7637455857285860629', lang: 'vi' },
  { id: 'BV029_streaming', label: 'American Female', resourceId: '6898240012404396546', lang: 'en' },
  { id: 'en_us_007', label: 'Male Professional', resourceId: '7114563482472681986', lang: 'en' },
  { id: 'BV503_streaming', label: 'Energetic Female', resourceId: '7081168775646548482', lang: 'en' },
  { id: 'en_us_010', label: 'Charming Male', resourceId: '7114563482359435778', lang: 'en' },
  { id: 'ICL_en_male_philosopher_dsp', label: 'Narrator', resourceId: '7525722920161725712', lang: 'en' },
  { id: 'en_female_soothing_mars_bigtts', label: 'Female Teacher', resourceId: '7526754143369760016', lang: 'en' },
  { id: 'id_female_noor', label: 'Shinta (nữ)', resourceId: '7242142046587195906', lang: 'id' },
  { id: 'id_female_icha_uranus_bigtts', label: 'Icha (nữ)', resourceId: '7587328219989249296', lang: 'id' },
  { id: 'id_male_putra_uranus_bigtts', label: 'Putra (nam)', resourceId: '7587328479071309073', lang: 'id' },
  { id: 'ICL_id_male_deep_god_dsp', label: 'Deep God (nam trầm)', resourceId: '7605123605034208513', lang: 'id' },
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

export function catalogVoices(providerId: string): TtsVoice[] | undefined {
  return TTS_PROVIDER_OPTIONS.find((p) => p.id === providerId)?.voices;
}

// Giọng trong catalog đọc được ngôn ngữ `lang`. Provider không catalog → undefined (mọi giọng).
export function voicesForLang(providerId: string, lang: OutputLanguage): TtsVoice[] | undefined {
  return catalogVoices(providerId)?.filter((v) => v.lang === lang);
}

// Giọng hiệu dụng cho job ngôn ngữ `lang` — dùng CHUNG cho server (readTtsConfig, trước khi
// tính cache key) và UI (dropdown trang video), để hai bên không chọn khác giọng nhau.
//   • provider không catalog (ElevenLabs đa ngôn ngữ) → giữ nguyên voiceId
//   • voiceId ngoài catalog (người dùng tự đặt qua ENV) → giữ nguyên — chủ động chọn
//   • voiceId trong catalog đúng ngôn ngữ → giữ
//   • voiceId rỗng với 'vi' → giữ rỗng: provider tự resolve CAPCUT_VOICE/default như cũ, cache
//     key không đổi
//   • còn lại (rỗng với ngôn ngữ khác, hoặc giọng catalog sai ngôn ngữ) → giọng đầu của `lang`
// Trả null khi catalog không có giọng nào cho `lang` — caller báo lỗi gợi ý đổi provider.
export function pickVoiceForLang(
  providerId: string,
  voiceId: string,
  lang: OutputLanguage,
): string | null {
  const catalog = catalogVoices(providerId);
  if (!catalog) return voiceId;
  const known = voiceId ? catalog.find((v) => v.id === voiceId) : undefined;
  if (voiceId && !known) return voiceId;
  if (known?.lang === lang) return voiceId;
  if (!voiceId && lang === 'vi') return '';
  return catalog.find((v) => v.lang === lang)?.id ?? null;
}
