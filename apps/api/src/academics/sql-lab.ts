import { BadRequestException, ServiceUnavailableException } from '@nestjs/common';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { Worker } from 'node:worker_threads';
import { z } from 'zod';
import type { StudyResult } from './academics.types';

const inputSchema = z
  .object({
    query: z
      .string()
      .trim()
      .min(1)
      .max(4000)
      .refine((value) => Buffer.byteLength(value, 'utf8') <= 12000, 'SQL 过长'),
    exercise: z.enum(['high-scores', 'course-average', 'student-courses']),
  })
  .strict();
type Token = { kind: 'word' | 'number' | 'string' | 'symbol'; raw: string; value?: string };
export type SqlPlan = { sql: string; parameters: string[] };
export type SqlLabRows = { columns: string[]; rows: (string | number | null)[][]; truncated: boolean };
const keywords = new Set(
  'SELECT DISTINCT FROM AS JOIN INNER LEFT OUTER ON WHERE GROUP BY HAVING ORDER ASC DESC LIMIT OFFSET AND OR NOT IS NULL TRUE FALSE IN BETWEEN LIKE UNION ALL WITH RECURSIVE EXISTS CASE WHEN THEN ELSE END COLLATE OVER FILTER WINDOW CROSS RIGHT FULL NATURAL USING'.split(
    ' ',
  ),
);
const tables = new Set(['students', 'courses', 'enrollments']);
const functions: Record<string, [number, number]> = {
  COUNT: [1, 1],
  AVG: [1, 1],
  SUM: [1, 1],
  MIN: [1, 1],
  MAX: [1, 1],
  ROUND: [1, 2],
  ABS: [1, 1],
  LOWER: [1, 1],
  UPPER: [1, 1],
  LENGTH: [1, 1],
};
const invalid = (message: string) => new BadRequestException(`SQL 学习环境：${message}`);
function tokenize(query: string): Token[] {
  const tokens: Token[] = [];
  let offset = 0;
  while (offset < query.length) {
    const rest = query.slice(offset);
    const whitespace = /^\s+/.exec(rest);
    if (whitespace) {
      offset += whitespace[0].length;
      continue;
    }
    if (rest.startsWith('--') || rest.startsWith('/*')) throw invalid('暂不接受注释，请提交一条 SELECT 查询');
    const text = /^'(?:[^']|'')*'/.exec(rest);
    if (text) {
      const value = text[0].slice(1, -1).replaceAll("''", "'");
      if (Buffer.byteLength(value, 'utf8') > 256) throw invalid('单个字符串最多 256 字节');
      tokens.push({ kind: 'string', raw: text[0], value });
      offset += text[0].length;
    } else {
      const number = /^(?:\d+(?:\.\d+)?)/.exec(rest);
      const word = /^[a-zA-Z_][a-zA-Z0-9_]*/.exec(rest);
      const symbol = /^(?:<=|>=|<>|!=|[(),.*+/%=<>;\-])/.exec(rest);
      if (number) {
        if (number[0].length > 18 || !Number.isFinite(Number(number[0])) || Number(number[0]) > 1e9)
          throw invalid('数值常量超出教学查询范围');
        tokens.push({ kind: 'number', raw: number[0] });
        offset += number[0].length;
      } else if (word) {
        if (word[0].length > 64) throw invalid('标识符最多 64 个字符');
        tokens.push({ kind: 'word', raw: word[0] });
        offset += word[0].length;
      } else if (symbol) {
        tokens.push({ kind: 'symbol', raw: symbol[0] });
        offset += symbol[0].length;
      } else throw invalid('包含不支持的字符；请使用普通表名、列名和单引号字符串');
    }
    if (tokens.length > 600) throw invalid('查询过于复杂，请拆分练习');
  }
  if (tokens.at(-1)?.raw === ';') tokens.pop();
  if (tokens.some((token) => token.raw === ';' && token.kind === 'symbol'))
    throw invalid('只允许一条 SELECT 查询');
  return tokens;
}
/** Complete grammar, not a blacklist: no subqueries, external tables, SQL extensions or arbitrary functions. */
export function compileSqlLabQuery(query: string): SqlPlan {
  if (
    typeof query !== 'string' ||
    query.length < 1 ||
    query.length > 4000 ||
    Buffer.byteLength(query, 'utf8') > 12000
  )
    throw invalid('查询长度必须为 1 至 4000 个字符');
  const tokens = tokenize(query);
  let position = 0,
    expressions = 0,
    joinCount = 0;
  const peek = () => tokens[position]?.raw.toUpperCase();
  const take = (value: string) => {
    if (peek() !== value) return false;
    position++;
    return true;
  };
  const expect = (value: string) => {
    if (!take(value)) throw invalid(`此处需要 ${value}`);
  };
  const identifier = () => {
    const token = tokens[position];
    if (!token || token.kind !== 'word' || keywords.has(token.raw.toUpperCase()))
      throw invalid('此处需要普通列名、表名或别名');
    position++;
    return token.raw;
  };
  const primary = (depth: number): void => {
    if (depth > 12 || ++expressions > 180) throw invalid('表达式嵌套或数量超出教学范围');
    if (take('+') || take('-') || take('NOT')) {
      primary(depth + 1);
      return;
    }
    if (take('(')) {
      expression(0, depth + 1);
      expect(')');
      return;
    }
    const token = tokens[position];
    if (!token) throw invalid('表达式不完整');
    if (token.kind === 'number' || token.kind === 'string' || ['NULL', 'TRUE', 'FALSE'].includes(peek()!)) {
      position++;
      return;
    }
    if (take('*')) return;
    const name = identifier();
    if (take('(')) {
      const nameUpper = name.toUpperCase();
      const arity = functions[nameUpper];
      if (!arity)
        throw invalid(
          `不支持函数 ${name}，仅允许 COUNT、AVG、SUM、MIN、MAX、ROUND、ABS、LOWER、UPPER、LENGTH`,
        );
      if (take('DISTINCT') && !['COUNT', 'AVG', 'SUM'].includes(nameUpper))
        throw invalid('该函数不支持 DISTINCT');
      let count = 0;
      do {
        expression(0, depth + 1);
        if (++count > arity[1]) throw invalid('函数参数过多');
      } while (take(','));
      expect(')');
      if (count < arity[0]) throw invalid('函数参数不足');
    } else if (take('.')) {
      if (!take('*')) identifier();
    }
  };
  const expression = (minimum = 0, depth = 0): void => {
    primary(depth);
    while (position < tokens.length) {
      const op = peek()!;
      const precedence =
        op === 'OR'
          ? 1
          : op === 'AND'
            ? 2
            : ['=', '!=', '<>', '<', '>', '<=', '>=', 'IS', 'IN', 'BETWEEN', 'LIKE'].includes(op)
              ? 3
              : ['+', '-'].includes(op)
                ? 4
                : ['*', '/', '%'].includes(op)
                  ? 5
                  : -1;
      if (precedence < minimum || precedence < 0) break;
      position++;
      if (op === 'IS') take('NOT');
      if (op === 'IN') {
        expect('(');
        let count = 0;
        do {
          expression(0, depth + 1);
          if (++count > 20) throw invalid('IN 列表最多 20 个值');
        } while (take(','));
        expect(')');
      } else {
        expression(precedence + 1, depth + 1);
        if (op === 'BETWEEN') {
          expect('AND');
          expression(precedence + 1, depth + 1);
        }
      }
    }
  };
  const alias = () => {
    if (take('AS')) identifier();
    else if (tokens[position]?.kind === 'word' && !keywords.has(peek()!)) identifier();
  };
  const table = () => {
    const name = identifier();
    if (!tables.has(name.toLowerCase())) throw invalid('仅可查询 students、courses、enrollments 三张教学表');
    alias();
  };
  const expressionList = (limit: number, select = false, order = false) => {
    let count = 0;
    do {
      expression();
      if (select) alias();
      if (order && !take('ASC')) take('DESC');
      if (++count > limit) throw invalid('查询列或排序分组项过多');
    } while (take(','));
  };
  const smallInteger = () => {
    const token = tokens[position++];
    if (!token || token.kind !== 'number' || !/^\d+$/.test(token.raw) || Number(token.raw) > 100)
      throw invalid('LIMIT 和 OFFSET 必须为 0 至 100 的整数');
  };
  expect('SELECT');
  take('DISTINCT');
  expressionList(20, true);
  expect('FROM');
  table();
  while (['JOIN', 'INNER', 'LEFT'].includes(peek()!)) {
    if (++joinCount > 2) throw invalid('最多使用两次 JOIN');
    if (take('LEFT')) take('OUTER');
    else take('INNER');
    expect('JOIN');
    table();
    expect('ON');
    expression();
  }
  if (take('WHERE')) expression();
  if (take('GROUP')) {
    expect('BY');
    expressionList(12);
  }
  if (take('HAVING')) expression();
  if (take('ORDER')) {
    expect('BY');
    expressionList(12, false, true);
  }
  if (take('LIMIT')) {
    smallInteger();
    if (take('OFFSET')) smallInteger();
  }
  if (position !== tokens.length)
    throw invalid('此查询超出支持语法，仅支持 SELECT、筛选、分组、排序和最多两次 JOIN');
  return {
    sql: tokens.map((token) => (token.kind === 'string' ? '?' : token.raw)).join(' '),
    parameters: tokens.filter((token) => token.kind === 'string').map((token) => token.value!),
  };
}

const expected = {
  'high-scores': {
    columns: ['name', 'score'],
    rows: [
      ['Dana', 95],
      ['Alice', 92],
      ['Chen', 88],
      ['Faye', 81],
    ],
    title: '高分学生',
    instruction: '选择 name、score，筛选 score >= 80，按 score 降序、id 升序。',
  },
  'course-average': {
    columns: ['title', 'avg_grade'],
    rows: [
      ['Algorithms', 86],
      ['Physics', 96],
      ['Statistics', 233 / 3],
    ],
    title: '课程平均分',
    instruction: '选择课程 title 和平均 grade（别名 avg_grade），保留未选课课程，按 title 升序。',
  },
  'student-courses': {
    columns: ['name', 'title'],
    rows: [
      ['Alice', 'Algorithms'],
      ['Alice', 'Statistics'],
    ],
    title: 'Alice 的选课',
    instruction: '选择 name、title，查询 Alice 的所有选课，按课程 title 升序。',
  },
} satisfies Record<
  string,
  { columns: string[]; rows: (string | number)[][]; title: string; instruction: string }
>;
export function compareSqlLabResult(exercise: keyof typeof expected, actual: SqlLabRows) {
  const answer = expected[exercise];
  const columnsMatch =
    actual.columns.length === answer.columns.length &&
    actual.columns.every((column, index) => column === answer.columns[index]);
  const rowCountMatch = actual.rows.length === answer.rows.length;
  let firstMismatch = '';
  if (columnsMatch && rowCountMatch) {
    for (let row = 0; row < answer.rows.length && !firstMismatch; row++) {
      for (let column = 0; column < answer.columns.length; column++) {
        const target = answer.rows[row][column],
          value = actual.rows[row][column];
        const matches =
          typeof target === 'number'
            ? typeof value === 'number' && Number.isFinite(value) && Math.abs(value - target) <= 1e-6
            : value === target;
        if (!matches) {
          firstMismatch = `第 ${row + 1} 行 ${answer.columns[column]} 不符合预期，请检查筛选、计算和排序。`;
          break;
        }
      }
    }
  }
  return {
    matched: !actual.truncated && columnsMatch && rowCountMatch && !firstMismatch,
    columnsMatch,
    rowCountMatch,
    firstMismatch,
  };
}
let activeWorkers = 0;
export function sqlLabActiveWorkers() {
  return activeWorkers;
}
async function execute(plan: SqlPlan): Promise<SqlLabRows> {
  if (activeWorkers >= 4) throw new ServiceUnavailableException('SQL 练习正在处理较多请求，请稍后再试');
  activeWorkers++;
  let worker: Worker;
  try {
    const compiled = join(__dirname, 'sql-lab.worker.js');
    const path = existsSync(compiled) ? compiled : join(__dirname, 'sql-lab.worker.ts');
    worker = new Worker(path, {
      workerData: plan,
      env: {},
      execArgv: path.endsWith('.ts') ? ['--experimental-strip-types'] : [],
      resourceLimits: { maxOldGenerationSizeMb: 32, maxYoungGenerationSizeMb: 8, stackSizeMb: 2 },
    });
  } catch {
    activeWorkers--;
    throw new ServiceUnavailableException('SQL 练习暂时不可用，请稍后重试');
  }
  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = async (value?: SqlLabRows, error?: Error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      try {
        await worker.terminate();
      } catch {
        // The worker may have exited between its message and termination.
      } finally {
        activeWorkers--;
      }
      if (error) reject(error);
      else resolve(value!);
    };
    const timer = setTimeout(() => {
      void finish(undefined, invalid('执行超过 2 秒，请简化查询'));
    }, 2000);
    worker.once('error', () => {
      void finish(undefined, new ServiceUnavailableException('SQL 练习执行环境暂时不可用'));
    });
    worker.once('exit', (code) => {
      if (!settled)
        void finish(
          undefined,
          new ServiceUnavailableException(`SQL 练习执行中断${code === 0 ? '' : '，请简化查询后重试'}`),
        );
    });
    worker.once('message', (message: { result?: SqlLabRows; error?: string }) => {
      if (message.result) void finish(message.result);
      else void finish(undefined, invalid(message.error || '查询无法执行，请检查表名、列名和聚合表达式'));
    });
  });
}
export async function runSqlLab(values: Record<string, unknown>): Promise<StudyResult> {
  const input = inputSchema.parse(values);
  const actual = await execute(compileSqlLabQuery(input.query));
  const answer = expected[input.exercise];
  const comparison = compareSqlLabResult(input.exercise, actual);
  const toTable = (title: string, columns: string[], rows: SqlLabRows['rows']) => ({
    title,
    columns: columns.map((title, index) => ({ key: `column_${index}`, title })),
    rows: rows.map((row) => Object.fromEntries(row.map((value, index) => [`column_${index}`, value]))),
  });
  const result: StudyResult = {
    summary: comparison.matched
      ? `查询执行成功，结果符合“${answer.title}”任务要求。`
      : `查询已执行，结果尚未符合“${answer.title}”任务要求。`,
    metrics: [
      { label: '返回行数', value: actual.rows.length },
      { label: '任务是否匹配', value: comparison.matched ? '是' : '否' },
    ],
    tables: [
      toTable('查询结果', actual.columns, actual.rows),
      toTable('任务预期结果', answer.columns, answer.rows),
    ],
    sections: [
      { title: '任务要求', content: answer.instruction, status: 'info' },
      {
        title: '核对范围',
        content:
          '只核对当前固定教学数据的输出，不代表查询对所有可能数据都正确。课程平均分练习还应思考没有选课记录时 LEFT JOIN 的作用。',
        status: 'info',
      },
      {
        title: '逐项核对',
        content: `列名和顺序：${comparison.columnsMatch ? '符合' : `应为 ${answer.columns.join(', ')}`}；行数：${comparison.rowCountMatch ? '符合' : `应为 ${answer.rows.length} 行`}。${comparison.firstMismatch || (comparison.columnsMatch && comparison.rowCountMatch ? '逐单元格对比完成；文本区分大小写，数值容差为 0.000001。' : '请按预期列名、列顺序与行顺序再次检查。')}`,
        status: comparison.matched ? 'success' : 'warning',
      },
      {
        title: '教学数据表',
        content:
          'students(id, name, major, score)：6 位学生；courses(id, title, credits)：3 门课程；enrollments(student_id, course_id, grade)：7 条选课记录。全部为固定虚构教学数据，与真实账号和机构无关。',
        status: 'info',
      },
      {
        title: '查询范围',
        content:
          '支持单条 SELECT、WHERE、GROUP BY、HAVING、ORDER BY、LIMIT，以及最多两次 INNER/LEFT JOIN。函数仅限 COUNT、AVG、SUM、MIN、MAX、ROUND、ABS、LOWER、UPPER、LENGTH。最多显示 100 行，输出限制 64 KiB。',
        status: 'info',
      },
    ],
  };
  while (Buffer.byteLength(JSON.stringify(result), 'utf8') > 64000 && result.tables[0].rows.length) {
    result.tables[0].rows.pop();
    actual.truncated = true;
  }
  if (actual.truncated) {
    result.summary = '查询已执行，但输出达到显示上限，未判定为任务匹配。';
    result.metrics[0].value = result.tables[0].rows.length;
    result.metrics[1].value = '否';
    result.sections.push({
      title: '输出已截断',
      content: '请通过 WHERE 或 LIMIT 缩小结果范围。',
      status: 'warning',
    });
  }
  return result;
}
