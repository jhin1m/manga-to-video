// Verify tầng settings của TTS (unit + mock ElevenLabs, không API thật):
//   BẤT BIẾN quan trọng nhất: settings TTS null → readTtsConfig() y hệt trước, ttsCacheKey
//     KHÔNG đổi ⇒ audio đã trả phí không bị synth lại
//   chuỗi ưu tiên 4 tầng: overrides (job) > .settings.json.tts > ENV > default
//   /voices cho cả elevenlabs (API thật qua mock) lẫn capcut (catalog tĩnh), lỗi → 502
//   /preview trả audio/mpeg và lần 2 HIT cache (mock chỉ bị gọi 1 lần)
import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createMockElevenLabs } from './mock-elevenlabs.mjs';

const dir = mkdtempSync(path.join(os.tmpdir(), 'verify-tts-settings-'));
const settingsFile = path.join(dir, '.settings.json');
process.env.SETTINGS_FILE = settingsFile;
process.env.TTS_CACHE_DIR = path.join(dir, 'cache');
for (const k of [
  'TTS_PROVIDER', 'ELEVENLABS_API_KEY', 'ELEVENLABS_VOICE_ID', 'ELEVENLABS_MODEL',
  'ELEVENLABS_BASE_URL', 'CAPCUT_VOICE',
]) {
  delete process.env[k];
}

const { readTtsConfig, ttsCacheKey, TTS_PREVIEW_SAMPLE } = await import('@/lib/tts');
const { writeAiSettings } = await import('@/lib/settings');
type TtsInput = Parameters<typeof writeAiSettings>[0] extends infer T
  ? T extends { tts?: infer U }
    ? U
    : never
  : never;
const { CAPCUT_VOICES } = await import('@/lib/tts-providers/catalog');
const { POST: VOICES } = await import('@/app/api/settings/tts/voices/route');
const { POST: PREVIEW } = await import('@/app/api/settings/tts/preview/route');

let failures = 0;
const eq = (a: unknown, e: unknown, label: string) => {
  if (JSON.stringify(a) === JSON.stringify(e)) console.log(`  ✓ ${label}`);
  else {
    failures++;
    console.error(`  ✗ ${label}\n    expected: ${JSON.stringify(e)}\n    actual:   ${JSON.stringify(a)}`);
  }
};
const ok = (c: boolean, label: string) => eq(c, true, label);

const post = (body: unknown) =>
  new Request('http://localhost/api/settings/tts', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });

// Settings AI tối thiểu để writeAiSettings đi qua sanitize (tts là phần đang test).
const withTts = (tts: TtsInput) => ({
  vision: {
    provider: 'openrouter' as const,
    baseURL: '',
    model: 'm',
    apiKey: 'k',
    disableThinking: false,
  },
  script: null,
  tts,
});

console.log('1. KHOÁ — settings TTS null → giá trị y hệt hiện tại');
{
  const cfg = readTtsConfig();
  eq(cfg.provider, 'elevenlabs', 'provider mặc định elevenlabs');
  eq(cfg.voiceId, '21m00Tcm4TlvDq8ikWAM', 'voiceId mặc định không đổi');
  eq(cfg.model, 'eleven_multilingual_v2', 'model mặc định không đổi');
  eq(cfg.apiKey, '', 'chưa có key → rỗng (provider tự kiểm lúc synth)');
}

console.log('2. KHOÁ — ttsCacheKey giữ nguyên công thức (mốc vàng)');
{
  // Hash HẰNG SỐ đo trước khi sửa readTtsConfig. Đổi = mọi audio ElevenLabs đã trả phí
  // trong .cache/tts thành rác, phải synth lại từ đầu.
  const GOLDEN = 'fd4be6e98cffef25dba20f7973b7297fec521fd8bb8b26853645c64f39107749';
  eq(
    ttsCacheKey('Xin chào', '21m00Tcm4TlvDq8ikWAM', 'eleven_multilingual_v2', 'elevenlabs'),
    GOLDEN,
    'sha256(text\\0voice\\0model) cho elevenlabs không đổi',
  );
  ok(
    ttsCacheKey('Xin chào', 'v', 'm', 'capcut') !== ttsCacheKey('Xin chào', 'v', 'm', 'elevenlabs'),
    'provider khác vẫn có prefix riêng (không đụng cache ElevenLabs)',
  );
}

console.log('3. KHOÁ — provider không phải elevenlabs thì voiceId/model rỗng');
{
  process.env.TTS_PROVIDER = 'capcut';
  const cfg = readTtsConfig();
  eq(cfg.provider, 'capcut', 'ENV TTS_PROVIDER vẫn có tác dụng');
  eq(cfg.voiceId, '', 'voiceId rỗng — provider tự resolve default');
  eq(cfg.model, '', 'model rỗng');
  delete process.env.TTS_PROVIDER;
}

console.log('4. Settings TTS làm mặc định toàn cục');
{
  writeAiSettings(withTts({ provider: 'capcut', voiceId: 'BV562_streaming', model: '', apiKey: '' }));
  const cfg = readTtsConfig();
  eq(cfg.provider, 'capcut', 'provider theo settings');
  eq(cfg.voiceId, 'BV562_streaming', 'voiceId theo settings');
}

console.log('5. Overrides của job THẮNG settings');
{
  const cfg = readTtsConfig({ provider: 'elevenlabs' });
  eq(cfg.provider, 'elevenlabs', 'overrides đè provider của settings');
  // Giọng CapCut trong settings tuyệt đối không được gán cho ElevenLabs — provider hiệu
  // dụng khác provider đã cấu hình thì settings TTS không áp dụng.
  eq(cfg.voiceId, '21m00Tcm4TlvDq8ikWAM', 'voiceId rơi về mặc định ElevenLabs, không lấy giọng CapCut');
  eq(cfg.model, 'eleven_multilingual_v2', 'model rơi về mặc định ElevenLabs');
}

console.log('6. ENV vẫn là đường lùi khi settings TTS null');
{
  writeAiSettings(withTts(null));
  process.env.TTS_PROVIDER = 'capcut';
  eq(readTtsConfig().provider, 'capcut', 'settings null → nghe ENV TTS_PROVIDER');
  delete process.env.TTS_PROVIDER;
  // Và bất biến mục 1 vẫn đứng khi có settings AI nhưng tts = null.
  eq(readTtsConfig().voiceId, '21m00Tcm4TlvDq8ikWAM', 'settings AI có nhưng tts null → giọng cũ');
}

console.log('7. apiKey: settings thắng ENV');
{
  process.env.ELEVENLABS_API_KEY = 'env-key';
  eq(readTtsConfig().apiKey, 'env-key', 'settings tts null → ENV');
  writeAiSettings(withTts({ provider: 'elevenlabs', voiceId: '', model: '', apiKey: 'settings-key' }));
  eq(readTtsConfig().apiKey, 'settings-key', 'key trong settings thắng ENV');
  writeAiSettings(withTts({ provider: 'elevenlabs', voiceId: '', model: '', apiKey: '' }));
  eq(readTtsConfig().apiKey, 'env-key', 'key settings rỗng → rơi về ENV');
  delete process.env.ELEVENLABS_API_KEY;
}

console.log('8. /voices — capcut trả catalog tĩnh, không gọi mạng');
{
  const res = await VOICES(post({ provider: 'capcut' }));
  eq(res.status, 200, '200');
  const { voices } = JSON.parse(await res.text()) as { voices: Array<{ id: string }> };
  eq(voices.length, CAPCUT_VOICES.length, 'đủ số giọng trong catalog');
  ok(
    voices.some((v) => v.id === 'BV562_streaming'),
    'có giọng mẫu BV562_streaming',
  );
}

console.log('9. /voices — elevenlabs map voice_id→id, name→label');
{
  const mock = await createMockElevenLabs(0);
  process.env.ELEVENLABS_BASE_URL = `http://127.0.0.1:${mock.port}`;
  const res = await VOICES(post({ provider: 'elevenlabs', apiKey: 'k' }));
  eq(res.status, 200, '200');
  const { voices } = JSON.parse(await res.text()) as { voices: Array<{ id: string; label: string }> };
  eq(voices.length, 2, 'lấy đủ giọng');
  eq(voices[0], { id: '21m00Tcm4TlvDq8ikWAM', label: 'Rachel' }, 'map đúng voice_id/name');
  await mock.close();
}

console.log('10. /voices — upstream lỗi → 502, không throw (UI lùi ô nhập tự do)');
{
  const mock = await createMockElevenLabs(0);
  process.env.ELEVENLABS_BASE_URL = `http://127.0.0.1:${mock.port}`;
  process.env.MOCK_VOICES_STATUS = '401';
  const res = await VOICES(post({ provider: 'elevenlabs', apiKey: 'sai' }));
  eq(res.status, 502, 'lỗi upstream → 502');
  ok(typeof JSON.parse(await res.text()).error === 'string', 'trả {error} thay vì ném');
  delete process.env.MOCK_VOICES_STATUS;
  await mock.close();
}

console.log('11. /preview — trả audio/mpeg, lần 2 HIT cache (không gọi lại API)');
{
  const mock = await createMockElevenLabs(0);
  process.env.ELEVENLABS_BASE_URL = `http://127.0.0.1:${mock.port}`;
  const body = { provider: 'elevenlabs', voiceId: 'voice-preview', model: 'eleven_multilingual_v2', apiKey: 'k' };
  const r1 = await PREVIEW(post(body));
  eq(r1.status, 200, '200');
  eq(r1.headers.get('content-type'), 'audio/mpeg', 'Content-Type audio/mpeg');
  ok((await r1.arrayBuffer()).byteLength > 0, 'body mp3 khác rỗng');
  eq(mock.requestCount(), 1, 'lần 1 gọi API đúng 1 lần');
  const r2 = await PREVIEW(post(body));
  eq(r2.status, 200, 'lần 2 vẫn 200');
  ok((await r2.arrayBuffer()).byteLength > 0, 'lần 2 vẫn có audio');
  eq(mock.requestCount(), 1, 'lần 2 HIT cache — KHÔNG gọi lại API');
  await mock.close();
}

console.log('12. Câu mẫu preview là HẰNG SỐ dùng chung (đổi = mất cache preview)');
{
  // Ghim GIÁ TRỊ, không chỉ "khác rỗng": đổi câu mẫu là vô hiệu toàn bộ cache preview đã có.
  eq(TTS_PREVIEW_SAMPLE, 'Đây là giọng đọc thử cho video recap truyện tranh.', 'câu mẫu không đổi');
}

console.log('13. /voices và /preview không trả key (kể cả khi lỗi)');
{
  const mock = await createMockElevenLabs(0);
  process.env.ELEVENLABS_BASE_URL = `http://127.0.0.1:${mock.port}`;
  const KEY = 'el-secret-key-4242';
  const v = await (await VOICES(post({ provider: 'elevenlabs', apiKey: KEY }))).text();
  ok(!v.includes(KEY), '/voices không trả key');
  // Ép /preview vào nhánh LỖI bằng cách trỏ ElevenLabs vào port chết — dùng elevenlabs
  // (đã có mock) thay vì capcut: capcut sẽ gọi API NỘI BỘ THẬT qua mạng, làm test:unit
  // chậm/flaky và ping bên thứ ba mỗi lần chạy.
  process.env.ELEVENLABS_BASE_URL = 'http://127.0.0.1:1';
  const p = await PREVIEW(post({ provider: 'elevenlabs', voiceId: 'v-err', model: 'm', apiKey: KEY }));
  eq(p.status, 502, 'upstream chết → 502');
  const pText = await p.text();
  ok(!pText.includes(KEY), '/preview không trả key kể cả khi lỗi');
  await mock.close();
}

console.log('14. Route TTS từ chối request cross-site (không để trang khác sai khiến gửi key)');
{
  const crossSite = (body: unknown) =>
    new Request('http://localhost/api/settings/tts', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'sec-fetch-site': 'cross-site' },
      body: JSON.stringify(body),
    });
  eq((await VOICES(crossSite({ provider: 'capcut' }))).status, 403, '/voices cross-site → 403');
  eq(
    (await PREVIEW(crossSite({ provider: 'capcut', voiceId: 'v', model: '' }))).status,
    403,
    '/preview cross-site → 403',
  );
  // Same-origin và header vắng mặt (curl/CLI/test) vẫn phải qua — đây KHÔNG phải auth.
  eq((await VOICES(post({ provider: 'capcut' }))).status, 200, 'không có header → vẫn cho qua');
}

rmSync(dir, { recursive: true, force: true });
if (failures > 0) {
  console.error(`\nverify-tts-settings: ${failures} lỗi`);
  process.exit(1);
}
console.log('\nverify-tts-settings: OK');
