import test from 'node:test';
import assert from 'node:assert/strict';
import { algorithmProblems, getAlgorithmProblem } from '../apps/api/src/algorithms/algorithms.catalog';

// Independent reference calculations catch ambiguous prompts and incorrect expected answers.
const solve: Record<string, (input: string) => string> = {
  'sum-of-two': (input) =>
    String(
      input
        .trim()
        .split(/\s+/)
        .map(Number)
        .reduce((a, b) => a + b),
    ),
  'array-maximum': (input) => {
    const [n, ...a] = input.trim().split(/\s+/).map(Number);
    assert.equal(a.length, n);
    let maximum = -Infinity;
    for (const value of a) maximum = Math.max(maximum, value);
    return `${maximum} ${a.indexOf(maximum) + 1}`;
  },
  'palindrome-word': (input) => (input.trim() === [...input.trim()].reverse().join('') ? 'YES' : 'NO'),
  'two-sum-indices': (input) => {
    const [n, target, ...a] = input.trim().split(/\s+/).map(Number);
    assert.equal(a.length, n);
    const seen = new Map<number, { count: number; first: number }>();
    let count = 0,
      answer = '';
    for (let i = 0; i < n; i++) {
      const complement = seen.get(target - a[i]);
      if (complement) {
        count += complement.count;
        answer = `${complement.first + 1} ${i + 1}`;
      }
      const previous = seen.get(a[i]);
      seen.set(a[i], { count: (previous?.count ?? 0) + 1, first: previous?.first ?? i });
    }
    assert.equal(count, 1, 'The statement promises exactly one pair');
    return answer;
  },
  'first-position': (input) => {
    const [n, q, ...values] = input.trim().split(/\s+/).map(Number);
    assert.equal(values.length, n + q);
    const a = values.slice(0, n);
    assert.deepEqual(
      a,
      [...a].sort((x, y) => x - y),
    );
    const first = new Map<number, number>();
    for (let i = 0; i < n; i++) if (!first.has(a[i])) first.set(a[i], i + 1);
    return values
      .slice(n)
      .map((x) => first.get(x) ?? -1)
      .join('\n');
  },
  'balanced-brackets': (input) => {
    const opens: string[] = [];
    const pairs: Record<string, string> = { ')': '(', ']': '[', '}': '{' };
    for (const char of input.trim()) {
      if ('([{'.includes(char)) opens.push(char);
      else if (opens.pop() !== pairs[char]) return 'NO';
    }
    return opens.length ? 'NO' : 'YES';
  },
  'maximum-subarray': (input) => {
    const [n, ...a] = input.trim().split(/\s+/).map(Number);
    assert.equal(a.length, n);
    // Prefix-minimum formulation independently checks the catalog's Kadane recurrence.
    let best = -Infinity,
      prefix = 0,
      minimum = 0;
    for (const value of a) {
      prefix += value;
      best = Math.max(best, prefix - minimum);
      minimum = Math.min(minimum, prefix);
    }
    return String(best);
  },
  'longest-unique-window': (input) => {
    const value = input.trim();
    assert.match(value, /^[a-z]+$/);
    let longest = 0;
    // At most 26 unique lowercase letters: this independent enumeration is O(26n).
    for (let i = 0; i < value.length; i++) {
      const chars = new Set<string>();
      for (let j = i; j < value.length && !chars.has(value[j]); j++) {
        chars.add(value[j]);
        longest = Math.max(longest, chars.size);
      }
    }
    return String(longest);
  },
  'grid-paths': (input) => {
    const [nText, mText, ...rows] = input.trim().split(/\s+/);
    const n = Number(nText),
      m = Number(mText);
    assert.equal(rows.length, n);
    assert.ok(rows.every((row) => row.length === m));
    const paths = Array.from({ length: n + 1 }, () => new Uint32Array(m + 1));
    for (let r = n - 1; r >= 0; r--)
      for (let c = m - 1; c >= 0; c--) {
        if (rows[r][c] === '#') continue;
        paths[r][c] = r === n - 1 && c === m - 1 ? 1 : (paths[r + 1][c] + paths[r][c + 1]) % 1000000007;
      }
    return String(paths[0][0]);
  },
  'minimum-coins': (input) => {
    const [n, amount, ...coins] = input.trim().split(/\s+/).map(Number);
    assert.equal(coins.length, n);
    assert.equal(new Set(coins).size, n);
    const queue = [[0, 0]],
      seen = new Set([0]);
    for (const [value, count] of queue) {
      if (value === amount) return String(count);
      for (const coin of coins)
        if (value + coin <= amount && !seen.has(value + coin)) {
          seen.add(value + coin);
          queue.push([value + coin, count + 1]);
        }
    }
    return '-1';
  },
  'course-order': (input) => {
    const [n, m, ...edges] = input.trim().split(/\s+/).map(Number);
    assert.equal(edges.length, m * 2);
    const adj: number[][] = Array.from({ length: n + 1 }, () => []);
    const colors = new Uint8Array(n + 1),
      next = new Uint32Array(n + 1);
    for (let i = 0; i < edges.length; i += 2) {
      assert.ok(edges[i] >= 1 && edges[i] <= n && edges[i + 1] >= 1 && edges[i + 1] <= n);
      adj[edges[i]].push(edges[i + 1]);
    }
    // Iterative DFS is independent of the reference explanation's Kahn queue and handles deep chains.
    for (let start = 1; start <= n; start++) {
      if (colors[start]) continue;
      const stack = [start];
      colors[start] = 1;
      while (stack.length) {
        const vertex = stack[stack.length - 1];
        if (next[vertex] === adj[vertex].length) {
          colors[vertex] = 2;
          stack.pop();
          continue;
        }
        const child = adj[vertex][next[vertex]++];
        if (colors[child] === 1) return 'NO';
        if (colors[child] === 0) {
          colors[child] = 1;
          stack.push(child);
        }
      }
    }
    return 'YES';
  },
  'inversion-count': (input) => {
    const [n, ...a] = input.trim().split(/\s+/).map(Number);
    assert.equal(a.length, n);
    // Fenwick ranks provide O(n log n) verification independent of merge-sort counting.
    const sorted = [...new Set(a)].sort((x, y) => x - y);
    const ranks = new Map(sorted.map((value, index) => [value, index + 1]));
    const tree = new Uint32Array(sorted.length + 1);
    let count = 0;
    for (let i = n - 1; i >= 0; i--) {
      const rank = ranks.get(a[i])!;
      for (let j = rank - 1; j > 0; j -= j & -j) count += tree[j];
      for (let j = rank; j < tree.length; j += j & -j) tree[j]++;
    }
    return String(count);
  },
  'range-sum': (input) => {
    const [n, q, ...a] = input.trim().split(/\s+/).map(Number);
    assert.ok(n >= 1 && n <= 100000 && q >= 1 && q <= 50000);
    assert.equal(a.length, n + 2 * q);
    // Fenwick queries independently check the simple-prefix reference implementation.
    const tree = new Float64Array(n + 1);
    for (let i = 1; i <= n; i++) {
      assert.ok(Math.abs(a[i - 1]) <= 1e9);
      for (let j = i; j <= n; j += j & -j) tree[j] += a[i - 1];
    }
    const prefix = (r: number) => {
      let sum = 0;
      for (let j = r; j; j -= j & -j) sum += tree[j];
      return sum;
    };
    const answer: number[] = [];
    for (let i = n; i < a.length; i += 2) {
      const [l, r] = a.slice(i, i + 2);
      assert.ok(1 <= l && l <= r && r <= n);
      answer.push(prefix(r) - prefix(l - 1));
    }
    return answer.join('\n');
  },
  'merge-intervals': (input) => {
    const [n, ...a] = input.trim().split(/\s+/).map(Number);
    assert.ok(n >= 1 && n <= 50000);
    assert.equal(a.length, 2 * n);
    // Sweep grouped endpoints; closed starts are processed before closed ends.
    const events = new Map<number, [number, number]>();
    for (let i = 0; i < a.length; i += 2) {
      const [l, r] = a.slice(i, i + 2);
      assert.ok(l <= r && Math.abs(l) <= 1e9 && Math.abs(r) <= 1e9);
      const start = events.get(l) ?? [0, 0];
      start[0]++;
      events.set(l, start);
      const end = events.get(r) ?? [0, 0];
      end[1]++;
      events.set(r, end);
    }
    const answer: string[] = [];
    let active = 0,
      left = 0;
    for (const [x, [starts, ends]] of [...events].sort((a, b) => a[0] - b[0])) {
      if (active === 0) {
        assert.ok(starts);
        left = x;
      }
      active += starts - ends;
      assert.ok(active >= 0);
      if (!active) answer.push(`${left} ${x}`);
    }
    return `${answer.length}\n${answer.join('\n')}`;
  },
  'binary-tree-depth': (input) => {
    const [n, ...a] = input.trim().split(/\s+/).map(Number);
    assert.ok(n >= 0 && n <= 100000);
    assert.equal(a.length, 2 * n);
    const parents = new Int32Array(n + 1);
    for (let u = 1; u <= n; u++)
      for (const v of a.slice(2 * u - 2, 2 * u)) {
        assert.ok(v >= 0 && v <= n);
        if (v) {
          assert.equal(parents[v], 0, 'Unique parent');
          parents[v] = u;
        }
      }
    if (!n) return '0';
    assert.equal(parents[1], 0);
    const stack = [[1, 1]],
      visited = new Set<number>();
    let answer = 0;
    while (stack.length) {
      const [u, depth] = stack.pop()!;
      assert.ok(!visited.has(u), 'No tree cycle');
      visited.add(u);
      answer = Math.max(answer, depth);
      for (const v of a.slice(2 * u - 2, 2 * u)) if (v) stack.push([v, depth + 1]);
    }
    assert.equal(visited.size, n, 'Every node reachable');
    return String(answer);
  },
  'island-count': (input) => {
    const [rText, cText, ...grid] = input.trim().split(/\s+/);
    const rows = Number(rText),
      cols = Number(cText);
    assert.ok(rows >= 1 && rows <= 500 && cols >= 1 && cols <= 500);
    assert.equal(grid.length, rows);
    assert.ok(grid.every((row) => row.length === cols && /^[01]+$/.test(row)));
    // Union adjacent land cells instead of the editorial's flood fill.
    const parent = Array.from({ length: rows * cols }, (_, i) => i);
    const find = (x: number) => {
      while (parent[x] !== x) {
        parent[x] = parent[parent[x]];
        x = parent[x];
      }
      return x;
    };
    let components = 0;
    for (let r = 0; r < rows; r++)
      for (let c = 0; c < cols; c++)
        if (grid[r][c] === '1') {
          components++;
          for (const [x, y] of [
            [r - 1, c],
            [r, c - 1],
          ])
            if (x >= 0 && y >= 0 && grid[x][y] === '1') {
              const a = find(r * cols + c),
                b = find(x * cols + y);
              if (a !== b) {
                parent[a] = b;
                components--;
              }
            }
        }
    return String(components);
  },
  'shortest-path': (input) => {
    const [n, m, s, t, ...a] = input.trim().split(/\s+/).map(Number);
    assert.ok(n >= 1 && n <= 100000 && m >= 0 && m <= 200000 && s >= 1 && s <= n && t >= 1 && t <= n);
    assert.equal(a.length, 3 * m);
    const graph: [number, number][][] = Array.from({ length: n + 1 }, () => []);
    for (let i = 0; i < a.length; i += 3) {
      const [u, v, w] = a.slice(i, i + 3);
      assert.ok(u >= 1 && u <= n && v >= 1 && v <= n && w >= 0 && w <= 1e9);
      graph[u].push([v, w]);
    }
    // Queue-based repeated relaxation independently checks Dijkstra on these fixtures.
    const dist = new Array(n + 1).fill(Infinity),
      queued = new Uint8Array(n + 1),
      queue = [s];
    dist[s] = 0;
    queued[s] = 1;
    for (let head = 0; head < queue.length; head++) {
      const u = queue[head];
      queued[u] = 0;
      for (const [v, w] of graph[u])
        if (dist[u] + w < dist[v]) {
          dist[v] = dist[u] + w;
          if (!queued[v]) {
            queued[v] = 1;
            queue.push(v);
          }
        }
    }
    return String(dist[t] === Infinity ? -1 : dist[t]);
  },
  'connected-components': (input) => {
    const [n, m, ...a] = input.trim().split(/\s+/).map(Number);
    assert.ok(n >= 1 && n <= 100000 && m >= 0 && m <= 200000);
    assert.equal(a.length, 2 * m);
    const graph: number[][] = Array.from({ length: n + 1 }, () => []);
    for (let i = 0; i < a.length; i += 2) {
      const [u, v] = a.slice(i, i + 2);
      assert.ok(u >= 1 && u <= n && v >= 1 && v <= n);
      graph[u].push(v);
      graph[v].push(u);
    }
    const seen = new Set<number>();
    let answer = 0;
    for (let u = 1; u <= n; u++)
      if (!seen.has(u)) {
        answer++;
        seen.add(u);
        const stack = [u];
        while (stack.length)
          for (const v of graph[stack.pop()!])
            if (!seen.has(v)) {
              seen.add(v);
              stack.push(v);
            }
      }
    return String(answer);
  },
};

test('algorithm catalog has complete public statements, starter programs and independent answer checks', () => {
  assert.equal(algorithmProblems.length, 18);
  assert.equal(new Set(algorithmProblems.map((p) => p.id)).size, algorithmProblems.length);
  assert.equal(getAlgorithmProblem('does-not-exist'), undefined);
  for (const p of algorithmProblems) {
    assert.equal(getAlgorithmProblem(p.id), p);
    assert.ok(p.description && p.inputFormat && p.outputFormat && p.constraints && p.solution);
    assert.ok(p.examples.length && p.hints.length && p.testCases.filter((c) => c.hidden).length >= 4);
    assert.ok(p.testCases.length <= 10, 'Keep the total compile/queue work within the judge deadline');
    assert.ok(Buffer.byteLength(JSON.stringify(p.testCases)) <= 16 * 1048576);
    assert.deepEqual(Object.keys(p.starterCode).sort(), ['cpp', 'java', 'javascript', 'python']);
    assert.deepEqual(
      p.testCases.filter((c) => !c.hidden).map(({ input, output }) => ({ input, output })),
      p.examples.map(({ input, output }) => ({ input, output })),
    );
    for (const c of p.testCases) {
      assert.ok(Buffer.byteLength(c.input) <= 4 * 1048576 && Buffer.byteLength(c.output) <= 1048576);
      assert.equal(
        solve[p.id](c.input),
        c.output.trimEnd(),
        `${p.id}: ${JSON.stringify(c.input.slice(0, 100))}`,
      );
    }
  }
});

test('private cases exercise stated size limits, repeated values, overflow and modular arithmetic', () => {
  const cases = (id: string) => getAlgorithmProblem(id)!.testCases.filter((item) => item.hidden);
  for (const id of [
    'array-maximum',
    'two-sum-indices',
    'first-position',
    'maximum-subarray',
    'inversion-count',
  ])
    assert.ok(cases(id).some((item) => item.input.startsWith('100000')));
  for (const id of ['palindrome-word', 'balanced-brackets', 'longest-unique-window'])
    assert.ok(cases(id).some((item) => item.input.trim().length === 100000));
  assert.ok(
    cases('first-position').some(
      (item) => item.input.startsWith('100000 100000\n') && item.output.trim().split('\n').length === 100000,
    ),
  );
  assert.ok(
    cases('grid-paths').some((item) => item.input.startsWith('500 500\n') && item.output === '264223182\n'),
  );
  assert.ok(cases('minimum-coins').some((item) => item.input.startsWith('30 10000\n')));
  assert.equal(cases('course-order').filter((item) => item.input.startsWith('100000 200000\n')).length, 2);
  assert.ok(cases('maximum-subarray').some((item) => Number(item.output) > 2147483647));
  assert.ok(cases('inversion-count').some((item) => Number(item.output) > 4294967295));
});

test('extended topics include maximum-size, directed, isolated and degenerate cases', () => {
  const cases = (id: string) => getAlgorithmProblem(id)!.testCases.filter((c) => c.hidden);
  assert.ok(cases('range-sum').some((c) => c.input.startsWith('100000 50000\n')));
  assert.ok(
    cases('merge-intervals').some((c) => c.input.startsWith('50000\n') && c.output.startsWith('50000\n')),
  );
  assert.ok(cases('binary-tree-depth').some((c) => c.output.trim() === '100000'));
  assert.ok(cases('island-count').some((c) => c.output.trim() === '125000'));
  assert.ok(
    cases('shortest-path').some((c) => c.input.startsWith('100000 200000') && Number(c.output) > 2147483647),
  );
  assert.ok(
    cases('connected-components').some((c) => c.input.startsWith('100000 0') && c.output.trim() === '100000'),
  );
});
