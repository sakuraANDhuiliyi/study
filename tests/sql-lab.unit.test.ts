import test from 'node:test';
import assert from 'node:assert/strict';
import { HttpException } from '@nestjs/common';
import {
  compileSqlLabQuery,
  compareSqlLabResult,
  runSqlLab,
  sqlLabActiveWorkers,
} from '../apps/api/src/academics/sql-lab';

const highScores = 'SELECT name, score FROM students WHERE score >= 80 ORDER BY score DESC, id ASC;';
const averages =
  'SELECT c.title, AVG(e.grade) AS avg_grade FROM courses AS c LEFT JOIN enrollments AS e ON e.course_id = c.id GROUP BY c.id, c.title ORDER BY c.title ASC';
const alice =
  "SELECT s.name, c.title FROM students s INNER JOIN enrollments e ON e.student_id = s.id INNER JOIN courses c ON c.id = e.course_id WHERE s.name = 'Alice' ORDER BY c.title";
const isBadRequest = (error: unknown) => error instanceof HttpException && error.getStatus() === 400;

test('SQL完整语法允许三类任务、字符串参数绑定和单个行尾分号', () => {
  assert.match(compileSqlLabQuery(highScores).sql, /^SELECT name , score/);
  assert.equal(compileSqlLabQuery(averages).parameters.length, 0);
  assert.deepEqual(compileSqlLabQuery(alice).parameters, ['Alice']);
  const quoted = compileSqlLabQuery(
    "SELECT name FROM students WHERE name = 'Alice''; DROP TABLE students; --' LIMIT 1;",
  );
  assert.ok(!quoted.sql.includes('DROP'));
  assert.deepEqual(quoted.parameters, ["Alice'; DROP TABLE students; --"]);
  for (const query of [
    'SELECT COUNT(*) AS n FROM students',
    'SELECT major, AVG(score) AS average FROM students GROUP BY major HAVING COUNT(*) > 1 ORDER BY average DESC',
    "SELECT name FROM students WHERE score BETWEEN 60 AND 90 AND major IN ('CS', 'Math') ORDER BY id LIMIT 4 OFFSET 1",
  ])
    assert.ok(compileSqlLabQuery(query).sql);
});

test('SQL拒绝写入、外部数据、递归和嵌套查询、多语句、未知函数及资源放大', () => {
  const denied = [
    'DELETE FROM students',
    'PRAGMA database_list',
    "ATTACH DATABASE '/etc/passwd' AS x",
    'SELECT * FROM sqlite_master',
    'SELECT * FROM main.students',
    'WITH RECURSIVE x(n) AS (SELECT 1 UNION ALL SELECT n+1 FROM x) SELECT * FROM x',
    'SELECT (SELECT name FROM students) FROM courses',
    'SELECT * FROM (SELECT * FROM students)',
    'SELECT * FROM students UNION SELECT * FROM students',
    'SELECT name FROM students; DROP TABLE students;',
    'SELECT name FROM students;;',
    'SELECT * FROM students -- comment',
    'SELECT /* hidden */ * FROM students',
    'SELECT randomblob(1000000000) FROM students',
    'SELECT zeroblob(1000000000) FROM students',
    "SELECT printf('%999999999s',name) FROM students",
    "SELECT load_extension('/tmp/extension') FROM students",
    'SELECT group_concat(name) FROM students',
    'SELECT * FROM students s JOIN students b ON 1=1 JOIN students c ON 1=1 JOIN students d ON 1=1',
    'SELECT * FROM students, courses',
    'SELECT * FROM students LIMIT 1000000000',
    'SELECT * FROM students LIMIT 5 OFFSET 999',
    'SELECT name FROM students WHERE id IN (SELECT id FROM courses)',
    `SELECT '${'x'.repeat(257)}' FROM students`,
    `SELECT ${'('.repeat(30)}score${')'.repeat(30)} FROM students`,
  ];
  for (const query of denied) assert.throws(() => compileSqlLabQuery(query), isBadRequest, query);
  assert.throws(() => compileSqlLabQuery(' '.repeat(4001)), isBadRequest);
  assert.equal(sqlLabActiveWorkers(), 0);
});

test('练习按列名、列位置、大小写、行序及有限数值容差核对，不把查询成功算完成', () => {
  const valid = {
    columns: ['name', 'score'],
    rows: [
      ['Dana', 95],
      ['Alice', 92],
      ['Chen', 88],
      ['Faye', 81],
    ],
    truncated: false,
  };
  assert.equal(compareSqlLabResult('high-scores', valid).matched, true);
  for (const actual of [
    { ...valid, columns: ['NAME', 'score'] },
    { ...valid, columns: ['score', 'name'] },
    { ...valid, rows: [...valid.rows].reverse() },
    { ...valid, rows: [['dana', 95], ...valid.rows.slice(1)] },
    { ...valid, truncated: true },
    { ...valid, rows: [['Dana', '95'], ...valid.rows.slice(1)] },
  ])
    assert.equal(compareSqlLabResult('high-scores', actual).matched, false);
  const average = {
    columns: ['title', 'avg_grade'],
    rows: [
      ['Algorithms', 86],
      ['Physics', 96],
      ['Statistics', 77.666667],
    ],
    truncated: false,
  };
  assert.equal(compareSqlLabResult('course-average', average).matched, true);
  average.rows[2][1] = 77.67;
  assert.equal(compareSqlLabResult('course-average', average).matched, false);
});

test('真实独立SQL.js worker执行三题，失败与截断回收线程，超额并发拒绝', { timeout: 15000 }, async () => {
  for (const [exercise, query] of [
    ['high-scores', highScores],
    ['course-average', averages],
    ['student-courses', alice],
  ]) {
    const result = await runSqlLab({ exercise, query });
    assert.equal(result.metrics.find((item) => item.label === '任务是否匹配')!.value, '是');
    assert.equal(sqlLabActiveWorkers(), 0);
  }
  const wrong = await runSqlLab({
    exercise: 'high-scores',
    query: 'SELECT name, score FROM students ORDER BY id',
  });
  assert.equal(wrong.metrics[1].value, '否');
  assert.match(wrong.summary, /尚未符合/);
  await assert.rejects(
    runSqlLab({ exercise: 'high-scores', query: 'SELECT nonexistent FROM students' }),
    isBadRequest,
  );
  assert.equal(sqlLabActiveWorkers(), 0);
  const large = await runSqlLab({
    exercise: 'high-scores',
    query: 'SELECT a.name,b.name,c.name FROM students a JOIN students b ON 1=1 JOIN students c ON 1=1',
  });
  assert.equal(large.tables[0].rows.length, 100);
  assert.equal(large.metrics[1].value, '否');
  assert.match(large.summary, /显示上限/);
  assert.ok(Buffer.byteLength(JSON.stringify(large), 'utf8') <= 65536);
  const results = await Promise.allSettled(
    Array.from({ length: 5 }, () => runSqlLab({ exercise: 'high-scores', query: highScores })),
  );
  assert.equal(results.filter((result) => result.status === 'fulfilled').length, 4);
  const rejected = results.find((result) => result.status === 'rejected') as PromiseRejectedResult;
  assert.equal(rejected.reason.getStatus(), 503);
  assert.equal(sqlLabActiveWorkers(), 0);
  assert.equal((await runSqlLab({ exercise: 'high-scores', query: highScores })).metrics[1].value, '是');
});

test('独立worker超过两秒后终止并释放并发槽，整份学习结果不超过64KiB', { timeout: 10000 }, async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  try {
    const pending = runSqlLab({ exercise: 'high-scores', query: highScores });
    const rejected = assert.rejects(
      pending,
      (error: unknown) => isBadRequest(error) && (error as Error).message.includes('2 秒'),
    );
    t.mock.timers.tick(2001);
    await rejected;
    assert.equal(sqlLabActiveWorkers(), 0);
  } finally {
    t.mock.timers.reset();
  }
  const columns = Array.from({ length: 20 }, (_, index) => `'${'x'.repeat(256)}' AS c${index}`).join(',');
  // The SQL input itself remains within 4000 characters: use 12 bounded projected literals.
  const query = `SELECT ${columns.split(',').slice(0, 12).join(',')} FROM students a JOIN students b ON 1=1 JOIN students c ON 1=1`;
  const bounded = await runSqlLab({ exercise: 'high-scores', query });
  assert.ok(Buffer.byteLength(JSON.stringify(bounded), 'utf8') <= 65536);
  assert.ok(bounded.tables[0].rows.length < 100);
  assert.equal(bounded.metrics[1].value, '否');
  assert.equal(sqlLabActiveWorkers(), 0);
});
