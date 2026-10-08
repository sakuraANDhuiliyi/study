export type ModuleKind = 'calculator' | 'quiz' | 'workspace' | 'algorithm' | 'sql';
export interface ModuleField {
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
}
export interface StudyQuestion {
  id: string;
  prompt: string;
  choices: { id: string; label: string }[];
  correctChoiceId: string;
  explanation: string;
}
export interface StudyModule {
  id: string;
  title: string;
  description: string;
  kind: ModuleKind;
  subjectIds: string[];
  tags: string[];
  estimatedMinutes: number;
  learningObjectives: string[];
  concepts: { title: string; content: string }[];
  instructions: string[];
  fields: ModuleField[];
  defaultValues: Record<string, unknown>;
  examples: { title: string; values: Record<string, unknown>; explanation: string }[];
  questions?: StudyQuestion[];
  resources: { title: string; url: string }[];
}
export interface ModuleSummary {
  id: string;
  title: string;
  description: string;
  kind: ModuleKind;
  subjectIds: string[];
  tags: string[];
  estimatedMinutes: number;
}
export type ResultCell = string | number | boolean | null;
export interface StudyResult {
  summary: string;
  metrics: { label: string; value: string | number; unit?: string }[];
  tables: { title: string; columns: { key: string; title: string }[]; rows: Record<string, ResultCell>[] }[];
  sections: { title: string; content: string; status?: 'success' | 'warning' | 'info' }[];
  chart?: { title: string; points: { x: number; y: number; label?: string }[] };
  categoryChart?: {
    title: string;
    categories: string[];
    series: { name: string; values: number[] }[];
    yAxisLabel: string;
  };
}
export interface SubjectTemplate {
  id: string;
  name: string;
  description: string;
}
export interface MajorTemplate {
  id: string;
  name: string;
  description: string;
  subjectId: string;
  moduleIds: string[];
}
export const moduleSummary = (module: StudyModule): ModuleSummary => ({
  id: module.id,
  title: module.title,
  description: module.description,
  kind: module.kind,
  subjectIds: module.subjectIds,
  tags: module.tags,
  estimatedMinutes: module.estimatedMinutes,
});
export const numberField = (key: string, label: string, min = -1e9, max = 1e9): ModuleField => ({
  key,
  label,
  type: 'number',
  required: true,
  min,
  max,
  step: [
    'prefix',
    'splitPrefix',
    'shift',
    'clusters',
    'iterations',
    'midi',
    'semitones',
    'trials',
    'successes',
    'servings',
    'compounds',
    'visits',
    'leads',
    'sales',
    'days',
    'driverTeeth',
    'drivenTeeth',
  ].includes(key)
    ? 1
    : key === 'intervals'
      ? 2
      : 0.01,
});
export const textField = (
  key: string,
  label: string,
  help = '',
  type: ModuleField['type'] = 'textarea',
): ModuleField => ({ key, label, type, required: true, help });
export const selectField = (key: string, label: string, options: [string, string][]): ModuleField => ({
  key,
  label,
  type: 'select',
  required: true,
  options: options.map(([value, label]) => ({ value, label })),
});
export const table = (title: string, keys: [string, string][], rows: Record<string, ResultCell>[]) => ({
  title,
  columns: keys.map(([key, title]) => ({ key, title })),
  rows,
});
export const result = (
  summary: string,
  metrics: StudyResult['metrics'] = [],
  sections: StudyResult['sections'] = [],
  tables: StudyResult['tables'] = [],
): StudyResult => ({ summary, metrics, sections, tables });
export const makeModule = (
  definition: Omit<StudyModule, 'tags' | 'estimatedMinutes' | 'instructions' | 'examples' | 'resources'> &
    Partial<Pick<StudyModule, 'tags' | 'estimatedMinutes' | 'instructions' | 'examples' | 'resources'>>,
): StudyModule => ({
  tags: [],
  estimatedMinutes: 20,
  instructions: [
    '阅读原理与输入单位，先用示例核对结果。',
    '改变一个参数，观察输出如何变化，并记录原因。',
    '保存一次完整练习，再在学习记录中补充自己的总结。',
  ],
  examples: [
    {
      title: '起步示例',
      values: definition.defaultValues,
      explanation: '先运行此组参数，再对照原理手工复核。',
    },
  ],
  resources: [],
  ...definition,
});
