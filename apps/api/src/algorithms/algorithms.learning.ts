/** Curated original learning paths. Progress is based on accepted formal submissions. */
export const algorithmPlans = [
  {
    id: 'first-steps',
    title: '零基础编程起步',
    description: '从输入输出到数组与字符串，建立读题、实现、验证的完整习惯。',
    level: '入门',
    estimatedDays: 7,
    chapters: [
      {
        title: '熟悉判题流程',
        description: '先跑样例，再补边界，最后正式提交。',
        problemIds: ['sum-of-two', 'array-maximum'],
      },
      {
        title: '掌握数组与字符串',
        description: '练习双指针、计数和基础查询，明确下标与边界。',
        problemIds: ['palindrome-word', 'two-sum-indices', 'range-sum'],
      },
    ],
  },
  {
    id: 'linear-patterns',
    title: '数组与字符串常用技巧',
    description: '用不变量理解二分、栈、滑动窗口和区间扫描。',
    level: '基础',
    estimatedDays: 10,
    chapters: [
      {
        title: '查询与匹配',
        description: '理解有序性和后进先出如何减少重复工作。',
        problemIds: ['first-position', 'balanced-brackets'],
      },
      {
        title: '连续区间',
        description: '区分连续子数组、滑动窗口与区间合并的状态。',
        problemIds: ['maximum-subarray', 'longest-unique-window', 'merge-intervals'],
      },
    ],
  },
  {
    id: 'dp-divide',
    title: '动态规划与分治进阶',
    description: '从状态定义出发，推导转移、初值、遍历顺序与复杂度。',
    level: '进阶',
    estimatedDays: 7,
    chapters: [
      {
        title: '动态规划',
        description: '练习计数型与最优化型状态，解释每一项转移的来源。',
        problemIds: ['grid-paths', 'minimum-coins'],
      },
      {
        title: '分治与合并',
        description: '将跨区间贡献嵌入归并过程，并注意大整数。',
        problemIds: ['inversion-count'],
      },
    ],
  },
  {
    id: 'trees-graphs',
    title: '树与图专题',
    description: '从遍历、连通性和最短路走向最小生成树，区分路径最短与全图连接总权最小。',
    level: '进阶',
    estimatedDays: 16,
    chapters: [
      {
        title: '遍历与连通性',
        description: '学习队列、显式栈与访问标记，避免重复访问。',
        problemIds: ['binary-tree-depth', 'island-count', 'connected-components'],
      },
      {
        title: '依赖与带权路径',
        description: '区分拓扑顺序与最短距离，选择合适的数据结构。',
        problemIds: ['course-order', 'shortest-path'],
      },
      {
        title: '全图连接与贪心',
        description: '组合边排序与并查集，用安全边和交换论证理解最小生成树。',
        problemIds: ['minimum-spanning-tree'],
      },
    ],
  },
];
