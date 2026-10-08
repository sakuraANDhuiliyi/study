import { extraAlgorithmContents } from './algorithms.catalog-extra';
import { graphAlgorithmContents } from './algorithms.catalog-graphs';

/** Original, versioned practice content. Private cases and teaching notes stay on the server. */
export type AlgorithmLanguage = 'cpp' | 'python' | 'javascript' | 'java';
export type Language = AlgorithmLanguage;
export interface AlgorithmProblem {
  id: string;
  number: number;
  title: string;
  difficulty: 'easy' | 'medium' | 'hard';
  tags: string[];
  description: string;
  inputFormat: string;
  outputFormat: string;
  constraints: string;
  examples: { input: string; output: string; explanation: string }[];
  timeLimitMs: number;
  memoryLimitMb: number;
  starterCode: Record<AlgorithmLanguage, string>;
  testCases: { input: string; output: string; hidden: boolean }[];
  hints: string[];
  solution: string;
}
const starterCode: Record<AlgorithmLanguage, string> = {
  cpp: '#include <bits/stdc++.h>\nusing namespace std;\n\nint main() {\n    ios::sync_with_stdio(false);\n    cin.tie(nullptr);\n    // 从标准输入读取数据，将答案输出到标准输出。\n    // 请根据左侧输入格式实现算法。\n    return 0;\n}\n',
  python:
    'import sys\n\ndef solve():\n    data = sys.stdin.read().split()\n    # 根据左侧输入格式解析 data，使用 print 输出答案。\n    pass\n\nif __name__ == "__main__":\n    solve()\n',
  javascript:
    "const fs = require('fs');\nconst input = fs.readFileSync(0, 'utf8').trim();\nconst tokens = input ? input.split(/\\s+/) : [];\n\nfunction solve() {\n  // 根据左侧输入格式解析 tokens，使用 console.log 输出答案。\n}\n\nsolve();\n",
  java: 'import java.io.*;\nimport java.util.*;\n\npublic class Main {\n    public static void main(String[] args) throws Exception {\n        BufferedReader br = new BufferedReader(new InputStreamReader(System.in));\n        // 从 br 读取输入，使用 System.out.println 输出答案。\n        // 大量整数输入建议使用缓冲读取与分词。\n    }\n}\n',
};
export type AlgorithmContent = Omit<
  AlgorithmProblem,
  'number' | 'starterCode' | 'timeLimitMs' | 'memoryLimitMb' | 'testCases'
> & {
  hiddenCases: [string, string][];
};
const contents: AlgorithmContent[] = [
  {
    id: 'sum-of-two',
    title: '两数相加',
    difficulty: 'easy',
    tags: ['入门', '数学'],
    description:
      '读入两个整数，计算它们的和。这道题用于熟悉标准输入、标准输出和在线判题。只输出答案，不要输出提示文字。',
    inputFormat: '一行两个整数 a 和 b，以空格分隔。',
    outputFormat: '输出一个整数，表示 a + b。',
    constraints: '−10⁹ ≤ a, b ≤ 10⁹。',
    examples: [
      { input: '7 12\n', output: '19\n', explanation: '7 + 12 = 19。' },
      { input: '-5 3\n', output: '-2\n', explanation: '负数同样参与计算。' },
    ],
    hiddenCases: [
      ['0 0\n', '0\n'],
      ['1000000000 1000000000\n', '2000000000\n'],
      ['-1000000000 -1000000000\n', '-2000000000\n'],
      ['42 -42\n', '0\n'],
    ],
    hints: ['按空白分隔读取两个整数。', '将两个整数相加后输出，注意负数。'],
    solution: '读入 a、b，输出 a+b。时间复杂度 O(1)，额外空间 O(1)。',
  },
  {
    id: 'array-maximum',
    title: '寻找最高分',
    difficulty: 'easy',
    tags: ['数组', '遍历'],
    description: '给定 n 个整数成绩（允许负数），找出最大值及其第一次出现的位置。位置从 1 开始编号。',
    inputFormat: '第一行一个整数 n。第二行 n 个整数。',
    outputFormat: '输出最大值和其第一次出现的位置，以一个空格分隔。',
    constraints: '1 ≤ n ≤ 100000；每个整数的绝对值 ≤ 10⁹。',
    examples: [{ input: '5\n3 9 4 9 2\n', output: '9 2\n', explanation: '最大值 9 首次出现在第 2 个位置。' }],
    hiddenCases: [
      ['1\n-7\n', '-7 1\n'],
      ['4\n-8 -3 -3 -9\n', '-3 2\n'],
      ['4\n5 5 5 5\n', '5 1\n'],
      ['5\n1 2 3 4 5\n', '5 5\n'],
      ['3\n1000000000 0 -1000000000\n', '1000000000 1\n'],
    ],
    hints: ['把第一个数设为当前最大值，而不是把最大值初始化为 0。', '只有遇到严格更大的数时才更新位置。'],
    solution:
      '扫描数组并维护最大值与首次位置；严格大于时更新，两者相等时保留原位置。时间 O(n)，除输入存储外空间 O(1)。',
  },
  {
    id: 'palindrome-word',
    title: '回文单词',
    difficulty: 'easy',
    tags: ['字符串', '双指针'],
    description: '一个单词从左到右和从右到左读起来相同，则称为回文。判断给定小写英文单词是否为回文。',
    inputFormat: '一行一个只包含小写英文字母的非空单词。',
    outputFormat: '是回文输出 YES，否则输出 NO。',
    constraints: '1 ≤ 单词长度 ≤ 100000。',
    examples: [
      { input: 'level\n', output: 'YES\n', explanation: '倒序仍然是 level。' },
      { input: 'study\n', output: 'NO\n', explanation: '首尾字母不同。' },
    ],
    hiddenCases: [
      ['a\n', 'YES\n'],
      ['abba\n', 'YES\n'],
      ['abca\n', 'NO\n'],
      ['aaaaabaaaaa\n', 'YES\n'],
      ['aabb\n', 'NO\n'],
    ],
    hints: ['比较第一个字符和最后一个字符。', '两个指针从首尾同时向中间移动，遇到不同字符就可以停止。'],
    solution: '用左右指针比较对应字符，若存在不相等的一对则 NO，否则 YES。时间 O(n)，额外空间 O(1)。',
  },
  {
    id: 'two-sum-indices',
    title: '配对目标值',
    difficulty: 'easy',
    tags: ['数组', '哈希表'],
    description:
      '在整数数组中找到两个不同位置，使两数之和等于 target。保证恰好有一组满足条件的位置对，按从小到大输出这两个从 1 开始的位置。',
    inputFormat: '第一行 n 和 target。第二行 n 个整数。',
    outputFormat: '输出两个位置 i、j（i < j），以一个空格分隔。',
    constraints: '2 ≤ n ≤ 100000；数组元素及 target 的绝对值 ≤ 10⁹；保证恰好一组位置对。',
    examples: [
      { input: '4 10\n2 7 4 8\n', output: '1 4\n', explanation: '第 1 个数 2 和第 4 个数 8 的和为 10。' },
    ],
    hiddenCases: [
      ['2 6\n3 3\n', '1 2\n'],
      ['4 0\n-4 2 4 7\n', '1 3\n'],
      ['5 11\n1 2 3 5 6\n', '4 5\n'],
      ['3 -8\n-3 -5 2\n', '1 2\n'],
      ['4 4\n0 4 7 9\n', '1 2\n'],
    ],
    hints: [
      '当前值为 x 时，之前是否出现过 target − x？',
      '先查找补数，再记录当前下标，避免重复使用同一位置。',
    ],
    solution:
      '哈希表保存已扫描值及其位置。对每个 x 先查 target-x，找到则输出存储位置和当前位置；否则记录 x。平均时间 O(n)，空间 O(n)。',
  },
  {
    id: 'first-position',
    title: '第一次出现的位置',
    difficulty: 'easy',
    tags: ['二分查找', '数组'],
    description:
      '给定一个非递减整数数组以及 q 次查询。每次查询一个值，输出该值在数组中第一次出现的位置（从 1 开始）；不存在则输出 −1。请使用二分查找处理查询。',
    inputFormat: '第一行 n 和 q。第二行 n 个非递减整数。第三行 q 个查询值。',
    outputFormat: '每次查询输出一行结果。',
    constraints: '1 ≤ n, q ≤ 100000；所有数的绝对值 ≤ 10⁹。',
    examples: [
      {
        input: '6 3\n1 2 2 2 5 9\n2 4 9\n',
        output: '2\n-1\n6\n',
        explanation: '2 第一次在位置 2；4 不存在；9 在位置 6。',
      },
    ],
    hiddenCases: [
      ['1 3\n5\n5 4 6\n', '1\n-1\n-1\n'],
      ['4 3\n-3 -3 0 7\n-3 0 8\n', '1\n3\n-1\n'],
      ['4 2\n2 2 2 2\n2 1\n', '1\n-1\n'],
      ['5 4\n1 3 5 7 9\n1 0 10 5\n', '1\n-1\n-1\n3\n'],
    ],
    hints: ['找到第一个大于或等于查询值的位置。', '相等时仍向左缩小区间；最后检查候选值是否确实相等。'],
    solution:
      '对每次查询做 lower_bound 二分，找到第一个不小于 x 的位置。若越界或不等于 x 则输出 -1，否则输出位置+1。时间 O(n+q log n)，数组空间 O(n)。',
  },
  {
    id: 'balanced-brackets',
    title: '括号检查器',
    difficulty: 'easy',
    tags: ['栈', '字符串'],
    description: '给定仅包含 ()[]{} 的非空字符串，判断括号是否正确配对。不同类型的括号必须按嵌套顺序闭合。',
    inputFormat: '一行括号字符串。',
    outputFormat: '合法输出 YES，否则输出 NO。',
    constraints: '1 ≤ 字符串长度 ≤ 100000。',
    examples: [
      { input: '{[()]}()\n', output: 'YES\n', explanation: '所有括号均按正确顺序闭合。' },
      { input: '([)]\n', output: 'NO\n', explanation: '右括号 ) 与当前最内层的 [ 不匹配。' },
    ],
    hiddenCases: [
      ['(\n', 'NO\n'],
      [')\n', 'NO\n'],
      ['()[]{}\n', 'YES\n'],
      ['((()))\n', 'YES\n'],
      ['(()\n', 'NO\n'],
      ['{[]}\n', 'YES\n'],
    ],
    hints: ['用栈保存尚未匹配的左括号。', '右括号必须匹配栈顶，最后栈还必须为空。'],
    solution:
      '左括号入栈；右括号遇空栈或类型不匹配立即判错，否则出栈。扫描结束栈为空才合法。时间 O(n)，空间 O(n)。',
  },
  {
    id: 'maximum-subarray',
    title: '最佳连续区间',
    difficulty: 'medium',
    tags: ['动态规划', '数组'],
    description: '给定一个整数数组，选择一个非空连续区间，使其中元素的和最大，输出这个最大和。',
    inputFormat: '第一行 n。第二行 n 个整数。',
    outputFormat: '输出最大连续区间和。',
    constraints:
      '1 ≤ n ≤ 100000；每个数的绝对值 ≤ 10⁹。答案可能超出 32 位整数范围，C++/Java 请使用 64 位整数。',
    examples: [
      { input: '8\n-2 3 -1 4 -5 2 2 -1\n', output: '6\n', explanation: '选择连续区间 [3, −1, 4]，和为 6。' },
    ],
    hiddenCases: [
      ['4\n-8 -2 -5 -9\n', '-2\n'],
      ['1\n7\n', '7\n'],
      ['3\n1000000000 1000000000 1000000000\n', '3000000000\n'],
      ['5\n1 -1 1 -1 1\n', '1\n'],
      ['5\n0 0 0 0 0\n', '0\n'],
    ],
    hints: ['考虑以当前位置结尾的最佳区间。', '要么从当前元素重新开始，要么接在前一个最佳区间后面。'],
    solution:
      '令 current=max(a[i],current+a[i])，best=max(best,current)，两者从首元素初始化以处理全负数。时间 O(n)，额外空间 O(1)。',
  },
  {
    id: 'longest-unique-window',
    title: '最长无重复片段',
    difficulty: 'medium',
    tags: ['滑动窗口', '哈希表', '字符串'],
    description: '给定一个小写英文字符串，求不包含重复字符的最长连续子串长度。子串必须连续。',
    inputFormat: '一行非空小写英文字符串。',
    outputFormat: '输出一个整数，表示最长长度。',
    constraints: '1 ≤ 字符串长度 ≤ 100000。',
    examples: [
      { input: 'abcabcbb\n', output: '3\n', explanation: 'abc 的长度为 3，且三个字符互不相同。' },
      { input: 'abba\n', output: '2\n', explanation: 'ab 或 ba 都符合要求，整个字符串不符合。' },
    ],
    hiddenCases: [
      ['aaaaa\n', '1\n'],
      ['a\n', '1\n'],
      ['dvdf\n', '3\n'],
      ['abcdefghijklmnopqrstuvwxyz\n', '26\n'],
      ['tmmzuxt\n', '5\n'],
    ],
    hints: ['维护一个没有重复字符的窗口。', '记录字符最后出现位置，左边界只向右移动，不能回退。'],
    solution:
      '记录每个字符最近下标 last。遍历右端点 r，令 left=max(left,last[c]+1)，更新 last[c]=r 和答案 r-left+1。时间 O(n)，小写字母表额外空间 O(26)。',
  },
  {
    id: 'grid-paths',
    title: '穿越方格',
    difficulty: 'medium',
    tags: ['动态规划', '矩阵'],
    description:
      '从 n 行 m 列网格左上角走到右下角，每步只能向右或向下。字符 . 表示可通行，# 表示障碍。求不同路径数量，对 1000000007 取模。如果起点或终点被阻挡，答案为 0。',
    inputFormat: '第一行 n 和 m，随后 n 行，每行 m 个字符 . 或 #。',
    outputFormat: '输出路径数量对 1000000007 取模后的结果。',
    constraints: '1 ≤ n, m ≤ 500。',
    examples: [
      {
        input: '3 3\n...\n.#.\n...\n',
        output: '2\n',
        explanation: '只能沿上边和右边，或左边和下边绕过中间障碍。',
      },
    ],
    hiddenCases: [
      ['1 1\n.\n', '1\n'],
      ['1 1\n#\n', '0\n'],
      ['2 3\n...\n...\n', '3\n'],
      ['3 3\n...\n###\n...\n', '0\n'],
      ['1 4\n..#.\n', '0\n'],
      ['2 2\n..\n.#\n', '0\n'],
    ],
    hints: ['到达某个格子的最后一步只可能来自其上方或左方。', '障碍处路径数为 0，可以用一维数组保存当前行。'],
    solution:
      'dp[i][j] 为到达该格的路径数，障碍为0，其他格为上方+左方并取模；起点可通行时为1。用滚动数组实现 O(nm) 时间、O(m) 空间。',
  },
  {
    id: 'minimum-coins',
    title: '最少兑换次数',
    difficulty: 'medium',
    tags: ['动态规划', '完全背包'],
    description:
      '有 n 种面额的硬币，每种数量无限。求凑出总额 amount 至少需要多少枚硬币，无法恰好凑出则输出 −1。总额为 0 时无需硬币。',
    inputFormat: '第一行 n 和 amount。第二行 n 个互不相同的正整数面额。',
    outputFormat: '输出最少硬币数量，或 −1。',
    constraints: '1 ≤ n ≤ 30；0 ≤ amount ≤ 10000；1 ≤ 面额 ≤ 10000。',
    examples: [
      { input: '3 11\n1 3 5\n', output: '3\n', explanation: '5 + 5 + 1，需要 3 枚硬币。' },
      { input: '1 7\n2\n', output: '-1\n', explanation: '偶数面额无法凑出 7。' },
    ],
    hiddenCases: [
      ['2 0\n2 5\n', '0\n'],
      ['3 6\n1 3 4\n', '2\n'],
      ['2 3\n4 5\n', '-1\n'],
      ['1 12\n3\n', '4\n'],
      ['2 10\n7 5\n', '2\n'],
    ],
    hints: [
      '优先选最大面额的贪心策略不一定正确，例如面额 1、3、4 凑 6。',
      '设 dp[x] 为凑出 x 的最小数量，从 dp[0]=0 开始枚举最后一枚硬币。',
    ],
    solution:
      '初始化 dp[0]=0，其余为不可达。对 x=1..amount 枚举 c≤x，更新 dp[x]=min(dp[x],dp[x-c]+1)。不可达输出 -1。时间 O(n·amount)，空间 O(amount)。',
  },
  {
    id: 'course-order',
    title: '学习任务排期',
    difficulty: 'medium',
    tags: ['图', '拓扑排序', '队列'],
    description:
      '有编号 1 到 n 的学习任务，m 条依赖 a b 表示必须完成 a 才能开始 b。判断能否完成所有任务，不需要输出具体顺序。允许重复依赖和自依赖。',
    inputFormat: '第一行 n 和 m，随后 m 行每行 a 和 b。',
    outputFormat: '能完成全部任务输出 YES，依赖中存在环则输出 NO。',
    constraints: '1 ≤ n ≤ 100000；0 ≤ m ≤ 200000；1 ≤ a, b ≤ n。',
    examples: [
      { input: '4 4\n1 2\n1 3\n2 4\n3 4\n', output: 'YES\n', explanation: '一种顺序为 1、2、3、4。' },
      { input: '3 3\n1 2\n2 3\n3 1\n', output: 'NO\n', explanation: '三个任务形成循环依赖。' },
    ],
    hiddenCases: [
      ['3 0\n', 'YES\n'],
      ['1 1\n1 1\n', 'NO\n'],
      ['4 2\n1 2\n3 4\n', 'YES\n'],
      ['2 2\n1 2\n1 2\n', 'YES\n'],
      ['5 3\n1 2\n4 5\n5 4\n', 'NO\n'],
    ],
    hints: ['没有任何前置任务的任务可以先完成。', '不断移除入度为 0 的任务，最终看是否移除了全部任务。'],
    solution:
      '建立邻接表与入度，所有入度0节点入队。出队时计数并降低后继入度，降至0的入队。处理数为n则无环。重复边同样计数和消除。时间与空间均 O(n+m)。',
  },
  {
    id: 'inversion-count',
    title: '逆序对计数',
    difficulty: 'hard',
    tags: ['分治', '归并排序', '数组'],
    description:
      '对于整数数组，若 i < j 且 a[i] > a[j]，则 (i,j) 是一个逆序对。求数组中逆序对的总数。相等的元素不构成逆序对。',
    inputFormat: '第一行 n。第二行 n 个整数。',
    outputFormat: '输出逆序对数量。',
    constraints: '1 ≤ n ≤ 100000；每个元素绝对值 ≤ 10⁹。答案可能超过 32 位整数范围。',
    examples: [
      { input: '5\n3 1 2 5 4\n', output: '3\n', explanation: '逆序对对应的值为 (3,1)、(3,2)、(5,4)。' },
    ],
    hiddenCases: [
      ['1\n1\n', '0\n'],
      ['5\n5 4 3 2 1\n', '10\n'],
      ['4\n2 2 1 1\n', '4\n'],
      ['4\n-1 -2 -3 -4\n', '6\n'],
      ['5\n1 2 3 4 5\n', '0\n'],
      ['3\n0 0 0\n', '0\n'],
    ],
    hints: [
      '暴力枚举所有位置对是 O(n²)，考虑分治。',
      '归并时若右半部分当前值更小，它会与左半部分所有剩余值构成逆序对。',
    ],
    solution:
      '归并排序递归统计左右区间内部的逆序对；合并时若右值小于左值，增加左侧剩余元素数。相等时先取左值。时间 O(n log n)，额外空间 O(n)，计数使用64位。',
  },
];

// Deterministic private stress cases cover stated limits without storing megabytes of fixtures in Git.
// Expected answers follow closed forms/constructions and are independently checked in catalog tests.
const limitCases: Record<string, [string, string][]> = (() => {
  const n = 100_000;
  const numbers = (length: number, value: (index: number) => number) =>
    Array.from({ length }, (_, index) => value(index)).join(' ');
  const array = (value: (index: number) => number) => `${n}\n${numbers(n, value)}\n`;
  const graphEdges = [
    ...Array.from({ length: n - 1 }, (_, index) => `${index + 1} ${index + 2}`),
    ...Array.from({ length: n - 2 }, (_, index) => `${index + 1} ${index + 3}`),
    '1 2',
    '1 2',
  ].join('\n');
  return {
    'sum-of-two': [
      ['1000000000 -1000000000\n', '0\n'],
      ['-1000000000 999999999\n', '-1\n'],
    ],
    'array-maximum': [
      [array(() => -1_000_000_000), '-1000000000 1\n'],
      [array((i) => (i >= n - 2 ? 1_000_000_000 : -1_000_000_000)), '1000000000 99999\n'],
    ],
    'palindrome-word': [
      [`${'a'.repeat(49_999)}bb${'a'.repeat(49_999)}\n`, 'YES\n'],
      [`${'a'.repeat(49_999)}bc${'a'.repeat(49_999)}\n`, 'NO\n'],
    ],
    'two-sum-indices': [[`${n} 1\n${numbers(n - 2, () => 2)} 1000000000 -999999999\n`, '99999 100000\n']],
    'first-position': [
      [
        `${n} ${n}\n${numbers(n, (i) => Math.floor(i / 2) - 25_000)}\n${numbers(n, (i) => (i % 2 ? 25_000 : 24_999))}\n`,
        '99999\n-1\n'.repeat(n / 2),
      ],
    ],
    'balanced-brackets': [
      [`${'('.repeat(n / 2)}${')'.repeat(n / 2)}\n`, 'YES\n'],
      [`${'('.repeat(n / 2)}${')'.repeat(n / 2 - 1)}]\n`, 'NO\n'],
    ],
    'maximum-subarray': [
      [array(() => 1_000_000_000), '100000000000000\n'],
      [array(() => -1_000_000_000), '-1000000000\n'],
    ],
    'longest-unique-window': [
      [`${'abcdefghijklmnopqrstuvwxyz'.repeat(Math.ceil(n / 26)).slice(0, n)}\n`, '26\n'],
      [`${'a'.repeat(n - 26)}abcdefghijklmnopqrstuvwxyz\n`, '26\n'],
    ],
    'grid-paths': [
      // C(998, 499) mod 1_000_000_007, checked independently using grid DP in tests.
      [`500 500\n${('.'.repeat(500) + '\n').repeat(500)}`, '264223182\n'],
    ],
    'minimum-coins': [
      [`30 10000\n${numbers(30, (i) => i + 1)}\n`, '334\n'],
      [`30 9999\n${numbers(30, (i) => 2 * (i + 1))}\n`, '-1\n'],
    ],
    'course-order': [
      [`${n} 200000\n${graphEdges}\n1 2\n`, 'YES\n'],
      [`${n} 200000\n${graphEdges}\n100000 1\n`, 'NO\n'],
    ],
    'inversion-count': [
      [array((i) => n - i), '4999950000\n'],
      [array((i) => (i < n / 2 ? 1 : 0)), '2500000000\n'],
    ],
  };
})();

export const algorithmProblems: AlgorithmProblem[] = [
  ...contents,
  ...extraAlgorithmContents,
  ...graphAlgorithmContents,
].map(({ hiddenCases, ...problem }, index) => ({
  ...problem,
  number: index + 1,
  timeLimitMs: 2000,
  memoryLimitMb: 256,
  starterCode: { ...starterCode },
  testCases: [
    ...problem.examples.map(({ input, output }) => ({ input, output, hidden: false })),
    ...hiddenCases.map(([input, output]) => ({ input, output, hidden: true })),
    ...(limitCases[problem.id] ?? []).map(([input, output]) => ({ input, output, hidden: true })),
  ],
}));

export function getAlgorithmProblem(id: string): AlgorithmProblem | undefined {
  return algorithmProblems.find((problem) => problem.id === id);
}
