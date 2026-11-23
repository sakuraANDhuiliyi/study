import test from 'node:test';
import assert from 'node:assert/strict';
import { createLiveFixture } from './live.fixture';
import { MobileApiError, MobileClient } from '../apps/mobile/src/client';
import {
  programmingRoot as root,
  programmingApi,
  type Project,
  type ProjectBackup,
  type ProjectVersion,
  type CreativeIdea,
  type CreativeList,
  type ProgrammingStatus,
} from '../apps/mobile/src/programming-model';
function zipFiles(bytes: Uint8Array) {
  const data = Buffer.from(bytes),
    files: { path: string; content: string }[] = [];
  let cursor = 0;
  while (data.readUInt32LE(cursor) === 0x04034b50) {
    assert.equal(data.readUInt16LE(cursor + 8), 0);
    const size = data.readUInt32LE(cursor + 18),
      name = data.readUInt16LE(cursor + 26),
      extra = data.readUInt16LE(cursor + 28),
      start = cursor + 30 + name + extra;
    assert.ok(start + size <= data.length);
    files.push({
      path: data.subarray(cursor + 30, cursor + 30 + name).toString('utf8'),
      content: data.subarray(start, start + size).toString('utf8'),
    });
    cursor = start + size;
  }
  assert.equal(data.readUInt32LE(cursor), 0x02014b50);
  return files;
}
test(
  'native programming and creative workspace: real private projects, revisions, portable sources and reviewed drafts',
  { timeout: 180000 },
  async (t) => {
    const f = await createLiveFixture();
    const mobile = async (username: string) => {
      let saved: string | null = null;
      const c = new MobileClient(
        f.origin,
        {
          get: async () => saved,
          set: async (v) => {
            saved = v;
          },
          remove: async () => {
            saved = null;
          },
        },
        () => {},
      );
      await c.login(username, f.password);
      return c;
    };
    const denied = (p: Promise<unknown>, status: number) =>
      assert.rejects(p, (e) => e instanceof MobileApiError && e.status === status);
    try {
      const student = await mobile(f.users.student.username),
        other = await mobile(f.users.student2.username),
        outsider = await mobile(f.users.outsider.username),
        teacher = await mobile(f.users.teacher.username);
      let project: Project,
        versionId = '',
        backup: ProjectBackup,
        creative: CreativeIdea,
        creativeProject: Project;
      const read = (id = project.id) => student.request<Project>(root + '/projects/' + id);
      await t.test(
        'student-only native routes retain feature scope and reject preview/agent paths',
        async () => {
          assert.equal((await fetch(f.origin + '/api' + root + '/templates')).status, 401);
          await f.call(f.clients.student, root + '/templates', 'GET', undefined, 403);
          await denied(teacher.request(root + '/templates'), 403);
          await denied(student.request('/programming/projects'), 403);
          for (const path of [root + '/projects/p1/preview', root + '/creative/x/preview'])
            await denied(student.request(path, {}, 'POST'), 404);
          await denied(student.request('/programming/projects/p1/preview', {}, 'POST'), 403);
          await denied(student.request('/programming/android/status'), 403);
          for (const query of ['?page=1&page=2', '?pageSize=21', '?organizationId=other'])
            await denied(student.request(root + '/projects' + query), 400);
          const status = await student.request<ProgrammingStatus>(root + '/status');
          assert.equal(status.ai.available, false);
          assert.deepEqual(Object.keys(status).sort(), ['ai', 'limits']);
          const templates = await student.request<{ items: { id: string }[] }>(root + '/templates');
          assert.deepEqual(
            templates.items.map((t) => t.id),
            ['starter', 'counter', 'todo'],
          );
        },
      );
      await t.test(
        'create/edit actual files with compare-and-swap and reject traversal or owner spoofing',
        async () => {
          project = await programmingApi.create(student, '原生项目', 'counter');
          assert.equal(project.revision, 0);
          const saved = await programmingApi.save(student, {
            ...project,
            title: '原生项目已编辑',
            files: [
              { path: 'index.html', content: '<h1>中文🌱</h1>\n<script>not_executed()</script>' },
              { path: 'scripts/app.js', content: 'console.log("literal source")' },
            ],
          });
          assert.equal(saved.revision, 1);
          await denied(programmingApi.save(student, { ...project, title: 'stale' }), 409);
          project = saved;
          assert.equal((await read()).title, '原生项目已编辑');
          await denied(
            student.request(
              root + '/projects/' + project.id,
              {
                revision: project.revision,
                title: 'bad',
                files: [{ path: '../index.html', content: 'bad' }],
              },
              'PATCH',
            ),
            400,
          );
          await denied(
            student.request(
              root + '/projects/' + project.id,
              { ...project, userId: f.users.student2.id },
              'PATCH',
            ),
            400,
          );
          for (const client of [other, outsider])
            await denied(client.request(root + '/projects/' + project.id), 404);
          assert.equal((await other.request<{ total: number }>(root + '/projects')).total, 0);
          assert.equal(
            (await f.db.programmingProject.findUniqueOrThrow({ where: { id: project.id } })).userId,
            f.users.student.id,
          );
        },
      );
      await t.test(
        'version snapshots are immutable, restore preserves saved current work and validates ownership',
        async () => {
          const saved = await programmingApi.version(student, project.id, project.revision, '手机里程碑');
          project = saved.project;
          versionId = saved.version.id;
          const original = project.files;
          project = await programmingApi.save(student, {
            ...project,
            title: '新版',
            files: [{ path: 'index.html', content: 'newer draft' }],
          });
          const version = await student.request<ProjectVersion>(
            root + '/projects/' + project.id + '/versions/' + versionId,
          );
          assert.deepEqual(version.files, original);
          await denied(programmingApi.restore(other, project.id, project.revision, versionId), 404);
          project = await programmingApi.restore(student, project.id, project.revision, versionId);
          assert.deepEqual(project.files, original);
          const snapshots = await f.db.programmingVersion.findMany({ where: { projectId: project.id } });
          assert.ok(snapshots.some((v) => JSON.stringify(v.files).includes('newer draft')));
        },
      );
      await t.test(
        'actual ZIP/JSON backups round-trip as independent projects without IDs or history injection',
        async () => {
          const binary = await student.request<Uint8Array>(
            root + '/projects/' + project.id + '/export',
            undefined,
            'GET',
            { binary: true },
          );
          assert.deepEqual(zipFiles(binary), project.files);
          backup = await student.request<ProjectBackup>(root + '/projects/' + project.id + '/backup');
          assert.deepEqual(
            Object.keys(backup).sort(),
            ['format', 'version', 'title', 'templateId', 'files'].sort(),
          );
          assert.deepEqual(backup.files, project.files);
          const imported = await programmingApi.import(student, backup);
          assert.notEqual(imported.id, project.id);
          assert.equal(imported.revision, 0);
          assert.deepEqual(imported.files, project.files);
          const duplicated = await programmingApi.duplicate(
            student,
            project.id,
            project.revision,
            '独立副本',
          );
          assert.notEqual(duplicated.id, project.id);
          assert.deepEqual(duplicated.files, project.files);
          await denied(
            student.request(root + '/projects/import', { ...backup, userId: f.users.student2.id }, 'POST'),
            400,
          );
          await denied(other.request(root + '/projects/' + project.id + '/backup'), 404);
          await programmingApi.remove(student, duplicated.id);
          await denied(read(duplicated.id), 404);
          assert.equal(await f.db.programmingVersion.count({ where: { projectId: duplicated.id } }), 0);
        },
      );
      await t.test(
        'creative browsing/favorites and projects preserve exact licensed source notices',
        async () => {
          const catalog = await student.request<CreativeList>(root + '/creative?pageSize=1');
          assert.ok(catalog.total > 0);
          creative = await student.request<CreativeIdea>(root + '/creative/' + catalog.items[0].id);
          assert.ok(creative.files?.some((file) => file.path === 'NOTICE.txt'));
          assert.match(creative.revision, /^[a-f0-9]{64}$/);
          await programmingApi.favorite(student, creative.id, true);
          assert.equal((await student.request<CreativeList>(root + '/creative?collection=saved')).total, 1);
          assert.equal((await other.request<CreativeList>(root + '/creative?collection=saved')).total, 0);
          creativeProject = await programmingApi.fromIdea(student, creative, '我的创意改编');
          assert.equal(creativeProject.templateId, 'creative:' + creative.id);
          assert.deepEqual(creativeProject.files, creative.files);
          await denied(
            programmingApi.save(student, {
              ...creativeProject,
              files: creativeProject.files.filter((f) => f.path !== 'NOTICE.txt'),
            }),
            400,
          );
          await denied(
            student.request(
              root + '/creative/' + creative.id + '/projects',
              { title: '过期来源', revision: '0'.repeat(64) },
              'POST',
            ),
            409,
          );
          const exported = await student.request<Uint8Array>(
            root + '/creative/' + creative.id + '/export',
            undefined,
            'GET',
            { binary: true },
          );
          assert.deepEqual(zipFiles(exported), creative.files);
        },
      );
      await t.test(
        'AI is configuration gated; only explicit reviewed draft application changes source',
        async () => {
          const count = await f.db.programmingAiDraft.count();
          await denied(programmingApi.generate(student, project.id, project.revision, '增加说明'), 503);
          assert.equal(await f.db.programmingAiDraft.count(), count);
          // A fixed trusted fixture represents a completed provider response; no provider or source code runs in this suite.
          const scope = { organizationId: f.organization.id, userId: f.users.student.id };
          const operation = await f.db.aiStudyOperation.create({
            data: {
              ...scope,
              kind: 'programming',
              status: 'completed',
              leaseExpiresAt: new Date(Date.now() + 60000),
              completedAt: new Date(),
            },
          });
          const candidate = [{ path: 'index.html', content: '<h1>Reviewed fixture</h1>' }];
          const draft = await f.db.programmingAiDraft.create({
            data: {
              ...scope,
              projectId: project.id,
              operationId: operation.id,
              baseRevision: project.revision,
              prompt: 'fixture only',
              status: 'ready',
              summary: '固定候选',
              plan: ['展示文本'],
              teaching: ['HTML标题'],
              files: candidate,
              model: 'fixture',
            },
          });
          const before = project.files;
          const inspected = await student.request<{ files: unknown }>(
            root + '/projects/' + project.id + '/ai-drafts/' + draft.id,
          );
          assert.deepEqual(inspected.files, candidate);
          assert.deepEqual((await read()).files, before);
          await denied(other.request(root + '/projects/' + project.id + '/ai-drafts/' + draft.id), 404);
          const applied = await programmingApi.apply(student, project.id, draft.id, project.revision);
          project = applied.project;
          assert.deepEqual(project.files, candidate);
          assert.equal(applied.draft.status, 'applied');
          const replay = await programmingApi.apply(student, project.id, draft.id, project.revision);
          assert.equal(replay.project.revision, project.revision);
          assert.ok(
            (await f.db.programmingVersion.findMany({ where: { projectId: project.id } })).some(
              (v) => JSON.stringify(v.files) === JSON.stringify(before),
            ),
          );
        },
      );
      await t.test(
        'feature and learning permission revocation prevent writes and all owners remain isolated',
        async () => {
          const before = await f.db.programmingProject.count();
          await f.db.systemSetting.upsert({
            where: { organizationId_key: { organizationId: f.organization.id, key: 'features' } },
            create: { organizationId: f.organization.id, key: 'features', value: { practice: false } },
            update: { value: { practice: false } },
          });
          await denied(read(), 403);
          await denied(student.request(root + '/creative'), 403);
          await denied(programmingApi.create(student, '不应创建', 'starter'), 403);
          await f.db.systemSetting.deleteMany({
            where: { organizationId: f.organization.id, key: 'features' },
          });
          await f.db.rolePermission.delete({
            where: { roleId_permissionId: { roleId: 'STUDENT', permissionId: 'learning.use' } },
          });
          await denied(programmingApi.save(student, { ...project, title: '不应更新' }), 403);
          await f.db.rolePermission.create({ data: { roleId: 'STUDENT', permissionId: 'learning.use' } });
          assert.equal(await f.db.programmingProject.count(), before);
          assert.equal((await read()).title, project.title);
          await f.db.session.deleteMany({ where: { userId: f.users.student.id, clientType: 'MOBILE' } });
          await denied(read(), 401);
        },
      );
    } finally {
      await f.cleanup();
    }
  },
);
