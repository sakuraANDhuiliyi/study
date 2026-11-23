import type { MobileClient } from './client';
export const programmingRoot = '/mobile/programming';
export type ProjectFile = { path: string; content: string };
export type Project = {
  id: string;
  title: string;
  templateId: string;
  revision: number;
  files: ProjectFile[];
  createdAt: string;
  updatedAt: string;
};
export type ProjectSummary = Omit<Project, 'files'> & { fileCount: number };
export type ProjectBackup = {
  format: 'zhixue-programming';
  version: 1;
  title: string;
  templateId: string;
  files: ProjectFile[];
};
export type ProjectVersion = {
  id: string;
  number: number;
  note: string;
  createdAt: string;
  title?: string;
  files?: ProjectFile[];
};
export type ProjectTemplate = {
  id: 'starter' | 'counter' | 'todo';
  title: string;
  description: string;
  files: ProjectFile[];
};
export type ProgrammingStatus = {
  ai: { available: boolean; reason: string; model: string };
  limits: {
    maxProjects: number;
    maxFiles: number;
    maxVersions: number;
    maxAiDrafts: number;
    dailyRequests: number;
  };
};
export type ProgrammingDraft = {
  id: string;
  projectId: string;
  baseRevision: number;
  status: 'pending' | 'ready' | 'failed' | 'applied';
  prompt: string;
  summary: string;
  plan?: string[];
  teaching?: string[];
  files?: ProjectFile[];
  error?: string | null;
  createdAt: string;
};
export type CreativeIdea = {
  id: string;
  title: string;
  category: string;
  tags: string[];
  description: string;
  learningGoals: string[];
  saved: boolean;
  revision: string;
  source: {
    repository: string;
    commit: string;
    license: string;
    licenseText?: string;
    usageNotice?: string;
    scope?: string;
    changes?: string;
    videos: { platform: string; title: string; url: string }[];
  };
  files?: ProjectFile[];
};
export type CreativeList = {
  items: CreativeIdea[];
  total: number;
  totalCatalog: number;
  savedCount: number;
  categories: { name: string; count: number }[];
};
const path = (id: string) => programmingRoot + '/projects/' + encodeURIComponent(id);
export function sourceBytes(text: string) {
  let size = 0;
  for (const character of text) {
    const code = character.codePointAt(0)!;
    size += code <= 0x7f ? 1 : code <= 0x7ff ? 2 : code <= 0xffff ? 3 : 4;
  }
  return size;
}
export function validateProjectFiles(files: ProjectFile[]) {
  const pattern =
    /^(?:[A-Za-z0-9][A-Za-z0-9._-]*\/)*[A-Za-z0-9][A-Za-z0-9._-]*\.(?:html|css|js|json|md|txt|svg)$/;
  if (
    !Array.isArray(files) ||
    files.length < 1 ||
    files.length > 24 ||
    !files.some((file) => file && file.path === 'index.html')
  )
    throw new Error('项目需要 index.html，最多24个文件。');
  const names = new Set<string>();
  let bytes = 0;
  for (const file of files) {
    if (!file || typeof file !== 'object' || Array.isArray(file)) throw new Error('项目文件格式无效。');
    if (
      typeof file.path !== 'string' ||
      file.path.length > 160 ||
      !pattern.test(file.path) ||
      names.has(file.path.toLowerCase())
    )
      throw new Error('文件名须为不重复的普通相对路径，支持 html/css/js/json/md/txt/svg。');
    if (typeof file.content !== 'string' || file.content.includes('\0') || sourceBytes(file.content) > 65536)
      throw new Error('每个文件限64 KiB且不能包含空字符。');
    names.add(file.path.toLowerCase());
    bytes += sourceBytes(file.content);
  }
  if (bytes > 262144 || sourceBytes(JSON.stringify(files)) > 360000)
    throw new Error('项目总源码最多256 KiB，请减少内容。');
}
export function parseProjectBackup(value: unknown): ProjectBackup {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new Error('请选择有效的项目JSON备份。');
  const b = value as ProjectBackup;
  if (
    Object.keys(b).sort().join(',') !== 'files,format,templateId,title,version' ||
    b.format !== 'zhixue-programming' ||
    b.version !== 1 ||
    typeof b.title !== 'string' ||
    !b.title.trim() ||
    b.title.length > 160 ||
    typeof b.templateId !== 'string'
  )
    throw new Error('备份格式或版本无效。');
  validateProjectFiles(b.files);
  return b;
}
export const programmingApi = {
  create: (c: MobileClient, title: string, templateId: ProjectTemplate['id']) =>
    c.request<Project>(programmingRoot + '/projects', { title: title.trim(), templateId }, 'POST'),
  save: (c: MobileClient, project: Pick<Project, 'id' | 'revision' | 'title' | 'files'>) => {
    validateProjectFiles(project.files);
    return c.request<Project>(
      path(project.id),
      { revision: project.revision, title: project.title.trim(), files: project.files },
      'PATCH',
    );
  },
  version: (c: MobileClient, id: string, revision: number, note: string) =>
    c.request<{ project: Project; version: ProjectVersion }>(
      path(id) + '/versions',
      { revision, note: note.trim() || '手机保存快照' },
      'POST',
    ),
  restore: (c: MobileClient, id: string, revision: number, versionId: string) =>
    c.request<Project>(path(id) + '/restore', { revision, versionId }, 'POST'),
  duplicate: (c: MobileClient, id: string, revision: number, title: string) =>
    c.request<Project>(path(id) + '/duplicate', { revision, title: title.trim() }, 'POST'),
  remove: (c: MobileClient, id: string) => c.request(path(id), undefined, 'DELETE'),
  import: (c: MobileClient, backup: ProjectBackup) =>
    c.request<Project>(programmingRoot + '/projects/import', backup, 'POST'),
  generate: (c: MobileClient, id: string, revision: number, prompt: string) =>
    c.request<ProgrammingDraft>(path(id) + '/ai-drafts', { revision, prompt: prompt.trim() }, 'POST'),
  apply: (c: MobileClient, id: string, draftId: string, revision: number) =>
    c.request<{ project: Project; draft: ProgrammingDraft }>(
      path(id) + '/ai-drafts/' + encodeURIComponent(draftId) + '/apply',
      { revision },
      'POST',
    ),
  favorite: (c: MobileClient, id: string, saved: boolean) =>
    c.request(programmingRoot + '/creative/' + encodeURIComponent(id) + '/favorite', { saved }, 'PUT'),
  fromIdea: (c: MobileClient, idea: CreativeIdea, title: string) =>
    c.request<Project>(
      programmingRoot + '/creative/' + encodeURIComponent(idea.id) + '/projects',
      { revision: idea.revision, title: title.trim() },
      'POST',
    ),
};
