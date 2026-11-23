import { test } from 'node:test';
import assert from 'node:assert/strict';
import { focusSummary, focusInput, focusQuery } from '../apps/api/src/focus/focus-data';

const dto = {
  title: '  课后复习  ',
  category: null,
  mode: 'FOCUS',
  plannedMinutes: 25,
  actualSeconds: 90,
  status: 'COMPLETED',
  startedAt: '2026-01-01T08:00:00+08:00',
  endedAt: '2026-01-01T00:02:00Z',
};

test('专注写入保留实际用时，拒绝无时区、未来和伪造时长', () => {
  const saved = focusInput.parse(dto);
  assert.equal(saved.title, '课后复习');
  assert.equal(saved.startedAt.toISOString(), '2026-01-01T00:00:00.000Z');
  assert.equal(saved.reflection, null);
  assert.ok(
    focusInput.safeParse({ ...dto, plannedMinutes: 180, actualSeconds: 1, reflection: 'x'.repeat(500) })
      .success,
  );
  for (const patch of [
    { userId: 'spoof' },
    { title: ' ' },
    { title: 'x'.repeat(121) },
    { reflection: 'a'.repeat(501) },
    { plannedMinutes: 181 },
    { plannedMinutes: 0 },
    { actualSeconds: 0 },
    { actualSeconds: 14401 },
    { actualSeconds: 1.5 },
    { actualSeconds: 121 },
    { plannedMinutes: '25' },
    { category: '未定义领域' },
    { reflection: '包含\0字节' },
    { endedAt: '2026-01-01T00:02:00' },
    { endedAt: new Date(Date.now() + 60000).toISOString() },
    { startedAt: dto.endedAt },
    { endedAt: '2026-01-01T00:02:00+25:00' },
    { status: 'running' },
    { mode: 'FREE' },
  ])
    assert.equal(focusInput.safeParse({ ...dto, ...patch }).success, false, JSON.stringify(patch));
});

test('专注历史分页、状态与分类仅接收有界的标量', () => {
  assert.deepEqual(focusQuery.parse({}), { page: 1, pageSize: 20 });
  assert.deepEqual(
    focusQuery.parse({ page: '2', pageSize: '10', category: '复习整理', status: 'ABANDONED' }),
    {
      page: 2,
      pageSize: 10,
      category: '复习整理',
      status: 'ABANDONED',
    },
  );
  for (const query of [
    { page: ['1'] },
    { page: '2.5' },
    { pageSize: '0' },
    { pageSize: '101' },
    { page: '100001' },
    { organizationId: 'x' },
    { status: 'all' },
    { category: ['课程学习'] },
  ])
    assert.equal(focusQuery.safeParse(query).success, false);
});

test('北京时间跨年、周一起算，逐日以秒合计后再折算分钟', () => {
  const rows = [
    { date: '2026-12-31', seconds: 70, completedCount: 1 },
    { date: '2027-01-01', seconds: 40, completedCount: 2 },
    { date: '2027-01-02', seconds: 25, completedCount: 1 },
    { date: '2027-01-03', seconds: 121, completedCount: 1 },
  ];
  const sunday = focusSummary(rows, new Date('2027-01-03T15:59:59.999Z'));
  assert.deepEqual(
    [sunday.todayMinutes, sunday.weekMinutes, sunday.weekSeconds, sunday.streakDays, sunday.completedCount],
    [2, 4, 256, 4, 5],
  );
  const monday = focusSummary(rows, new Date('2027-01-03T16:00:00Z'));
  assert.deepEqual(
    monday.days.map((d) => d.date),
    ['2026-12-29', '2026-12-30', '2026-12-31', '2027-01-01', '2027-01-02', '2027-01-03', '2027-01-04'],
  );
  assert.deepEqual(
    [monday.todayMinutes, monday.weekSeconds, monday.streakDays, monday.completedCount],
    [0, 0, 4, 5],
  );
  assert.equal(monday.days[3].seconds, 40);
  assert.equal(focusSummary(rows, new Date('2027-01-04T16:00:00Z')).streakDays, 0);
  const empty = focusSummary([], new Date('2027-01-04T16:00:00Z'));
  assert.equal(empty.days.length, 7);
  assert.ok(empty.days.every((day) => day.seconds === 0 && day.completedCount === 0));
  assert.equal(empty.completedCount, 0);
});
