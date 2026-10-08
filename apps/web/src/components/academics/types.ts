export type ModuleKind = 'calculator' | 'quiz' | 'workspace' | 'algorithm' | 'sql';
export type Subject = {
  id: string;
  name: string;
  description: string;
  active: boolean;
  revision: number;
  organizationId: string | null;
};
export type Major = Subject & { subjectId: string; moduleIds: string[] };
export type ModuleSummary = {
  id: string;
  title: string;
  description: string;
  kind: ModuleKind;
  subjectIds: string[];
  tags: string[];
  estimatedMinutes: number;
};
export type ModuleField = {
  key: string;
  label: string;
  type: 'number' | 'text' | 'textarea' | 'select' | 'json' | 'matrix' | 'checkbox';
  required?: boolean;
  min?: number;
  max?: number;
  step?: number;
  placeholder?: string;
  help?: string;
  options?: { value: string | number; label: string }[];
};
export type LearningModule = ModuleSummary & {
  learningObjectives: string[];
  concepts: { title: string; content: string }[];
  instructions: string[];
  fields: ModuleField[];
  defaultValues: Record<string, unknown>;
  examples: { title: string; values: Record<string, unknown>; explanation: string }[];
  questions?: { id: string; prompt: string; choices: { id: string; label: string }[] }[];
  resources: { title: string; url: string }[];
};
export type LearningResult = {
  summary: string;
  metrics: { label: string; value: string | number; unit?: string }[];
  tables: {
    title: string;
    columns: { key: string; title: string }[];
    rows: Record<string, string | number | boolean | null>[];
  }[];
  sections: { title: string; content: string; status?: 'success' | 'warning' | 'info' }[];
  chart?: { title: string; points: { x: number; y: number; label?: string }[] };
};
export type LearningRecord = {
  id: string;
  moduleId: string;
  title: string;
  values: Record<string, unknown>;
  result: LearningResult;
  status: 'DRAFT' | 'COMPLETED';
  revision: number;
  notes: string;
  createdAt: string;
  updatedAt: string;
};
export type Catalog = { subjects: Subject[]; majors: Major[]; modules: ModuleSummary[] };
export type Preferences = { revision: number; selectedModuleIds: string[]; majorId?: string | null };
export type AcademicHomeData = Preferences & {
  accountMode: 'PERSONAL' | 'ORGANIZATION';
  major: Major | null;
  stats: { records: number; completed: number; modulesPracticed: number };
  recentRecords: LearningRecord[];
  recommendations: ModuleSummary[];
};
export const kindLabels: Record<ModuleKind, string> = {
  calculator: '计算实验',
  quiz: '概念练习',
  workspace: '学习工作台',
  algorithm: '算法编程',
  sql: 'SQL 实验',
};
