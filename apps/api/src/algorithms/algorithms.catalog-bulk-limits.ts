/** Constructed stress cases; closed-form answers are independent of the reference programs. */
const n = 100_000;
const numbers = (count: number, value: number | ((index: number) => number)) =>
  Array.from({ length: count }, (_, i) => (typeof value === 'number' ? value : value(i))).join(' ');
const array = (value: number | ((index: number) => number), head: string = String(n)) =>
  `${head}\n${numbers(n, value)}\n`;
const chain = (count: number = n) =>
  Array.from({ length: count - 1 }, (_, i) => `${i + 1} ${i + 2}`).join('\n') + '\n';
const tree = `${n}\n${chain()}`;
const repeated = (value: string, count: number) => Array(count).fill(value).join(' ');
export const bulkAlgorithmLimitCases: Record<string, [string, string][]> = {
  'unique-values': [[array(1), '1\n']],
  'second-distinct': [[array(9), 'NONE\n']],
  'majority-ballot': [[array((i) => i % 2), 'NONE\n']],
  'sorted-deduplicate': [[array(1), '1\n1\n']],
  'rotate-array': [[array(0, `${n} 1000000000000`), repeated('0', n) + '\n']],
  'mex-number': [[array((i) => i), `${n}\n`]],
  'pair-difference': [[array(0, `${n} 0`), '4999950000\n']],
  'odd-subarrays': [[array(1), '2500050000\n']],
  'zero-sum-subarrays': [[array(0), '5000050000\n']],
  'product-except-self': [[array(1), repeated('1', n) + '\n']],
  'minimum-value-gap': [[array(1), '0\n']],
  'median-movement': [[array(1), '0\n']],
  'shortest-positive-window': [[array(1, `${n} ${n}`), `${n}\n`]],
  'fixed-window-total': [[array(-1, `${n} ${n}`), '-100000\n']],
  'range-increments': [[array(0, `${n} ${n}`) + `1 ${n} 1\n`.repeat(n), repeated(String(n), n) + '\n']],
  'range-xor': [[array(0, `${n} ${n}`) + `1 ${n}\n`.repeat(n), '0\n'.repeat(n)]],
  'next-greater-index': [[array((i) => n - i), repeated('0', n) + '\n']],
  'window-maximum': [[array(1, `${n} 500`), repeated('1', n - 499) + '\n']],
  'histogram-area': [[array(1_000_000_000), '100000000000000\n']],
  'kth-ranked': [[array((i) => n - i, `${n} ${n}`), `${n}\n`]],
  'dynamic-range-sum': [
    [array(0, `${n} ${n}`) + 'ADD 1 1000000000\n'.repeat(n - 1) + `SUM 1 ${n}\n`, '99999000000000\n'],
  ],
  'increasing-subsequence': [[array((i) => i), `${n}\n`]],
  'nonadjacent-value': [[array(1_000_000_000), '50000000000000\n']],
  'unweighted-distance': [[`${n} ${n - 1} 1 ${n}\n${chain()}`, '99999\n']],
  'bipartite-check': [[`${n} ${n - 1}\n${chain()}`, 'YES\n']],
  'directed-reach-count': [[`${n} ${n - 1} 1\n${chain()}`, `${n}\n`]],
  'dag-longest-edges': [[`${n} ${n - 1}\n${chain()}`, '99999\n']],
  'dag-path-count': [[`${n} ${n - 1}\n${chain()}`, '1\n']],
  'euler-trail-check': [[`${n} ${n - 1}\n${chain()}`, 'YES\n']],
  'tree-diameter': [[tree, '99999\n']],
  'rooted-subtree-sizes': [[tree, numbers(n, (i) => n - i) + '\n']],
  'lowest-common-ancestor': [[`${n} ${n}\n${chain()}${`1 ${n}\n`.repeat(n)}`, '1\n'.repeat(n)]],
  'tree-independent-count': [[tree, '879053727\n']],
  'tree-maximum-matching': [[tree, '50000\n']],
  'tree-distance-sums': [
    [
      `50000\n${chain(50000)}`,
      numbers(50000, (i) => (i * (i + 1)) / 2 + ((49999 - i) * (50000 - i)) / 2) + '\n',
    ],
  ],
  'convex-hull-vertices': [
    [`${n}\n` + Array.from({ length: n }, (_, i) => `${i} ${i}`).join('\n') + '\n', '2\n'],
  ],
  'polygon-double-area': [
    [
      `${n}\n` +
        Array.from({ length: n / 2 }, (_, i) => `${i} 0`).join('\n') +
        '\n' +
        Array.from({ length: n / 2 }, (_, i) => `${n / 2 - i - 1} 1`).join('\n') +
        '\n',
      '99998\n',
    ],
  ],
  'maximum-manhattan': [
    [`${n}\n` + Array.from({ length: n }, (_, i) => `${i} 0`).join('\n') + '\n', '99999\n'],
  ],
  'anagram-labels': [['a'.repeat(n) + '\n' + 'a'.repeat(n) + '\n', 'YES\n']],
  'run-length-encode': [['a'.repeat(n) + '\n', 'a100000\n']],
  'shortest-string-period': [['abc'.repeat(Math.ceil(n / 3)).slice(0, n) + '\n', `${n}\n`]],
  'pattern-occurrences': [['a'.repeat(n) + '\n' + 'a'.repeat(n / 2) + '\n', '50001\n']],
  'longest-palindrome-length': [['a'.repeat(2000) + '\n', '2000\n']],
  'palindrome-substring-count': [['a'.repeat(2000) + '\n', '2001000\n']],
  'subsequence-check': [['a'.repeat(n) + '\na\n', 'YES\n']],
  'caesar-shift': [['1\n' + 'a'.repeat(n) + '\n', 'b'.repeat(n) + '\n']],
  'minimum-rotation': [['a'.repeat(2000) + '\n', 'a'.repeat(2000) + '\n']],
  'word-frequency': [[`${n}\n${repeated('a', n)}\n`, 'a 100000\n']],
  'bracket-insertions': [[')'.repeat(n) + '\n', `${n}\n`]],
  'common-subsequence': [['a'.repeat(500) + '\n' + 'a'.repeat(500) + '\n', '500\n']],
  'edit-distance': [['a'.repeat(500) + '\n' + 'b'.repeat(500) + '\n', '500\n']],
  'zero-one-knapsack': [['100 10000\n' + '100 1000000000\n'.repeat(100), '100000000000\n']],
  'ordered-coin-ways': [['1 10000\n1\n', '1\n']],
  'unordered-coin-ways': [['1 10000\n1\n', '1\n']],
  'subset-target': [['100 10000\n' + numbers(100, 100) + '\n', 'YES\n']],
  'bounded-hop-cost': [['5000 100\n' + numbers(5000, 1) + '\n', '0\n']],
  'grid-minimum-cost': [['500 500\n' + (numbers(500, 1) + '\n').repeat(500), '999\n']],
  'largest-one-square': [['500 500\n' + ('1'.repeat(500) + '\n').repeat(500), '250000\n']],
  'rod-cut-value': [['1000\n' + numbers(1000, (i) => i + 1) + '\n', '1000\n']],
  'matrix-chain-cost': [['100\n' + numbers(101, 1000) + '\n', '99000000000\n']],
  'palindromic-subsequence': [['a'.repeat(1000) + '\n', '1000\n']],
  'end-picking-game': [['3000\n' + numbers(3000, 1_000_000_000) + '\n', '0\n']],
  'strong-component-count': [[`2000 1999\n${chain(2000)}`, '2000\n']],
  'all-pairs-routes': [
    [
      '100 99 1\n' +
        Array.from({ length: 99 }, (_, i) => `${i + 1} ${i + 2} 1000000000`).join('\n') +
        '\n1 100\n',
      '99000000000\n',
    ],
  ],
  'bridge-count': [[`2000 1999\n${chain(2000)}`, '1999\n']],
  'articulation-count': [[`2000 1999\n${chain(2000)}`, '1998\n']],
  'bipartite-matching': [
    [
      '200 200 10000\n' +
        Array.from({ length: 10000 }, (_, i) => `${Math.floor(i / 100) + 1} ${(i % 100) + 1}`).join('\n') +
        '\n',
      '100\n',
    ],
  ],
  'maximum-network-flow': [['50 1000 1 50\n' + '1 50 1000000000\n'.repeat(1000), '1000000000000\n']],
};
