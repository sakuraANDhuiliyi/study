export const androidBase = '/mobile/android-studio';
export type AndroidStatus = {
  available: boolean;
  reason: string;
  ai?: { available: boolean; reason: string };
};
export type AndroidProject = {
  id: string;
  name: string;
  package: string;
  hasApk: boolean;
  createdAt: string | null;
  latestStatus: string;
  buildLogs: { id: string }[];
};
export type AndroidFile = {
  path: string;
  content: string;
  revision: string;
  writable: boolean;
  truncated: boolean;
};
export type AndroidJob = {
  id: string;
  projectId: string;
  status: string;
  prompt: string;
  result: string;
  error: string;
  hasApk: boolean;
  runMode: string;
};
export type AndroidBuild = {
  status: 'running' | 'cancel_requested' | 'succeeded' | 'failed';
  startedAt: string;
  completedAt: string | null;
  message: string;
};
export const androidTaskActive = (status: string) =>
  ['queued', 'running', 'paused', 'awaiting_approval', 'cancel_requested'].includes(status);
export const androidTaskStatus = (status: string) =>
  ({
    queued: '等待执行',
    running: '正在执行',
    paused: '已暂停',
    awaiting_approval: '等待你的确认',
    cancel_requested: '正在取消',
    succeeded: '执行完成',
    failed: '执行失败',
    canceled: '已取消',
    interrupted: '执行中断',
  })[status] ||
  status ||
  '尚未执行';
export function nativePreviewUrl(
  platformOrigin: string,
  preview: { url: string; origin: string; expiresAt: string },
) {
  const platform = new URL(platformOrigin),
    origin = new URL(preview.origin),
    url = new URL(preview.url);
  if (
    !['http:', 'https:'].includes(url.protocol) ||
    url.protocol !== origin.protocol ||
    url.origin !== origin.origin ||
    origin.hostname === platform.hostname ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    origin.username ||
    origin.password ||
    origin.pathname !== '/' ||
    origin.search ||
    origin.hash ||
    !/^\/preview\/[a-f0-9]{64}\/index\.html$/.test(url.pathname) ||
    !Number.isFinite(Date.parse(preview.expiresAt)) ||
    Date.parse(preview.expiresAt) <= Date.now()
  )
    throw new Error('预览地址无效或已过期，请重新生成');
  if (url.protocol === 'http:' && !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname))
    throw new Error('预览需要独立 HTTPS 地址');
  return url.href;
}
