import { capcutProvider } from './capcut';
import { elevenlabsProvider } from './elevenlabs';
import type { TtsProvider } from './types';

export type { TtsConfig, TtsProvider, TtsVoice } from './types';

// Registry provider TTS — map tĩnh. Thêm provider mới = thêm 1 dòng ở đây + 1 file provider.
const PROVIDERS: Record<string, TtsProvider> = {
  [elevenlabsProvider.id]: elevenlabsProvider,
  [capcutProvider.id]: capcutProvider,
};

export const DEFAULT_PROVIDER_ID = 'elevenlabs';

export function getTtsProvider(id: string): TtsProvider {
  const provider = PROVIDERS[id];
  if (!provider) {
    const valid = Object.keys(PROVIDERS).join(', ');
    throw new Error(`TTS_PROVIDER không hợp lệ: "${id}". Provider hợp lệ: ${valid}.`);
  }
  return provider;
}

// UI liệt kê provider từ ./catalog (dữ liệu thuần, client-safe) — không import registry này
// (registry kéo node:crypto qua các provider). Đây chỉ là tầng resolve/synth phía server.
