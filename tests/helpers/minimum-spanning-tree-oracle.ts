import assert from 'node:assert/strict';

export type MstEdge = readonly [number, number, number];
export type MstGraph = { n: number; edges: MstEdge[] };

/** Test-only parser. Production custom stdin remains the student's program's responsibility. */
export function parseMstInput(input: string): MstGraph {
  const tokens = input.trim().split(/\s+/);
  assert.ok(
    tokens.every((token) => /^[+-]?\d+$/.test(token)),
    'Decimal integer tokens required',
  );
  const values = tokens.map(Number);
  const [n, m] = values;
  assert.ok(Number.isInteger(n) && n >= 1 && n <= 100000, 'Invalid vertex count');
  assert.ok(Number.isInteger(m) && m >= 0 && m <= 100000, 'Invalid edge count');
  assert.equal(values.length, 2 + 3 * m, 'Input must contain exactly m edges');
  const edges: MstEdge[] = [];
  for (let i = 2; i < values.length; i += 3) {
    const [u, v, w] = values.slice(i, i + 3);
    assert.ok(Number.isInteger(u) && u >= 1 && u <= n);
    assert.ok(Number.isInteger(v) && v >= 1 && v <= n);
    assert.ok(Number.isInteger(w) && Math.abs(w) <= 1e9);
    edges.push([u, v, w]);
  }
  return { n, edges };
}

/** Independent Prim oracle: grow a cut from vertex 1; no sorting/union-find/Kruskal code. */
export function primMinimumSpanningTree({ n, edges }: MstGraph): number | null {
  const adjacency: [number, number][][] = Array.from({ length: n + 1 }, () => []);
  for (const [u, v, weight] of edges) {
    adjacency[u].push([v, weight]);
    adjacency[v].push([u, weight]);
  }
  const heap: [number, number][] = [];
  function push(item: [number, number]) {
    let i = heap.length;
    heap.push(item);
    while (i > 0) {
      const parent = (i - 1) >> 1;
      if (heap[parent][0] <= item[0]) break;
      heap[i] = heap[parent];
      i = parent;
    }
    heap[i] = item;
  }
  function pop() {
    const first = heap[0],
      last = heap.pop()!;
    if (heap.length) {
      let i = 0;
      while (i * 2 + 1 < heap.length) {
        let child = i * 2 + 1;
        if (child + 1 < heap.length && heap[child + 1][0] < heap[child][0]) child++;
        if (heap[child][0] >= last[0]) break;
        heap[i] = heap[child];
        i = child;
      }
      heap[i] = last;
    }
    return first;
  }
  const seen = new Uint8Array(n + 1);
  const best = new Float64Array(n + 1).fill(Infinity);
  best[1] = 0;
  push([0, 1]);
  let total = 0,
    visited = 0;
  while (heap.length) {
    const [weight, u] = pop();
    if (seen[u]) continue;
    seen[u] = 1;
    total += weight;
    visited++;
    for (const [v, w] of adjacency[u])
      if (!seen[v] && w < best[v]) {
        best[v] = w;
        push([w, v]);
      }
  }
  assert.ok(Number.isSafeInteger(total), 'Oracle must retain exact integer totals');
  return visited === n ? total : null;
}

export function solveMstInput(input: string): string {
  const answer = primMinimumSpanningTree(parseMstInput(input));
  return answer === null ? 'IMPOSSIBLE' : String(answer);
}

/** Small-graph oracle: enumerate subsets of n-1 edges, then check connectivity using DFS.
 * With n-1 edges connectivity itself proves acyclicity; loops/parallel cycles cannot pass.
 */
export function enumerateSpanningTrees({ n, edges }: MstGraph): number | null {
  assert.ok(n <= 7 && edges.length <= 14, 'Exhaustive oracle is limited to small graphs');
  let answer = Infinity;
  const selected: MstEdge[] = [];
  function visit(index: number, total: number) {
    if (selected.length === n - 1) {
      const adjacency: number[][] = Array.from({ length: n + 1 }, () => []);
      for (const [u, v] of selected) {
        adjacency[u].push(v);
        adjacency[v].push(u);
      }
      const seen = new Set([1]),
        stack = [1];
      while (stack.length)
        for (const v of adjacency[stack.pop()!])
          if (!seen.has(v)) {
            seen.add(v);
            stack.push(v);
          }
      if (seen.size === n) answer = Math.min(answer, total);
      return;
    }
    if (edges.length - index < n - 1 - selected.length) return;
    for (let i = index; i < edges.length; i++) {
      selected.push(edges[i]);
      visit(i + 1, total + edges[i][2]);
      selected.pop();
    }
  }
  visit(0, 0);
  return answer === Infinity ? null : answer;
}
