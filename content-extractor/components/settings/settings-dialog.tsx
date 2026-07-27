'use client';

import { useState } from 'react';
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
import { Label } from '@/components/ui/label';
import { Separator } from '@/components/ui/separator';
import { Switch } from '@/components/ui/switch';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import type { AiProviderId } from '@/lib/ai-providers';
import {
  ProviderSection,
  draftKeyPayload,
  emptyDraft,
  type StageDraft,
} from './provider-section';
import { TtsSection, emptyTtsDraft, ttsKeyPayload, type TtsDraft } from './tts-section';

// Settings dialog: cấu hình AI (Vision + Biên kịch tách riêng) và TTS, lưu server-side
// (.settings.json) qua /api/settings — hiệu lực NGAY cho job kế tiếp, không cần restart.
// API key nhập thẳng ở đây; server không bao giờ trả key về, chỉ trả mask.

// DTO của GET /api/settings — key đã bị XOÁ khỏi payload, thay bằng hasKey + keyMask.
interface StageDto {
  provider: AiProviderId;
  baseURL: string;
  model: string;
  hasKey: boolean;
  keyMask: string;
  disableThinking: boolean;
}
interface TtsDto {
  provider: string;
  voiceId: string;
  model: string;
  hasKey: boolean;
  keyMask: string;
}

function toDraft(dto: StageDto): StageDraft {
  return { ...dto, apiKey: '', clearKey: false };
}

export function SettingsDialog() {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  // Chỉ true khi GET thành công. PUT là replace-TOÀN-tài-liệu: lưu trên state chưa nạp sẽ
  // gửi script:null + tts:null và XOÁ SẠCH cấu hình Biên kịch riêng lẫn TTS đang có.
  const [loaded, setLoaded] = useState(false);
  const [saving, setSaving] = useState(false);
  const [envKeys, setEnvKeys] = useState<Record<string, boolean>>({});
  // configured=false → đang chạy theo .env.local (chưa có .settings.json).
  const [configured, setConfigured] = useState(false);
  const [vision, setVision] = useState<StageDraft>(() => emptyDraft());
  const [script, setScript] = useState<StageDraft>(() => emptyDraft());
  // script===null ở server = "dùng chung Vision". Trên UI là một ô tick.
  const [shareScript, setShareScript] = useState(true);
  const [tts, setTts] = useState<TtsDraft>(() => emptyTtsDraft());
  const [ttsEnabled, setTtsEnabled] = useState(false);

  async function load() {
    setLoading(true);
    setLoaded(false);
    try {
      const res = await fetch('/api/settings');
      const data = (await res.json()) as {
        settings: { vision: StageDto; script: StageDto | null; tts: TtsDto | null } | null;
        envKeys: Record<string, boolean>;
      };
      setEnvKeys(data.envKeys ?? {});
      const s = data.settings;
      setConfigured(Boolean(s));
      setVision(s ? toDraft(s.vision) : emptyDraft());
      setScript(s?.script ? toDraft(s.script) : s ? toDraft(s.vision) : emptyDraft());
      setShareScript(!s?.script);
      setTtsEnabled(Boolean(s?.tts));
      setTts(s?.tts ? { ...s.tts, apiKey: '', clearKey: false } : emptyTtsDraft());
      setLoaded(true);
    } catch {
      toast.error('Không tải được cấu hình hiện tại — đóng rồi mở lại dialog để thử lại.');
    } finally {
      setLoading(false);
    }
  }

  function handleOpenChange(next: boolean) {
    setOpen(next);
    if (next) void load();
  }

  async function put(body: unknown, successMessage: string) {
    setSaving(true);
    try {
      const res = await fetch('/api/settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const data = (await res.json().catch(() => null)) as { error?: string } | null;
      if (!res.ok) throw new Error(data?.error ?? `Lỗi HTTP ${res.status}`);
      toast.success(successMessage);
      setOpen(false);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Không lưu được cấu hình');
    } finally {
      setSaving(false);
    }
  }

  function save() {
    const stagePayload = (d: StageDraft) => ({
      provider: d.provider,
      baseURL: d.baseURL,
      model: d.model,
      apiKey: draftKeyPayload(d),
      disableThinking: d.disableThinking,
    });
    void put(
      {
        settings: {
          vision: stagePayload(vision),
          script: shareScript ? null : stagePayload(script),
          tts: ttsEnabled
            ? {
                provider: tts.provider,
                voiceId: tts.voiceId,
                model: tts.model,
                apiKey: ttsKeyPayload(tts),
              }
            : null,
        },
      },
      'Đã lưu — có hiệu lực ngay cho lần chạy kế tiếp, không cần restart.',
    );
  }

  const customMissingBase =
    (vision.provider === 'custom' && !vision.baseURL.trim()) ||
    (!shareScript && script.provider === 'custom' && !script.baseURL.trim());

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm" aria-label="Cấu hình AI và giọng đọc">
          <Settings data-icon="inline-start" />
          AI
        </Button>
      </DialogTrigger>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Cấu hình</DialogTitle>
          <DialogDescription>
            {configured
              ? 'Có hiệu lực ngay cho lần chạy kế tiếp — không cần sửa .env.local hay restart.'
              : 'Đang chạy theo .env.local. Lưu ở đây sẽ đè lên cấu hình đó.'}
          </DialogDescription>
        </DialogHeader>

        <Tabs defaultValue="ai" className="gap-4" aria-busy={loading}>
          <TabsList>
            <TabsTrigger value="ai">AI</TabsTrigger>
            <TabsTrigger value="tts">Giọng đọc</TabsTrigger>
          </TabsList>

          <TabsContent value="ai" className="grid gap-4">
            <section className="grid gap-3">
              <h3 className="text-sm font-medium">Vision — đọc trang truyện</h3>
              <ProviderSection
                stage="vision"
                value={vision}
                onChange={setVision}
                envKeys={envKeys}
                disabled={!loaded}
              />
            </section>

            <Separator />

            <div className="flex items-start justify-between gap-3">
              <div className="grid gap-1">
                <Label htmlFor="settings-share-script" className="font-normal">
                  Biên kịch dùng chung cấu hình với Vision
                </Label>
                <p className="text-xs text-muted-foreground">
                  Dùng chung là dùng chung tất cả, kể cả model — biên kịch sẽ chạy đúng model
                  của Vision và không đọc <code>SCRIPT_MODEL</code> nữa.
                </p>
              </div>
              <Switch
                id="settings-share-script"
                checked={shareScript}
                disabled={!loaded}
                onCheckedChange={(next) => {
                  // Bỏ tick → khởi tạo khối Biên kịch từ chính Vision: người dùng chỉ đổi
                  // phần khác biệt. Key để trống (server thừa kế key vision đang dùng).
                  if (!next) setScript({ ...vision, apiKey: '', clearKey: false, model: '' });
                  setShareScript(next);
                }}
              />
            </div>

            {!shareScript && (
              <section className="grid gap-3">
                <h3 className="text-sm font-medium">Biên kịch — viết lời kể</h3>
                <ProviderSection
                  stage="script"
                  value={script}
                  onChange={setScript}
                  envKeys={envKeys}
                  disabled={!loaded}
                />
              </section>
            )}
          </TabsContent>

          <TabsContent value="tts" className="grid gap-4">
            <div className="flex items-center justify-between gap-3">
              <Label htmlFor="settings-tts-enabled" className="font-normal">
                Đặt giọng đọc mặc định ở đây (tắt = theo <code>.env.local</code>)
              </Label>
              <Switch
                id="settings-tts-enabled"
                checked={ttsEnabled}
                disabled={!loaded}
                onCheckedChange={setTtsEnabled}
              />
            </div>
            {ttsEnabled && <TtsSection value={tts} onChange={setTts} disabled={!loaded} />}
          </TabsContent>
        </Tabs>

        <DialogFooter>
          {configured && (
            <Button
              variant="outline"
              disabled={!loaded || saving}
              onClick={() => void put({ settings: null }, 'Đã quay về cấu hình theo .env.local.')}
            >
              Dùng theo ENV
            </Button>
          )}
          <Button onClick={save} disabled={!loaded || saving || customMissingBase}>
            Lưu cấu hình
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
