import test from 'node:test';
import assert from 'node:assert/strict';
import { evaluateWorkspaceModule } from '../apps/api/src/academics/tools-workspace';
import { humanitiesModules } from '../apps/api/src/academics/academics.modules-humanities';
import type { StudyResult } from '../apps/api/src/academics/academics.types';
const moduleById = (id: string) => humanitiesModules.find((module) => module.id === id)!;
const evaluate = (id: string, overrides: Record<string, unknown> = {}) => {
  const module = moduleById(id);
  return evaluateWorkspaceModule(module, { ...module.defaultValues, ...overrides });
};
const metric = (result: StudyResult, label: string) =>
  result.metrics.find((item) => item.label === label)!.value;

test('建筑面积按空间核算及预算余量，超预算显示warning', () => {
  const normal = evaluate('architecture-studio');
  assert.equal(metric(normal, '空间合计面积'), 120);
  assert.equal(metric(normal, '剩余面积预算'), 0);
  const excess = evaluate('architecture-studio', { areaBudget: 100 });
  assert.equal(metric(excess, '剩余面积预算'), -20);
  assert.match(excess.summary, /超出/);
});
test('建筑空间限制负数、过多项目和未知JSON属性', () => {
  for (const rooms of [
    [{ name: '教室', area: -1 }],
    Array.from({ length: 31 }, () => ({ name: '教室', area: 1 })),
    [{ name: '教室', area: 1, unsafe: true }],
  ])
    assert.throws(() => evaluate('architecture-studio', { rooms }));
});
test('教学活动累积开始结束与课时超时准确', () => {
  const result = evaluate('education-design');
  assert.equal(metric(result, '活动总时长'), 45);
  assert.equal(metric(result, '课时剩余'), 0);
  const timetable = result.tables.find((item) => item.title === '教学活动时间表')!;
  assert.deepEqual(
    timetable.rows.map((row) => [row.start, row.end]),
    [
      [0, 5],
      [5, 20],
      [20, 35],
      [35, 45],
    ],
  );
  assert.match(evaluate('education-design', { minutes: 30 }).summary, /超过/);
});
test('教学活动必须有正时长与评价依据，阶段数量有界', () => {
  for (const plan of [
    [{ phase: '开始', minutes: 0, activity: '练习', assessment: '复述' }],
    [{ phase: '开始', minutes: 1, activity: '练习', assessment: '' }],
    Array.from({ length: 16 }, () => ({ phase: '开始', minutes: 1, activity: '练习', assessment: '复述' })),
  ])
    assert.throws(() => evaluate('education-design', { plan }));
});
test('史料整数年代稳定排序，同年来源不合并、不丢失', () => {
  const result = evaluate('history-research', {
    timeline: [
      { year: 10, title: '晚', source: '原文B' },
      { year: -5, title: '早', source: '档案A' },
      { year: 10, title: '同年另一来源', source: '材料C' },
    ],
  });
  const rows = result.tables.find((item) => item.title === '年代顺序')!.rows;
  assert.deepEqual(
    rows.map((row) => [row.year, row.source]),
    [
      [-5, '档案A'],
      [10, '原文B'],
      [10, '材料C'],
    ],
  );
  assert.equal(metric(result, '最早年份'), -5);
});
test('史料拒绝非整数年份、缺失来源和超出条数', () => {
  for (const timeline of [
    [{ year: 1.5, title: '事件', source: '来源' }],
    [{ year: 1, title: '事件', source: '' }],
    Array.from({ length: 31 }, () => ({ year: 1, title: '事件', source: '来源' })),
  ])
    assert.throws(() => evaluate('history-research', { timeline }));
});
test('行程时长、预算和人均按明细精确核算，支持小数数量按分舍入', () => {
  const normal = evaluate('tourism-planning');
  assert.equal(metric(normal, '日程合计'), 150);
  assert.equal(metric(normal, '预算合计'), '70.00');
  assert.equal(metric(normal, '人均预算'), '7.00');
  const fractional = evaluate('tourism-planning', {
    budget: [{ item: '按单位分摊', unitPrice: 0.01, quantity: 1.5 }],
    people: 2,
  });
  assert.equal(metric(fractional, '预算合计'), '0.02');
  assert.equal(metric(fractional, '人均预算'), '0.01');
  const halfCent = evaluate('tourism-planning', {
    budget: [{ item: '按人数分摊', unitPrice: 0.03, quantity: 1 }],
    people: 2,
  });
  assert.equal(metric(halfCent, '人均预算'), '0.02');
});
test('行程和预算拒绝负价、负时长、无效人数与超量精度', () => {
  for (const overrides of [
    { budget: [{ item: '资料', unitPrice: -1, quantity: 1 }] },
    { budget: [{ item: '资料', unitPrice: 1, quantity: 0.0001 }] },
    { people: 0 },
    { people: 1.5 },
    { itinerary: [{ activity: '活动', minutes: -1 }] },
  ])
    assert.throws(() => evaluate('tourism-planning', overrides));
});
test('翻译仅检查术语两侧字符串出现，明确不判断语义准确', () => {
  const normal = evaluate('translation-studio');
  assert.equal(metric(normal, '两侧均出现的术语数'), 2);
  const result = evaluate('translation-studio', {
    terms: [{ source: 'Machine learning', target: '不存在的词' }],
  });
  assert.equal(metric(result, '两侧均出现的术语数'), 0);
  assert.match(result.sections.find((item) => item.title === '术语检查边界')!.content, /不验证.*准确/);
});
test('术语表限制空白、单项长度和数量，不接受脚本式对象', () => {
  for (const terms of [
    [{ source: '', target: '词' }],
    [{ source: 'a'.repeat(161), target: '词' }],
    Array.from({ length: 31 }, () => ({ source: 'a', target: '词' })),
    [{ source: { value: 'script' }, target: '词' }],
  ])
    assert.throws(() => evaluate('translation-studio', { terms }));
});
test('独立学习笔记保留主题、正文预览、标签去重和后续行动', () => {
  const result = evaluate('study-notebook', {
    title: '我的笔记',
    body: '第一段\n\n第二段',
    tags: '数学, 复习，数学',
    nextAction: '',
  });
  assert.equal(metric(result, '标签数'), 2);
  assert.equal(metric(result, '文本段落数'), 4);
  assert.equal(result.sections.find((item) => item.title === '笔记主题')!.content, '我的笔记');
  assert.equal(result.sections.find((item) => item.title === '正文预览')!.content, '第一段\n\n第二段');
  assert.equal(result.sections.find((item) => item.title === '下一步行动')!.status, 'warning');
});
test('独立笔记限制正文、标签、主题和整体字节，不补造空内容', () => {
  for (const overrides of [
    { body: '' },
    { body: 'a'.repeat(12001) },
    { title: 'a'.repeat(161) },
    { tags: Array.from({ length: 21 }, (_, i) => `tag${i}`).join(',') },
    { tags: 'a'.repeat(41) },
    { body: '中'.repeat(12000), nextAction: '中'.repeat(12000) },
  ])
    assert.throws(() => evaluate('study-notebook', overrides));
});
test('18类工作台均以实际字段工作，只返回结构统计和对应专业复盘', () => {
  assert.equal(humanitiesModules.length, 18);
  for (const module of humanitiesModules) {
    const result = evaluateWorkspaceModule(module, module.defaultValues);
    assert.match(result.summary, /结构检查/);
    assert.ok(result.sections.find((item) => item.title === '专业复盘问题')?.content);
    assert.ok(Buffer.byteLength(JSON.stringify(result), 'utf8') <= 65536);
    const required = module.fields.find((field) => field.required)!;
    assert.throws(() =>
      evaluateWorkspaceModule(module, { ...module.defaultValues, [required.key]: undefined }),
    );
    assert.throws(() => evaluateWorkspaceModule(module, { ...module.defaultValues, injected: 'unexpected' }));
  }
});
