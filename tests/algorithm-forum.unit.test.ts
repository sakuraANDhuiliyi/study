import test from 'node:test';
import assert from 'node:assert/strict';
import {
  forumListQuery,
  forumPageQuery,
  forumPostInput,
  forumModerationInput,
  forumPostUpdateInput,
  forumReplyInput,
  forumRevisionInput,
} from '../apps/api/src/algorithm-forum/algorithm-forum.schemas';
import {
  createForumAuthorLabel,
  AlgorithmForumService,
  forumCanModerate,
  forumCanWrite,
  forumVisibleWhere,
} from '../apps/api/src/algorithm-forum/algorithm-forum.service';
import type { Actor } from '../apps/api/src/auth/auth.guard';
const actor = (role = 'STUDENT', permissions = ['learning.use']): Actor => ({
  id: 'person-1',
  organizationId: 'school-a',
  role,
  permissions,
  name: 'Private name',
});
test('forum create explicitly declares visibility and rejects spoofed identities/moderation', () => {
  const input = {
    scope: 'public',
    kind: 'question',
    title: '  Help  ',
    body: '  const value = 2;  ',
    problemId: 'two-sum',
  };
  assert.equal(forumPostInput.parse(input).title, 'Help');
  for (const extra of [
    { organizationId: 'foreign' },
    { authorId: 'another' },
    { pinned: true },
    { revision: 2 },
  ])
    assert.equal(forumPostInput.safeParse({ ...input, ...extra }).success, false);
  assert.equal(forumPostInput.safeParse({ ...input, scope: undefined }).success, false);
});
test('forum ordinary text permits code/HTML literal and bounds Unicode, empty text and NUL', () => {
  const input = {
    scope: 'organization',
    kind: 'solution',
    title: '题解',
    body: '<script>alert("literal")</script>\nconst count = 1;',
  };
  assert.equal(forumPostInput.parse(input).body, input.body);
  for (const body of [' ', 'x\0x', '汉'.repeat(15001)])
    assert.equal(forumPostInput.safeParse({ ...input, body }).success, false);
  assert.equal(forumPostInput.safeParse({ ...input, body: '汉'.repeat(15000) }).success, true);
});
test('forum pagination and filters strictly constrain scope, IDs and bounds', () => {
  assert.deepEqual(forumListQuery.parse({}), { scope: 'public', page: 1, pageSize: 20 });
  for (const query of [
    { scope: 'all' },
    { page: 0 },
    { pageSize: 51 },
    { page: 'Infinity' },
    { problemId: '../hidden' },
    { q: 'x'.repeat(201) },
    { authorId: 'private' },
  ])
    assert.equal(forumListQuery.safeParse(query).success, false);
  assert.equal(forumPageQuery.safeParse({ scope: 'public' }).success, false);
});
test('forum revisions and moderation fields cannot wrap or become content updates', () => {
  for (const revision of [-1, 0.5, 2147483647, '1'])
    assert.equal(forumRevisionInput.safeParse({ revision }).success, false);
  assert.equal(forumRevisionInput.safeParse({ revision: 2147483646 }).success, true);
  assert.equal(forumModerationInput.safeParse({ revision: 0 }).success, false);
  assert.equal(forumModerationInput.safeParse({ revision: 0, scope: 'public', solved: true }).success, false);
  assert.equal(
    forumPostUpdateInput.safeParse({ revision: 1, title: 'valid', body: 'valid', scope: 'public' }).success,
    false,
  );
  assert.equal(
    forumReplyInput.safeParse({ postRevision: 0, body: 'valid', authorId: 'spoof' }).success,
    false,
  );
});
test('forum public/private visibility always applies deletion and private organization fence', () => {
  const who = actor();
  assert.deepEqual(forumVisibleWhere(who, 'public'), { deletedAt: null, scope: 'public' });
  assert.deepEqual(forumVisibleWhere(who, 'organization'), {
    deletedAt: null,
    scope: 'organization',
    organizationId: 'school-a',
  });
  assert.deepEqual(forumVisibleWhere(who), {
    deletedAt: null,
    OR: [{ scope: 'public' }, { scope: 'organization', organizationId: 'school-a' }],
  });
});
test('forum writers use student learning permission or explicit communication write', () => {
  assert.equal(forumCanWrite(actor()), true);
  assert.equal(forumCanWrite(actor('STUDENT', ['communication.write'])), false);
  assert.equal(forumCanWrite(actor('TEACHER', ['communication.write'])), true);
  assert.equal(forumCanWrite(actor('ADMIN', ['communication.moderate'])), false);
});
test('forum moderation requires actual content organization, or explicit platform super-admin authority', () => {
  const admin = actor('ADMIN', ['communication.moderate']);
  assert.equal(forumCanModerate(admin, 'school-a'), true);
  assert.equal(forumCanModerate(admin, 'school-b'), false);
  assert.equal(forumCanModerate(actor('SUPER_ADMIN', ['communication.moderate']), 'school-b'), false);
  assert.equal(
    forumCanModerate(actor('SUPER_ADMIN', ['communication.moderate', 'org.platform']), 'school-b'),
    true,
  );
  assert.equal(forumCanModerate(actor('TEACHER', ['org.platform']), 'school-a'), false);
});
test('forum alias candidates are random and do not accept account IDs', () => {
  const labels = new Set(Array.from({ length: 100 }, () => createForumAuthorLabel()));
  assert.equal(labels.size, 100);
  for (const label of labels) assert.match(label, /^学习者·[0-9a-f]{16}$/);
});
test('forum aliases survive service restart, separate visibility contexts and resolve a racing insert in batches', async () => {
  const stored: { authorId: string; contextKey: string; label: string }[] = [];
  let reads = 0,
    writes = 0;
  const db = {
    algorithmForumAlias: {
      async findMany({ where }: any) {
        reads++;
        return stored.filter((row) =>
          where.OR.some((key: any) => row.authorId === key.authorId && row.contextKey === key.contextKey),
        );
      },
      async createMany({ data, skipDuplicates }: any) {
        writes++;
        assert.equal(skipDuplicates, true);
        for (const row of data)
          if (
            !stored.some(
              (existing) => existing.authorId === row.authorId && existing.contextKey === row.contextKey,
            )
          ) {
            // Another request commits first; our response must read its label.
            stored.push({ ...row, label: createForumAuthorLabel() });
          }
      },
    },
  };
  const rows = [
    { authorId: 'private-id', organizationId: 'school-a', scope: 'public' },
    { authorId: 'private-id', organizationId: 'school-a', scope: 'organization' },
    { authorId: 'private-id', organizationId: 'school-b', scope: 'organization' },
  ];
  const service = new AlgorithmForumService(db as any, {} as any);
  const label = await (service as any).authorLabels(db, [...rows, ...rows]);
  assert.equal(stored.length, 3);
  assert.equal(reads, 2);
  assert.equal(writes, 1);
  assert.equal(new Set(rows.map(label)).size, 3);
  for (const row of rows) assert.ok(stored.some((alias) => alias.label === label(row)));
  const afterRestart = await (new AlgorithmForumService(db as any, {} as any) as any).authorLabels(db, rows);
  for (const row of rows) assert.equal(afterRestart(row), label(row));
  assert.equal(afterRestart({ ...rows[0], organizationId: 'school-b' }), label(rows[0]));
  assert.equal(reads, 3);
  assert.equal(writes, 1);
});
