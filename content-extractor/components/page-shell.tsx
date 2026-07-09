import { cn } from '@/lib/utils';

// Container chuẩn cho nội dung trang: 1 bề rộng + 1 padding + mẫu page-header thống nhất.
// Trang nào cần rộng hơn (vd Video 2 cột) truyền wide.
export function PageShell({
  title,
  subtitle,
  actions,
  wide = false,
  children,
}: {
  title: string;
  subtitle?: string;
  actions?: React.ReactNode;
  wide?: boolean;
  children: React.ReactNode;
}) {
  return (
    <main
      className={cn('mx-auto w-full flex-1 px-4 py-6', wide ? 'max-w-screen-2xl' : 'max-w-6xl')}
    >
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-xl font-semibold tracking-tight">{title}</h1>
          {subtitle && <p className="mt-1 text-sm text-muted-foreground">{subtitle}</p>}
        </div>
        {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
      </div>
      <div className="mt-6">{children}</div>
    </main>
  );
}
