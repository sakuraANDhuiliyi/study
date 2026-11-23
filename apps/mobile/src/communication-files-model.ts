import type { MobileClient } from './client';
export type CommunicationFile = { id: string; name: string; mime: string; size: number };
export type CommunicationFileScope = { kind: 'course' | 'conversation'; id: string };
export type CommunicationFilePage = {
  items: CommunicationFile[];
  total: number;
  page: number;
  pageSize: number;
  maxUploadBytes: number;
};
export function communicationFilesPath(scope: CommunicationFileScope) {
  if (!/^[A-Za-z0-9_-]{1,100}$/.test(scope.id)) throw new Error('附件所属范围无效');
  return scope.kind === 'course'
    ? '/mobile/discussions/courses/' + scope.id + '/files'
    : '/mobile/messages/conversations/' + scope.id + '/files';
}
export function confirmedCommunicationFile(value: unknown): CommunicationFile {
  const f = value as CommunicationFile;
  if (
    !f ||
    !/^[A-Za-z0-9_-]{1,100}$/.test(f.id) ||
    typeof f.name !== 'string' ||
    !f.name ||
    f.name.length > 255 ||
    typeof f.mime !== 'string' ||
    !f.mime ||
    !Number.isSafeInteger(f.size) ||
    f.size < 1 ||
    f.size > 50 * 1024 * 1024
  )
    throw new Error('上传回执无效，请先核对服务器本人附件列表');
  return { id: f.id, name: f.name, mime: f.mime, size: f.size };
}
export function addCommunicationFile(items: CommunicationFile[], file: CommunicationFile) {
  const f = confirmedCommunicationFile(file);
  if (items.some((r) => r.id === f.id)) return items;
  if (items.length >= 10) throw new Error('一次发布最多10个附件');
  return [...items, f];
}
export function communicationFileIds(items: CommunicationFile[]) {
  if (items.length > 10 || new Set(items.map((r) => r.id)).size !== items.length)
    throw new Error('附件数量或标识重复');
  return items.map((f) => confirmedCommunicationFile(f).id);
}
export const communicationFilesApi = {
  list: (c: MobileClient, s: CommunicationFileScope, page = 1) =>
    c.request<CommunicationFilePage>(communicationFilesPath(s) + '?page=' + page + '&pageSize=10'),
  remove: (c: MobileClient, s: CommunicationFileScope, id: string) =>
    c.request(communicationFilesPath(s) + '/' + encodeURIComponent(id), undefined, 'DELETE'),
};
