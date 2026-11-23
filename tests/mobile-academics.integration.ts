import 'reflect-metadata';
import test from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { createLiveFixture, liveWait } from './live.fixture';
import { MobileClient } from '../apps/mobile/src/client';
import {
  academicRoot as root,
  academicForm,
  academicValues,
  academicsApi,
  type AcademicCatalog,
  type AcademicMe,
  type AcademicModule,
  type AcademicRecord,
  type AcademicRecordsPage,
} from '../apps/mobile/src/academics-model';
import type { AcademicGoal } from '../apps/mobile/src/academics-model';
import { academicModules } from '../apps/api/src/academics/academics.modules';

test(
  'native academics uses real shared tools, private records, goals and file exports with fresh mobile permissions',
  { timeout: 240000 },
  async (t) => {
    const f = await createLiveFixture();
    const make = () => {
      let raw: string | null = null;
      return new MobileClient(
        f.origin,
        {
          get: async () => raw,
          set: async (value) => {
            raw = value;
          },
          remove: async () => {
            raw = null;
          },
        },
        () => {},
      );
    };
    const login = async (username: string) => {
      const c = make();
      await c.login(username, f.password);
      return c;
    };
    const denied = (promise: Promise<unknown>, status: number) =>
      assert.rejects(promise, (e) => (e as { status: number }).status === status);
    let student = await login(f.users.student.username);
    const other = await login(f.users.student2.username),
      foreign = await login(f.users.outsider.username),
      teacher = await login(f.users.teacher.username);
    const evaluate = (
      client: MobileClient,
      moduleId: string,
      values: Record<string, unknown>,
      title?: string,
    ) =>
      client.request<{ record: AcademicRecord; result: AcademicRecord['result'] }>(
        root + '/modules/' + moduleId + '/evaluate',
        { values, ...(title ? { title } : {}) },
        'POST',
      );
    let record: AcademicRecord, goal: AcademicGoal;
    try {
      await t.test(
        'bounded native-only student routes deny cookie users, teachers, unknown fields and foreign administration',
        async () => {
          assert.equal((await fetch(f.origin + '/api' + root + '/catalog')).status, 401);
          await f.call(f.clients.student, root + '/catalog', 'GET', undefined, 403);
          await denied(teacher.request(root + '/catalog'), 403);
          await denied(student.request('/academics/catalog'), 403);
          for (const query of [
            '?page=0',
            '?pageSize=21',
            '?page=1&page=2',
            '?userId=other',
            '?status=invalid',
          ])
            await denied(student.request(root + '/records' + query), 400);
          await denied(student.request(root + '/admin/subjects'), 404);
          const catalog = await student.request<AcademicCatalog>(root + '/catalog');
          assert.equal(catalog.modules.length, academicModules.length);
          const quiz = await student.request<AcademicModule>(root + '/modules/anatomy-quiz');
          assert.ok(quiz.questions?.length);
          assert.ok(!JSON.stringify(quiz).includes('correctChoiceId'));
          await denied(
            student.request(
              root + '/preferences',
              { revision: 0, selectedModuleIds: [], organizationId: 'foreign' },
              'PATCH',
            ),
            400,
          );
        },
      );
      await t.test(
        'personal major and free modules persist; organization major stays administrator controlled',
        async () => {
          const personal = make();
          await personal.register({
            username: 'native_academic_' + randomBytes(6).toString('hex'),
            password: f.password,
            name: '手机专业学习测试',
          });
          const catalog = await personal.request<AcademicCatalog>(root + '/catalog'),
            me = await personal.request<AcademicMe>(root + '/me');
          const major = catalog.majors.find((m) => m.organizationId === null)!;
          assert.ok(major);
          const chosen = ['circuit-lab', 'study-notebook', 'sql-lab'];
          await personal.request(
            root + '/preferences',
            { revision: me.revision, selectedModuleIds: chosen, majorId: major.id },
            'PATCH',
          );
          const fresh = await personal.request<AcademicMe>(root + '/me');
          assert.equal(fresh.majorId, major.id);
          assert.deepEqual(fresh.selectedModuleIds, chosen);
          await denied(
            personal.request(
              root + '/preferences',
              { revision: me.revision, selectedModuleIds: [] },
              'PATCH',
            ),
            409,
          );
          const organization = await student.request<AcademicMe>(root + '/me');
          await denied(
            student.request(
              root + '/preferences',
              { revision: organization.revision, selectedModuleIds: chosen, majorId: major.id },
              'PATCH',
            ),
            403,
          );
          await student.request(
            root + '/preferences',
            { revision: organization.revision, selectedModuleIds: chosen },
            'PATCH',
          );
          assert.deepEqual((await student.request<AcademicMe>(root + '/me')).selectedModuleIds, chosen);
          await personal.clear();
        },
      );
      await t.test(
        'real calculators, JSON/matrix, SQL, quiz and free notes save their actual result snapshots',
        async () => {
          for (const moduleId of ['circuit-lab', 'matrix-lab', 'sql-lab', 'anatomy-quiz', 'study-notebook']) {
            const module = await student.request<AcademicModule>(root + '/modules/' + moduleId);
            const form = academicForm(module);
            if (module.kind === 'quiz')
              form.answers = Object.fromEntries(module.questions!.map((q) => [q.id, q.choices[0].id]));
            const saved = await evaluate(
              student,
              moduleId,
              academicValues(module, form),
              '原生实验 ' + moduleId,
            );
            assert.equal(saved.record.status, 'COMPLETED');
            assert.deepEqual(saved.record.result, saved.result);
            assert.deepEqual(
              (await academicsApi.record(student, saved.record.id)).values,
              saved.record.values,
            );
            if (moduleId === 'circuit-lab') {
              record = saved.record;
              assert.ok(saved.result.metrics.some((m) => m.value === 600));
            }
            if (module.kind === 'sql') assert.ok(saved.result.tables.some((table) => table.rows.length > 0));
            if (module.kind === 'quiz') assert.equal(saved.result.sections.length, module.questions!.length);
          }
          const before = await student.request<AcademicRecordsPage>(root + '/records');
          await denied(evaluate(student, 'confusion-matrix', { tp: 0, fp: 0, fn: 0, tn: 0 }), 400);
          await denied(
            evaluate(student, 'sql-lab', { exercise: 'high-scores', query: 'DELETE FROM students' }),
            400,
          );
          const after = await student.request<AcademicRecordsPage>(root + '/records');
          assert.equal(after.total, before.total);
          const web = (await f.call(f.clients.student, '/academics/records/' + record.id)).body;
          assert.deepEqual(web, record);
          for (const c of [other, foreign]) {
            await denied(academicsApi.record(c, record.id), 404);
            await denied(c.request(root + '/records/' + record.id, undefined, 'DELETE'), 404);
            assert.equal((await c.request<AcademicRecordsPage>(root + '/records')).total, 0);
          }
        },
      );
      await t.test(
        'notes and status preserve Unicode, CAS conflicts never overwrite another version',
        async () => {
          const saved = await academicsApi.saveRecord(student, record, {
            title: '电路观察',
            notes: 'PRIVATE_NATIVE_NOTE\n<vector> 😀',
            status: 'DRAFT',
          });
          await denied(
            academicsApi.saveRecord(student, record, { title: 'stale', notes: 'lost', status: 'COMPLETED' }),
            409,
          );
          assert.equal((await academicsApi.record(student, record.id)).notes, saved.notes);
          const own = await student.request<AcademicRecordsPage>(
            root + '/records?moduleId=circuit-lab&status=DRAFT',
          );
          assert.equal(own.total, 1);
          assert.equal(own.items[0].id, record.id);
          await denied(
            other.request(
              root + '/records/' + record.id,
              { revision: saved.revision, notes: 'other' },
              'PATCH',
            ),
            404,
          );
          record = saved;
        },
      );
      await t.test(
        'goals count only completed records after creation and support revision archive/restore/delete',
        async () => {
          goal = await student.request<AcademicGoal>(
            root + '/goals',
            { moduleId: 'circuit-lab', title: '三次电路练习', targetCount: 3, dueDate: '2030-12-31' },
            'POST',
          );
          assert.equal(goal.progressCount, 0);
          const module = await student.request<AcademicModule>(root + '/modules/circuit-lab');
          const later = (await evaluate(student, module.id, module.defaultValues)).record;
          const get = async () =>
            (await student.request<{ items: AcademicGoal[] }>(root + '/goals?status=all')).items.find(
              (g) => g.id === goal.id,
            )!;
          assert.equal((await get()).progressCount, 1);
          const draft = await academicsApi.saveRecord(student, later, {
            title: later.title,
            notes: '',
            status: 'DRAFT',
          });
          assert.equal((await get()).progressCount, 0);
          await academicsApi.saveRecord(student, draft, {
            title: later.title,
            notes: '',
            status: 'COMPLETED',
          });
          assert.equal((await get()).progressCount, 1);
          const archived = await student.request<AcademicGoal>(
            root + '/goals/' + goal.id,
            { revision: goal.revision, archived: true },
            'PATCH',
          );
          assert.equal(archived.archived, true);
          await denied(
            student.request(root + '/goals/' + goal.id, { revision: goal.revision, title: 'stale' }, 'PATCH'),
            409,
          );
          const restored = await student.request<AcademicGoal>(
            root + '/goals/' + goal.id,
            { revision: archived.revision, archived: false },
            'PATCH',
          );
          await denied(
            other.request(root + '/goals/' + goal.id, { revision: restored.revision }, 'DELETE'),
            404,
          );
          await student.request(root + '/records/' + later.id, undefined, 'DELETE');
          assert.equal((await get()).progressCount, 0);
          await student.request(root + '/goals/' + goal.id, { revision: restored.revision }, 'DELETE');
        },
      );
      await t.test(
        'CSV and Markdown are real bounded download bytes with own saved contents only',
        async () => {
          const csv = await student.request<Uint8Array>(
            root + '/records/export',
            { format: 'csv', moduleId: 'circuit-lab', status: 'DRAFT', limit: 5000 },
            'POST',
            { binary: true },
          );
          assert.deepEqual([...csv.slice(0, 3)], [239, 187, 191]);
          const csvText = new TextDecoder().decode(csv);
          assert.ok(csvText.includes('电路观察'));
          assert.ok(csvText.includes('有笔记'));
          assert.ok(!csvText.includes('PRIVATE_NATIVE_NOTE'));
          const md = await student.request<Uint8Array>(
            root + '/records/export',
            { format: 'md', moduleId: 'circuit-lab', status: 'DRAFT', limit: 20 },
            'POST',
            { binary: true },
          );
          const text = new TextDecoder().decode(md);
          assert.ok(text.includes('PRIVATE_NATIVE_NOTE'));
          assert.ok(text.includes('<vector> 😀'));
          assert.ok(text.includes('resistances'));
          assert.ok(text.includes(record.result.summary));
          const empty = await other.request<Uint8Array>(
            root + '/records/export',
            { format: 'md', status: 'all', limit: 20 },
            'POST',
            { binary: true },
          );
          assert.ok(!new TextDecoder().decode(empty).includes('PRIVATE_NATIVE_NOTE'));
          await denied(student.request(root + '/records/export', { format: 'md', limit: 51 }, 'POST'), 400);
        },
      );
      await t.test(
        'queued sensitive writes reject a removed native credential after the user lock',
        async () => {
          student = await login(f.users.student.username);
          const session = await f.db.session.findFirstOrThrow({
            where: { userId: f.users.student.id, clientType: 'MOBILE' },
            orderBy: { createdAt: 'desc' },
          });
          const initial = await academicsApi.record(student, record.id);
          let release!: () => void, ready!: () => void;
          const gate = new Promise<void>((r) => {
              release = r;
            }),
            acquired = new Promise<void>((r) => {
              ready = r;
            });
          const held = f.db.$transaction(
            async (tx) => {
              await tx.$queryRaw`SELECT "id" FROM "User" WHERE "id" = ${f.users.student.id} FOR UPDATE`;
              ready();
              await gate;
              await tx.mobileCredential.delete({ where: { sessionId: session.id } });
            },
            { timeout: 15000 },
          );
          await acquired;
          const pending = academicsApi.saveRecord(student, initial, {
            title: initial.title,
            notes: 'REVOKED_WRITE',
            status: initial.status,
          });
          await liveWait(120);
          release();
          await held;
          await assert.rejects(pending);
          assert.equal(
            (await f.db.academicsRecord.findUniqueOrThrow({ where: { id: record.id } })).notes,
            initial.notes,
          );
        },
      );
    } finally {
      await f.cleanup();
    }
  },
);
