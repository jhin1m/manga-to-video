'use client';

import { useMemo, useRef, useState } from 'react';
import { toast } from 'sonner';
import { Settings } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
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

// Settings dialog: đổi provider/model AI từ UI, lưu server-side (.settings.json) qua
// /api/settings — hiệu lực ngay cho job kế tiếp, không cần restart. Key vẫn ở .env.local.

// Radix Select cấm value="" — sentinel 'env' = "Dùng theo ENV" (xóa settings), cùng pattern
// TTS_PROVIDER_ENV ở trang video.
const PROVIDER_ENV = 'env';

interface Preset {
  id: string;
  label: string;
  baseURL: string;
  keyEnv: string;
}

interface AiSettingsDto {
  provider: string;
  baseURL: string;
  visionModel: string;
  scriptModel: string;
  disableThinking: boolean;
}

interface SlimModel {
  id: string;
  name: string;
  vision: boolean;
}

// Gợi ý model tĩnh cho provider ngoài OpenRouter (datalist chỉ là gợi ý, gõ tay vẫn được).
const STATIC_MODELS: Record<string, { vision: string[]; script: string[] }> = {
  openai: { vision: ['gpt-4o-mini', 'gpt-4o'], script: ['gpt-4o', 'gpt-4o-mini'] },
  zai: { vision: ['glm-4.5v', 'glm-4.6v'], script: ['glm-4.6', 'glm-4.5-air'] },
  'zai-coding': { vision: ['glm-4.5v', 'glm-4.6v'], script: ['glm-4.6', 'glm-4.5-air'] },
};

export function SettingsDialog() {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [presets, setPresets] = useState<Preset[]>([]);
  const [keys, setKeys] = useState<Record<string, boolean>>({});
  const [models, setModels] = useState<SlimModel[]>([]);
  // Draft form — provider='env' nghĩa là chưa cấu hình (ENV thuần).
  const [provider, setProvider] = useState(PROVIDER_ENV);
  const [baseURL, setBaseURL] = useState('');
  const [visionModel, setVisionModel] = useState('');
  const [scriptModel, setScriptModel] = useState('');
  const [disableThinking, setDisableThinking] = useState(false);

  const preset = presets.find((p) => p.id === provider);
  const isZai = provider === 'zai' || provider === 'zai-coding';
  const isCustom = provider === 'custom';

  // Fetch nằm trong event handler (không useEffect) — lint repo cấm setState-trong-effect.
  const modelsFetched = useRef(false);

  // Danh sách model OpenRouter cho datalist (lỗi mạng thì thôi, gõ tay vẫn được).
  function loadModels() {
    if (modelsFetched.current) return;
    modelsFetched.current = true;
    fetch('/api/settings/models')
      .then((res) => (res.ok ? res.json() : Promise.reject()))
      .then((data: { models: SlimModel[] }) => setModels(data.models ?? []))
      .catch(() => {
        modelsFetched.current = false; // cho phép thử lại lần mở sau
      });
  }

  // Mở dialog → nạp settings hiện tại + trạng thái key (boolean, không có giá trị key).
  async function load() {
    setLoading(true);
    try {
      const res = await fetch('/api/settings');
      const data = (await res.json()) as {
        settings: AiSettingsDto | null;
        presets: Preset[];
        keys: Record<string, boolean>;
      };
      setPresets(data.presets ?? []);
      setKeys(data.keys ?? {});
      const s = data.settings;
      setProvider(s?.provider ?? PROVIDER_ENV);
      setBaseURL(s?.baseURL ?? '');
      setVisionModel(s?.visionModel ?? '');
      setScriptModel(s?.scriptModel ?? '');
      setDisableThinking(s?.disableThinking ?? false);
      if (s?.provider === 'openrouter') loadModels();
    } catch {
      toast.error('Không tải được cấu hình hiện tại');
    } finally {
      setLoading(false);
    }
  }

  function handleOpenChange(next: boolean) {
    setOpen(next);
    if (next) void load();
  }

  const visionSuggestions = useMemo(
    () =>
      provider === 'openrouter'
        ? models.filter((m) => m.vision).map((m) => m.id)
        : (STATIC_MODELS[provider]?.vision ?? []),
    [provider, models],
  );
  const scriptSuggestions = useMemo(
    () =>
      provider === 'openrouter'
        ? // Ghim openrouter/auto lên đầu — Set khử trùng lặp vì danh sách từ API cũng chứa nó.
          [...new Set(['openrouter/auto', ...models.map((m) => m.id)])]
        : (STATIC_MODELS[provider]?.script ?? []),
    [provider, models],
  );

  // Thiếu key cho provider đã chọn → cảnh báo trước khi lưu (amber = còn fallback
  // OPENAI_API_KEY, đỏ = không có key nào chạy được).
  const keyWarning = useMemo(() => {
    if (!preset || provider === PROVIDER_ENV) return null;
    if (keys[preset.keyEnv]) return null;
    if (preset.keyEnv !== 'OPENAI_API_KEY' && keys.OPENAI_API_KEY) {
      return { fatal: false, text: `Chưa có ${preset.keyEnv} trong .env.local — sẽ dùng tạm OPENAI_API_KEY.` };
    }
    return { fatal: true, text: `Thiếu ${preset.keyEnv} trong .env.local — vision/biên kịch sẽ lỗi 401.` };
  }, [preset, provider, keys]);

  function pickProvider(id: string) {
    setProvider(id);
    if (id === PROVIDER_ENV) return;
    if (id === 'openrouter') loadModels();
    const p = presets.find((x) => x.id === id);
    // Preset tự điền baseURL; custom giữ giá trị đang gõ để sửa tiếp.
    if (p && id !== 'custom') setBaseURL(p.baseURL);
  }

  async function save() {
    setSaving(true);
    try {
      const body =
        provider === PROVIDER_ENV
          ? { settings: null }
          : { settings: { provider, baseURL, visionModel, scriptModel, disableThinking } };
      const res = await fetch('/api/settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const data = (await res.json().catch(() => null)) as { error?: string } | null;
      if (!res.ok) throw new Error(data?.error ?? `Lỗi HTTP ${res.status}`);
      toast.success(
        provider === PROVIDER_ENV
          ? 'Đã quay về cấu hình theo .env.local.'
          : 'Đã lưu — có hiệu lực ngay cho lần chạy kế tiếp, không cần restart.',
      );
      setOpen(false);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Không lưu được cấu hình');
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm" aria-label="Cấu hình AI">
          <Settings data-icon="inline-start" />
          AI
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Cấu hình AI</DialogTitle>
          <DialogDescription>
            Chọn nhà cung cấp và model cho vision + biên kịch. API key vẫn nằm trong{' '}
            <code>.env.local</code>.
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-4" aria-busy={loading}>
          <div className="grid gap-1.5">
            <Label>Nhà cung cấp</Label>
            <Select value={provider} onValueChange={pickProvider} disabled={loading}>
              <SelectTrigger className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={PROVIDER_ENV}>Theo ENV (.env.local)</SelectItem>
                {presets.map((p) => (
                  <SelectItem key={p.id} value={p.id}>
                    {p.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {keyWarning && (
              <p className={`text-xs ${keyWarning.fatal ? 'text-destructive' : 'text-amber-500'}`}>
                {keyWarning.text}
              </p>
            )}
          </div>

          {provider !== PROVIDER_ENV && (
            <>
              <div className="grid gap-1.5">
                <Label htmlFor="settings-base-url">Base URL</Label>
                <Input
                  id="settings-base-url"
                  value={baseURL}
                  readOnly={!isCustom}
                  className={isCustom ? '' : 'text-muted-foreground'}
                  placeholder="https://..."
                  onChange={(e) => setBaseURL(e.target.value)}
                />
              </div>

              <div className="grid gap-1.5">
                <Label htmlFor="settings-vision-model">Vision model (đọc trang truyện)</Label>
                <Input
                  id="settings-vision-model"
                  list="settings-vision-models"
                  value={visionModel}
                  placeholder={provider === 'openrouter' ? 'vd: openai/gpt-4o-mini' : 'vd: gpt-4o-mini'}
                  onChange={(e) => setVisionModel(e.target.value)}
                />
                <datalist id="settings-vision-models">
                  {visionSuggestions.map((id) => (
                    <option key={id} value={id} />
                  ))}
                </datalist>
                {provider === 'openrouter' && (
                  <p className="text-xs text-muted-foreground">
                    Gợi ý đã lọc model nhận input ảnh. Slug OpenRouter phải có prefix vendor/.
                  </p>
                )}
              </div>

              <div className="grid gap-1.5">
                <Label htmlFor="settings-script-model">Script model (viết kịch bản)</Label>
                <Input
                  id="settings-script-model"
                  list="settings-script-models"
                  value={scriptModel}
                  placeholder={provider === 'openrouter' ? 'vd: openrouter/auto' : 'vd: gpt-4o'}
                  onChange={(e) => setScriptModel(e.target.value)}
                />
                <datalist id="settings-script-models">
                  {scriptSuggestions.map((id) => (
                    <option key={id} value={id} />
                  ))}
                </datalist>
                {provider === 'openrouter' && (
                  <p className="text-xs text-muted-foreground">
                    <code>openrouter/auto</code> = OpenRouter tự chọn model text phù hợp.
                  </p>
                )}
              </div>

              {isZai && (
                <div className="flex items-center justify-between gap-3">
                  <Label htmlFor="settings-disable-thinking" className="font-normal">
                    Tắt thinking (GLM) — tiết kiệm ~50% token
                  </Label>
                  <Switch
                    id="settings-disable-thinking"
                    checked={disableThinking}
                    onCheckedChange={setDisableThinking}
                  />
                </div>
              )}
            </>
          )}
        </div>

        <DialogFooter>
          <Button onClick={save} disabled={loading || saving || (isCustom && !baseURL.trim())}>
            {provider === PROVIDER_ENV ? 'Dùng theo ENV' : 'Lưu cấu hình'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
