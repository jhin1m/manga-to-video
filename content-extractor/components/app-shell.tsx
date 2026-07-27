'use client';

import { useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { FolderOpen, Save } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { SettingsDialog } from '@/components/settings/settings-dialog';
import { StageStepper } from '@/components/stage-stepper';
import { ThemeToggle } from '@/components/theme-toggle';
import { useProject } from '@/components/project-context';

// Khung app chung cho cả 4 stage: top bar (tên app · trạng thái project · Lưu/Mở project ·
// theme) + stepper. Nội dung trang render bên dưới — trang tự lo container (PageShell).
export function AppShell({ children }: { children: React.ReactNode }) {
  const { state, publish } = useProject();
  const router = useRouter();
  const fileRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);

  // Tải .mtvproj về máy — file là bản lưu duy nhất (store server in-memory, mất khi restart).
  async function saveProject() {
    if (!state.jobId) return;
    setBusy(true);
    try {
      const res = await fetch(`/api/project/export?jobId=${encodeURIComponent(state.jobId)}`);
      if (!res.ok) {
        const data = (await res.json().catch(() => null)) as { error?: string } | null;
        throw new Error(data?.error ?? `Lỗi HTTP ${res.status}`);
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `project-${state.jobId}.mtvproj`;
      a.click();
      URL.revokeObjectURL(url);
      publish({ dirty: false });
      toast.success('Đã lưu project (.mtvproj).');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Không lưu được project');
    } finally {
      setBusy(false);
    }
  }

  async function openProject(file: File) {
    setBusy(true);
    try {
      const fd = new FormData();
      fd.append('file', file);
      const res = await fetch('/api/project/import', { method: 'POST', body: fd });
      const data = (await res.json().catch(() => null)) as
        | { jobId?: string; stage?: string; error?: string }
        | null;
      if (!res.ok || !data?.jobId) {
        throw new Error(data?.error ?? `Lỗi HTTP ${res.status}`);
      }
      publish({
        jobId: data.jobId,
        hasStoryboard: true,
        storyboardDone: true,
        scriptConfirmed: data.stage === 'video',
        dirty: false,
      });
      router.push(
        data.stage === 'video'
          ? `/video/${data.jobId}`
          : data.stage === 'script'
            ? `/script/${data.jobId}`
            : `/storyboard/${data.jobId}`,
      );
      toast.success('Đã mở project — tiếp tục từ trạng thái đã lưu.');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Không mở được project');
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <header className="sticky top-0 z-40 border-b bg-background/80 backdrop-blur">
        <div className="mx-auto flex w-full max-w-6xl flex-wrap items-center gap-x-4 gap-y-2 px-4 py-2">
          <Link href="/" className="text-sm font-bold tracking-tight">
            Manga → Video
          </Link>

          <div className="order-last w-full sm:order-none sm:w-auto sm:flex-1">
            <StageStepper />
          </div>

          <div className="ml-auto flex items-center gap-1.5">
            {state.jobId && (
              <span className="mr-1 hidden items-center gap-1.5 text-xs text-muted-foreground md:flex">
                <code className="max-w-28 truncate">{state.jobId.slice(0, 8)}</code>
                {state.dirty && (
                  <span title="Có thay đổi chưa lưu" className="text-amber-500">
                    ●
                  </span>
                )}
              </span>
            )}
            <input
              ref={fileRef}
              type="file"
              accept=".mtvproj,application/zip"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) void openProject(f);
                e.target.value = '';
              }}
            />
            <Button
              variant="outline"
              size="sm"
              disabled={busy}
              onClick={() => fileRef.current?.click()}
            >
              <FolderOpen data-icon="inline-start" />
              Mở project
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={saveProject}
              disabled={busy || !state.jobId}
            >
              <Save data-icon="inline-start" />
              Lưu project
            </Button>
            <SettingsDialog />
            <ThemeToggle />
          </div>
        </div>
      </header>
      {children}
    </>
  );
}
