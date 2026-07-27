// Verify cấu hình AI từ Settings UI (unit, không server, không mạng):
//   luật ưu tiên settings > ENV cho vision + script; không settings → ENV thuần y cũ
//   key: lưu trong settings thắng ENV; rỗng → ENV theo provider, fallback OPENAI_API_KEY
//   sentinel apiKey 3 trạng thái khi ghi (null=giữ, ""=xoá, chuỗi=key mới); chặn chuỗi mask
//   migration file v1 (shape phẳng) → v2 (lồng vision/script/tts), đọc KHÔNG ghi đè file
//   disableThinking chỉ áp với provider z.ai (không rò param GLM sang provider khác)
//   file hỏng/rỗng = chưa cấu hình; write/read round-trip; reset (null) xóa file; mode 0o600
import { chmodSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { existsSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  readAiSettings,
  resolveApiKey,
  stageConfig,
  writeAiSettings,
  type StageConfig,
} from '../lib/settings';
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

// Helper dựng StageConfig cho test — baseURL '' để preset tự điền (trừ custom).
const stage = (over: Omit<Partial<StageConfig>, 'apiKey'> & { apiKey?: string | null }) => ({
  provider: 'openrouter' as const,
  baseURL: '',
  model: 'm',
  apiKey: null as string | null,
  disableThinking: false,
  ...over,
});

// Env nền kiểm soát được: xóa mọi biến liên quan rồi đặt lại theo từng case.
for (const k of [
  'OPENAI_API_KEY', 'OPENAI_BASE_URL', 'VISION_MODEL', 'VISION_DISABLE_THINKING',
  'ZAI_API_KEY', 'OPENROUTER_API_KEY', 'GEMINI_API_KEY', 'MODEL_MAX_TOKENS',
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
  // CỐ Ý ĐỔI (chỉ dạng, không đổi hành vi): cờ boolean disableThinking → extraParams tính sẵn.
  // Nhánh ENV suy provider từ baseURL CHỈ để chọn dạng param — z.ai vẫn ra đúng param GLM cũ.
  eq(v.extraParams, { thinking: { type: 'disabled' } }, 'vision extraParams theo VISION_DISABLE_THINKING');
  const s = readScriptConfig();
  eq(s.baseURL, 'http://localhost:3108/v1', 'script baseURL theo SCRIPT_BASE_URL (back-compat)');
  eq(s.model, 'mock-script', 'script model theo SCRIPT_MODEL');
}

console.log('2. Settings openrouter → đè ENV cho cả 2 stage, không rò param thinking');
// CỐ Ý ĐỔI: shape v1 phẳng → v2 lồng (vision/script/tts). Nội dung assertion giữ nguyên.
writeAiSettings({
  vision: stage({ provider: 'openrouter', model: 'openai/gpt-4o-mini', disableThinking: true }),
  script: stage({ provider: 'openrouter', model: 'openrouter/auto', disableThinking: true }),
  tts: null,
});
process.env.OPENROUTER_API_KEY = 'test-key-openrouter';
{
  const s = readAiSettings();
  eq(s?.vision.baseURL, 'https://openrouter.ai/api/v1', 'baseURL rỗng được điền từ preset');
  const v = readVisionConfig();
  eq(v.baseURL, 'https://openrouter.ai/api/v1', 'vision baseURL theo settings (đè OPENAI_BASE_URL)');
  eq(v.model, 'openai/gpt-4o-mini', 'vision model theo settings');
  eq(v.apiKey === 'test-key-openrouter', true, 'vision key từ OPENROUTER_API_KEY');
  // CỐ Ý ĐỔI: trước đây cờ bị ép về false với mọi provider non-zai (param GLM là thứ duy
  // nhất biết gửi). Nay mỗi provider có dạng param riêng — OpenRouter tắt reasoning bằng
  // {reasoning:{exclude:true}}. Tinh thần cũ "không rò param GLM sang provider khác" vẫn
  // được giữ, kiểm ở mục 14.
  eq(v.extraParams, { reasoning: { exclude: true } }, 'openrouter dùng param reasoning.exclude');
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
// CỐ Ý ĐỔI: shape v2. `script` riêng thay cho trường scriptModel phẳng.
writeAiSettings({
  vision: stage({ provider: 'zai-coding', model: '', disableThinking: true }),
  script: stage({ provider: 'zai-coding', model: 'glm-4.6', disableThinking: true }),
  tts: null,
});
process.env.ZAI_API_KEY = 'test-key-zai';
{
  const v = readVisionConfig();
  eq(v.baseURL, 'https://api.z.ai/api/coding/paas/v4', 'zai-coding baseURL preset');
  eq(v.model, 'glm-4.5v', 'model rỗng → fallback VISION_MODEL env');
  // CỐ Ý ĐỔI (chỉ dạng): cờ boolean → extraParams. Có settings thì trần token mặc định
  // theo provider cũng vào đây (z.ai = 16384, chặn finish_reason=length).
  eq(
    v.extraParams,
    { thinking: { type: 'disabled' }, max_tokens: 16384 },
    'z.ai: param tắt thinking + trần token mặc định',
  );
  eq(v.apiKey === 'test-key-zai', true, 'key từ ZAI_API_KEY');
  eq(
    readScriptConfig().extraParams,
    { thinking: { type: 'disabled' }, max_tokens: 16384 },
    'script cũng nhận extraParams của z.ai',
  );
}

console.log('5. File hỏng/rỗng → coi như chưa cấu hình, không sập');
writeFileSync(file, 'not-json{{{');
eq(readAiSettings(), null, 'JSON hỏng → null');
writeFileSync(file, '   \n');
eq(readAiSettings(), null, 'file rỗng → null (SETTINGS_FILE=/dev/null dùng được)');
writeFileSync(file, JSON.stringify({ version: 2, vision: { provider: 'nope', baseURL: 'x' } }));
eq(readAiSettings(), null, 'provider lạ → null');
writeFileSync(file, JSON.stringify({ version: 2, vision: { provider: 'custom', baseURL: '' } }));
eq(readAiSettings(), null, 'custom thiếu baseURL → null');
writeFileSync(
  file,
  // script CÓ MẶT nhưng hỏng → cả file coi như hỏng, KHÔNG âm thầm rơi về "dùng chung vision"
  // (rơi về dùng chung sẽ chạy biên kịch bằng provider khác cái người dùng đã chọn).
  JSON.stringify({
    version: 2,
    vision: { provider: 'openrouter', baseURL: '', model: 'm' },
    script: { provider: 'nope' },
  }),
);
eq(readAiSettings(), null, 'script có mặt nhưng hỏng → null (không âm thầm dùng chung)');

console.log('6. Round-trip + chuẩn hóa + reset');
writeAiSettings({
  vision: stage({ provider: 'custom', baseURL: 'http://localhost:9999/v1/', model: ' m1 ' }),
  script: stage({ provider: 'custom', baseURL: 'http://localhost:9999/v1/', model: 'm2' }),
  tts: null,
});
{
  const s = readAiSettings();
  eq(s?.vision.baseURL, 'http://localhost:9999/v1', 'trailing slash bị cắt');
  eq(s?.vision.model, 'm1', 'model được trim');
}
throws(
  () => writeAiSettings({ provider: 'bogus' } as never),
  'không hợp lệ',
  'write settings sai shape → ném lỗi',
);
writeAiSettings(null);
eq(existsSync(file), false, 'reset (null) xóa file');
eq(readAiSettings(), null, 'sau reset → ENV thuần');

console.log('7. Migration file v1 (shape phẳng) → v2 — AC6');
writeFileSync(
  file,
  JSON.stringify({
    provider: 'zai-coding',
    baseURL: 'https://api.z.ai/api/coding/paas/v4',
    visionModel: 'glm-4.5v',
    scriptModel: 'glm-4.6',
    disableThinking: true,
  }),
);
{
  const s = readAiSettings();
  eq(s?.version, 2, 'file v1 đọc ra v2');
  eq(s?.vision.provider, 'zai-coding', 'vision provider giữ nguyên');
  eq(s?.vision.model, 'glm-4.5v', 'visionModel → vision.model');
  eq(s?.vision.disableThinking, true, 'disableThinking giữ nguyên');
  eq(s?.vision.apiKey, '', 'v1 không có key → rỗng (fallback ENV)');
  eq(s?.script?.provider, 'zai-coding', 'script thừa hưởng provider của v1');
  eq(s?.script?.model, 'glm-4.6', 'scriptModel → script.model');
  eq(s?.tts, null, 'v1 không có tts');
  // Đọc là thao tác CHỈ-ĐỌC: không tự nâng cấp file trên đĩa (side effect bất ngờ).
  eq(JSON.parse(readFileSync(file, 'utf8')).version, undefined, 'đọc KHÔNG ghi đè file v1');
}
writeFileSync(
  file,
  JSON.stringify({ provider: 'openrouter', baseURL: '', visionModel: 'v', scriptModel: '', disableThinking: false }),
);
{
  // v1 scriptModel rỗng KHÔNG được migrate thành script:null. Ở v1 rỗng = rơi về SCRIPT_MODEL
  // env; null ở v2 = dùng y model của vision. Migrate sang null sẽ đổi model biên kịch của
  // file v1 đang chạy — đúng thứ AC6 cấm.
  const s = readAiSettings();
  eq(s?.script?.model, '', 'v1 scriptModel rỗng → script.model rỗng (giữ fallback SCRIPT_MODEL)');
  eq(s?.script?.provider, 'openrouter', 'script vẫn thừa hưởng provider của vision');
  process.env.SCRIPT_MODEL = 'env-script-model';
  eq(readScriptConfig().model, 'env-script-model', 'biên kịch vẫn chạy SCRIPT_MODEL y như v1');
  delete process.env.SCRIPT_MODEL;
}

console.log('8. Sentinel apiKey 3 trạng thái — AC4');
writeAiSettings({
  vision: stage({ provider: 'openrouter', model: 'm', apiKey: 'sk-real-123' }),
  script: null,
  tts: null,
});
eq(readAiSettings()?.vision.apiKey, 'sk-real-123', 'key mới được lưu');
writeAiSettings({
  vision: stage({ provider: 'openrouter', model: 'm2', apiKey: null }),
  script: null,
  tts: null,
});
eq(readAiSettings()?.vision.apiKey, 'sk-real-123', 'apiKey null → GIỮ NGUYÊN key cũ (AC4)');
eq(readAiSettings()?.vision.model, 'm2', 'trường khác vẫn cập nhật bình thường');
throws(
  () =>
    writeAiSettings({
      vision: stage({ provider: 'openrouter', model: 'm', apiKey: '••••1234' }),
      script: null,
      tts: null,
    }),
  'mask',
  'chuỗi mask bị từ chối (chặn client lỡ gửi lại placeholder)',
);
eq(readAiSettings()?.vision.apiKey, 'sk-real-123', 'lần ghi bị từ chối không làm hỏng key đang lưu');
writeAiSettings({
  vision: stage({ provider: 'openrouter', model: 'm', apiKey: '' }),
  script: null,
  tts: null,
});
eq(readAiSettings()?.vision.apiKey, '', 'apiKey "" → xoá key, rơi về ENV');

console.log('9. script tách khỏi vision thừa kế key đang có hiệu lực');
writeAiSettings({
  vision: stage({ provider: 'openrouter', model: 'm', apiKey: 'sk-shared' }),
  script: null,
  tts: null,
});
writeAiSettings({
  // Bỏ tick "dùng chung": script thành config riêng, UI gửi apiKey null (người dùng không gõ).
  vision: stage({ provider: 'openrouter', model: 'm', apiKey: null }),
  script: stage({ provider: 'openrouter', model: 'm-script', apiKey: null }),
  tts: null,
});
eq(readAiSettings()?.script?.apiKey, 'sk-shared', 'script mới thừa kế key vision đang dùng');

console.log('10. tts round-trip + sentinel');
writeAiSettings({
  vision: stage({ provider: 'openrouter', model: 'm', apiKey: null }),
  script: null,
  tts: { provider: 'elevenlabs', voiceId: 'v1', model: 'eleven_multilingual_v2', apiKey: 'el-key' },
});
eq(readAiSettings()?.tts?.apiKey, 'el-key', 'tts key được lưu');
writeAiSettings({
  vision: stage({ provider: 'openrouter', model: 'm', apiKey: null }),
  script: null,
  tts: { provider: 'elevenlabs', voiceId: 'v2', model: 'eleven_multilingual_v2', apiKey: null },
});
eq(readAiSettings()?.tts?.apiKey, 'el-key', 'tts apiKey null → giữ key cũ');
eq(readAiSettings()?.tts?.voiceId, 'v2', 'tts voiceId vẫn cập nhật');

console.log('11. stageConfig — script null nghĩa là dùng chung vision');
{
  writeAiSettings({
    vision: stage({ provider: 'zai-coding', model: 'glm-4.5v', apiKey: 'k-vision' }),
    script: null,
    tts: null,
  });
  const s = readAiSettings()!;
  eq(stageConfig(s, 'script'), s.vision, 'script null → stageConfig trả đúng config vision');
  eq(stageConfig(s, 'vision'), s.vision, 'stage vision → config vision');
  writeAiSettings({
    vision: stage({ provider: 'zai-coding', model: 'glm-4.5v', apiKey: null }),
    script: stage({ provider: 'google', model: 'gemini-2.5-flash', apiKey: 'k-script' }),
    tts: null,
  });
  const s2 = readAiSettings()!;
  eq(stageConfig(s2, 'script').provider, 'google', 'có script riêng → trả config script');
  eq(stageConfig(s2, 'vision').provider, 'zai-coding', 'vision không bị ảnh hưởng');
}

console.log('12. resolveApiKey — key trong settings thắng ENV');
{
  process.env.OPENROUTER_API_KEY = 'env-openrouter';
  const withKey = stage({ provider: 'openrouter', apiKey: 'file-key' }) as StageConfig;
  const noKey = stage({ provider: 'openrouter', apiKey: '' }) as StageConfig;
  eq(resolveApiKey(withKey).apiKey, 'file-key', 'key lưu trong settings thắng ENV');
  eq(resolveApiKey(withKey).keyEnv, 'OPENROUTER_API_KEY', 'keyEnv theo provider');
  eq(resolveApiKey(noKey).apiKey, 'env-openrouter', 'key rỗng → ENV theo provider');
  delete process.env.OPENROUTER_API_KEY;
  eq(resolveApiKey(noKey).apiKey, 'test-key-openai', 'thiếu ENV riêng → OPENAI_API_KEY');
  delete process.env.OPENAI_API_KEY;
  eq(resolveApiKey(noKey).apiKey, '', 'thiếu tất cả → rỗng (caller ném lỗi nêu keyEnv)');
  process.env.OPENAI_API_KEY = 'test-key-openai';
}

console.log('13. Quyền file 0o600 — file chứa API key, không để người dùng khác đọc');
writeAiSettings({
  vision: stage({ provider: 'openrouter', model: 'm', apiKey: 'sk-secret' }),
  script: null,
  tts: null,
});
eq(statSync(file).mode & 0o777, 0o600, 'file mới ghi có mode 0o600');
chmodSync(file, 0o644);
writeAiSettings({
  vision: stage({ provider: 'openrouter', model: 'm', apiKey: null }),
  script: null,
  tts: null,
});
eq(statSync(file).mode & 0o777, 0o600, 'file đã tồn tại mode 0o644 → chmod về 0o600');

console.log('14. Vision ≠ Biên kịch: 2 provider, 2 host, 2 key — AC2');
{
  process.env.ZAI_API_KEY = 'key-zai';
  process.env.GEMINI_API_KEY = 'key-gemini';
  writeAiSettings({
    vision: stage({ provider: 'zai-coding', model: 'glm-4.5v', apiKey: '' }),
    script: stage({ provider: 'google', model: 'gemini-2.5-flash', apiKey: '' }),
    tts: null,
  });
  const v = readVisionConfig();
  const s = readScriptConfig();
  eq(v.baseURL, 'https://api.z.ai/api/coding/paas/v4', 'vision đi host z.ai');
  eq(s.baseURL, 'https://generativelanguage.googleapis.com/v1beta/openai', 'script đi host Google');
  ok(v.baseURL !== s.baseURL, '2 stage ra 2 host KHÁC NHAU');
  eq(v.apiKey, 'key-zai', 'vision lấy ZAI_API_KEY');
  eq(s.apiKey, 'key-gemini', 'script lấy GEMINI_API_KEY');
  eq(v.model, 'glm-4.5v', 'vision model riêng');
  eq(s.model, 'gemini-2.5-flash', 'script model riêng');
}

console.log('15. script null → biên kịch dùng y cấu hình vision, model rơi về SCRIPT_MODEL');
{
  process.env.SCRIPT_MODEL = 'env-script-model';
  writeAiSettings({
    vision: stage({ provider: 'zai-coding', model: 'glm-4.5v', apiKey: 'k-shared' }),
    script: null,
    tts: null,
  });
  {
    const v = readVisionConfig();
    const s = readScriptConfig();
    eq(s.baseURL, v.baseURL, 'script dùng chung baseURL vision');
    eq(s.apiKey, v.apiKey, 'script dùng chung key vision');
    // "Dùng chung" là dùng chung TẤT CẢ, kể cả model — không lén rơi về SCRIPT_MODEL env.
    eq(s.model, 'glm-4.5v', 'script dùng chung cả model vision');
  }
  // Chỉ khi model vision cũng rỗng thì mới rơi về SCRIPT_MODEL env.
  writeAiSettings({
    vision: stage({ provider: 'zai-coding', model: '', apiKey: 'k-shared' }),
    script: null,
    tts: null,
  });
  eq(readScriptConfig().model, 'env-script-model', 'cả hai rỗng → fallback SCRIPT_MODEL');
  delete process.env.SCRIPT_MODEL;
}

console.log('16. extraParams — đúng provider, không rò param sang provider khác');
{
  const paramsFor = (provider: 'zai-coding' | 'google' | 'openai', disableThinking: boolean) => {
    writeAiSettings({
      vision: stage({ provider, model: 'm', apiKey: 'k', disableThinking }),
      script: null,
      tts: null,
    });
    return readVisionConfig().extraParams as Record<string, unknown>;
  };
  {
    const p = paramsFor('zai-coding', true);
    ok('thinking' in p, 'z.ai có param thinking');
    ok(!('reasoning_effort' in p), 'z.ai KHÔNG rò reasoning_effort của Google');
  }
  {
    const p = paramsFor('google', true);
    eq(p.reasoning_effort, 'none', 'google có reasoning_effort:none');
    ok(!('thinking' in p), 'google KHÔNG rò param thinking của GLM');
  }
  {
    const p = paramsFor('openai', true);
    ok(!('thinking' in p), 'openai KHÔNG nhận param thinking');
    ok(!('reasoning_effort' in p), 'openai KHÔNG nhận reasoning_effort');
  }
}

console.log('17. max_tokens — ENV thắng, ENV trống thì mặc định theo provider');
{
  const maxTokensFor = (provider: 'google' | 'openai' | 'zai-coding') => {
    writeAiSettings({
      vision: stage({ provider, model: 'm', apiKey: 'k' }),
      script: null,
      tts: null,
    });
    return readVisionConfig().extraParams as Record<string, unknown>;
  };
  process.env.MODEL_MAX_TOKENS = '4096';
  eq(maxTokensFor('google').max_tokens, 4096, 'ENV MODEL_MAX_TOKENS thắng mặc định provider');
  eq(maxTokensFor('openai').max_tokens, 4096, 'ENV áp cho cả provider không có mặc định');
  delete process.env.MODEL_MAX_TOKENS;
  eq(maxTokensFor('google').max_tokens, 16384, 'ENV trống + google → 16384');
  eq(maxTokensFor('zai-coding').max_tokens, 16384, 'ENV trống + z.ai → 16384');
  ok(!('max_tokens' in maxTokensFor('openai')), 'ENV trống + openai → KHÔNG có khoá max_tokens');
}

console.log('18. Nhánh ENV thuần: KHÔNG đổi một chữ nào so với trước');
{
  writeAiSettings(null);
  process.env.OPENAI_BASE_URL = 'https://api.z.ai/api/coding/paas/v4';
  process.env.OPENAI_API_KEY = 'test-key-openai';
  // Áp thêm trần token mặc định ở đây sẽ đổi hành vi của người đang chạy ENV thuần.
  ok(!('max_tokens' in readVisionConfig().extraParams), 'ENV thuần + z.ai → không tự áp 16384');
  process.env.MODEL_MAX_TOKENS = '2048';
  eq(readVisionConfig().extraParams.max_tokens, 2048, 'ENV thuần vẫn nghe MODEL_MAX_TOKENS');
  delete process.env.MODEL_MAX_TOKENS;
  // Cờ *_DISABLE_THINKING của nhánh ENV trước đây gửi thẳng param GLM BẤT KỂ endpoint nào.
  // Suy provider từ chuỗi host sẽ NUỐT param với endpoint GLM không nằm ở api.z.ai
  // (open.bigmodel.cn, proxy nội bộ) → người dùng mất ~50% token tiết kiệm mà không có lỗi.
  process.env.OPENAI_BASE_URL = 'https://open.bigmodel.cn/api/paas/v4';
  eq(
    readVisionConfig().extraParams,
    { thinking: { type: 'disabled' } },
    'ENV thuần: cờ bật → gửi param GLM kể cả host không phải api.z.ai (y hệt trước)',
  );
  process.env.OPENAI_BASE_URL = 'https://api.z.ai/api/coding/paas/v4';
}

console.log('19. Key THUỘC VỀ provider — đổi provider không được thừa kế key nhà khác');
{
  process.env.ZAI_API_KEY = 'key-zai';
  process.env.GEMINI_API_KEY = 'key-gemini';
  writeAiSettings({
    vision: stage({ provider: 'zai', model: 'glm-4.5v', apiKey: 'sk-ZAI-SECRET' }),
    script: null,
    tts: null,
  });
  // Đổi nhà cung cấp mà không gõ lại ô key: UI gửi apiKey null. Thừa kế ở đây sẽ GỬI secret
  // của z.ai sang Google, và vì cfg.apiKey khác rỗng nên không bao giờ rơi về GEMINI_API_KEY.
  writeAiSettings({
    vision: stage({ provider: 'google', model: 'gemini-2.5-flash', apiKey: null }),
    script: null,
    tts: null,
  });
  eq(readAiSettings()?.vision.apiKey, '', 'đổi provider + apiKey null → KHÔNG thừa kế key nhà cũ');
  eq(readVisionConfig().apiKey, 'key-gemini', 'rơi đúng về GEMINI_API_KEY của provider mới');

  // Ngược lại: cùng provider thì vẫn giữ key (AC4 không được vỡ vì bản vá này).
  writeAiSettings({
    vision: stage({ provider: 'google', model: 'gemini-2.5-pro', apiKey: 'sk-GOOGLE' }),
    script: null,
    tts: null,
  });
  writeAiSettings({
    vision: stage({ provider: 'google', model: 'gemini-2.5-flash', apiKey: null }),
    script: null,
    tts: null,
  });
  eq(readAiSettings()?.vision.apiKey, 'sk-GOOGLE', 'cùng provider + apiKey null → vẫn giữ key');
}

console.log('20. Tách script khỏi vision: thừa kế key CHỈ khi cùng provider — AC2');
{
  writeAiSettings({
    vision: stage({ provider: 'zai', model: 'glm-4.5v', apiKey: 'sk-ZAI-SECRET' }),
    script: null,
    tts: null,
  });
  // Bỏ tick "dùng chung" + chọn nhà cung cấp KHÁC cho biên kịch — đây chính là AC2.
  writeAiSettings({
    vision: stage({ provider: 'zai', model: 'glm-4.5v', apiKey: null }),
    script: stage({ provider: 'google', model: 'gemini-2.5-flash', apiKey: null }),
    tts: null,
  });
  eq(readAiSettings()?.script?.apiKey, '', 'script khác provider → KHÔNG thừa kế key vision');
  eq(readScriptConfig().apiKey, 'key-gemini', 'script dùng đúng GEMINI_API_KEY');
  eq(readVisionConfig().apiKey, 'sk-ZAI-SECRET', 'vision vẫn giữ key của nó');

  // Cùng provider thì thừa kế như thiết kế (bỏ tick không làm gãy cấu hình đang chạy).
  writeAiSettings({
    vision: stage({ provider: 'zai', model: 'glm-4.5v', apiKey: null }),
    script: stage({ provider: 'zai', model: 'glm-4.6', apiKey: null }),
    tts: null,
  });
  eq(readAiSettings()?.script?.apiKey, 'sk-ZAI-SECRET', 'script cùng provider → vẫn thừa kế');
}

console.log('21. tts: đổi nhà cung cấp không để lại key mồ côi');
{
  writeAiSettings({
    vision: stage({ provider: 'zai', model: 'm', apiKey: null }),
    script: null,
    tts: { provider: 'elevenlabs', voiceId: 'v', model: '', apiKey: 'el-SECRET' },
  });
  writeAiSettings({
    vision: stage({ provider: 'zai', model: 'm', apiKey: null }),
    script: null,
    // UI ẩn ô key khi provider là capcut → không có cách nào gõ '' để xoá. Nếu thừa kế mù,
    // key ElevenLabs nằm lại trong file vĩnh viễn.
    tts: { provider: 'capcut', voiceId: 'BV562_streaming', model: '', apiKey: null },
  });
  eq(readAiSettings()?.tts?.apiKey, '', 'đổi provider TTS → key nhà cũ bị bỏ, không mồ côi');
  delete process.env.GEMINI_API_KEY;
}

rmSync(dir, { recursive: true, force: true });
if (failures > 0) {
  console.error(`\nverify-settings: ${failures} lỗi`);
  process.exit(1);
}
console.log('\nverify-settings: OK');
