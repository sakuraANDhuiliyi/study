import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Alert, Button, Input, Spin, Tag } from 'antd';
import { ApiError, queryString } from '../../api';
import { useAuth } from '../../auth';
import type { LearningActionDomain, LearningFilters } from './action-domain';
import './learning-filters.css';

type Courses = { items: { id: string; title: string }[]; total: number; page: number; pageSize: number };
type Choice = { id: string; title: string; snapshot: Courses; generation: number };
const sourceLabels = { all: '全部来源', personal: '个人待办', assignment: '作业', exam: '考试' };
export function ActionFilters({
  domain,
  filters,
  busy,
  onApply,
}: {
  domain: LearningActionDomain;
  filters: LearningFilters;
  busy: boolean;
  onApply: (filters: LearningFilters) => void;
}) {
  const { user } = useAuth();
  const canCourse = !!user?.permissions.includes('course.read');
  const [draft, setDraft] = useState<LearningFilters>({ type: 'all' });
  const [choice, setChoice] = useState<Choice>(),
    [appliedChoice, setAppliedChoice] = useState<Choice>();
  const [opened, setOpened] = useState(false),
    [search, setSearch] = useState(''),
    [lookup, setLookup] = useState(''),
    [page, setPage] = useState(1);
  const enabled = canCourse && draft.type !== 'personal' && opened;
  const raw = useQuery<Courses>({
    queryKey: [...domain.scope, 'courses', lookup, page],
    queryFn: ({ signal }) =>
      domain.request<Courses>(
        '/planner/actions/courses?' + queryString({ search: lookup, page, pageSize: 20 }),
        { signal },
        true,
        (body) => {
          if (
            !Array.isArray(body.items) ||
            !Number.isSafeInteger(body.total) ||
            body.total < 0 ||
            body.page !== page ||
            body.pageSize !== 20 ||
            body.items.some((item) => typeof item.id !== 'string' || typeof item.title !== 'string')
          )
            throw new ApiError(502, '授权课程响应不完整，请重试。');
        },
      ),
    enabled,
    retry: false,
    staleTime: 0,
    structuralSharing: false,
  });
  const query = { ...raw, ...domain.expose(raw) };
  useEffect(() => {
    if (!query.data) return;
    const snapshot = query.data;
    const chosen = snapshot.items.find((item) => item.id === draft.courseId);
    const applied = snapshot.items.find((item) => item.id === filters.courseId);
    if (chosen) setChoice({ ...chosen, snapshot, generation: domain.generation.current });
    if (applied) setAppliedChoice({ ...applied, snapshot, generation: domain.generation.current });
  }, [query.data, draft.courseId, filters.courseId]);
  const caption = (selection?: Choice) =>
    selection?.generation === domain.generation.current && domain.trusted(selection?.snapshot)
      ? selection?.title
      : '所选课程（等待权限确认）';
  const options = query.data?.items ?? [];
  const shownChoice = draft.courseId && !options.some((item) => item.id === draft.courseId);
  return (
    <div className="learning-filters">
      <form
        aria-label="学习行动筛选"
        onSubmit={(event) => {
          event.preventDefault();
          if (busy) return;
          onApply({ ...draft });
          setAppliedChoice(choice);
        }}
      >
        <label>
          <span>来源</span>
          <select
            aria-label="学习行动来源"
            value={draft.type}
            disabled={busy}
            onChange={(event) => {
              const type = event.target.value as LearningFilters['type'];
              setDraft((value) => ({
                ...value,
                type,
                ...(type === 'personal' ? { courseId: undefined } : {}),
              }));
              if (type === 'personal') setChoice(undefined);
            }}
          >
            {(Object.entries(sourceLabels) as [LearningFilters['type'], string][])
              .filter(([type]) => canCourse || type === 'all' || type === 'personal')
              .map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
          </select>
        </label>
        {canCourse && (
          <label>
            <span>课程范围</span>
            <select
              aria-label="学习行动课程"
              value={draft.courseId ?? ''}
              disabled={busy || draft.type === 'personal'}
              onChange={(event) => {
                const id = event.target.value;
                setDraft((value) => ({ ...value, courseId: id || undefined }));
                const item = options.find((item) => item.id === id);
                setChoice(
                  item && query.data
                    ? { ...item, snapshot: query.data, generation: domain.generation.current }
                    : undefined,
                );
              }}
            >
              <option value="">全部课程及个人待办</option>
              {shownChoice && <option value={draft.courseId}>{caption(choice)}</option>}
              {options.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.title}
                </option>
              ))}
            </select>
          </label>
        )}
        <div className="learning-filter-buttons">
          {canCourse && (
            <Button disabled={busy || draft.type === 'personal'} onClick={() => setOpened((value) => !value)}>
              {opened ? '收起课程选择' : '选择课程'}
            </Button>
          )}
          <Button type="primary" htmlType="submit" disabled={busy}>
            应用学习筛选
          </Button>
          <Button
            disabled={busy}
            onClick={() => {
              setDraft({ type: 'all' });
              setChoice(undefined);
              setAppliedChoice(undefined);
              onApply({ type: 'all' });
            }}
          >
            重置学习筛选
          </Button>
        </div>
      </form>
      {enabled && (
        <div className="learning-course-picker" role="region" aria-label="授权课程选择">
          <form
            onSubmit={(event) => {
              event.preventDefault();
              if (!busy) {
                setLookup(search);
                setPage(1);
              }
            }}
          >
            <Input
              aria-label="查找授权课程"
              maxLength={100}
              value={search}
              disabled={busy}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="按课程名称字面查找"
            />
            <Button htmlType="submit" disabled={busy || raw.isFetching}>
              查找课程
            </Button>
            <Button disabled={busy || raw.isFetching} onClick={() => void raw.refetch()}>
              刷新课程选项
            </Button>
          </form>
          {query.isLoading && (
            <p role="status" aria-label="课程选项加载状态">
              <Spin size="small" /> 正在加载授权课程…
            </p>
          )}
          {query.error && (
            <Alert
              type="error"
              showIcon
              message={
                query.error instanceof ApiError && query.error.status >= 400 && query.error.status < 500
                  ? '当前无权查看课程选项，请确认资格或筛选'
                  : query.data
                    ? '暂时无法刷新，正在显示上次授权课程选项'
                    : '暂时无法加载授权课程，请确认权限后重试'
              }
              description={query.error instanceof Error ? query.error.message : undefined}
              action={
                <Button disabled={busy || raw.isFetching} onClick={() => void raw.refetch()}>
                  重试课程选项
                </Button>
              }
            />
          )}
          {query.data && (
            <>
              <p role="status" aria-label="课程选项匹配数量">
                找到 {query.data.total} 门授权课程；第 {query.data.page} 页。请在课程范围中选择。
              </p>
              {query.data.total === 0 && <p>没有匹配的授权课程。</p>}
              <div className="learning-filter-buttons">
                <Button
                  disabled={busy || raw.isFetching || page <= 1}
                  onClick={() => setPage((value) => value - 1)}
                >
                  课程上一页
                </Button>
                <Button
                  disabled={busy || raw.isFetching || page * query.data.pageSize >= query.data.total}
                  onClick={() => setPage((value) => value + 1)}
                >
                  课程下一页
                </Button>
              </div>
            </>
          )}
        </div>
      )}
      <div aria-label="已应用的学习筛选" className="learning-filter-applied">
        <strong>已应用：</strong>
        <Tag>{sourceLabels[filters.type]}</Tag>
        <Tag>
          {!canCourse
            ? '本人个人待办（当前无课程查看权限）'
            : filters.courseId
              ? caption(appliedChoice)
              : filters.type === 'personal'
                ? '本人个人待办'
                : '全部课程及个人待办'}
        </Tag>
      </div>
      <p className="learning-filter-hint">
        筛选仅影响下方三个时间桶，不改变学习概览全量指标。个人待办未归属课程；选定课程只显示该课程作业和考试。
      </p>
    </div>
  );
}
