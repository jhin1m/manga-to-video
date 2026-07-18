import { constants, createHash, publicEncrypt, randomBytes, randomInt, randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { withRetry } from '../vision';
import { CAPCUT_VOICES, PROVIDER_LABELS } from './catalog';
import type { TtsConfig, TtsProvider } from './types';

// Provider CapCut TTS — port thuần TypeScript từ K07VN/capcut-tts-api (Python), API nội bộ
// reverse-engineered, free, có giọng Việt. Signing (MD5 + RSA PKCS#1 v1.5) bằng node:crypto,
// KHÔNG runtime Python, KHÔNG dependency mới. Parser response theo mẫu THẬT capture ở Phase 1
// (reports/capcut-response-samples.md). Toàn bộ flow async (new → poll → download) gói trong
// synth(); bên ngoài không biết gì về task/token. CapCut là API unofficial — có thể ngừng
// hoạt động; lỗi luôn kèm gợi ý đổi TTS_PROVIDER=elevenlabs (không auto-fallback).

const DEFAULT_BASE_URL = 'https://editor-api-sg.capcutapi.com';
const DEFAULT_VOICE = 'BV074_streaming';
const DEFAULT_RESOURCE_ID = '7102355709945188865';
const DEFAULT_POLL_INTERVAL_MS = 1500;
const DEFAULT_TOTAL_TIMEOUT_MS = 120_000; // khớp AbortSignal ElevenLabs
const REQUEST_TIMEOUT_MS = 30_000;

// Đọc số dương từ env, không hợp lệ → default. Cho phép mock/test rút ngắn nhịp poll và
// timeout (khớp cách CAPCUT_BASE_URL đổi endpoint khi test); ops cũng tinh chỉnh được.
function envInt(name: string, fallback: number): number {
  const n = Number(process.env[name]);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

// Device profile mặc định (từ repo nguồn) — chỉ là BASE cho các field app-level (aid, app version…).
// Ba field định danh máy device_id/tdid/iid dưới đây KHÔNG dùng nguyên: chúng bị ByteDance Shark
// risk-control chặn "shark block only" (ret=-6) vì cả cộng đồng xài chung một device. loadDevice()
// thay chúng bằng identity ngẫu nhiên persist ở .cache/capcut-device.json. Override qua
// CAPCUT_DEVICE_JSON (path file JSON) vẫn thắng tất cả.
const DEFAULT_DEVICE: Record<string, string> = {
  aid: '359289',
  app_name: 'CapCut',
  appvr: '8.7.0',
  version_name: '8.7.0',
  version_code: '8.7.0',
  channel: 'capcutpc_google',
  device_platform: 'mac',
  device_type: 'MacBookPro17,1',
  device_brand: 'MacBookPro17,1',
  os_version: '15.7.4',
  device_id: '7647183892936328721',
  iid: '7647185302080423697',
  region: 'VN',
  loc: 'VN',
  lan: 'vi-VN',
  pf: '3',
  tdid: '7647183892936328721',
};

// Public key nhúng (từ repo nguồn) — dùng để RSA-encrypt sign-string của payload TTS.
const TTS_SIGN_PUBLIC_KEY_PEM = `-----BEGIN PUBLIC KEY-----
MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEAmTd34Lw4b7IuldSXh/zY
CMla+ITdGG5TeWz6ad+OySd4r+IrY45AoqrYUxhQ2dl+7z+i7r/5vEa8rr39BYfB
8AGMQLmZA8HmgpWBsqrn/V6daUALkKnkLb70Fn32CJigIuGXAYqxUdGuI340aC+0
v5Es3puJsHyzf01/AelE4Cdc6bZhQrASJLBh8R3BQToYClmDVSDUQk28o8sl/guA
Z4n303Vj+6Siv1HayPCdV6kpVVnMBAG4+umUbwGmn132N3fgpzLarFF3XyWmS1zh
D/J07iM/rP8GDO9IskHNHd2phrO0G6KzrcFAnTBHjVv+hCBEfzN/no3FNA9AuC36
mwIDAQAB
-----END PUBLIC KEY-----`;

// Catalog giọng Việt (CAPCUT_VOICES) sống ở ./catalog — dữ liệu thuần dùng chung với UI.

const HINT = 'Đổi TTS_PROVIDER=elevenlabs nếu CapCut không dùng được.';

// ==== Helpers signing (thuần hàm, unit-testable) ====

function compactJson(obj: unknown): string {
  // Khớp compact_json Python (separators no-space, giữ UTF-8) — JSON.stringify mặc định
  // cũng không thêm space và giữ nguyên UTF-8.
  return JSON.stringify(obj);
}

function md5Hex(input: string): string {
  return createHash('md5').update(input, 'utf8').digest('hex');
}

function escapeXml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function buildSsml(text: string, voice: string, resourceId: string, rate: string): string {
  const voiceBlock =
    `    <voice name="${voice}" mock_tone_info="" platform="sami" ` +
    `resource_id="${resourceId}" emotion="" emotion_scale="0" style="" role="" ` +
    `moyin_emotion="" is_clone_tone="false" need_subtitle_timestamp="false">\n` +
    `        <prosody rate="${rate}">${escapeXml(text)}</prosody>\n` +
    `    </voice>`;
  return (
    '<speak version="1.0" xmlns="http://www.w3.org/2001/10/synthesis" xml:lang="en-US">\n' +
    voiceBlock +
    '\n</speak>'
  );
}

// RSA encrypt PKCS#1 v1.5 (type 2, padding ngẫu nhiên) bằng public key nhúng → base64.
// node publicEncrypt + RSA_PKCS1_PADDING = RSAES-PKCS1-v1_5, khớp rsa_encrypt_pkcs1v15 Python.
function rsaSign(signInput: string): string {
  return publicEncrypt(
    { key: TTS_SIGN_PUBLIC_KEY_PEM, padding: constants.RSA_PKCS1_PADDING },
    Buffer.from(signInput, 'utf8'),
  ).toString('base64');
}

function payloadSign(ssml: string, extraInfo: string, deviceId: string, appId: string): string {
  const signInput =
    `appid:${appId}&did:${deviceId}&creditDisable:false&ssml:${md5Hex(ssml)}&extraInfo:${extraInfo}`;
  return rsaSign(signInput);
}

// x-ss-stub = MD5 của chính body text gửi đi (hex lowercase).
function xSsStub(bodyText: string): string {
  return md5Hex(bodyText);
}

// sign header = MD5("9e2c|{7 ký tự cuối của path không gồm query}|3|{appvr}|{deviceTime}|{tdid}|11ac").
function signHeader(path: string, appvr: string, deviceTime: string, tdid: string): string {
  const clean = path.split('?')[0];
  return md5Hex(`9e2c|${clean.slice(-7)}|3|${appvr}|${deviceTime}|${tdid}|11ac`);
}

function traceId(): string {
  const seed = randomBytes(16).toString('hex'); // 32 hex chars
  return `00-${seed}-${seed.slice(0, 16)}-01`;
}

// ==== Request building ====

interface CapcutRequest {
  url: string;
  headers: Record<string, string>;
  bodyText: string;
}

function commonQuery(
  device: Record<string, string>,
  babiParam: unknown | null,
  includeRegion: boolean,
): string {
  const q: Record<string, string> = {
    app_name: device.app_name,
    device_type: device.device_type,
    os_version: device.os_version,
    channel: device.channel,
    version_name: device.version_name,
    device_brand: device.device_brand,
    device_id: device.device_id,
    iid: device.iid,
    version_code: device.version_code,
    device_platform: device.device_platform,
    aid: device.aid,
  };
  if (includeRegion) q.region = device.region;
  if (babiParam !== null) q.babi_param = compactJson(babiParam);
  return new URLSearchParams(q).toString();
}

function baseHeaders(
  device: Record<string, string>,
  bodyText: string,
  appid: boolean,
): Record<string, string> {
  const now = String(Math.floor(Date.now() / 1000));
  const headers: Record<string, string> = {
    'content-type': 'application/json',
    appvr: device.appvr,
    ch: device.channel,
    'device-time': now,
    lan: device.lan,
    loc: device.loc,
    pf: device.pf,
    'sign-ver': '1',
    tdid: device.tdid,
    'x-ss-stub': xSsStub(bodyText),
    'x-ss-dp': device.aid,
    'x-khronos': now,
    'x-tt-trace-id': traceId(),
    'user-agent':
      'Cronet/TTNetVersion:1d7cc3b1 2025-07-16 QuicVersion:52c2b40d 2025-04-03',
    'accept-encoding': 'gzip, deflate',
    'store-country-code': device.loc.toLowerCase(),
    'store-country-code-src': 'did',
    'is-dispatch-us-ttp': '0',
    'is-app-region-us-ttp': '0',
  };
  if (appid) {
    headers['app-sdk-version'] = device.appvr;
    headers.appid = device.aid;
  }
  return headers;
}

const BABI_PARAM = {
  feature_entrance: 'editor',
  feature_entrance_detail: 'editor-feature-text_to_speech',
  feature_key: 'text_to_speech',
  scenario: 'video_editor',
};

function buildNewRequest(
  text: string,
  voice: string,
  resourceId: string,
  rate: string,
  device: Record<string, string>,
  baseUrl: string,
): CapcutRequest {
  const ssml = buildSsml(text, voice, resourceId, rate);
  const extraInfo = compactJson({ benefit_info: {} });
  const payload = {
    audio_format: 'mp3',
    babi_param: compactJson(BABI_PARAM),
    credit_disable: false,
    extra_info: extraInfo,
    need_merge_voice: false,
    need_subtitle_timestamp: false,
    scene: 'text_to_speech',
    ssml,
    sign: payloadSign(ssml, extraInfo, device.device_id, device.aid),
  };
  const body = {
    bind_id: randomUUID(),
    can_queue: true,
    enter_from: 'text_to_speech',
    tasks: [
      {
        context: randomUUID(),
        payload: compactJson(payload),
        req_key: 'sami_text_to_speech',
        task_version: 'v3',
      },
    ],
  };
  const path = '/lv/v1/common_task/new';
  const url = `${baseUrl}${path}?${commonQuery(device, BABI_PARAM, true)}`;
  const bodyText = compactJson(body);
  const headers = baseHeaders(device, bodyText, true);
  headers.sign = signHeader(path, device.appvr, headers['device-time'], device.tdid);
  return { url, headers, bodyText };
}

function buildQueryRequest(
  taskId: string,
  token: string,
  device: Record<string, string>,
  baseUrl: string,
): CapcutRequest {
  const body = {
    tasks: [
      { bind_id: '', id: taskId, req_key: 'sami_text_to_speech', task_version: 'v3', token },
    ],
  };
  const path = '/lv/v1/common_task/query';
  const url = `${baseUrl}${path}?${commonQuery(device, null, false)}`;
  const bodyText = compactJson(body);
  const headers = baseHeaders(device, bodyText, true);
  headers.sign = signHeader(path, device.appvr, headers['device-time'], device.tdid);
  return { url, headers, bodyText };
}

// ==== HTTP ====

interface CapcutTask {
  id?: string;
  status?: string;
  token?: string;
  payload?: string | null;
  err_code?: number;
  err_msg?: string;
}
interface CapcutEnvelope {
  ret?: string;
  errmsg?: string;
  data?: { tasks?: CapcutTask[]; failed_tasks?: unknown[] };
}

async function postJson(req: CapcutRequest): Promise<CapcutEnvelope> {
  const res = await fetch(req.url, {
    method: 'POST',
    headers: req.headers,
    body: req.bodyText,
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  if (!res.ok) {
    // status gắn kèm → withRetry phân loại 429/5xx như ElevenLabs.
    const err = new Error(`CapCut HTTP ${res.status}`) as Error & { status: number };
    err.status = res.status;
    throw err;
  }
  const data = (await res.json()) as CapcutEnvelope;
  if (data.ret !== '0') {
    // ret!=0 là lỗi nghiệp vụ CapCut (vd ret=-6 "shark block only" khi device bị risk-control chặn),
    // KHÔNG phải lỗi mạng → đánh dấu non-retryable để withRetry fail nhanh, không đập lại device đã chặn.
    const err = new Error(`CapCut API lỗi: ${data.errmsg || `ret=${data.ret}`}. ${HINT}`) as Error & {
      retryable: boolean;
    };
    err.retryable = false;
    throw err;
  }
  return data;
}

// Nơi lưu device identity ngẫu nhiên (gitignored qua .cache/). Path tương đối CWD — dùng chung
// giữa Preview UI (Next) và CLI render nên cùng máy chỉ có MỘT device ổn định.
const DEVICE_STORE_PATH = path.join('.cache', 'capcut-device.json');

// 19 chữ số, đầu 1..9 (không leading zero) — mô phỏng device_id/iid dạng snowflake ByteDance.
function randomSnowflake(): string {
  let rest = '';
  for (let i = 0; i < 18; i++) rest += String(randomInt(0, 10));
  return `${randomInt(1, 10)}${rest}`;
}

// Sinh identity máy mới: device_id == tdid (khớp mẫu DEFAULT_DEVICE), iid riêng.
function newDeviceIdentity(): Record<string, string> {
  const deviceId = randomSnowflake();
  return { device_id: deviceId, tdid: deviceId, iid: randomSnowflake() };
}

// Đọc identity đã persist; nếu chưa có/hỏng thì sinh mới + ghi atomic (.tmp → rename) chống corrupt
// khi ghi song song. Chỉ persist 3 field định danh máy — phần còn lại lấy từ DEFAULT_DEVICE.
async function loadOrCreatePersistedDevice(): Promise<Record<string, string>> {
  try {
    const raw = JSON.parse(await readFile(DEVICE_STORE_PATH, 'utf8')) as Record<string, string>;
    if (raw.device_id) return { ...DEFAULT_DEVICE, ...raw };
  } catch {
    // chưa tồn tại hoặc JSON hỏng → tạo mới bên dưới
  }
  const identity = newDeviceIdentity();
  await mkdir(path.dirname(DEVICE_STORE_PATH), { recursive: true });
  const tmp = `${DEVICE_STORE_PATH}.${randomUUID()}.tmp`;
  await writeFile(tmp, JSON.stringify(identity, null, 2), 'utf8');
  await rename(tmp, DEVICE_STORE_PATH);
  return { ...DEFAULT_DEVICE, ...identity };
}

async function resolveDevice(): Promise<Record<string, string>> {
  const overridePath = process.env.CAPCUT_DEVICE_JSON;
  if (overridePath) {
    try {
      const raw = JSON.parse(await readFile(overridePath, 'utf8')) as Record<string, string>;
      return { ...DEFAULT_DEVICE, ...raw };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      throw new Error(`Không đọc được CAPCUT_DEVICE_JSON (${overridePath}): ${msg}`);
    }
  }
  return loadOrCreatePersistedDevice();
}

// Memo hóa: resolve device MỘT lần/process (tránh đọc/ghi file mỗi segment và tránh race). Không
// cache lỗi để lần sau còn thử lại.
let devicePromise: Promise<Record<string, string>> | null = null;
function loadDevice(): Promise<Record<string, string>> {
  if (!devicePromise) {
    devicePromise = resolveDevice().catch((err) => {
      devicePromise = null;
      throw err;
    });
  }
  return devicePromise;
}

async function pollAudioUrl(
  taskId: string,
  token: string,
  device: Record<string, string>,
  baseUrl: string,
): Promise<string> {
  const totalTimeoutMs = envInt('CAPCUT_TIMEOUT_MS', DEFAULT_TOTAL_TIMEOUT_MS);
  const pollIntervalMs = envInt('CAPCUT_POLL_INTERVAL_MS', DEFAULT_POLL_INTERVAL_MS);
  const deadline = Date.now() + totalTimeoutMs;
  while (Date.now() < deadline) {
    const data = await withRetry(() => postJson(buildQueryRequest(taskId, token, device, baseUrl)));
    const task = data.data?.tasks?.[0];
    const status = task?.status;
    if (status === 'succeed') {
      const payload = task?.payload;
      if (!payload) throw new Error(`CapCut trả về rỗng dù task thành công. ${HINT}`);
      const parsed = JSON.parse(payload) as {
        audio_subtitles?: { speech_url?: string; code?: number; msg?: string }[];
      };
      const audio = parsed.audio_subtitles?.[0];
      if (!audio?.speech_url) {
        throw new Error(`CapCut không có URL audio trong kết quả. ${HINT}`);
      }
      return audio.speech_url;
    }
    if (status === 'failed' || status === 'fail') {
      const reason = task?.err_msg ? `${task.err_msg} (err_code ${task.err_code})` : 'không rõ';
      throw new Error(`CapCut synth thất bại: ${reason}. ${HINT}`);
    }
    // queueing / trạng thái trung gian khác → chờ rồi poll tiếp.
    await new Promise((r) => setTimeout(r, pollIntervalMs));
  }
  throw new Error(`CapCut synth quá thời gian chờ (${Math.round(totalTimeoutMs / 1000)}s). ${HINT}`);
}

async function downloadAudio(url: string): Promise<Buffer> {
  const audio = await withRetry(async () => {
    const res = await fetch(url, { signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) });
    if (!res.ok) {
      const err = new Error(`CapCut tải audio HTTP ${res.status}`) as Error & { status: number };
      err.status = res.status;
      throw err;
    }
    return Buffer.from(await res.arrayBuffer());
  });
  if (audio.length === 0) throw new Error(`CapCut trả audio rỗng. ${HINT}`);
  return audio;
}

// Giọng hiệu dụng: cfg.voiceId rỗng → CAPCUT_VOICE (ENV) → default. Dùng CHUNG cho cache key
// (resolveVoiceId) và synth — hai nơi phải khớp để key phản ánh đúng giọng sẽ synth.
function effectiveVoice(cfg: TtsConfig): string {
  return cfg.voiceId || process.env.CAPCUT_VOICE || DEFAULT_VOICE;
}

export const capcutProvider: TtsProvider = {
  id: 'capcut',
  label: PROVIDER_LABELS.capcut,
  voices: CAPCUT_VOICES,
  resolveVoiceId: effectiveVoice,
  async synth(text: string, cfg: TtsConfig): Promise<Buffer> {
    const baseUrl = (process.env.CAPCUT_BASE_URL || DEFAULT_BASE_URL).replace(/\/$/, '');
    const voice = effectiveVoice(cfg);
    const resourceId =
      CAPCUT_VOICES.find((v) => v.id === voice)?.resourceId ||
      process.env.CAPCUT_RESOURCE_ID ||
      DEFAULT_RESOURCE_ID;
    const device = await loadDevice();

    const created = await withRetry(() =>
      postJson(buildNewRequest(text, voice, resourceId, '1.0', device, baseUrl)),
    );
    const task = created.data?.tasks?.[0];
    if (!task?.id || !task?.token) {
      throw new Error(`CapCut không tạo được task (thiếu id/token). ${HINT}`);
    }
    const audioUrl = await pollAudioUrl(task.id, task.token, device, baseUrl);
    return downloadAudio(audioUrl);
  },
};
