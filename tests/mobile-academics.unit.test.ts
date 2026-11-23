import test from 'node:test';
import assert from 'node:assert/strict';
import { mobileAcademicRouteAllowed as allowed } from '../apps/api/src/mobile/mobile-academics.policy';
import { mobileAcademicRecordQuery } from '../apps/api/src/mobile/mobile-academics.schemas';
import { academicModules } from '../apps/api/src/academics/academics.modules';
import { publicAcademicModule, validateModuleValues } from '../apps/api/src/academics/academics.engine';
import {
  academicForm,
  academicValues,
  academicNotes,
  reconcileAcademicEdit,
  type AcademicModule,
  type AcademicRecord,
} from '../apps/mobile/src/academics-model';

test('native academic allowlist exposes only explicit student learning reads and writes', () => {
  for (const [method, paths] of Object.entries({
    GET: ['catalog', 'me', 'records', 'modules/circuit-lab', 'records/record-1', 'goals'],
    POST: ['modules/circuit-lab/evaluate', 'records/export', 'goals'],
    PATCH: ['preferences', 'records/record-1', 'goals/goal-1'],
    DELETE: ['records/record-1', 'goals/goal-1'],
  }))
    for (const path of paths)
      assert.equal(allowed('/api/mobile/academics/' + path, method), true, method + path);
  for (const path of [
    '/api/academics/catalog',
    '/api/mobile/academics/admin/subjects',
    '/api/mobile/academics/admin/majors',
    '/api/mobile/academics/modules/x/evaluate/extra',
    '/api/mobile/academics/modules/%2e%2e',
    '/api/mobile/academics/records/x/notes',
    '/api/mobile/academics/catalog/',
  ])
    for (const method of ['GET', 'POST', 'PATCH', 'DELETE'])
      assert.equal(allowed(path, method), false, method + path);
  assert.equal(allowed('/api/mobile/academics/preferences', 'PUT'), false);
  assert.equal(allowed('/api/mobile/academics/catalog', 'POST'), false);
});
test('record query rejects mass assignment, duplicate query values and unbounded pages', () => {
  assert.deepEqual(mobileAcademicRecordQuery.parse({ page: '2', moduleId: 'circuit-lab', status: 'DRAFT' }), {
    page: 2,
    pageSize: 12,
    moduleId: 'circuit-lab',
    status: 'DRAFT',
  });
  for (const input of [
    { page: true },
    { page: ['1'] },
    { pageSize: 21 },
    { page: 0 },
    { userId: 'other' },
    { organizationId: 'other' },
    { status: ['all'] },
    { status: 'done' },
  ])
    assert.equal(mobileAcademicRecordQuery.safeParse(input).success, false);
});
test('all published tools can render native fields and preserve usable default types without leaking quiz keys', () => {
  const types = new Set<string>();
  for (const original of academicModules) {
    const module = publicAcademicModule(original) as AcademicModule;
    if (module.kind === 'algorithm') continue;
    const values = academicForm(module);
    for (const field of module.fields) {
      types.add(field.type);
      assert.ok(
        typeof values[field.key] === (field.type === 'checkbox' ? 'boolean' : 'string'),
        module.id + ':' + field.key,
      );
    }
    if (module.kind === 'quiz') {
      assert.ok(!JSON.stringify(module).includes('correctChoiceId'));
      assert.throws(() => academicValues(module, values));
      values.answers = Object.fromEntries((module.questions || []).map((q) => [q.id, q.choices[0].id]));
    }
    const submitted = academicValues(module, values);
    assert.doesNotThrow(() => validateModuleValues(original, submitted), module.id);
  }
  for (const kind of ['number', 'select', 'textarea', 'json', 'matrix', 'checkbox'])
    assert.ok(types.has(kind), kind);
});
test('native forms preserve empty optional fields and whitespace, reject missing/nonfinite/integer values, reset fields on older snapshots', () => {
  const module = publicAcademicModule(
    academicModules.find((m) => m.id === 'digital-logic')!,
  ) as AcademicModule;
  const restored = academicForm(module, { expression: '  A && B\n' });
  assert.equal(restored.compareExpression, '');
  assert.equal(academicValues(module, restored).expression, '  A && B\n');
  const matrix = publicAcademicModule(
    academicModules.find((m) => m.id === 'confusion-matrix')!,
  ) as AcademicModule;
  for (const value of ['', 'Infinity', 'abc', '1.5', '-1', '1000001'])
    assert.throws(() => academicValues(matrix, { ...academicForm(matrix), tp: value }));
  assert.equal(academicValues(matrix, { ...academicForm(matrix), tp: '0' }).tp, 0);
});
test('notes retain literal Unicode and pending record changes reconcile without replay', () => {
  assert.equal(academicNotes('  <vector>\n😀  '), '  <vector>\n😀  ');
  assert.equal(academicNotes(''), '');
  assert.throws(() => academicNotes('a\0b'));
  assert.throws(() => academicNotes('学'.repeat(12001)));
  const base = {
    id: 'r',
    moduleId: 'circuit-lab',
    revision: 2,
    title: '旧实验',
    notes: '旧笔记',
    status: 'DRAFT',
  } as AcademicRecord;
  const intent = { title: '新实验', notes: '新笔记', status: 'COMPLETED' as const };
  assert.equal(reconcileAcademicEdit(base, intent, { ...base, ...intent, revision: 3 }), 'applied');
  assert.equal(reconcileAcademicEdit(base, intent, base), 'unchanged');
  for (const current of [
    { ...base, ...intent, revision: 4 },
    { ...base, ...intent, revision: 3, id: 'other' },
    { ...base, ...intent, revision: 3, notes: '不同' },
  ])
    assert.equal(reconcileAcademicEdit(base, intent, current), 'conflict');
});
