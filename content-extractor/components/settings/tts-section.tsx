'use client';

import { useRef, useState } from 'react';
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
import { TTS_PROVIDER_OPTIONS } from '@/lib/tts-providers/catalog';

// Tab TTS của Settings: nhà cung cấp + key + dropdown giọng THẬT (thay ô gõ voice ID tay)
// + nghe thử. Đây là mặc định TOÀN CỤC — panel TTS ở trang video vẫn ghi đè theo từng job.
//
// Ô key theo đúng quy ước sentinel như provider-section: keyMask chỉ là placeholder.

export interface TtsDraft {
  provider: string;
  voiceId: string;
  model: string;
  apiKey: string;
  clearKey: boolean;
  hasKey: boolean;
  keyMask: string;
}

export function emptyTtsDraft(): TtsDraft {
  return {
    provider: TTS_PROVIDER_OPTIONS[0].id,
    voiceId: '',
    model: '',
    apiKey: '',
    clearKey: false,
    hasKey: false,
    keyMask: '',
  };
}

export function ttsKeyPayload(d: TtsDraft): string | null {
  if (d.clearKey) return '';
  const typed = d.apiKey.trim();
  return typed ? typed : null;
}

// Radix Select cấm value="" — sentinel cho "giọng mặc định của provider".
const VOICE_DEFAULT = '__default__';

interface Voice {
  id: string;
  label: string;
}

export function TtsSection({
  value,
  onChange,
  disabled,
}: {
  value: TtsDraft;
  onChange: (next: TtsDraft) => void;
  disabled?: boolean;
}) {
  const [voices, setVoices] = useState<Voice[]>([]);
  // null = chưa hỏi; false = hỏi rồi nhưng hỏng → lùi về ô nhập tự do.
  const [voicesOk, setVoicesOk] = useState<boolean | null>(null);
  const [previewing, setPreviewing] = useState(false);
  const fetchedFor = useRef<string>('');

  const set = (patch: Partial<TtsDraft>) => onChange({ ...value, ...patch });
  // ElevenLabs cần key riêng; CapCut là endpoint nội bộ không dùng key.
  const needsKey = value.provider === 'elevenlabs';

  function loadVoices(provider: string) {
    if (fetchedFor.current === provider) return;
    fetchedFor.current = provider;
    fetch('/api/settings/tts/voices', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ provider, apiKey: ttsKeyPayload(value) }),
    })
      .then((res) => (res.ok ? res.json() : Promise.reject(new Error())))
      .then((data: { voices?: Voice[] }) => {
        setVoices(data.voices ?? []);
        setVoicesOk((data.voices ?? []).length > 0);
      })
      .catch(() => {
        setVoices([]);
        setVoicesOk(false); // ô nhập tự do — lỗi mạng/sai key không được chặn người dùng
        fetchedFor.current = '';
      });
  }

  function pickProvider(id: string) {
    setVoices([]);
    setVoicesOk(null);
    fetchedFor.current = '';
    // Đổi provider → reset giọng/model/key: giọng lẫn key của nhà này không hợp lệ với nhà
    // kia. Xoá hasKey/keyMask để placeholder không nói dối và key cũ không nằm lại mồ côi
    // (ô key bị ẩn với provider không cần key, không còn cách nào xoá).
    set({ provider: id, voiceId: '', model: '', apiKey: '', clearKey: false, hasKey: false, keyMask: '' });
    loadVoices(id);
  }

  async function preview() {
    setPreviewing(true);
    try {
      const res = await fetch('/api/settings/tts/preview', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          provider: value.provider,
          voiceId: value.voiceId,
          model: value.model,
          apiKey: ttsKeyPayload(value),
        }),
      });
      if (!res.ok) {
        const data = (await res.json().catch(() => null)) as { error?: string } | null;
        throw new Error(data?.error ?? `Lỗi HTTP ${res.status}`);
      }
      const url = URL.createObjectURL(await res.blob());
      const audio = new Audio(url);
      // Thu hồi ở MỌI đường kết thúc, không chỉ 'ended' — play() có thể bị chặn (autoplay
      // policy) hoặc người dùng đóng dialog giữa chừng, để lại blob treo trong bộ nhớ.
      const release = () => URL.revokeObjectURL(url);
      audio.addEventListener('ended', release, { once: true });
      audio.addEventListener('error', release, { once: true });
      try {
        await audio.play();
      } catch {
        release();
        throw new Error('Trình duyệt chặn tự phát — bấm lại nút Nghe thử.');
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Không nghe thử được');
    } finally {
      setPreviewing(false);
    }
  }

  return (
    <div className="grid gap-3">
      <div className="grid gap-1.5">
        <Label htmlFor="settings-tts-provider">Nhà cung cấp</Label>
        <Select value={value.provider} onValueChange={pickProvider} disabled={disabled}>
          <SelectTrigger id="settings-tts-provider" className="w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {TTS_PROVIDER_OPTIONS.map((p) => (
              <SelectItem key={p.id} value={p.id}>
                {p.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {needsKey && (
        <div className="grid gap-1.5">
          <Label htmlFor="settings-tts-key">API key</Label>
          <div className="flex gap-2">
            <Input
              id="settings-tts-key"
              type="password"
              autoComplete="off"
              spellCheck={false}
              value={value.apiKey}
              placeholder={
                value.clearKey
                  ? 'sẽ xoá key đã lưu'
                  : value.hasKey
                    ? `${value.keyMask} (để trống = giữ nguyên)`
                    : 'dán key, hoặc để trống dùng ELEVENLABS_API_KEY'
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
        </div>
      )}

      <div className="grid gap-1.5">
        <Label htmlFor="settings-tts-voice">Giọng</Label>
        <div className="flex gap-2">
          {voicesOk ? (
            <Select
              value={value.voiceId || VOICE_DEFAULT}
              disabled={disabled}
              onValueChange={(v) => set({ voiceId: v === VOICE_DEFAULT ? '' : v })}
            >
              <SelectTrigger id="settings-tts-voice" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={VOICE_DEFAULT}>Giọng mặc định</SelectItem>
                {voices.map((v) => (
                  <SelectItem key={v.id} value={v.id}>
                    {v.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          ) : (
            <Input
              id="settings-tts-voice"
              value={value.voiceId}
              placeholder="voice ID (để trống = giọng mặc định)"
              disabled={disabled}
              onFocus={() => loadVoices(value.provider)}
              onChange={(e) => set({ voiceId: e.target.value })}
            />
          )}
          <Button
            type="button"
            variant="outline"
            disabled={disabled || previewing}
            onClick={preview}
          >
            {previewing ? 'Đang tải…' : 'Nghe thử'}
          </Button>
        </div>
        {voicesOk === false && (
          <p className="text-xs text-amber-500">
            Không lấy được danh sách giọng (sai key hoặc mất mạng) — vẫn nhập voice ID tay được.
          </p>
        )}
      </div>

      {needsKey && (
        <div className="grid gap-1.5">
          <Label htmlFor="settings-tts-model">Model</Label>
          <Input
            id="settings-tts-model"
            value={value.model}
            placeholder="để trống = eleven_multilingual_v2"
            disabled={disabled}
            onChange={(e) => set({ model: e.target.value })}
          />
        </div>
      )}

      <p className="text-xs text-muted-foreground">
        Đây là mặc định chung. Panel &quot;Giọng đọc (TTS)&quot; ở trang video vẫn ghi đè được
        cho từng video.
      </p>
    </div>
  );
}
