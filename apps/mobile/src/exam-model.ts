import type { MobileClient } from './client';
import { answerMap, answerRows, type Answers, type AnswerValue, type Question } from './assignment-model';
export type ExamRecord = {
  id: string;
  number: number;
  status: string;
  deadlineAt: string;
  submittedAt?: string | null;
};
export type ExamDetail = {
  id: string;
  title: string;
  description: string;
  status: string;
  startsAt: string;
  endsAt: string;
  entryClosesAt: string;
  durationMinutes: number;
  maxAttempts: number;
  totalCents: number;
  allowBacktrack: boolean;
  eligible: boolean;
  attempts: ExamRecord[];
  serverTime: string;
  extension: { deadlineAt: string; extraAttempts: number } | null;
};
export type ExamAttempt = ExamRecord & {
  examId: string;
  revision: number;
  currentPosition: number;
  flags: string[];
  serverTime: string;
  lastSavedAt: string | null;
  gradingStatus: string;
  releaseStatus: string;
  scoreCents: number | null;
  feedback?: string;
  scoreAdjustmentCents?: number;
  exam: {
    id: string;
    title: string;
    description: string;
    allowBacktrack: boolean;
    totalCents: number;
    passCents: number;
  };
  items: Question[];
  answers: { questionVersionId: string; value: AnswerValue; scoreCents?: number | null; comment?: string }[];
};
export type ExamSave = {
  revision: number;
  answers: ReturnType<typeof answerRows>;
  flags: string[];
  currentPosition: number;
};
export function secondsLeft(deadline: string, serverTime: string, receivedAt: number, now: number) {
  return Math.max(
    0,
    Math.ceil((Date.parse(deadline) - Date.parse(serverTime) - Math.max(0, now - receivedAt)) / 1000),
  );
}
export function examEntry(d: ExamDetail, now: number) {
  if (d.status !== 'published') return '考试已取消或尚未发布';
  if (!d.eligible) return '当前没有参考资格';
  if (now < Date.parse(d.startsAt)) return '考试尚未开始';
  if (now >= Date.parse(d.extension?.deadlineAt || d.entryClosesAt)) return '已超过允许进入的时间';
  if (d.attempts.length >= d.maxAttempts + (d.extension?.extraAttempts || 0)) return '已达作答次数上限';
  return '';
}
/** Single writer: immutable snapshots, CAS, no retry of an uncertain write until server reload. */
export class ExamWriter {
  answers: Answers;
  flags: string[];
  position: number;
  revision: number;
  private generation = 0;
  private savedGeneration = 0;
  private flight: Promise<void> | null = null;
  error: Error | null = null;
  lastSavedAt: string | null;
  constructor(
    readonly initial: ExamAttempt,
    private send: (body: ExamSave) => Promise<{ revision: number; lastSavedAt: string }>,
  ) {
    this.answers = answerMap(initial.answers);
    this.flags = [...initial.flags];
    this.position = initial.currentPosition;
    this.revision = initial.revision;
    this.lastSavedAt = initial.lastSavedAt;
  }
  async settled() {
    if (this.flight) await this.flight.catch(() => undefined);
  }
  get dirty() {
    return this.generation !== this.savedGeneration;
  }
  change(id: string, value: AnswerValue) {
    if (this.error) throw this.error;
    if (!this.initial.exam.allowBacktrack && this.initial.items[this.position]?.id !== id)
      throw new Error('本考试不允许修改其他题目');
    this.answers = { ...this.answers, [id]: value };
    this.generation++;
  }
  flag(id: string) {
    if (this.error) throw this.error;
    this.flags = this.flags.includes(id) ? this.flags.filter((x) => x !== id) : [...this.flags, id];
    this.generation++;
  }
  async move(next: number) {
    if (this.error) throw this.error;
    if (next < 0 || next >= this.initial.items.length) return;
    if (!this.initial.exam.allowBacktrack && next !== this.position + 1)
      throw new Error('本考试不允许返回或跳题');
    await this.save();
    this.position = next;
    this.generation++;
    await this.save();
  }
  async save(): Promise<void> {
    if (this.error) throw this.error;
    if (this.flight) {
      await this.flight;
      return this.save();
    }
    if (!this.dirty) return;
    const generation = this.generation;
    const rows = this.initial.exam.allowBacktrack
      ? this.answers
      : Object.fromEntries(
          Object.entries(this.answers).filter(([id]) => id === this.initial.items[this.position]?.id),
        );
    const body: ExamSave = JSON.parse(
      JSON.stringify({
        revision: this.revision,
        answers: answerRows(rows),
        flags: this.flags,
        currentPosition: this.position,
      }),
    );
    this.flight = (async () => {
      try {
        const result = await this.send(body);
        this.revision = result.revision;
        this.lastSavedAt = result.lastSavedAt;
        this.savedGeneration = generation;
      } catch (e) {
        this.error = e instanceof Error ? e : new Error('保存失败，请核对服务器答卷');
        throw this.error;
      } finally {
        this.flight = null;
      }
    })();
    await this.flight;
    if (this.dirty) await this.save();
  }
}

/** Keep the shared MobileClient positional request contract in one tested adapter. */
export const examApi = {
  start: (client: MobileClient, id: string) =>
    client.request<ExamAttempt>('/mobile/exams/' + encodeURIComponent(id) + '/start', {}, 'POST'),
  load: (client: MobileClient, id: string) =>
    client.request<ExamAttempt>('/mobile/exam-attempts/' + encodeURIComponent(id)),
  save: (client: MobileClient, id: string, body: ExamSave) =>
    client.request<{ revision: number; lastSavedAt: string }>(
      '/mobile/exam-attempts/' + encodeURIComponent(id) + '/answers',
      body,
      'PUT',
    ),
  submit: (client: MobileClient, id: string, idempotencyKey: string) =>
    client.request<ExamAttempt>(
      '/mobile/exam-attempts/' + encodeURIComponent(id) + '/submit',
      { idempotencyKey },
      'POST',
    ),
};

export function nativeExamPage(path: string | null | undefined) {
  const match = /^\/(exams|exam-attempts)\/([a-zA-Z0-9_-]+)$/.exec(path || '');
  return match
    ? { pathname: match[1] === 'exams' ? '/exams/[id]' : '/exam-attempts/[id]', params: { id: match[2] } }
    : null;
}
