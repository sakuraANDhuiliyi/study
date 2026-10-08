// This worker receives a validated SELECT plan as data. It never connects to application databases,
// evaluates JavaScript input, loads user-selected files, or registers user-defined SQLite functions.
// Resource bounds come from the allowlisted grammar and tiny tables, not V8 limits on WASM memory.
const sqlWorkerThreads = require('node:worker_threads') as typeof import('node:worker_threads');
const sqlWorkerInitialize = require('sql.js') as typeof import('sql.js');
const sqlWorkerSeed = `
CREATE TABLE students(id INTEGER PRIMARY KEY, name TEXT, major TEXT, score INTEGER);
INSERT INTO students VALUES (1,'Alice','CS',92),(2,'Bob','Math',76),(3,'Chen','CS',88),(4,'Dana','Physics',95),(5,'Evan','Math',64),(6,'Faye','CS',81);
CREATE TABLE courses(id INTEGER PRIMARY KEY, title TEXT, credits INTEGER);
INSERT INTO courses VALUES (1,'Algorithms',3),(2,'Statistics',2),(3,'Physics',4);
CREATE TABLE enrollments(student_id INTEGER, course_id INTEGER, grade INTEGER);
INSERT INTO enrollments VALUES (1,1,93),(1,2,88),(2,2,78),(3,1,85),(4,3,96),(5,2,67),(6,1,80);
PRAGMA trusted_schema=OFF;
PRAGMA max_page_count=32;
PRAGMA cache_size=16;
PRAGMA temp_store=MEMORY;
PRAGMA query_only=ON;
`;
async function sqlWorkerRun() {
  const SQL = await sqlWorkerInitialize({ locateFile: (file) => require.resolve(`sql.js/dist/${file}`) });
  const db = new SQL.Database();
  let statement: import('sql.js').Statement | undefined;
  try {
    db.run(sqlWorkerSeed);
    const plan = sqlWorkerThreads.workerData as { sql: string; parameters: string[] };
    statement = db.prepare(plan.sql, plan.parameters);
    const columns = statement.getColumnNames();
    const rows: (string | number | null)[][] = [];
    let truncated = false,
      bytes = Buffer.byteLength(JSON.stringify(columns), 'utf8');
    while (statement.step()) {
      const values = statement.get();
      if (
        values.some(
          (value) => value instanceof Uint8Array || (typeof value === 'number' && !Number.isFinite(value)),
        )
      )
        throw new Error('numeric range');
      const row = values as (string | number | null)[];
      bytes += Buffer.byteLength(JSON.stringify(row), 'utf8');
      if (rows.length >= 100 || bytes > 58000) {
        truncated = true;
        break;
      }
      rows.push(row);
    }
    sqlWorkerThreads.parentPort?.postMessage({ result: { columns, rows, truncated } });
  } catch (error) {
    const message = error instanceof Error ? error.message : '';
    const diagnostic = /no such column/i.test(message)
      ? '列名不存在，请核对教学表结构及别名'
      : /ambiguous column/i.test(message)
        ? '列名不明确，请加上表名或表别名'
        : /aggregate|GROUP BY/i.test(message)
          ? '聚合表达式不合法，请检查 GROUP BY 和函数参数'
          : /numeric range/i.test(message)
            ? '计算结果超出有限数值范围，请缩小数值'
            : '查询无法执行，请检查表名、列名、语法和函数参数';
    sqlWorkerThreads.parentPort?.postMessage({ error: diagnostic });
  } finally {
    statement?.free();
    db.close();
    sqlWorkerThreads.parentPort?.close();
  }
}
void sqlWorkerRun().catch(() => {
  sqlWorkerThreads.parentPort?.postMessage({ error: '教学数据库初始化失败，请稍后再试' });
  sqlWorkerThreads.parentPort?.close();
});
