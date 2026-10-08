import type { AlgorithmContent } from './algorithms.catalog';

const maximumNodes = 100_000;
// Closed-form answers: each non-loop edge is a necessary bridge in these trees.
// Reverse endpoint order exercises large inputs without relying on random fixtures.
const positiveStar = `${maximumNodes} ${maximumNodes}\n${Array.from(
  { length: maximumNodes - 1 },
  (_, i) => `1 ${maximumNodes - i} 1000000000`,
).join('\n')}\n1 1 -1000000000\n`;
const negativeChain = `${maximumNodes} ${maximumNodes}\n${maximumNodes} ${maximumNodes} -1000000000\n${Array.from(
  { length: maximumNodes - 1 },
  (_, i) => `${maximumNodes - i} ${maximumNodes - i - 1} -1000000000`,
).join('\n')}\n`;

/** Original graph problems; only public statements and examples are exposed to students. */
export const graphAlgorithmContents: AlgorithmContent[] = [
  {
    id: 'minimum-spanning-tree',
    title: '最小生成树总权',
    difficulty: 'medium',
    tags: ['图', '最小生成树', '贪心', '排序', '并查集'],
    description:
      '给定 n 个编号为 1 到 n 的结点以及 m 条带整数权重的无向边。请从这些边中选出恰好 n−1 条，使所有结点连通且不含环，并让所选边的总权重最小，这样的边集称为最小生成树。允许负权、零权、平行边和自环；平行边是相同两个端点之间的不同边，自环的两个端点相同。即使某条边权重为负，也不能额外选入使结果形成环的边。若无法连接全部结点，输出 IMPOSSIBLE。单个结点选择零条边，总权重为0。可能存在多棵最小生成树，本题只要求最小总权重。',
    inputFormat:
      '第一行两个整数 n 和 m。接下来 m 行，每行三个整数 u、v、w，表示一条连接 u 与 v 的无向边，权重为 w。',
    outputFormat:
      '若存在生成树，输出一个整数，表示最小生成树的总权重；否则输出 IMPOSSIBLE。合法答案可以是负数，−1 也是合法的总权重，不表示失败。',
    constraints:
      '1 ≤ n ≤ 100000；0 ≤ m ≤ 100000；1 ≤ u,v ≤ n；−10⁹ ≤ w ≤ 10⁹。输入边没有排序。答案绝对值不超过 (n−1)×10⁹，可能超出32位整数范围；C++/Java 请用64位整数累计，JavaScript Number 可精确表示本题整数答案。',
    examples: [
      {
        input: '4 5\n1 2 2\n1 3 3\n2 3 2\n3 4 4\n2 4 9\n',
        output: '8\n',
        explanation:
          '选择 1—2、2—3 和 3—4，总权为2+2+4=8；边1—3会形成环，应跳过。从结点1出发的最短路径树可选择权重2、3、4的三条边，总权为9，说明最小生成树与最短路径树的目标不同。',
      },
      {
        input: '4 2\n1 2 -2\n3 4 5\n',
        output: 'IMPOSSIBLE\n',
        explanation:
          '两个分量 {1,2} 与 {3,4} 之间没有边，不能生成覆盖全部结点的一棵树。不能把各分量内边权相加后当成答案。',
      },
      {
        input: '3 3\n1 2 -3\n2 3 2\n1 3 7\n',
        output: '-1\n',
        explanation: '选择权重−3和2的两条边，得到合法生成树，总权为−1。它与无法连通时的 IMPOSSIBLE 不同。',
      },
    ],
    hiddenCases: [
      ['1 2\n1 1 -9\n1 1 0\n', '0\n'],
      ['2 0\n', 'IMPOSSIBLE\n'],
      ['4 7\n1 2 5\n1 2 0\n2 1 0\n2 3 0\n3 4 2\n1 4 8\n2 2 -20\n', '2\n'],
      ['4 6\n1 2 7\n1 3 7\n1 4 7\n2 3 7\n2 4 7\n3 4 7\n', '21\n'],
      ['4 4\n1 3 -3\n3 4 20\n1 2 -5\n2 3 -4\n', '11\n'],
      [positiveStar, '99999000000000\n'],
      [negativeChain, '-99999000000000\n'],
    ],
    hints: [
      '仅选择最便宜的 n−1 条边，是否可能在一部分结点中成环，却漏掉其他结点？',
      '将边按权重从小到大排序，用并查集判断当前边是否连接两个不同的分量。',
      '只在两个端点的根不同的时候合并并累加权重。最终成功合并必须达到 n−1 次；单点自然需要0次。',
    ],
    solution:
      'Kruskal：按数值权重非递减排序所有边，使用迭代查根、路径压缩与按大小合并维护分量。只有端点不同根时选边、合并并累加权重；自环和形成环的边跳过。成功合并达到n−1次时输出总权，否则输出IMPOSSIBLE。每次选边都可通过交换论证保持“存在一棵最优生成树包含已选边”；等权时不要求每棵最优树都包含它。时间 O(n+m log(m+1)+m α(n))，空间 O(n+m)。总权使用64位整数或等价的安全整数类型。',
  },
];
