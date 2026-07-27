// Kiểu dùng chung cho tầng provider TTS. Tách khỏi lib/tts.ts để provider và registry
// import được mà không tạo vòng phụ thuộc ngược về orchestration.

export interface TtsVoice {
  id: string; // voiceId gửi cho provider (vd voice_type CapCut)
  label: string; // nhãn hiển thị ở UI
  resourceId?: string; // CapCut cần resource_id riêng cho từng giọng
}

// Config chung cho một lần synth. Định hình theo ElevenLabs (backward-compat) — provider
// khác chỉ dùng phần liên quan (vd CapCut dùng voiceId, đọc endpoint/giọng từ ENV riêng),
// bỏ qua field không dùng thay vì lỗi.
export interface TtsConfig {
  provider?: string; // id provider; thiếu = 'elevenlabs' (giữ hành vi cũ cho call-site cũ)
  apiKey: string; // ElevenLabs
  baseUrl: string; // ElevenLabs (mock đè khi test)
  voiceId: string; // selector giọng, provider-agnostic
  model: string; // tier ElevenLabs; provider khác có thể bỏ qua
  cacheDir: string;
}

export interface TtsProvider {
  id: string; // 'elevenlabs' | 'capcut' | ...
  label: string; // nhãn cho UI
  voices?: TtsVoice[]; // catalog cho UI; undefined = nhập voiceId tự do
  // Giọng HIỆU DỤNG cho CACHE KEY khi cfg.voiceId rỗng (provider tự resolve default từ ENV
  // bên trong synth). Không khai báo = key dùng thẳng cfg.voiceId. Nhờ vậy đổi giọng mặc định
  // qua ENV không HIT nhầm audio giọng cũ (key phản ánh đúng giọng sẽ synth).
  resolveVoiceId?(cfg: TtsConfig): string;
  // Lấy danh sách giọng TỪ API của nhà cung cấp (giọng phụ thuộc tài khoản, không catalog
  // sẵn được). Không khai báo = UI dùng `voices` tĩnh, hoặc ô nhập tự do nếu cũng không có.
  listVoices?(cfg: TtsConfig): Promise<TtsVoice[]>;
  synth(text: string, cfg: TtsConfig): Promise<Buffer>; // text đã trim, khác rỗng → mp3
}
