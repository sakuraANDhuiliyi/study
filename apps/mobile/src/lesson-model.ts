export type LessonFile = { id: string; name: string; mime: string; size: number };
export type LessonProgress = { completed: boolean; positionSeconds: number; updatedAt: string } | null;
export type LessonDetail = {
  id: string;
  title: string;
  type: string;
  content: string;
  resourceUrl: string | null;
  attachmentId: string | null;
  progress: LessonProgress;
  files: LessonFile[];
};
export function lessonPosition(value: number) {
  return Number.isFinite(value) ? Math.max(0, Math.min(86400, Math.floor(value))) : 0;
}
export function publicResource(value: string | null) {
  try {
    const u = new URL(value || '');
    return u.protocol === 'https:' && !u.username && !u.password ? u.href : null;
  } catch {
    return null;
  }
}
/** One in-flight write and a coalesced latest position; never replay over a conflict. */
export class LessonProgressWriter {
  private work: Promise<void> | null = null;
  private pending: { completed: boolean; positionSeconds: number } | null = null;
  private failure: unknown;
  constructor(
    public current: LessonProgress,
    private write: (body: {
      completed: boolean;
      positionSeconds: number;
      expectedUpdatedAt: string | null;
    }) => Promise<NonNullable<LessonProgress>>,
  ) {}
  save(completed: boolean, positionSeconds: number): Promise<void> {
    if (this.failure) return Promise.reject(this.failure);
    this.pending = { completed, positionSeconds: lessonPosition(positionSeconds) };
    if (this.work) return this.work;
    this.work = (async () => {
      while (this.pending) {
        const next = this.pending;
        this.pending = null;
        this.current = await this.write({ ...next, expectedUpdatedAt: this.current?.updatedAt ?? null });
      }
    })()
      .catch((e) => {
        this.failure = e;
        this.pending = null;
        throw e;
      })
      .finally(() => {
        this.work = null;
      });
    return this.work;
  }
}
