import test from 'node:test';
import assert from 'node:assert/strict';
import { focusInput } from '../apps/api/src/focus/focus-data';
import { mobilePersonalLearningRouteAllowed as allowed } from '../apps/api/src/mobile/mobile-personal-learning.policy';
import { mobilePersonalNoteQuery } from '../apps/api/src/mobile/mobile-personal-learning.schemas';
import { canUseStandalone } from '../apps/api/src/notes/note-list';
import {
  focusElapsed,
  startFocus,
  toggleFocusPause,
  finishFocus,
  sameFocusRecord,
  personalNoteInput,
  reconcilePersonalNote,
  personalNotesApi,
  type PersonalNote,
} from '../apps/mobile/src/personal-learning-model';
import { notesApi } from '../apps/mobile/src/notes-model';
test('personal mobile routes are exact native endpoints and bounded strict note filters', () => {
  for (const [method, path] of [
    ['GET', 'notes'],
    ['GET', 'notes/standalone'],
    ['POST', 'notes/standalone'],
    ['PATCH', 'notes/standalone/a'],
    ['DELETE', 'notes/standalone/a'],
    ['GET', 'lesson-notes'],
    ['PUT', 'lessons/a/note'],
    ['GET', 'focus/summary'],
    ['POST', 'focus/sessions'],
    ['DELETE', 'focus/sessions/a'],
  ])
    assert.equal(allowed('/api/mobile/personal/' + path, method), true);
  for (const [method, path] of [
    ['POST', 'notes'],
    ['POST', 'lessons/a/note'],
    ['PUT', 'focus/sessions/a'],
    ['POST', 'focus/sessions/a'],
    ['GET', 'notes/standalone/a/other'],
    ['POST', 'focus/summary'],
  ])
    assert.equal(allowed('/api/mobile/personal/' + path, method), false);
  assert.equal(allowed('/api/focus/sessions', 'POST'), false);
  assert.equal(allowed('/api/mobile/personal/notes/standalone/a%2fb', 'PATCH'), false);
  assert.deepEqual(mobilePersonalNoteQuery.parse({}), { source: 'all', page: 1, pageSize: 10 });
  for (const q of [
    { page: ['1'] },
    { page: true },
    { pageSize: 21 },
    { source: 'private' },
    { userId: 'other' },
  ])
    assert.equal(mobilePersonalNoteQuery.safeParse(q).success, false);
});
test('independent notes keep the existing website student and institutional teacher permissions', () => {
  const actor: any = { role: 'STUDENT', accountMode: 'PERSONAL', permissions: ['learning.use'] };
  assert.equal(canUseStandalone(actor), true);
  assert.equal(
    canUseStandalone({
      ...actor,
      role: 'TEACHER',
      accountMode: 'ORGANIZATION',
      permissions: ['course.read'],
    }),
    true,
  );
  for (const variant of [
    { role: 'TEACHER', accountMode: 'PERSONAL', permissions: ['course.read'] },
    { role: 'TEACHER', accountMode: 'ORGANIZATION', permissions: [] },
    { role: 'ADMIN', permissions: ['course.read', 'learning.use'] },
    { role: 'STUDENT', permissions: [] },
  ])
    assert.equal(canUseStandalone({ ...actor, ...variant }), false);
});
test('focus elapsed is independent of render ticks and catches up across background/resume', () => {
  const at = Date.parse('2026-01-01T00:00:00Z'),
    timer = startFocus(' 一次练习 ', '算法练习', 'FOCUS', 2, at);
  assert.equal(focusElapsed(timer, at + 59000), 59000);
  assert.equal(focusElapsed(timer, at + 600000), 120000);
  const completed = finishFocus(timer, at + 600000);
  assert.equal(completed.actualSeconds, 120);
  assert.equal(completed.status, 'COMPLETED');
  assert.equal(completed.endedAt, new Date(at + 120000).toISOString());
  assert.equal(focusInput.safeParse(completed).success, true);
  assert.deepEqual(finishFocus(timer, at + 1800000), completed);
});
test('focus pause excludes elapsed background time and successful/interrupted records are frozen', () => {
  const at = Date.parse('2026-01-01T00:00:00Z');
  let timer = startFocus('学习', null, 'FOCUS', 1, at);
  timer = toggleFocusPause(timer, at + 20000);
  assert.equal(timer.resumedAt, null);
  assert.equal(focusElapsed(timer, at + 120000), 20000);
  timer = toggleFocusPause(timer, at + 120000);
  assert.equal(focusElapsed(timer, at + 130000), 30000);
  const interrupted = finishFocus(timer, at + 130000);
  assert.equal(interrupted.status, 'ABANDONED');
  assert.equal(interrupted.actualSeconds, 30);
  assert.equal(interrupted.endedAt, new Date(at + 130000).toISOString());
  const completed = finishFocus(timer, at + 180000);
  assert.equal(completed.status, 'COMPLETED');
  assert.equal(completed.actualSeconds, 60);
  assert.equal(completed.endedAt, new Date(at + 160000).toISOString());
  assert.equal(focusInput.safeParse(interrupted).success, true);
  assert.equal(focusInput.safeParse(completed).success, true);
  assert.equal(sameFocusRecord(interrupted, { ...interrupted }), true);
  assert.equal(sameFocusRecord(interrupted, { ...interrupted, reflection: 'changed' }), false);
  assert.equal(focusElapsed(timer, at - 1000), 0);
});
test('timer boundaries reject empty/invalid durations and never invent a one-second session', () => {
  const at = Date.parse('2026-01-01T00:00:00Z');
  for (const minutes of [0, 181, 1.5, NaN, Infinity])
    assert.throws(() => startFocus('study', null, 'FOCUS', minutes, at));
  assert.throws(() => startFocus('', null, 'FOCUS', 25, at));
  assert.throws(() => startFocus('x\0', null, 'FOCUS', 25, at));
  assert.throws(() => finishFocus(startFocus('study', null, 'FOCUS', 25, at), at + 999));
  const max = finishFocus(startFocus('study', null, 'FOCUS', 180, at), at + 20 * 3600000);
  assert.equal(max.actualSeconds, 10800);
  assert.equal(focusInput.safeParse(max).success, true);
});
test('independent notes validate literal Unicode and reconcile by complete payload plus version', () => {
  const base: PersonalNote = {
    id: 'n',
    title: '私人',
    category: null,
    body: '原内容',
    pinned: false,
    revision: 2,
    createdAt: '2026-01-01',
    updatedAt: '2026-01-01',
  };
  const intent = personalNoteInput({
    title: ' 新标题 ',
    category: '  ',
    body: '  <script>笔记😀</script>\n ',
    pinned: true,
  });
  assert.equal(intent.body, '  <script>笔记😀</script>\n ');
  assert.equal(intent.title, '新标题');
  assert.equal(intent.category, null);
  assert.equal(reconcilePersonalNote(base, intent, { ...base, ...intent, revision: 3 }), 'applied');
  assert.equal(reconcilePersonalNote(base, intent, base), 'unchanged');
  for (const note of [
    { ...base, ...intent, revision: 4 },
    { ...base, ...intent, revision: 3, id: 'new' },
    { ...base, ...intent, revision: 3, pinned: false },
  ])
    assert.equal(reconcilePersonalNote(base, intent, note), 'conflict');
  for (const edit of [
    { ...intent, title: '' },
    { ...intent, body: '' },
    { ...intent, body: 'x'.repeat(10001) },
    { ...intent, category: 'x'.repeat(61) },
    { ...intent, body: '\0' },
  ])
    assert.throws(() => personalNoteInput(edit));
});
test('teacher personal lesson routing is opt-in while existing mobile student API remains unchanged', async () => {
  const calls: any[] = [];
  const c: any = {
    request: async (...args: any[]) => {
      calls.push(args);
      return {};
    },
  };
  await notesApi.read(c, 'lesson');
  await notesApi.read(c, 'lesson', true);
  assert.equal(calls[0][0], '/mobile/lessons/lesson/note');
  assert.equal(calls[1][0], '/mobile/personal/lessons/lesson/note');
  await notesApi.save(c, 'lesson', '正文', false, null, true);
  assert.equal(calls[2][0], '/mobile/personal/lessons/lesson/note');
  assert.equal(calls[2][1].revision, 0);
  await personalNotesApi.create(c, { title: '笔记', body: '正文', category: null, pinned: false });
  assert.equal(calls[3][0], '/mobile/personal/notes/standalone');
  assert.equal(Object.hasOwn(calls[3][1], 'userId'), false);
});
