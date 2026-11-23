import type { MobileClient } from './client';
export const academicRoot = '/mobile/academics';
export type ModuleKind = 'calculator' | 'quiz' | 'workspace' | 'algorithm' | 'sql';
export type ModuleSummary = {
  id: string;
  title: string;
  description: string;
  kind: ModuleKind;
  subjectIds: string[];
  tags: string[];
  estimatedMinutes: number;
};
export type AcademicMajor = {
  id: string;
  name: string;
  description: string;
  subjectId: string;
  moduleIds: string[];
  organizationId: string | null;
};
export type AcademicCatalog = {
  subjects: { id: string; name: string; description: string }[];
  majors: AcademicMajor[];
  modules: ModuleSummary[];
};
export type AcademicField = {
  key: string;
  label: string;
  type: 'number' | 'text' | 'textarea' | 'select' | 'json' | 'matrix' | 'checkbox';
  required?: boolean;
  min?: number;
  max?: number;
  step?: number;
  placeholder?: string;
  help?: string;
  options?: { value: string; label: string }[];
};
export type AcademicModule = ModuleSummary & {
  learningObjectives: string[];
  concepts: { title: string; content: string }[];
  instructions: string[];
  fields: AcademicField[];
  defaultValues: Record<string, unknown>;
  examples: { title: string; values: Record<string, unknown>; explanation: string }[];
  questions?: { id: string; prompt: string; choices: { id: string; label: string }[] }[];
  resources: { title: string; url: string }[];
};
export type AcademicResult = {
  summary: string;
  metrics: { label: string; value: string | number; unit?: string }[];
  tables: {
    title: string;
    columns: { key: string; title: string }[];
    rows: Record<string, string | number | boolean | null>[];
  }[];
  sections: { title: string; content: string; status?: string }[];
  chart?: { title: string; points: { x: number; y: number; label?: string }[] };
  categoryChart?: {
    title: string;
    categories: string[];
    series: { name: string; values: number[] }[];
    yAxisLabel?: string;
  };
};
export type AcademicRecord = {
  id: string;
  moduleId: string;
  title: string;
  values: Record<string, unknown>;
  result: AcademicResult;
  notes: string;
  status: 'DRAFT' | 'COMPLETED';
  revision: number;
  createdAt: string;
  updatedAt: string;
};
export type AcademicMe = {
  accountMode: 'PERSONAL' | 'ORGANIZATION';
  majorId: string | null;
  major: AcademicMajor | null;
  selectedModuleIds: string[];
  revision: number;
  stats: { records: number; completed: number; modulesPracticed: number };
  recentRecords: AcademicRecord[];
  recommendations: ModuleSummary[];
};
export type AcademicRecordsPage = { items: AcademicRecord[]; total: number; page: number; pageSize: number };
export type AcademicEdit = Pick<AcademicRecord, 'title' | 'notes' | 'status'>;
export type AcademicForm = Record<string, string | boolean | Record<string, string>>;
export const kindLabels: Record<ModuleKind, string> = {
  calculator: '计算实验',
  quiz: '知识测验',
  workspace: '学习工作台',
  algorithm: '算法练习',
  sql: 'SQL 实验',
};
export function academicForm(module: AcademicModule, source = module.defaultValues): AcademicForm {
  const values: AcademicForm = {};
  for (const field of module.fields) {
    const value = source[field.key];
    values[field.key] =
      field.type === 'checkbox'
        ? value === true
        : value == null
          ? ''
          : typeof value === 'object'
            ? JSON.stringify(value, null, 2)
            : String(value);
  }
  if (module.kind === 'quiz') {
    const supplied =
      source.answers && typeof source.answers === 'object' && !Array.isArray(source.answers)
        ? (source.answers as Record<string, unknown>)
        : {};
    values.answers = Object.fromEntries(
      (module.questions || [])
        .filter((q) => typeof supplied[q.id] === 'string')
        .map((q) => [q.id, supplied[q.id] as string]),
    );
  }
  return values;
}
export function academicValues(module: AcademicModule, form: AcademicForm): Record<string, unknown> {
  if (module.kind === 'quiz') {
    const answers = typeof form.answers === 'object' ? form.answers : {};
    for (const q of module.questions || [])
      if (!q.choices.some((c) => c.id === answers[q.id])) throw new Error('请完成所有题目后提交');
    return { answers };
  }
  return Object.fromEntries(
    module.fields.map((field) => {
      if (field.type === 'checkbox') return [field.key, form[field.key] === true];
      const text = typeof form[field.key] === 'string' ? (form[field.key] as string) : '';
      if (!text.trim() && field.required) throw new Error('请填写' + field.label);
      if (field.type === 'number') {
        if (!text.trim()) return [field.key, undefined];
        const value = Number(text);
        if (
          !Number.isFinite(value) ||
          (field.min != null && value < field.min) ||
          (field.max != null && value > field.max)
        )
          throw new Error(field.label + '超出允许的数值范围');
        if (field.step === 1 && !Number.isInteger(value)) throw new Error(field.label + '必须是整数');
        return [field.key, value];
      }
      if (field.type === 'select' && text && !field.options?.some((o) => o.value === text))
        throw new Error('请重新选择' + field.label);
      return [field.key, text];
    }),
  );
}
export function academicNotes(value: string) {
  const bytes = Array.from(value).reduce(
    (n, c) =>
      n +
      (c.codePointAt(0)! <= 0x7f ? 1 : c.codePointAt(0)! <= 0x7ff ? 2 : c.codePointAt(0)! <= 0xffff ? 3 : 4),
    0,
  );
  if (value.includes('\0') || value.length > 12000 || bytes > 36000)
    throw new Error('笔记最多12000字符、36000字节，不能包含空字符');
  return value;
}
export function reconcileAcademicEdit(base: AcademicRecord, intent: AcademicEdit, current: AcademicRecord) {
  if (current.id !== base.id || current.moduleId !== base.moduleId) return 'conflict';
  const same = (v: AcademicEdit) =>
    v.title === intent.title && v.notes === intent.notes && v.status === intent.status;
  if (current.revision === base.revision + 1 && same(current)) return 'applied';
  if (
    current.revision === base.revision &&
    current.title === base.title &&
    current.notes === base.notes &&
    current.status === base.status
  )
    return 'unchanged';
  return 'conflict';
}
export function academicRecordPath(id: string) {
  return academicRoot + '/records/' + encodeURIComponent(id);
}
export const academicsApi = {
  record: (client: MobileClient, id: string) => client.request<AcademicRecord>(academicRecordPath(id)),
  saveRecord: (client: MobileClient, base: AcademicRecord, edit: AcademicEdit) =>
    client.request<AcademicRecord>(
      academicRecordPath(base.id),
      { revision: base.revision, ...edit, notes: academicNotes(edit.notes) },
      'PATCH',
    ),
};

export type AcademicGoal = {
  id: string;
  moduleId: string;
  title: string;
  targetCount: number;
  dueDate: string | null;
  archived: boolean;
  revision: number;
  createdAt: string;
  updatedAt: string;
  progressCount: number;
  completed: boolean;
  unit: '次' | '题';
  overdue: boolean;
};
