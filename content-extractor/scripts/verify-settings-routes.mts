// Verify route /api/settings* — gọi TRỰC TIẾP hàm GET/PUT/POST của route (Request/Response
// thuần, không dựng Next server). Upstream giả bằng http server dựng tại chỗ, mỗi test một
// port riêng → cache /models (khóa theo provider+baseURL) không lẫn giữa các test.
//   AC3: GET không bao giờ chứa API key thật ở BẤT KỲ field nào
//   AC4 qua HTTP: lưu → lưu lại không chạm ô key → key không đổi
//   /models chạy cho nhiều provider, upstream lỗi không chặn UI
//   /test phân loại lỗi và gửi ảnh cho stage vision
import http from 'node:http';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { existsSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const dir = mkdtempSync(path.join(os.tmpdir(), 'verify-settings-routes-'));
const file = path.join(dir, '.settings.json');
process.env.SETTINGS_FILE = file;
for (const k of [
  'OPENAI_API_KEY', 'OPENAI_BASE_URL', 'ZAI_API_KEY', 'OPENROUTER_API_KEY',
  'GEMINI_API_KEY', 'DEEPSEEK_API_KEY', 'GROQ_API_KEY', 'MODEL_MAX_TOKENS',
]) {
  delete process.env[k];
}

// Import SAU khi đặt SETTINGS_FILE — route đọc env lúc gọi, nhưng giữ thứ tự cho chắc.
const { GET, PUT } = await import('@/app/api/settings/route');
const { POST: MODELS } = await import('@/app/api/settings/models/route');
const { POST: TEST } = await import('@/app/api/settings/test/route');
const { fetchProviderModels } = await import('@/lib/ai-probe');

let failures = 0;
const eq = (a: unknown, e: unknown, label: string) => {
  if (JSON.stringify(a) === JSON.stringify(e)) console.log(`  ✓ ${label}`);
  else {
    failures++;
    console.error(`  ✗ ${label}\n    expected: ${JSON.stringify(e)}\n    actual:   ${JSON.stringify(a)}`);
  }
};
const ok = (c: boolean, label: string) => eq(c, true, label);

interface Mock {
  url: string;
  bodies: string[];
  paths: string[];
  auth: (string | undefined)[];
  close: () => Promise<void>;
}

// Mock upstream: handler nhận (req, url) và trả [status, jsonBody].
async function startMock(
  handler: (pathname: string, body: string) => [number, unknown],
): Promise<Mock> {
  const bodies: string[] = [];
  const paths: string[] = [];
  const auth: (string | undefined)[] = [];
  const server = http.createServer((req, res) => {
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => {
      const pathname = new URL(req.url ?? '/', 'http://x').pathname;
      paths.push(pathname);
      bodies.push(body);
      auth.push(req.headers.authorization);
      const [status, payload] = handler(pathname, body);
      res.writeHead(status, { 'content-type': 'application/json' });
      res.end(JSON.stringify(payload));
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = (server.address() as { port: number }).port;
  return {
    url: `http://127.0.0.1:${port}`,
    bodies,
    paths,
    auth,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}

const json = (body: unknown, method = 'PUT') =>
  new Request('http://localhost/api/settings', {
    method,
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });

const stage = (over: Record<string, unknown> = {}) => ({
  provider: 'openrouter',
  baseURL: '',
  model: 'openai/gpt-4o-mini',
  apiKey: null,
  disableThinking: false,
  ...over,
});

console.log('1. GET không rò API key — AC3');
{
  const put = await PUT(json({ settings: { vision: stage({ apiKey: 'sk-secret-abcd1234' }), script: null, tts: null } }));
  eq(put.status, 200, 'PUT lưu key → 200');
  const res = await GET();
  const raw = await res.text();
  // Assert trên CHUỖI JSON TOÀN BỘ response, không assert từng field — quên xoá key ở một
  // nhánh DTO nào đó vẫn bị bắt.
  ok(!raw.includes('sk-secret-abcd1234'), 'response GET KHÔNG chứa key thật ở bất kỳ đâu');
  ok(!raw.includes('"apiKey"'), 'DTO không còn khoá apiKey (xoá hẳn, không chỉ mask)');
  const data = JSON.parse(raw);
  eq(data.settings.vision.hasKey, true, 'hasKey = true');
  eq(data.settings.vision.keyMask, '••••1234', 'keyMask lộ đúng 4 ký tự cuối');
}

console.log('2. Key quá ngắn → mask trơn, không lộ ký tự nào');
{
  await PUT(json({ settings: { vision: stage({ apiKey: 'abcd' }), script: null, tts: null } }));
  const data = JSON.parse(await (await GET()).text());
  eq(data.settings.vision.keyMask, '••••', 'key 4 ký tự → •••• trơn');
  ok(!(await (await GET()).text()).includes('abcd'), 'key ngắn cũng không rò');
}

console.log('3. Chưa có key → hasKey false');
{
  await PUT(json({ settings: { vision: stage({ apiKey: '' }), script: null, tts: null } }));
  const data = JSON.parse(await (await GET()).text());
  eq(data.settings.vision.hasKey, false, 'hasKey = false');
  eq(data.settings.vision.keyMask, '', 'keyMask rỗng');
}

console.log('4. Round-trip qua HTTP — AC4');
{
  await PUT(json({ settings: { vision: stage({ apiKey: 'sk-keep-me-9999' }), script: null, tts: null } }));
  // Lưu lại KHÔNG chạm ô key: client gửi apiKey null.
  const res = await PUT(json({ settings: { vision: stage({ model: 'đổi-model', apiKey: null }), script: null, tts: null } }));
  eq(res.status, 200, 'PUT lần 2 → 200');
  const data = JSON.parse(await (await GET()).text());
  eq(data.settings.vision.hasKey, true, 'hasKey vẫn true sau khi lưu lại');
  eq(data.settings.vision.model, 'đổi-model', 'trường khác vẫn cập nhật');
  ok(readFileSync(file, 'utf8').includes('sk-keep-me-9999'), 'file trên đĩa vẫn giữ key cũ');
}

console.log('5. PUT chuỗi mask → 400, không phá key');
{
  const res = await PUT(json({ settings: { vision: stage({ apiKey: '••••9999' }), script: null, tts: null } }));
  eq(res.status, 400, 'PUT mask → 400');
  const err = JSON.parse(await res.text()).error as string;
  ok(/mask/i.test(err), `thông điệp nêu rõ không nhận chuỗi mask (${err.slice(0, 60)})`);
  ok(readFileSync(file, 'utf8').includes('sk-keep-me-9999'), 'key đang lưu không bị hỏng');
}

console.log('6. PUT settings=null → xoá file (nút "Dùng theo ENV")');
{
  const res = await PUT(json({ settings: null }));
  eq(res.status, 200, 'PUT null → 200');
  eq(existsSync(file), false, 'file bị xoá');
  eq(JSON.parse(await (await GET()).text()).settings, null, 'GET trả settings null');
}

console.log('7. PUT body không phải JSON → 400 (giữ hành vi cũ)');
{
  const res = await PUT(
    new Request('http://localhost/api/settings', { method: 'PUT', body: 'không-phải-json' }),
  );
  eq(res.status, 400, 'body rác → 400');
}

console.log('8. GET envKeys phủ mọi biến key của preset');
{
  process.env.GEMINI_API_KEY = 'g';
  const data = JSON.parse(await (await GET()).text());
  eq(data.envKeys.GEMINI_API_KEY, true, 'GEMINI_API_KEY có → true');
  eq(data.envKeys.DEEPSEEK_API_KEY, false, 'DEEPSEEK_API_KEY chưa có → false');
  eq(data.envKeys.GROQ_API_KEY, false, 'GROQ_API_KEY chưa có → false');
  ok(Array.isArray(data.presets) && data.presets.length >= 8, 'presets đi kèm response');
  delete process.env.GEMINI_API_KEY;
}

console.log('9. fetchProviderModels — OpenRouter khai báo được vision thật');
{
  const mock = await startMock(() => [
    200,
    {
      data: [
        { id: 'b/model-text', name: 'Text', architecture: { input_modalities: ['text'] } },
        { id: 'a/model-vision', name: 'Vision', architecture: { input_modalities: ['text', 'image'] } },
      ],
    },
  ]);
  const models = await fetchProviderModels({ provider: 'openrouter', baseURL: mock.url, apiKey: '' });
  eq(models.length, 2, 'lấy đủ model');
  eq(models[0].id, 'a/model-vision', 'sắp xếp theo id');
  eq(models[0].vision, true, 'input_modalities có image → vision true');
  eq(models[1].vision, false, 'chỉ text → vision false');
  eq(mock.paths[0], '/models', 'gọi đúng {baseURL}/models');
  await mock.close();
}

console.log('10. fetchProviderModels — provider thường không biết vision → null');
{
  const mock = await startMock(() => [200, { data: [{ id: 'glm-4.6' }, { id: 'glm-4.5v' }] }]);
  const models = await fetchProviderModels({ provider: 'zai', baseURL: mock.url, apiKey: 'k' });
  eq(models.length, 2, 'lấy đủ model');
  eq(models[0].vision, null, 'không khai báo modality → vision null (= không biết)');
  eq(mock.auth[0], 'Bearer k', 'gửi kèm Authorization: Bearer');
  await mock.close();
}

console.log('11. fetchProviderModels — gửi Authorization, và Google có đường lùi native');
{
  const seen: string[] = [];
  const mock = await startMock((pathname) => {
    seen.push(pathname);
    // Lớp OpenAI-compat của Google có thể không có /models → 404, phải tự lùi về native.
    if (pathname === '/openai/models') return [404, { error: 'not found' }];
    if (pathname === '/models') return [200, { models: [{ name: 'models/gemini-2.5-flash' }] }];
    return [500, {}];
  });
  const models = await fetchProviderModels({
    provider: 'google',
    baseURL: `${mock.url}/openai`,
    apiKey: 'k-google',
  });
  eq(seen, ['/openai/models', '/models'], 'compat 404 → tự lùi về endpoint native');
  eq(models[0].id, 'gemini-2.5-flash', 'bỏ prefix "models/" của Google');
  await mock.close();
}

console.log('12. POST /models — pin baseURL theo preset, upstream lỗi → 502 không throw');
{
  const mock = await startMock(() => [500, { error: 'sập' }]);
  // provider 'custom' là đường duy nhất cho phép baseURL tuỳ ý — preset thì PIN theo preset,
  // nếu không client có thể bảo route gửi key của người dùng tới host bất kỳ.
  const res = await MODELS(json({ provider: 'custom', baseURL: mock.url, apiKey: 'k' }, 'POST'));
  eq(res.status, 502, 'upstream lỗi → 502');
  ok(typeof JSON.parse(await res.text()).error === 'string', 'trả {error}, không throw (UI không bị chặn)');
  await mock.close();
}

console.log('13. POST /models — preset KHÔNG cho client đổi host (chặn rò key)');
{
  const mock = await startMock(() => [200, { data: [{ id: 'x' }] }]);
  const res = await MODELS(
    json({ provider: 'zai', baseURL: `${mock.url}/kẻ-tấn-công`, apiKey: 'k' }, 'POST'),
  );
  // baseURL bị pin về preset z.ai thật → mock không nhận được request nào.
  eq(mock.paths.length, 0, 'request KHÔNG đi tới host do client chỉ định');
  ok(res.status === 200 || res.status === 502, 'route vẫn trả về gọn ghẽ');
  await mock.close();
}

console.log('14. POST /test — phân loại lỗi upstream');
{
  const m401 = await startMock(() => [401, { error: { message: 'invalid api key' } }]);
  const r401 = await TEST(
    json({ stage: 'script', provider: 'custom', baseURL: m401.url, model: 'm', apiKey: 'k' }, 'POST'),
  );
  const b401 = JSON.parse(await r401.text());
  eq(b401.ok, false, '401 → ok:false');
  ok(/key/i.test(b401.message), `thông điệp nhóm "API key sai" (${b401.message})`);
  await m401.close();

  const m400 = await startMock(() => [
    400,
    { error: { message: 'this model does not support image input modality' } },
  ]);
  const r400 = await TEST(
    json({ stage: 'vision', provider: 'custom', baseURL: m400.url, model: 'm', apiKey: 'k' }, 'POST'),
  );
  const b400 = JSON.parse(await r400.text());
  ok(/ảnh/i.test(b400.message), `400 nói về ảnh → thông điệp "không nhận ảnh" (${b400.message})`);
  await m400.close();
}

console.log('15. POST /test — stage vision GỬI KÈM ảnh (bắt lỗi model text-only)');
{
  const mock = await startMock(() => [200, { choices: [{ message: { content: 'ok' } }] }]);
  const res = await TEST(
    json({ stage: 'vision', provider: 'custom', baseURL: mock.url, model: 'm', apiKey: 'k' }, 'POST'),
  );
  eq(JSON.parse(await res.text()).ok, true, 'gọi được → ok:true');
  const sent = JSON.parse(mock.bodies[0]);
  const parts = sent.messages[0].content as Array<{ type: string }>;
  ok(
    parts.some((p) => p.type === 'image_url'),
    'stage vision → body có phần image_url (/models không cho biết model nhận ảnh hay không)',
  );
  eq(sent.max_tokens, 1, 'max_tokens=1 → chi phí xấp xỉ 0');
  await mock.close();

  const mock2 = await startMock(() => [200, { choices: [{ message: { content: 'ok' } }] }]);
  await TEST(
    json({ stage: 'script', provider: 'custom', baseURL: mock2.url, model: 'm', apiKey: 'k' }, 'POST'),
  );
  const sent2 = JSON.parse(mock2.bodies[0]);
  ok(
    !JSON.stringify(sent2).includes('image_url'),
    'stage script → KHÔNG gửi ảnh (model text-only vẫn phải pass)',
  );
  await mock2.close();
}

console.log('17. provider "custom": KHÔNG được rơi về ENV — chặn rút key sang host lạ');
{
  process.env.OPENAI_API_KEY = 'sk-ENV-TOPSECRET';
  await PUT(json({ settings: null }));
  const mock = await startMock(() => [200, { data: [{ id: 'x' }] }]);
  // Host đích do CLIENT chọn. Nếu route tự đính OPENAI_API_KEY vào, một trang web bất kỳ
  // đang mở cùng trình duyệt chỉ cần POST body này là secret bay sang server của họ —
  // họ không cần đọc response (confused deputy).
  await MODELS(json({ provider: 'custom', baseURL: mock.url, apiKey: null }, 'POST'));
  eq(mock.auth[0], undefined, 'custom + apiKey null → KHÔNG gửi Authorization từ ENV');
  // Key người dùng TỰ GÕ thì vẫn dùng — đó là chủ ý của họ.
  await MODELS(json({ provider: 'custom', baseURL: `${mock.url}/v2`, apiKey: 'sk-user-typed' }, 'POST'));
  eq(mock.auth[1], 'Bearer sk-user-typed', 'key người dùng tự gõ vẫn được gửi');
  // Preset thì vẫn fallback ENV bình thường — host đã bị PIN nên không rò đi đâu được.
  await MODELS(json({ provider: 'openrouter', apiKey: null }, 'POST'));
  eq(mock.paths.length, 2, 'preset không đi qua host của client');
  await mock.close();
  delete process.env.OPENAI_API_KEY;
}

console.log('18. Route probe từ chối request cross-site');
{
  const crossSite = (body: unknown) =>
    new Request('http://localhost/api/settings/models', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'sec-fetch-site': 'cross-site' },
      body: JSON.stringify(body),
    });
  eq((await MODELS(crossSite({ provider: 'openrouter' }))).status, 403, '/models cross-site → 403');
  eq(
    (await TEST(crossSite({ stage: 'script', provider: 'openrouter', model: 'm' }))).status,
    403,
    '/test cross-site → 403',
  );
}

console.log('16. Không route nào trả key thô');
{
  await PUT(json({ settings: { vision: stage({ apiKey: 'sk-leak-check-7777' }), script: null, tts: null } }));
  const mock = await startMock(() => [200, { data: [{ id: 'x' }] }]);
  const bodies = [
    await (await GET()).text(),
    await (await MODELS(json({ provider: 'custom', baseURL: mock.url, apiKey: null }, 'POST'))).text(),
    await (
      await TEST(json({ stage: 'script', provider: 'custom', baseURL: mock.url, model: 'm', apiKey: null }, 'POST'))
    ).text(),
  ];
  ok(!bodies.some((b) => b.includes('sk-leak-check-7777')), 'GET/models/test đều không trả key');
  await mock.close();
}

rmSync(dir, { recursive: true, force: true });
if (failures > 0) {
  console.error(`\nverify-settings-routes: ${failures} lỗi`);
  process.exit(1);
}
console.log('\nverify-settings-routes: OK');
