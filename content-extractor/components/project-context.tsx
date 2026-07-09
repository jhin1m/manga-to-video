'use client';

import { createContext, useCallback, useContext, useMemo, useState } from 'react';

// Readiness của phiên làm việc — các trang publish bằng chứng dữ liệu (đã có storyboard?
// script đã chốt?…) để stepper khoá/mở bước và top bar biết trạng thái lưu. In-memory
// theo tab; reload thì trang hiện tại tự publish lại sau khi fetch.
export interface ProjectState {
  jobId: string | null;
  hasStoryboard: boolean;
  storyboardDone: boolean;
  scriptConfirmed: boolean;
  dirty: boolean; // có thay đổi chưa lưu vào file .mtvproj
}

const INITIAL: ProjectState = {
  jobId: null,
  hasStoryboard: false,
  storyboardDone: false,
  scriptConfirmed: false,
  dirty: false,
};

interface ProjectContextValue {
  state: ProjectState;
  /** Merge một phần readiness — trang gọi sau khi fetch/mutation thành công. */
  publish: (patch: Partial<ProjectState>) => void;
  /** Về trạng thái ban đầu (vd bấm "Chapter mới"). */
  reset: () => void;
}

const ProjectContext = createContext<ProjectContextValue | null>(null);

export function ProjectProvider({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<ProjectState>(INITIAL);

  const publish = useCallback((patch: Partial<ProjectState>) => {
    setState((prev) => {
      // Đổi job = phiên mới: gạt sạch readiness cũ trước khi áp patch, tránh
      // storyboard/script của job trước "mở khoá" nhầm bước cho job sau.
      const base = patch.jobId !== undefined && patch.jobId !== prev.jobId ? INITIAL : prev;
      return { ...base, ...patch };
    });
  }, []);

  const reset = useCallback(() => setState(INITIAL), []);

  const value = useMemo(() => ({ state, publish, reset }), [state, publish, reset]);
  return <ProjectContext.Provider value={value}>{children}</ProjectContext.Provider>;
}

export function useProject(): ProjectContextValue {
  const ctx = useContext(ProjectContext);
  if (!ctx) throw new Error('useProject phải dùng bên trong <ProjectProvider>');
  return ctx;
}
