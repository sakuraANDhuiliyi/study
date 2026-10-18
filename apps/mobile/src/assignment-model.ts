export type AnswerLeaf = string | boolean | string[] | null;
export type AnswerValue = AnswerLeaf | Record<string, AnswerLeaf>;
export type Answers = Record<string, AnswerValue>;
export type Question = {
  id: string;
  type: string;
  stem: string;
  scoreCents: number;
  options: { id: string; text: string }[];
  children: Question[];
  answer?: unknown;
  explanation?: string;
};
export type AssignmentFile = { id: string; name: string; mime: string; size: number };
export type Submitted = {
  id: string;
  version: number;
  idempotencyKey: string;
  submittedAt: string;
  status: string;
  gradingStatus: string;
  late: boolean;
  releasedAt: string | null;
  scoreCents: number | null;
  answers: { questionVersionId: string; value: AnswerValue }[];
  attachmentIds: string[];
  feedback: string;
  grading: {
    revision: number;
    comment: string;
    items: { questionVersionId: string; scoreCents: number; comment: string }[];
  }[];
};
export type AssignmentSummary = {
  id: string;
  title: string;
  courseId: string;
  courseTitle: string;
  opensAt: string;
  dueAt: string;
  totalCents: number;
  maxAttempts: number;
  latest: Pick<Submitted, 'version' | 'status' | 'gradingStatus' | 'releasedAt' | 'scoreCents'> | null;
};
export type AssignmentDetail = {
  id: string;
  title: string;
  description: string;
  courseId: string;
  opensAt: string;
  dueAt: string;
  totalCents: number;
  maxAttempts: number;
  allowLate: boolean;
  serverTime: string;
  items: { id: string; questionVersionId: string; question: Question }[];
  draft: {
    revision: number;
    answers: { questionVersionId: string; value: AnswerValue }[];
    attachmentIds: string[];
  } | null;
  exception: { exempt: boolean; allowUntil: string | null; extraAttempts: number; reason: string } | null;
  mySubmissions: Submitted[];
  attachmentIds: string[];
  files: AssignmentFile[];
  maxUploadBytes: number;
};
export function answerMap(rows: { questionVersionId: string; value: AnswerValue }[]): Answers {
  return Object.fromEntries(rows.map((x) => [x.questionVersionId, x.value]));
}
export function answerRows(answers: Answers) {
  return Object.entries(answers).map(([questionVersionId, value]) => ({ questionVersionId, value }));
}
export function answered(value: AnswerValue | undefined): boolean {
  if (value === null || value === undefined || value === '') return false;
  if (typeof value === 'string') return value.trim().length > 0;
  if (typeof value === 'boolean') return true;
  if (Array.isArray(value)) return value.some((v) => !!v.trim());
  return Object.values(value).some(answered);
}
export function assignmentWindow(d: AssignmentDetail, now: number) {
  const effectiveDue = Math.max(
    Date.parse(d.dueAt),
    d.exception?.allowUntil ? Date.parse(d.exception.allowUntil) : 0,
  );
  const limit = d.maxAttempts + (d.exception?.extraAttempts || 0);
  const used = Math.max(0, ...d.mySubmissions.map((s) => s.version));
  const reason = d.exception?.exempt
    ? '本人已获作业豁免，无需提交。'
    : now < Date.parse(d.opensAt)
      ? '作业尚未开放。'
      : !d.allowLate && now > effectiveDue
        ? '作业已截止，可向教师申请补交。'
        : used >= limit
          ? '已达提交次数上限，可向教师申请重交。'
          : '';
  return { reason, canWrite: !reason, effectiveDue, used, limit };
}
export function money(value: number | null | undefined) {
  return typeof value === 'number' && Number.isFinite(value)
    ? (value / 100).toFixed(2).replace(/\.00$/, '')
    : '待发布';
}
export function decodeText(value: string) {
  return value.replace(
    /&(?:#(x[0-9a-f]+|\d+)|(amp|lt|gt|quot|apos|nbsp));/gi,
    (match, number: string | undefined, named: string | undefined) => {
      if (number) {
        const code = number[0].toLowerCase() === 'x' ? parseInt(number.slice(1), 16) : parseInt(number, 10);
        return code > 0 && code <= 0x10ffff && !(code >= 0xd800 && code <= 0xdfff)
          ? String.fromCodePoint(code)
          : '\ufffd';
      }
      return (
        ({ amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' } as Record<string, string>)[
          named!.toLowerCase()
        ] || match
      );
    },
  );
}
export function richParts(html: string): { kind: 'text' | 'image'; value: string; alt?: string }[] {
  const clean = html.replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1>/gi, '');
  const parts: { kind: 'text' | 'image'; value: string; alt?: string }[] = [];
  const text = (raw: string) => {
    const value = decodeText(
      raw.replace(/<\/(?:p|h[1-6]|li|blockquote|div)>|<br\s*\/?>/gi, '\n').replace(/<[^>]*>/g, ''),
    ).trim();
    if (value) parts.push({ kind: 'text', value });
  };
  let at = 0;
  for (const m of clean.matchAll(/<img\b[^>]*>/gi)) {
    text(clean.slice(at, m.index));
    at = m.index! + m[0].length;
    const src = /\bsrc\s*=\s*["']([^"']+)["']/i.exec(m[0])?.[1];
    const alt = decodeText(/\balt\s*=\s*["']([^"']*)["']/i.exec(m[0])?.[1] || '题目图片');
    try {
      const url = new URL(decodeText(src || ''));
      if (url.protocol === 'https:' && !url.username && !url.password)
        parts.push({ kind: 'image', value: url.href, alt });
      else parts.push({ kind: 'text', value: alt + '（不支持的图片地址）' });
    } catch {
      parts.push({ kind: 'text', value: alt + '（图片地址无效）' });
    }
  }
  text(clean.slice(at));
  return parts;
}
export function safeFileName(name: string) {
  return (
    name
      .replace(/[\\/\x00-\x1f\x7f:*?"<>|]/g, '_')
      .replace(/^\.+/, '_')
      .slice(-100) || '作业附件'
  );
}

/** Reference rows only exist when the server has explicitly published answers. */
export function referenceRows(
  question: Question,
  label = '评分参考',
): { label: string; answer: unknown; explanation?: string; stem: string }[] {
  if (question.type === 'composite')
    return question.children.flatMap((child, index) =>
      referenceRows(child, label + ' · 子题 ' + (index + 1)),
    );
  return Object.hasOwn(question, 'answer')
    ? [{ label, answer: question.answer, explanation: question.explanation, stem: question.stem }]
    : [];
}
