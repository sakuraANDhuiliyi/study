import test from 'node:test';
import assert from 'node:assert/strict';
import { getAlgorithmProblem } from '../apps/api/src/algorithms/algorithms.catalog';
import {
  enumerateSpanningTrees,
  parseMstInput,
  primMinimumSpanningTree,
  solveMstInput,
  type MstGraph,
  type MstEdge,
} from './helpers/minimum-spanning-tree-oracle';

const problem = getAlgorithmProblem('minimum-spanning-tree')!;
test('MST canonical cases agree with independent Prim including both 100k limits', () => {
  assert.ok(problem);
  assert.equal(problem.number, 19);
  assert.equal(problem.title, '最小生成树总权');
  assert.equal(problem.examples.length, 3);
  assert.equal(problem.testCases.length, 10);
  assert.equal(problem.testCases.filter((item) => item.hidden).length, 7);
  for (const item of problem.testCases) assert.equal(solveMstInput(item.input), item.output.trim());
  assert.deepEqual(
    problem.examples.map((item) => item.output.trim()),
    ['8', 'IMPOSSIBLE', '-1'],
  );
  const large = problem.testCases.filter((item) => item.input.startsWith('100000 100000\n'));
  assert.equal(large.length, 2);
  assert.deepEqual(large.map((item) => item.output.trim()).sort(), ['-99999000000000', '99999000000000']);
});

test('MST distinguishes legitimate minus one, isolated singleton and disconnected graph', () => {
  for (const [input, answer] of [
    ['1 0\n', '0'],
    ['1 2\n1 1 -1000000000\n1 1 0\n', '0'],
    ['2 1\n1 2 -1\n', '-1'],
    ['2 0\n', 'IMPOSSIBLE'],
    ['3 2\n1 2 0\n1 2 -3\n', 'IMPOSSIBLE'],
  ])
    assert.equal(solveMstInput(input), answer);
});

test('negative cycle edges cannot replace the bridge needed to connect every vertex', () => {
  const graph: MstGraph = {
    n: 4,
    edges: [
      [1, 2, -9],
      [2, 3, -8],
      [1, 3, -7],
      [3, 4, 30],
      [4, 4, -1e9],
    ],
  };
  assert.equal(primMinimumSpanningTree(graph), 13);
  assert.equal(enumerateSpanningTrees(graph), 13);
});

test('equal-weight multiple trees, repeated edges and zero edges have a stable optimum', () => {
  const graph: MstGraph = {
    n: 4,
    edges: [
      [1, 2, 7],
      [1, 3, 7],
      [1, 4, 7],
      [2, 3, 7],
      [2, 4, 7],
      [3, 4, 7],
    ],
  };
  assert.equal(enumerateSpanningTrees(graph), 21);
  assert.equal(primMinimumSpanningTree(graph), 21);
  assert.equal(solveMstInput('3 5\n1 2 8\n1 2 0\n2 3 0\n1 3 9\n2 2 -100\n'), '0');
});

function randomGraphs() {
  let state = 0x19780517;
  const next = (limit: number) => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state % limit;
  };
  return Array.from({ length: 180 }, (): MstGraph => {
    const n = 1 + next(6),
      m = next(13);
    return { n, edges: Array.from({ length: m }, () => [1 + next(n), 1 + next(n), next(19) - 9] as MstEdge) };
  });
}

test('180 deterministic small graphs cross-check Prim against exhaustive tree subsets', () => {
  for (const graph of randomGraphs())
    assert.equal(primMinimumSpanningTree(graph), enumerateSpanningTrees(graph));
});

test('edge order, vertex renaming, duplicate edges and arbitrary self loops preserve answers', () => {
  for (const graph of randomGraphs()) {
    const expected = enumerateSpanningTrees(graph);
    const renamed: MstGraph = {
      n: graph.n,
      edges: graph.edges
        .slice()
        .reverse()
        .map(([u, v, w]) => [graph.n + 1 - v, graph.n + 1 - u, w]),
    };
    assert.equal(primMinimumSpanningTree(renamed), expected);
    const augmented: MstGraph = {
      n: graph.n,
      edges: [
        ...graph.edges,
        ...graph.edges,
        ...Array.from({ length: graph.n }, (_, i): MstEdge => [i + 1, i + 1, -1e9]),
      ],
    };
    assert.equal(primMinimumSpanningTree(augmented), expected);
  }
});

test('large positive and negative exact totals exceed 32-bit arithmetic safely', () => {
  for (const sign of [-1, 1]) {
    const graph: MstGraph = {
      n: 100000,
      edges: Array.from({ length: 99999 }, (_, i) => [i + 1, i + 2, sign * 1e9]),
    };
    assert.equal(primMinimumSpanningTree(graph), sign * 99999000000000);
  }
});

test('test oracle rejects malformed or out-of-contract canonical inputs', () => {
  for (const input of [
    '',
    '0 0',
    '100001 0',
    '2 -1',
    '2 1\n1 3 0',
    '2 1\n1 2 1.5',
    '2 1\n1 2 1000000001',
    '2 0\n1 2 0',
    '2 1\n1 2 NaN',
    '2 1\n1 2 0x10',
    '2 1\n1 2 1e3',
    '2.0 0',
  ])
    assert.throws(() => parseMstInput(input));
});
