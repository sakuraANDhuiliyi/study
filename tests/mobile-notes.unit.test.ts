import test from 'node:test';
import assert from 'node:assert/strict';
import { MobileApiError } from '../apps/mobile/src/client';
import {
  noteBody,
  sameNote,
  reconcileNote,
  definitiveNoteFailure,
  type LessonNote,
} from '../apps/mobile/src/notes-model';
const n: LessonNote = {
  id: 'own',
  body: '原文',
  pinned: false,
  revision: 1,
  updatedAt: new Date().toISOString(),
};
test('note validation trims only outer whitespace and rejects empty, oversized and NUL content', () => {
  assert.equal(noteBody('  第一行\n 第二行  '), '第一行\n 第二行');
  assert.equal(noteBody('字'.repeat(10000)).length, 10000);
  for (const v of ['', ' \n ', '字'.repeat(10001), 'x\0y']) assert.throws(() => noteBody(v));
});
test('note identity includes ID and revision so delete/recreate cannot appear unchanged', () => {
  assert.ok(sameNote(n, { ...n }));
  assert.ok(sameNote(null, null));
  assert.ok(!sameNote(n, { ...n, id: 'replacement' }));
  assert.ok(!sameNote(n, { ...n, revision: 2 }));
  assert.ok(!sameNote(n, null));
});
test('uncertain save resolves from a fresh exact snapshot without replaying writes', () => {
  const p = { kind: 'save' as const, base: n, body: '保存目标', pinned: true };
  assert.equal(reconcileNote(p, { ...n, body: p.body, pinned: true, revision: 2 }), 'applied');
  assert.equal(reconcileNote(p, n), 'unchanged');
  for (const next of [
    null,
    { ...n, id: 'new' },
    { ...n, revision: 3 },
    { ...n, body: '其他内容', revision: 2 },
  ])
    assert.equal(reconcileNote(p, next), 'conflict');
  assert.equal(reconcileNote({ ...p, base: null }, { ...n, body: p.body, pinned: true }), 'applied');
  assert.equal(reconcileNote({ ...p, base: null }, null), 'unchanged');
});
test('uncertain deletion respects replacement IDs and status errors cannot be treated as success', () => {
  const p = { kind: 'delete' as const, base: n };
  assert.equal(reconcileNote(p, null), 'applied');
  assert.equal(reconcileNote(p, n), 'unchanged');
  assert.equal(reconcileNote(p, { ...n, id: 'new' }), 'conflict');
  assert.ok(definitiveNoteFailure(new MobileApiError(409, 'conflict')));
  assert.ok(!definitiveNoteFailure(new MobileApiError(503, 'unavailable')));
  assert.ok(!definitiveNoteFailure(new TypeError('lost response')));
});
