'use client';

import { usePathname, useRouter } from 'next/navigation';
import { Check } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useProject } from '@/components/project-context';

// 3 bước pipeline theo job. Trang nhận chapter (`/`) không phải một bước — vào lại qua logo.
const STAGES = [
  { key: 'storyboard', label: 'Storyboard', href: (id: string) => `/storyboard/${id}` },
  { key: 'script', label: 'Kịch bản', href: (id: string) => `/script/${id}` },
  { key: 'video', label: 'Video', href: (id: string) => `/video/${id}` },
] as const;

// -1 = đang ở trang ngoài pipeline (vd `/` nhận chapter) — không node nào active.
function stageIndexFromPath(pathname: string): number {
  if (pathname.startsWith('/storyboard/')) return 0;
  if (pathname.startsWith('/script/')) return 1;
  if (pathname.startsWith('/video/')) return 2;
  return -1;
}

// jobId nằm ở segment thứ 2 của các route theo job (/storyboard/{id}, /script/{id}, /video/{id}).
function jobIdFromPath(pathname: string): string | null {
  const m = pathname.match(/^\/(?:storyboard|script|video)\/([^/]+)/);
  return m ? m[1] : null;
}

export function StageStepper() {
  const pathname = usePathname();
  const router = useRouter();
  const { state } = useProject();

  const current = stageIndexFromPath(pathname);
  const jobId = jobIdFromPath(pathname) ?? state.jobId;

  // Khoá an toàn: chỉ mở bước có bằng chứng dữ liệu (readiness do trang publish),
  // hoặc bước đứng trước bước đang xem (đã đi qua trong phiên này).
  function unlocked(i: number): boolean {
    if (i === current) return true;
    if (!jobId) return false;
    if (current >= 0 && i < current) return true;
    if (i === 0) return state.hasStoryboard;
    if (i === 1) return state.storyboardDone;
    return state.scriptConfirmed;
  }

  return (
    <nav aria-label="Các bước xử lý" className="flex items-center gap-1 overflow-x-auto">
      {STAGES.map((stage, i) => {
        const isCurrent = i === current;
        const isDone = current >= 0 && i < current;
        const canGo = unlocked(i);
        return (
          <div key={stage.key} className="flex shrink-0 items-center gap-1">
            {i > 0 && <div className="h-px w-4 bg-border sm:w-6" aria-hidden />}
            <button
              type="button"
              disabled={!canGo || isCurrent}
              aria-current={isCurrent ? 'step' : undefined}
              onClick={() => {
                if (jobId) router.push(stage.href(jobId));
              }}
              className={cn(
                'flex items-center gap-1.5 rounded-full px-2.5 py-1 text-sm transition-colors',
                isCurrent
                  ? 'bg-primary text-primary-foreground'
                  : canGo
                    ? 'text-foreground hover:bg-muted'
                    : 'text-muted-foreground/60',
                !canGo && !isCurrent && 'cursor-not-allowed',
              )}
            >
              <span
                className={cn(
                  'flex size-4.5 items-center justify-center rounded-full border text-[10px] font-semibold',
                  isCurrent
                    ? 'border-primary-foreground/40'
                    : isDone
                      ? 'border-success bg-success text-success-foreground'
                      : 'border-border',
                )}
              >
                {isDone ? <Check className="size-3" /> : i + 1}
              </span>
              <span className="hidden sm:inline">{stage.label}</span>
            </button>
          </div>
        );
      })}
    </nav>
  );
}
