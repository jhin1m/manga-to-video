// Verify catalog provider AI (unit thuần, không fs/mạng):
//   preset đủ trường + baseURL chuẩn hóa (không slash cuối, khớp luật sanitize của settings)
//   thinkingParams: param tắt reasoning ĐÚNG THEO provider, không rò param của provider này
//     sang provider khác (endpoint lạ param → 400)
//   defaultMaxTokens: trần output mặc định chặn bẫy finish_reason=length của model reasoning
//   module là DATA THUẦN — không import node builtin, để client component import trực tiếp
import { readFileSync } from 'node:fs';
import path from 'node:path';
import {
  PROVIDER_PRESETS,
  defaultMaxTokens,
  getPreset,
  thinkingParams,
  type AiProviderId,
} from '../lib/ai-providers';

let failures = 0;
const eq = (a: unknown, e: unknown, label: string) => {
  if (JSON.stringify(a) === JSON.stringify(e)) console.log(`  ✓ ${label}`);
  else {
    failures++;
    console.error(`  ✗ ${label}\n    expected: ${JSON.stringify(e)}\n    actual:   ${JSON.stringify(a)}`);
  }
};
const ok = (c: boolean, label: string) => eq(c, true, label);

console.log('1. Preset đủ trường và chuẩn hóa');
for (const p of PROVIDER_PRESETS) {
  ok(p.keyEnv.length > 0, `${p.id}: có keyEnv (${p.keyEnv})`);
  ok(p.label.length > 0, `${p.id}: có label`);
  if (p.id === 'custom') {
    eq(p.baseURL, '', 'custom: baseURL rỗng (người dùng tự nhập)');
  } else {
    ok(p.baseURL.length > 0, `${p.id}: có baseURL`);
    // sanitize() cắt slash cuối khi lưu — preset phải sẵn ở dạng đã chuẩn hóa, nếu không
    // baseURL preset và baseURL vòng qua file settings sẽ khác chuỗi nhau.
    ok(!p.baseURL.endsWith('/'), `${p.id}: baseURL không có slash cuối`);
  }
}
{
  const ids = PROVIDER_PRESETS.map((p) => p.id);
  eq(new Set(ids).size, ids.length, 'id preset không trùng');
  for (const want of ['google', 'deepseek', 'groq'] as AiProviderId[]) {
    ok(ids.includes(want), `có preset mới "${want}"`);
  }
  // Preset cũ phải còn nguyên — file .settings.json đang dùng của user tham chiếu tới chúng.
  for (const want of ['openai', 'zai', 'zai-coding', 'openrouter', 'custom'] as AiProviderId[]) {
    ok(ids.includes(want), `giữ preset cũ "${want}"`);
  }
  eq(getPreset('nope' as AiProviderId).id, 'openai', 'id lạ → rơi về preset đầu (openai)');
}

console.log('2. Cờ vision — UI cảnh báo khi chọn provider text-only cho stage Vision');
eq(getPreset('deepseek').vision, false, 'deepseek text-only');
eq(getPreset('google').vision, true, 'google nhận ảnh');
eq(getPreset('groq').vision, true, 'groq nhận ảnh');

console.log('3. thinkingParams — đúng provider, không rò sang provider khác');
eq(thinkingParams('zai', true), { thinking: { type: 'disabled' } }, 'zai → thinking.disabled');
eq(thinkingParams('zai-coding', true), { thinking: { type: 'disabled' } }, 'zai-coding → thinking.disabled');
eq(thinkingParams('google', true), { reasoning_effort: 'none' }, 'google → reasoning_effort:none');
eq(thinkingParams('openrouter', true), { reasoning: { exclude: true } }, 'openrouter → reasoning.exclude');
// Giữ tinh thần assertion cũ ở verify-settings case 2: param GLM KHÔNG được lọt sang OpenAI.
eq(thinkingParams('openai', true), {}, 'openai → {} (không rò param GLM)');
eq(thinkingParams('deepseek', true), {}, 'deepseek → {}');
eq(thinkingParams('groq', true), {}, 'groq → {}');
eq(thinkingParams('custom', true), {}, 'custom → {} (không đoán quirk endpoint lạ)');
for (const p of PROVIDER_PRESETS) {
  eq(thinkingParams(p.id, false), {}, `${p.id}: disable=false → {} (không gửi param nào)`);
}

console.log('4. defaultMaxTokens — chặn finish_reason=length của model reasoning');
eq(defaultMaxTokens('google'), 16384, 'google = 16384');
eq(defaultMaxTokens('zai'), 16384, 'zai = 16384');
eq(defaultMaxTokens('zai-coding'), 16384, 'zai-coding = 16384');
eq(defaultMaxTokens('openai'), undefined, 'openai = undefined (giữ mặc định endpoint)');
eq(defaultMaxTokens('openrouter'), undefined, 'openrouter = undefined');
eq(defaultMaxTokens('custom'), undefined, 'custom = undefined');

console.log('5. Module là data thuần — client component import trực tiếp được');
{
  const raw = readFileSync(path.join(process.cwd(), 'lib', 'ai-providers.ts'), 'utf8');
  // Bỏ comment trước khi soi: comment nói VỀ process.env/node: không phải là dùng chúng.
  const src = raw.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  ok(!/from\s+'node:/.test(src), 'không import node builtin');
  ok(!/\bprocess\.env\b/.test(src), 'không đọc process.env (server-only leak vào bundle client)');
  // Chỉ `import type` được phép: import giá trị kéo theo runtime dependency vào client bundle.
  const valueImports = src.match(/^import\s+(?!type\b)/gm) ?? [];
  eq(valueImports.length, 0, 'chỉ dùng `import type`, không import giá trị');
}

if (failures > 0) {
  console.error(`\nverify-ai-providers: ${failures} lỗi`);
  process.exit(1);
}
console.log('\nverify-ai-providers: OK');
