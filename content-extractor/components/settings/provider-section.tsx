'use client';

import { useMemo, useRef, useState } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import {
  PROVIDER_PRESETS,
  getPreset,
  thinkingParams,
  type AiProviderId,
} from '@/lib/ai-providers';

// Khối cấu hình MỘT stage (Vision hoặc Biên kịch) — dùng lại nguyên vẹn cho cả hai.
// Đó là lý do file này tồn tại, không phải để tách cho gọn.
//
// Quy ước ô API key (khớp sentinel 3 trạng thái của PUT /api/settings):
//   người dùng không gõ gì  → gửi apiKey: null  (giữ key đang lưu)
//   người dùng gõ           → gửi chuỗi đã gõ
//   bấm "Xoá key"           → gửi ''            (quay về ENV)
// keyMask CHỈ được dùng làm placeholder, TUYỆT ĐỐI không đổ vào value — đổ vào value là
// nguồn gốc lỗi ghi đè key thật bằng chuỗi mask.

export interface StageDraft {
  provider: AiProviderId;
  baseURL: string;
  model: string;
  apiKey: string; // ô nhập; rỗng = không đụng tới
  clearKey: boolean; // đã bấm "Xoá key"
  hasKey: boolean; // từ GET — server đang giữ key
  keyMask: string; // từ GET — chỉ để hiển thị
  disableThinking: boolean;
}

export function emptyDraft(provider: AiProviderId = 'openai'): StageDraft {
  return {
    provider,
    baseURL: getPreset(provider).baseURL,
    model: '',
    apiKey: '',
    clearKey: false,
    hasKey: false,
    keyMask: '',
    disableThinking: false,
  };
}

// Draft → phần apiKey của body PUT.
export function draftKeyPayload(d: StageDraft): string | null {
  if (d.clearKey) return '';
  const typed = d.apiKey.trim();
  return typed ? typed : null;
}

interface SlimModel {
  id: string;
  name: string;
  vision: boolean | null;
}

export function ProviderSection({
  stage,
  value,
  onChange,
  envKeys,
  disabled,
}: {
  stage: 'vision' | 'script';
  value: StageDraft;
  onChange: (next: StageDraft) => void;
  envKeys: Record<string, boolean>;
  disabled?: boolean;
}) {
  const [models, setModels] = useState<SlimModel[]>([]);
  const [testing, setTesting] = useState(false);
  // Fetch trong event handler, KHÔNG useEffect — lint repo cấm setState-trong-effect.
  const modelsFetchedFor = useRef<string>('');

  const preset = getPreset(value.provider);
  const isCustom = value.provider === 'custom';
  const idPrefix = `settings-${stage}`;
  const set = (patch: Partial<StageDraft>) => onChange({ ...value, ...patch });

  function loadModels(provider: AiProviderId, baseURL: string) {
    const token = `${provider} ${baseURL}`;
    if (modelsFetchedFor.current === token) return;
    modelsFetchedFor.current = token;
    fetch('/api/settings/models', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ provider, baseURL, apiKey: draftKeyPayload(value), stage }),
    })
      .then((res) => (res.ok ? res.json() : Promise.reject(new Error())))
      .then((data: { models?: SlimModel[] }) => setModels(data.models ?? []))
      .catch(() => {
        setModels([]);
        modelsFetchedFor.current = ''; // cho thử lại — ô model vẫn gõ tay được
      });
  }

  function pickProvider(id: string) {
    const next = id as AiProviderId;
    const p = getPreset(next);
    setModels([]);
    modelsFetchedFor.current = '';
    // Preset PIN baseURL; custom giữ nguyên giá trị đang gõ để sửa tiếp.
    const baseURL = next === 'custom' ? value.baseURL : p.baseURL;
    // Key THUỘC VỀ nhà cung cấp: đổi nhà thì key đã lưu không còn dùng được. Phải xoá cả
    // hasKey/keyMask, nếu không placeholder vẫn viết "••••1234 (để trống = giữ nguyên)" —
    // nói dối, và người dùng bấm Lưu mà tưởng key cũ vẫn hợp lệ.
    set({ provider: next, baseURL, model: '', apiKey: '', clearKey: false, hasKey: false, keyMask: '' });
    if (next !== 'custom') loadModels(next, baseURL);
  }

  async function testConnection() {
    setTesting(true);
    try {
      const res = await fetch('/api/settings/test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          stage,
          provider: value.provider,
          baseURL: value.baseURL,
          model: value.model,
          apiKey: draftKeyPayload(value),
        }),
      });
      const data = (await res.json()) as { ok?: boolean; message?: string; error?: string };
      if (data.ok) toast.success(data.message ?? 'Kết nối được.');
      else toast.error(data.message ?? data.error ?? 'Không kiểm tra được.');
    } catch {
      toast.error('Không gọi được máy chủ để kiểm tra.');
    } finally {
      setTesting(false);
    }
  }

  // Gợi ý model: ghim danh sách của preset lên đầu (endpoint /models của phần lớn nhà cung
  // cấp KHÔNG cho biết model nào nhận ảnh — lọc theo cờ vision sẽ lọc nhầm).
  const suggestions = useMemo(() => {
    const pinned = stage === 'vision' ? preset.visionModels : preset.scriptModels;
    const fromApi =
      stage === 'vision' && models.some((m) => m.vision !== null)
        ? models.filter((m) => m.vision).map((m) => m.id)
        : models.map((m) => m.id);
    return [...new Set([...pinned, ...fromApi])];
  }, [preset, models, stage]);

  // Chỉ hiện công tắc khi nhà cung cấp THẬT SỰ có param tắt reasoning — với OpenAI/DeepSeek/
  // Groq nó là no-op, hiện ra chỉ làm người dùng tưởng đã tắt.
  const thinkingSupported = Object.keys(thinkingParams(value.provider, true)).length > 0;

  // Cảnh báo thiếu key: chỉ khi CẢ ô key trống, server chưa giữ key, VÀ env cũng không có.
  const keyWarning = useMemo(() => {
    if (value.apiKey.trim() || (value.hasKey && !value.clearKey)) return null;
    if (envKeys[preset.keyEnv]) return null;
    if (preset.keyEnv !== 'OPENAI_API_KEY' && envKeys.OPENAI_API_KEY) {
      return { fatal: false, text: `Chưa có key riêng — sẽ dùng tạm OPENAI_API_KEY của .env.local.` };
    }
    return {
      fatal: true,
      text: `Chưa có key: nhập vào ô trên, hoặc khai báo ${preset.keyEnv} trong .env.local.`,
    };
  }, [value.apiKey, value.hasKey, value.clearKey, preset, envKeys]);

  return (
    <div className="grid gap-3">
      <div className="grid gap-1.5">
        <Label htmlFor={`${idPrefix}-provider`}>Nhà cung cấp</Label>
        <Select value={value.provider} onValueChange={pickProvider} disabled={disabled}>
          <SelectTrigger id={`${idPrefix}-provider`} className="w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {PROVIDER_PRESETS.map((p) => (
              <SelectItem key={p.id} value={p.id}>
                {p.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {stage === 'vision' && !preset.vision && (
          <p className="text-xs text-destructive">
            {preset.label} chỉ xử lý văn bản — không đọc được trang truyện. Chọn nhà cung cấp
            khác cho Vision.
          </p>
        )}
      </div>

      {isCustom && (
        <div className="grid gap-1.5">
          <Label htmlFor={`${idPrefix}-base-url`}>Base URL</Label>
          <Input
            id={`${idPrefix}-base-url`}
            value={value.baseURL}
            placeholder="https://…/v1"
            disabled={disabled}
            onChange={(e) => set({ baseURL: e.target.value })}
          />
        </div>
      )}

      <div className="grid gap-1.5">
        <Label htmlFor={`${idPrefix}-key`}>API key</Label>
        <div className="flex gap-2">
          <Input
            id={`${idPrefix}-key`}
            type="password"
            autoComplete="off"
            spellCheck={false}
            // value KHÔNG BAO GIỜ là keyMask — mask chỉ nằm ở placeholder.
            value={value.apiKey}
            placeholder={
              value.clearKey
                ? 'sẽ xoá key đã lưu'
                : value.hasKey
                  ? `${value.keyMask} (để trống = giữ nguyên)`
                  : `dán key, hoặc để trống dùng ${preset.keyEnv}`
            }
            disabled={disabled}
            onChange={(e) => set({ apiKey: e.target.value, clearKey: false })}
          />
          {value.hasKey && (
            <Button
              type="button"
              variant="outline"
              disabled={disabled}
              onClick={() => set({ apiKey: '', clearKey: !value.clearKey })}
            >
              {value.clearKey ? 'Hoàn tác' : 'Xoá key'}
            </Button>
          )}
        </div>
        {keyWarning && (
          <p className={`text-xs ${keyWarning.fatal ? 'text-destructive' : 'text-amber-500'}`}>
            {keyWarning.text}
          </p>
        )}
      </div>

      <div className="grid gap-1.5">
        <Label htmlFor={`${idPrefix}-model`}>Model</Label>
        <div className="flex gap-2">
          <Input
            id={`${idPrefix}-model`}
            list={`${idPrefix}-model-options`}
            value={value.model}
            placeholder={suggestions[0] ? `vd: ${suggestions[0]}` : 'tên model'}
            disabled={disabled}
            onFocus={() => loadModels(value.provider, value.baseURL)}
            onChange={(e) => set({ model: e.target.value })}
          />
          <Button
            type="button"
            variant="outline"
            disabled={disabled || testing || !value.model.trim()}
            onClick={testConnection}
          >
            {testing ? 'Đang thử…' : 'Kiểm tra'}
          </Button>
        </div>
        <datalist id={`${idPrefix}-model-options`}>
          {suggestions.map((id) => (
            <option key={id} value={id} />
          ))}
        </datalist>
        <p className="text-xs text-muted-foreground">
          Để trống = dùng model mặc định trong <code>.env.local</code>. Nút Kiểm tra gửi 1
          request tí hon
          {stage === 'vision' ? ' kèm ảnh 1×1px (bắt luôn model không nhận ảnh).' : '.'}
        </p>
      </div>

      {thinkingSupported && (
        <div className="flex items-center justify-between gap-3">
          <Label htmlFor={`${idPrefix}-thinking`} className="font-normal">
            Tắt reasoning — nhanh và rẻ hơn cho tác vụ không cần suy luận sâu
          </Label>
          <Switch
            id={`${idPrefix}-thinking`}
            checked={value.disableThinking}
            disabled={disabled}
            onCheckedChange={(v) => set({ disableThinking: v })}
          />
        </div>
      )}
    </div>
  );
}
