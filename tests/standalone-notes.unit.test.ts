import test from 'node:test';
import assert from 'node:assert/strict';
import {
  standaloneCreate,
  standalonePatch,
  standaloneDelete,
  combinedNoteQuery,
} from '../apps/api/src/notes/standalone.schemas';
import { canUseStandalone } from '../apps/api/src/notes/note-list';
import type { Actor } from '../apps/api/src/auth/auth.guard';

test('独立笔记保存原始正文、规范标题/分类，拒绝空白、空字符及越界输入', () => {
  const body = '  <section>学习笔记</section>\n  第二行\n';
  const valid = standaloneCreate.parse({ title: '  知识记录  ', category: '  ', body });
  assert.deepEqual(valid, { title: '知识记录', category: null, body, pinned: false });
  const limits = { title: '中'.repeat(120), category: '类'.repeat(60), body: '文'.repeat(10000) };
  assert.ok(standaloneCreate.safeParse(limits).success);
  for (const fields of [
    { title: ' ' },
    { body: '\r\n  ' },
    { title: limits.title + '多' },
    { body: limits.body + '多' },
    { category: limits.category + '多' },
    { title: 'a\0b' },
    { category: '\0' },
    { body: '\0' },
    { userId: 'other' },
    { organizationId: 'other' },
  ]) {
    assert.equal(standaloneCreate.safeParse({ ...limits, ...fields }).success, false);
  }
});

test('置顶补丁仅修改显式字段，所有写入版本有整数边界，分类可以清除', () => {
  assert.deepEqual(standalonePatch.parse({ revision: 1, pinned: false }), { revision: 1, pinned: false });
  assert.deepEqual(standalonePatch.parse({ revision: 2, category: '  ' }), { revision: 2, category: null });
  assert.equal(standalonePatch.safeParse({ revision: 1 }).success, false);
  for (const revision of [-1, 0, 1.5, 2147483647, '1']) {
    assert.equal(standalonePatch.safeParse({ revision, title: '合法标题' }).success, false);
  }
  assert.ok(standaloneDelete.safeParse({ revision: 2147483647 }).success);
  assert.equal(standaloneDelete.safeParse({ revision: 2147483648 }).success, false);
  assert.equal(standaloneDelete.safeParse({ revision: 1, userId: 'other' }).success, false);
});

test('统一列表仅接受已知来源、有效分页、字面搜索和范围筛选', () => {
  assert.deepEqual(combinedNoteQuery.parse({ source: 'all', search: ' %_ ', pageSize: '1' }), {
    source: 'all',
    search: '%_',
    page: 1,
    pageSize: 1,
  });
  for (const fields of [
    { source: 'other' },
    { pinned: '1' },
    { page: '0' },
    { pageSize: '51' },
    { search: '\0' },
    { courseId: '\0' },
    { category: '\0' },
    { userId: 'other' },
  ]) {
    assert.equal(combinedNoteQuery.safeParse({ source: 'all', ...fields }).success, false);
  }
});

test('独立笔记需要当前空间的学生或教师本人权限', () => {
  const actor: Actor = {
    id: 'me',
    name: '我',
    role: 'STUDENT',
    organizationId: 'space',
    accountMode: 'PERSONAL',
    permissions: ['learning.use'],
  };
  assert.ok(canUseStandalone(actor));
  assert.ok(canUseStandalone({ ...actor, accountMode: 'ORGANIZATION' }));
  assert.ok(
    canUseStandalone({
      ...actor,
      accountMode: 'ORGANIZATION',
      role: 'TEACHER',
      permissions: ['course.read'],
    }),
  );
  assert.equal(canUseStandalone({ ...actor, permissions: ['course.read'] }), false);
  assert.equal(canUseStandalone({ ...actor, role: 'TEACHER', permissions: ['course.read'] }), false);
  assert.equal(
    canUseStandalone({ ...actor, role: 'ADMIN', permissions: ['course.admin', 'learning.use'] }),
    false,
  );
});
