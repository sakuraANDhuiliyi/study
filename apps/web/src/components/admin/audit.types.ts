export type AuditFilters = Partial<
  Record<
    'search' | 'action' | 'actorId' | 'resourceType' | 'resourceId' | 'requestId' | 'from' | 'to',
    string
  >
>;
export type AuditRecord = {
  id: string;
  createdAt: string;
  userId: string | null;
  actorName: string;
  action: string;
  resourceType: string | null;
  resourceId: string | null;
  requestId: string | null;
  details: unknown;
};
export type AuditResponse = { items: AuditRecord[]; total: number; page: number; pageSize: number };
export type AuditExportSnapshot = { filters: AuditFilters; total: number };
export const auditFilterLabels: Record<keyof AuditFilters, string> = {
  search: '综合关键词',
  action: '操作包含（兼容旧筛选）',
  actorId: '操作人 ID',
  resourceType: '资源类型',
  resourceId: '资源标识',
  requestId: '追踪 ID',
  from: '开始时间（北京时间）',
  to: '结束时间（北京时间）',
};
export const auditTimestamp = (value: string) =>
  new Intl.DateTimeFormat('zh-CN', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  }).format(new Date(value));

/** datetime-local is interpreted as Beijing time, regardless of browser timezone. */
export function auditInstant(local: string, label: string) {
  if (!local) return undefined;
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2})?$/.test(local))
    throw new Error(`${label}请输入有效日期与时间，精确到秒。`);
  const normalized = local.length === 16 ? `${local}:00` : local;
  const instant = new Date(`${normalized}+08:00`);
  if (
    !Number.isFinite(instant.valueOf()) ||
    Number(normalized.slice(0, 4)) < 1 ||
    new Date(instant.valueOf() + 8 * 60 * 60 * 1000).toISOString().slice(0, 19) !== normalized
  )
    throw new Error(`${label}请输入有效日期与时间。`);
  return `${normalized}+08:00`;
}
export function parseAuditDraft(draft: Record<keyof AuditFilters, string>): AuditFilters {
  const limits = {
    search: 200,
    action: 200,
    actorId: 128,
    resourceType: 100,
    resourceId: 256,
    requestId: 200,
  };
  const result: AuditFilters = {};
  for (const key of Object.keys(limits) as (keyof typeof limits)[]) {
    // Historical action contains keeps whitespace and case, unlike new filters.
    const value = key === 'action' ? draft[key] : draft[key].trim();
    if (!value) continue;
    if (value.length > limits[key] || value.includes('\0'))
      throw new Error(`${auditFilterLabels[key]}最多 ${limits[key]} 个字符，不能包含空字符。`);
    result[key] = value;
  }
  result.from = auditInstant(draft.from, '开始时间');
  result.to = auditInstant(draft.to, '结束时间');
  if (result.from && result.to && new Date(result.from) > new Date(result.to))
    throw new Error('结束时间不能早于开始时间。');
  return Object.fromEntries(Object.entries(result).filter(([, value]) => value !== undefined));
}
