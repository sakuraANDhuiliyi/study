import test from 'node:test';
import assert from 'node:assert/strict';
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { creativeItems } from '../apps/api/src/programming/creative.catalog';
import {
  programmingBackupSchema,
  parseProgrammingBackup,
} from '../apps/api/src/programming/programming.backup';
import { programmingDuplicateInput } from '../apps/api/src/programming/programming.schemas';
import { ProgrammingService } from '../apps/api/src/programming/programming.service';
import type { Actor } from '../apps/api/src/auth/auth.guard';

const bundle = () => ({
  format: 'zhixue-programming' as const,
  version: 1 as const,
  title: '学习项目',
  templateId: 'starter',
  files: [
    { path: 'index.html', content: '<h1>你好</h1>' },
    { path: 'docs/notes.md', content: '中文\n' },
  ],
});
const actor: Actor = {
  id: 'owner',
  organizationId: 'org',
  name: '学生',
  role: 'STUDENT',
  sessionId: 'session',
  permissions: ['learning.use'],
};

test('portable format allows only explicit versioned sources and bounded duplicate inputs', () => {
  assert.deepEqual(programmingBackupSchema.parse(bundle()), bundle());
  for (const key of ['id', 'organizationId', 'userId', 'revision', 'versions', 'aiDrafts', 'operationId'])
    assert.equal(programmingBackupSchema.safeParse({ ...bundle(), [key]: 'injected' }).success, false, key);
  for (const value of [
    { format: 'other' },
    { version: 2 },
    { templateId: 'creative:unknown' },
    { templateId: '../starter' },
    { title: '\0hidden' },
    { files: [{ path: '../index.html', content: '' }] },
    { files: [{ path: 'index.html', content: '学'.repeat(21846) }] },
  ])
    assert.equal(programmingBackupSchema.safeParse({ ...bundle(), ...value }).success, false);
  assert.deepEqual(programmingDuplicateInput.parse({ title: ' 副本 ', revision: 0 }), {
    title: '副本',
    revision: 0,
  });
  for (const value of [
    { title: '复制' },
    { title: '复制', revision: -1 },
    { title: '复制', revision: '0' },
    { title: '复制', revision: 0, userId: 'other' },
    { title: '复制', revision: 2147483647 },
  ])
    assert.equal(programmingDuplicateInput.safeParse(value).success, false);
});

test('all creative backups preserve exact catalog notices and cannot downgrade recognizable provenance', () => {
  for (const creative of creativeItems) {
    const input = { ...bundle(), templateId: `creative:${creative.id}`, files: creative.files };
    assert.deepEqual(parseProgrammingBackup(input), input);
    for (const templateId of ['starter', 'imported'])
      assert.equal(
        parseProgrammingBackup({ ...input, templateId }).templateId,
        `creative:${creative.id}`,
        creative.id,
      );
    assert.throws(
      () =>
        parseProgrammingBackup({
          ...input,
          files: creative.files.filter((file) => file.path !== 'NOTICE.txt'),
        }),
      BadRequestException,
    );
    assert.throws(
      () =>
        parseProgrammingBackup({
          ...input,
          files: creative.files.map((file) =>
            file.path === 'NOTICE.txt' ? { ...file, content: file.content + '\nEdited' } : file,
          ),
        }),
      BadRequestException,
    );
    assert.throws(
      () =>
        parseProgrammingBackup({
          ...input,
          templateId: 'imported',
          files: creative.files.filter((file) => file.path !== 'NOTICE.txt'),
        }),
      BadRequestException,
    );
  }
});

test('plain documentation with a repository URL remains ordinary; altered notice casing and mismatched source fail', () => {
  const creative = creativeItems[0];
  const original = {
    ...bundle(),
    files: [...bundle().files, { path: 'README.md', content: `参考项目：${creative.source.repository}` }],
  };
  assert.equal(parseProgrammingBackup(original).templateId, 'starter');
  assert.throws(
    () =>
      parseProgrammingBackup({
        ...bundle(),
        templateId: `creative:${creativeItems[1].id}`,
        files: creative.files,
      }),
    BadRequestException,
  );
  assert.throws(
    () =>
      parseProgrammingBackup({
        ...bundle(),
        templateId: 'imported',
        files: creative.files.map((file) =>
          file.path === 'NOTICE.txt' ? { ...file, path: 'notice.txt' } : file,
        ),
      }),
    BadRequestException,
  );
});

test('one complete notice cannot hide another identifiable creative source without its own attribution', () => {
  const first = creativeItems[0],
    second = creativeItems[1];
  const mixed = [
    ...first.files,
    { path: 'second-source.js', content: second.files.find((file) => file.path === 'app.js')!.content },
  ];
  for (const templateId of [`creative:${first.id}`, 'imported'])
    assert.throws(
      () => parseProgrammingBackup({ ...bundle(), templateId, files: mixed }),
      BadRequestException,
    );
});

function fixture() {
  const source = {
    id: 'source',
    organizationId: 'org',
    userId: 'owner',
    title: '原项目',
    templateId: 'starter',
    revision: 7,
    files: bundle().files,
    createdAt: new Date(),
    updatedAt: new Date(),
    internalSecret: 'not-portable',
  };
  const projects = new Map<string, any>([['source', source]]);
  const versions: any[] = [
    {
      id: 'source-v7',
      projectId: 'source',
      organizationId: 'org',
      userId: 'owner',
      number: 7,
      title: '旧快照',
      files: [],
      note: '旧历史',
    },
  ];
  const audits: any[] = [];
  const checks: string[] = [];
  let revoked = false;
  const securityUser = {
    id: actor.id,
    organizationId: actor.organizationId,
    active: true,
    authVersion: 1,
    passwordHash: 'fixture-hash',
  };
  const match = (row: any, where: Record<string, unknown>) =>
    Object.entries(where).every(([key, value]) => row[key] === value);
  const db: any = {
    async $queryRaw(strings: TemplateStringsArray) {
      const sql = strings.join('?');
      checks.push(sql);
      if (sql.includes('FROM "User"')) return [securityUser];
      if (sql.includes('RolePermission')) return [{ permissionId: 'learning.use' }];
      if (sql.includes('SystemSetting')) return [{ value: { practice: !revoked } }];
      return [{ locked: 1 }];
    },
    user: {
      async findUnique() {
        return securityUser;
      },
    },
    session: {
      async findFirst() {
        return { id: actor.sessionId };
      },
    },
    organization: {
      async findUnique() {
        return { active: true };
      },
    },
    programmingProject: {
      async findFirst({ where }: any) {
        return [...projects.values()].find((row) => match(row, where)) || null;
      },
      async count({ where }: any) {
        return [...projects.values()].filter((row) => match(row, where)).length;
      },
      async create({ data }: any) {
        const row = {
          id: `new-${projects.size}`,
          revision: 0,
          createdAt: new Date(),
          updatedAt: new Date(),
          ...structuredClone(data),
        };
        projects.set(row.id, row);
        return row;
      },
    },
    programmingVersion: {
      async findFirst({ where }: any) {
        return versions.filter((row) => match(row, where)).sort((a, b) => b.number - a.number)[0] || null;
      },
      async create({ data }: any) {
        const row = { id: `version-${versions.length}`, createdAt: new Date(), ...structuredClone(data) };
        versions.push(row);
        return row;
      },
    },
    auditLog: {
      async create({ data }: any) {
        audits.push(structuredClone(data));
        return data;
      },
    },
    async $transaction(operation: (tx: any) => Promise<unknown>) {
      return operation(db);
    },
  };
  const auth = { require() {}, async checkFeature() {} };
  const service = new ProgrammingService(db, auth as any, {} as any, {} as any, {} as any);
  return {
    source,
    projects,
    versions,
    audits,
    checks,
    service,
    revoke() {
      revoked = true;
    },
  };
}

test('backup emits only a portable bundle, with private sources visible solely to the owner', async () => {
  const f = fixture();
  const output = await f.service.backup(actor, 'source');
  assert.deepEqual(Object.keys(output.bundle).sort(), ['files', 'format', 'templateId', 'title', 'version']);
  assert.deepEqual(output.bundle.files, bundle().files);
  assert(!JSON.stringify(output.bundle).includes('not-portable'));
  for (const foreign of [
    { ...actor, id: 'other' },
    { ...actor, organizationId: 'other-org' },
  ])
    await assert.rejects(f.service.backup(foreign, 'source'), NotFoundException);
  assert.equal(f.audits.length, 0);
});

test('duplicate keeps source revision intact and creates independent owner-scoped initial history', async () => {
  const f = fixture();
  const copy = await f.service.duplicate(actor, 'source', { title: '新副本', revision: 7 });
  assert.equal(copy.title, '新副本');
  assert.equal(copy.templateId, 'starter');
  assert.equal(copy.revision, 0);
  assert.deepEqual(copy.files, f.source.files);
  assert.equal(f.source.revision, 7);
  const snapshots = f.versions.filter((version) => version.projectId === copy.id);
  assert.equal(snapshots.length, 1);
  assert.equal(snapshots[0].number, 1);
  assert.equal(snapshots[0].userId, actor.id);
  assert.equal(snapshots[0].organizationId, actor.organizationId);
  assert.deepEqual(f.audits[0].details, { sourceProjectId: 'source', templateId: 'starter', fileCount: 2 });
  assert(f.checks.some((sql) => sql.includes('pg_advisory_xact_lock')));
  assert(f.checks.some((sql) => sql.includes('FOR UPDATE')));
  copy.files[0].content = 'copy changes';
  assert.equal(f.source.files[0].content, '<h1>你好</h1>');
});

test('duplicate stale revision or foreign scope creates nothing; import validates current access and scoped quota', async () => {
  const f = fixture();
  await assert.rejects(
    f.service.duplicate(actor, 'source', { title: '过期副本', revision: 6 }),
    ConflictException,
  );
  await assert.rejects(
    f.service.duplicate({ ...actor, organizationId: 'other-org' }, 'source', {
      title: '越权副本',
      revision: 7,
    }),
    ForbiddenException,
  );
  await assert.rejects(
    f.service.duplicate({ ...actor, id: 'other' }, 'source', { title: '越权副本', revision: 7 }),
    NotFoundException,
  );
  assert.equal(f.projects.size, 1);
  assert.equal(f.audits.length, 0);
  for (let i = 0; i < 20; i++)
    f.projects.set(`other-${i}`, { ...f.source, id: `other-${i}`, userId: 'other' });
  const imported = await f.service.importProject(actor, bundle());
  assert.equal(imported.revision, 0);
  assert.equal(f.versions.filter((row) => row.projectId === imported.id)[0].number, 1);
  assert.equal(f.audits[0].action, 'programming.import');
  assert.deepEqual(f.audits[0].details, { templateId: 'starter', fileCount: 2 });
  for (let i = 0; i < 18; i++) f.projects.set(`owner-${i}`, { ...f.source, id: `owner-${i}` });
  await assert.rejects(f.service.importProject(actor, bundle()), ConflictException);
  await assert.rejects(
    f.service.duplicate(actor, 'source', { title: '超额副本', revision: 7 }),
    ConflictException,
  );
  f.revoke();
  await assert.rejects(f.service.importProject(actor, bundle()), ForbiddenException);
  await assert.rejects(
    f.service.duplicate(actor, 'source', { title: '禁用副本', revision: 7 }),
    ForbiddenException,
  );
  assert.equal(f.audits.length, 1);
});

test('creative import and duplication retain immutable notice protection for later saves', async () => {
  const f = fixture();
  const creative = creativeItems[0];
  const imported = await f.service.importProject(actor, {
    ...bundle(),
    templateId: 'imported',
    files: creative.files,
  });
  assert.equal(imported.templateId, `creative:${creative.id}`);
  const copy = await f.service.duplicate(actor, imported.id, { title: '创意副本', revision: 0 });
  assert.equal(copy.templateId, imported.templateId);
  const tampered = copy.files.filter((file) => file.path !== 'NOTICE.txt');
  await assert.rejects(
    f.service.update(actor, copy.id, { title: copy.title, revision: 0, files: tampered }),
    BadRequestException,
  );
  assert.equal(f.projects.get(copy.id).revision, 0);
});
