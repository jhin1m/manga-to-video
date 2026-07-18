// Verify cấu hình AI từ Settings UI (unit, không server, không mạng):
//   luật ưu tiên settings > ENV cho vision + script; không settings → ENV thuần y cũ
//   key theo provider (ZAI_API_KEY/OPENROUTER_API_KEY, fallback OPENAI_API_KEY)
//   disableThinking chỉ áp với provider z.ai (không rò param GLM sang provider khác)
//   file hỏng/rỗng = chưa cấu hình; write/read round-trip; reset (null) xóa file
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { existsSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { readAiSettings, writeAiSettings, type AiSettings } from '../lib/settings';
import { readVisionConfig } from '../lib/vision';
import { readScriptConfig } from '../lib/script';

let failures = 0;
const eq = (a: unknown, e: unknown, label: string) => {
  if (JSON.stringify(a) === JSON.stringify(e)) console.log(`  ✓ ${label}`);
  else {
    failures++;
    console.error(`  ✗ ${label}\n    expected: ${JSON.stringify(e)}\n    actual:   ${JSON.stringify(a)}`);
  }
};
const ok = (c: boolean, label: string) => eq(c, true, label);
const throws = (fn: () => unknown, needle: string, label: string) => {
  try {
    fn();
    failures++;
    console.error(`  ✗ ${label} — không ném lỗi`);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    ok(msg.includes(needle), `${label} (${msg.slice(0, 80)})`);
  }
};

const dir = mkdtempSync(path.join(os.tmpdir(), 'verify-settings-'));
const file = path.join(dir, '.settings.json');
process.env.SETTINGS_FILE = file;

// Env nền kiểm soát được: xóa mọi biến liên quan rồi đặt lại theo từng case.
for (const k of [
  'OPENAI_API_KEY', 'OPENAI_BASE_URL', 'VISION_MODEL', 'VISION_DISABLE_THINKING',
  'ZAI_API_KEY', 'OPENROUTER_API_KEY',
  'SCRIPT_API_KEY', 'SCRIPT_BASE_URL', 'SCRIPT_MODEL', 'SCRIPT_DISABLE_THINKING',
]) {
  delete process.env[k];
}

console.log('1. Không có settings → ENV thuần (hành vi cũ giữ nguyên)');
process.env.OPENAI_API_KEY = 'test-key-openai';
process.env.OPENAI_BASE_URL = 'https://api.z.ai/api/coding/paas/v4';
process.env.VISION_MODEL = 'glm-4.5v';
process.env.VISION_DISABLE_THINKING = 'true';
process.env.SCRIPT_BASE_URL = 'http://localhost:3108/v1';
process.env.SCRIPT_MODEL = 'mock-script';
eq(readAiSettings(), null, 'chưa có file → null');
{
  const v = readVisionConfig();
  eq(v.baseURL, 'https://api.z.ai/api/coding/paas/v4', 'vision baseURL theo OPENAI_BASE_URL');
  eq(v.model, 'glm-4.5v', 'vision model theo VISION_MODEL');
  eq(v.disableThinking, true, 'vision disableThinking theo env flag');
  const s = readScriptConfig();
  eq(s.baseURL, 'http://localhost:3108/v1', 'script baseURL theo SCRIPT_BASE_URL (back-compat)');
  eq(s.model, 'mock-script', 'script model theo SCRIPT_MODEL');
}

console.log('2. Settings openrouter → đè ENV cho cả 2 stage, không rò param thinking');
writeAiSettings({
  provider: 'openrouter',
  baseURL: '', // rỗng → preset tự điền
  visionModel: 'openai/gpt-4o-mini',
  scriptModel: 'openrouter/auto',
  disableThinking: true, // non-zai → phải bị vô hiệu
} as AiSettings);
process.env.OPENROUTER_API_KEY = 'test-key-openrouter';
{
  const s = readAiSettings();
  eq(s?.baseURL, 'https://openrouter.ai/api/v1', 'baseURL rỗng được điền từ preset');
  const v = readVisionConfig();
  eq(v.baseURL, 'https://openrouter.ai/api/v1', 'vision baseURL theo settings (đè OPENAI_BASE_URL)');
  eq(v.model, 'openai/gpt-4o-mini', 'vision model theo settings');
  eq(v.apiKey === 'test-key-openrouter', true, 'vision key từ OPENROUTER_API_KEY');
  eq(v.disableThinking, false, 'disableThinking vô hiệu với provider non-zai');
  const sc = readScriptConfig();
  eq(sc.baseURL, 'https://openrouter.ai/api/v1', 'script baseURL theo settings (đè SCRIPT_BASE_URL)');
  eq(sc.model, 'openrouter/auto', 'script model theo settings');
  eq(sc.apiKey === 'test-key-openrouter', true, 'script key theo provider (bỏ qua SCRIPT_API_KEY vắng)');
}

console.log('3. Key theo provider: fallback OPENAI_API_KEY, thiếu cả hai → lỗi nêu tên biến');
delete process.env.OPENROUTER_API_KEY;
eq(readVisionConfig().apiKey === 'test-key-openai', true, 'thiếu key riêng → fallback OPENAI_API_KEY');
delete process.env.OPENAI_API_KEY;
throws(() => readVisionConfig(), 'OPENROUTER_API_KEY', 'thiếu mọi key → lỗi nêu OPENROUTER_API_KEY');
throws(() => readScriptConfig(), 'OPENROUTER_API_KEY', 'script cũng lỗi nêu tên biến');
process.env.OPENAI_API_KEY = 'test-key-openai';

console.log('4. Provider z.ai → disableThinking có hiệu lực, model rỗng fallback env');
writeAiSettings({
  provider: 'zai-coding',
  baseURL: '',
  visionModel: '',
  scriptModel: 'glm-4.6',
  disableThinking: true,
} as AiSettings);
process.env.ZAI_API_KEY = 'test-key-zai';
{
  const v = readVisionConfig();
  eq(v.baseURL, 'https://api.z.ai/api/coding/paas/v4', 'zai-coding baseURL preset');
  eq(v.model, 'glm-4.5v', 'visionModel rỗng → fallback VISION_MODEL env');
  eq(v.disableThinking, true, 'disableThinking áp dụng với z.ai');
  eq(v.apiKey === 'test-key-zai', true, 'key từ ZAI_API_KEY');
  eq(readScriptConfig().disableThinking, true, 'script disableThinking áp dụng với z.ai');
}

console.log('5. File hỏng/rỗng → coi như chưa cấu hình, không sập');
writeFileSync(file, 'not-json{{{');
eq(readAiSettings(), null, 'JSON hỏng → null');
writeFileSync(file, '   \n');
eq(readAiSettings(), null, 'file rỗng → null (SETTINGS_FILE=/dev/null dùng được)');
writeFileSync(file, JSON.stringify({ provider: 'nope', baseURL: 'x' }));
eq(readAiSettings(), null, 'provider lạ → null');
writeFileSync(file, JSON.stringify({ provider: 'custom', baseURL: '' }));
eq(readAiSettings(), null, 'custom thiếu baseURL → null');

console.log('6. Round-trip + chuẩn hóa + reset');
writeAiSettings({
  provider: 'custom',
  baseURL: 'http://localhost:9999/v1/', // slash cuối phải bị cắt
  visionModel: ' m1 ',
  scriptModel: 'm2',
  disableThinking: false,
} as AiSettings);
{
  const s = readAiSettings();
  eq(s?.baseURL, 'http://localhost:9999/v1', 'trailing slash bị cắt');
  eq(s?.visionModel, 'm1', 'model được trim');
}
throws(
  () => writeAiSettings({ provider: 'bogus' } as unknown as AiSettings),
  'không hợp lệ',
  'write settings sai shape → ném lỗi',
);
writeAiSettings(null);
eq(existsSync(file), false, 'reset (null) xóa file');
eq(readAiSettings(), null, 'sau reset → ENV thuần');

rmSync(dir, { recursive: true, force: true });
if (failures > 0) {
  console.error(`\nverify-settings: ${failures} lỗi`);
  process.exit(1);
}
console.log('\nverify-settings: OK');
