import 'reflect-metadata';
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  ExamWriter,
  nativeExamPage,
  secondsLeft,
  examEntry,
  type ExamAttempt,
  type ExamDetail,
} from '../apps/mobile/src/exam-model';
import { mobileRouteAllowed } from '../apps/api/src/auth/auth.guard';
const attempt = (backtrack = true) =>
  ({
    revision: 0,
    currentPosition: 0,
    flags: [],
    answers: [],
    lastSavedAt: null,
    items: [{ id: 'a' }, { id: 'b' }],
    exam: { allowBacktrack: backtrack },
  }) as unknown as ExamAttempt;
test('native exams allow exact student paths without granting generic exams, grade or audience routes', () => {
  for (const [p, m] of [
    ['/mobile/exams', 'GET'],
    ['/mobile/exams/e', 'GET'],
    ['/mobile/exams/e/start', 'POST'],
    ['/mobile/exam-attempts/a', 'GET'],
    ['/mobile/exam-attempts/a/answers', 'PUT'],
    ['/mobile/exam-attempts/a/submit', 'POST'],
  ])
    assert.ok(mobileRouteAllowed('/api' + p, m));
  for (const [p, m] of [
    ['/exams/e', 'GET'],
    ['/attempts/a', 'GET'],
    ['/mobile/exams/e/release', 'POST'],
    ['/mobile/exam-attempts/a/grade', 'PUT'],
    ['/mobile/exams/e/start', 'GET'],
    ['/mobile/exams/e', 'DELETE'],
  ])
    assert.ok(!mobileRouteAllowed('/api' + p, m));
});
test('exam countdown follows server clock rather than device clock and never grants time for backward jumps', () => {
  assert.equal(secondsLeft('2026-10-18T10:01:00Z', '2026-10-18T10:00:00Z', 100, 10100), 50);
  assert.equal(secondsLeft('2026-10-18T10:01:00Z', '2026-10-18T10:00:00Z', 100, 0), 60);
  assert.equal(secondsLeft('2026-10-18T10:01:00Z', '2026-10-18T10:00:00Z', 100, 999999), 0);
});
test('entry window respects eligibility, personalized extension and attempts', () => {
  const d = {
    status: 'published',
    eligible: true,
    startsAt: new Date(0).toISOString(),
    entryClosesAt: new Date(100).toISOString(),
    maxAttempts: 1,
    attempts: [],
    extension: null,
  } as unknown as ExamDetail;
  assert.equal(examEntry(d, 50), '');
  assert.match(examEntry(d, 100), /允许进入/);
  assert.equal(
    examEntry(
      {
        ...d,
        extension: { deadlineAt: new Date(500).toISOString(), extraAttempts: 1 },
        attempts: [{} as never],
      },
      150,
    ),
    '',
  );
  assert.match(examEntry({ ...d, eligible: false }, 50), /资格/);
});
test('exam writer serializes changes during a request and advances CAS only after acknowledgement', async () => {
  let release!: () => void;
  const wait = new Promise<void>((r) => (release = r));
  const calls: any[] = [];
  const w = new ExamWriter(attempt(), async (body) => {
    calls.push(body);
    if (calls.length === 1) await wait;
    return { revision: body.revision + 1, lastSavedAt: 'saved' };
  });
  w.change('a', false);
  const first = w.save();
  w.change('a', ['new']);
  const second = w.save();
  release();
  await Promise.all([first, second]);
  assert.equal(calls.length, 2);
  assert.equal(calls[0].answers[0].value, false);
  assert.deepEqual(calls[1].answers[0].value, ['new']);
  assert.equal(calls[1].revision, 1);
  assert.equal(w.dirty, false);
  assert.equal(w.revision, 2);
});
test('failed save freezes the local writer; uncertain requests cannot be silently replayed', async () => {
  let calls = 0;
  const w = new ExamWriter(attempt(), async () => {
    calls++;
    throw new Error('conflict');
  });
  w.change('a', 'local');
  await assert.rejects(w.save(), /conflict/);
  await assert.rejects(w.save(), /conflict/);
  assert.throws(() => w.change('a', 'overwrite'), /conflict/);
  assert.equal(calls, 1);
  assert.equal(w.answers.a, 'local');
});
test('sequential exams persist old answer before advancing and never resend a previous question', async () => {
  const calls: any[] = [];
  const w = new ExamWriter(attempt(false), async (body) => {
    calls.push(body);
    return { revision: body.revision + 1, lastSavedAt: 'saved' };
  });
  w.change('a', 'first');
  await w.move(1);
  w.change('b', 'second');
  await w.save();
  assert.deepEqual(
    calls.map((c) => c.answers.map((a: any) => a.questionVersionId)),
    [['a'], [], ['b']],
  );
  assert.equal(calls[1].currentPosition, 1);
  await assert.rejects(w.move(0), /返回/);
  assert.throws(() => w.change('a', 'hack'), /其他题目/);
});

test('planner exam links preserve canonical exam and in-progress attempt routes without granting arbitrary paths', () => {
  assert.deepEqual(nativeExamPage('/exams/e-1'), { pathname: '/exams/[id]', params: { id: 'e-1' } });
  assert.deepEqual(nativeExamPage('/exam-attempts/a_2'), {
    pathname: '/exam-attempts/[id]',
    params: { id: 'a_2' },
  });
  for (const value of [
    '/attempts/a',
    '//evil/exams/a',
    'https://evil/exams/a',
    '/exams/a?token=x',
    '/exams/a/grade',
  ])
    assert.equal(nativeExamPage(value), null);
});
