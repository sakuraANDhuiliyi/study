import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { App } from 'antd';
export type AnyRecord = Record<string, any>;
export type User = {
  id: string;
  name: string;
  username: string;
  role: string;
  roles: string[];
  permissions: string[];
  organizationId: string;
  accountMode?: 'PERSONAL' | 'ORGANIZATION';
  majorId?: string | null;
  major?: { id: string; name: string; subjectId: string; description: string; moduleIds: string[] } | null;
  canReturnToPersonal?: boolean;
};
let csrfToken = '';
let sessionScope = 'anonymous';
export const getCsrf = () => csrfToken;
export const setCsrf = (token: string) => {
  csrfToken = token;
};
export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
    public traceId?: string,
  ) {
    super(message);
  }
}
export async function api<T = any>(path: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers);
  if (!(init.body instanceof FormData) && init.body) headers.set('Content-Type', 'application/json');
  if (init.method && !['GET', 'HEAD'].includes(init.method)) headers.set('x-csrf-token', csrfToken);
  const res = await fetch(path.startsWith('/api') ? path : `/api${path}`, {
    ...init,
    headers,
    credentials: 'include',
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    if (res.status === 401 && !path.includes('/auth/')) window.dispatchEvent(new Event('auth-expired'));
    const fields = body.error?.fields || body.fields;
    const details = Array.isArray(fields)
      ? fields.map((field: any) => [field.field, field.message].filter(Boolean).join(': ')).join('；')
      : fields?.fieldErrors
        ? Object.entries(fields.fieldErrors)
            .map(([key, errors]) => `${key}: ${Array.isArray(errors) ? errors.join('；') : String(errors)}`)
            .join('；')
        : '';
    const message = Array.isArray(body.message)
      ? body.message.join('；')
      : body.message || body.error?.message || '请求失败，请稍后再试';
    throw new ApiError(
      res.status,
      details ? `${message}：${details.slice(0, 600)}` : message,
      body.error?.requestId || body.requestId,
    );
  }
  if (body.csrfToken) setCsrf(body.csrfToken);
  if (body.user) sessionScope = [body.user.organizationId, body.user.id, body.user.role].join(':');
  return body;
}
export const send = (path: string, body: unknown = {}, method = 'POST') =>
  api(path, { method, body: JSON.stringify(body) });
export const queryString = (params: Record<string, unknown>) => {
  const search = new URLSearchParams();
  Object.entries(params).forEach(([key, value]) => {
    if (value !== undefined && value !== null && value !== '') search.set(key, String(value));
  });
  return search.toString();
};
export function useData<T = any>(path: string, enabled = true, interval?: number) {
  return useQuery<T>({
    queryKey: [path, sessionScope],
    queryFn: () => api<T>(path),
    enabled,
    refetchInterval: interval,
    retry: (n, e) => (e instanceof ApiError && [401, 403, 404].includes(e.status) ? false : n < 1),
  });
}
export function useAction(success = '操作成功') {
  const client = useQueryClient();
  const { message } = App.useApp();
  return useMutation({
    mutationFn: ({ path, body, method }: { path: string; body?: unknown; method?: string }) =>
      send(path, body, method),
    onSuccess: async () => {
      await client.invalidateQueries();
      if (success) message.success(success);
    },
    onError: (error: Error) => message.error(error.message),
  });
}
export const labels: Record<string, string> = {
  STUDENT: '学生',
  TEACHER: '教师',
  ADMIN: '机构管理员',
  SUPER_ADMIN: '超级管理员',
  DRAFT: '草稿',
  PUBLISHED: '已发布',
  ARCHIVED: '已归档',
  UNPUBLISHED: '已下架',
  ACTIVE: '启用',
  DISABLED: '停用',
  SUBMITTED: '已提交',
  IN_PROGRESS: '作答中',
  TIMED_OUT: '超时交卷',
  GRADED: '已批改',
  PENDING: '待处理',
  RETURNED: '已退回',
  COMPLETED: '已完成',
  OPEN: '进行中',
  CLOSED: '已关闭',
  SINGLE: '单选题',
  MULTIPLE: '多选题',
  TRUE_FALSE: '判断题',
  FILL: '填空题',
  SHORT: '简答题',
  COMPOSITE: '综合题',
  TEXT: '图文课时',
  VIDEO: '视频课时',
  FILE: '附件课时',
  LINK: '外部链接',
};
Object.assign(labels, {
  SUCCEEDED: '已完成',
  RUNNING: '运行中',
  FAILED: '失败',
  RESOLVED: '已处理',
  PDF: 'PDF 课时',
  DOCUMENT: '文档课时',
  single: '单选题',
  multiple: '多选题',
  boolean: '判断题',
  blank: '填空题',
  short: '简答题',
  composite: '综合题',
  pending: '待批阅',
  graded: '已批阅',
  released: '成绩已发布',
  hidden: '尚未公开',
  not_submitted: '未提交',
  not_started: '未开始',
  exempt: '已豁免',
  late: '迟交',
  absent: '缺考',
  cancelled: '已取消',
  in_progress: '作答中',
  timed_out: '超时交卷',
});
export const label = (value: string) => labels[value] || labels[value?.toUpperCase()] || value || '—';
export const date = (value?: string, short = false) =>
  value
    ? new Intl.DateTimeFormat('zh-CN', {
        timeZone: 'Asia/Shanghai',
        month: '2-digit',
        day: '2-digit',
        ...(short ? {} : { hour: '2-digit', minute: '2-digit' }),
      }).format(new Date(value))
    : '—';
export const isTeacher = (u?: User) => !!u && ['TEACHER', 'ADMIN', 'SUPER_ADMIN'].includes(u.role);
export const isAdmin = (u?: User) => !!u && ['ADMIN', 'SUPER_ADMIN'].includes(u.role);
