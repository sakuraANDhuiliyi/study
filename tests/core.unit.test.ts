import { test } from 'node:test';
import assert from 'node:assert/strict';
import { hashPassword, verifyPassword } from '../apps/api/src/auth/password';
import { clean, csvCell, paging } from '../apps/api/src/common/utils';
test('Passwords are salted scrypt hashes, with timing-safe verification', () => {
  const a = hashPassword('testing-secret-123'),
    b = hashPassword('testing-secret-123');
  assert.notEqual(a, b);
  assert(!a.includes('testing-secret'));
  assert(verifyPassword('testing-secret-123', a));
  assert(!verifyPassword('wrong', a));
  assert(!verifyPassword('wrong', 'invalid'));
});
test('Rich text strips script, event handlers, iframes, javascript URLs', () => {
  const result = clean(
    '<p onclick="x()">Safe</p><script>bad()</script><iframe src=x></iframe><a href="javascript:alert(1)">bad</a>',
  );
  assert.equal(result, '<p>Safe</p><a>bad</a>');
});
test('CSV exports prevent formulas including leading whitespace', () => {
  for (const value of ['=CMD()', '+SUM(A1:A2)', '-1+2', '@SUM', '  =CMD()', '\tbad'])
    assert(csvCell(value).startsWith('"\''));
  assert.equal(csvCell('a"b'), '"a""b"');
});
test('Pagination bounds large and invalid sizes', () => {
  assert.deepEqual(paging({ page: '-1', pageSize: '99999' }), { page: 1, pageSize: 100, skip: 0 });
  assert.equal(paging({ page: '2', pageSize: '10' }).skip, 10);
});
