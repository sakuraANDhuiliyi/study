# 算法题库扩展说明

本次保留原有 19 道题的 ID、编号、题解和四语言参考程序，新增 100 道独立的原创中文练习，题库合计 **119 道**。新增题不是替换旧题标题或常数得到的重复副本，覆盖数论、数组统计、数据结构、字符串、贪心、动态规划、图、树与计算几何。页面分页沿用当前分页接口，不需要把所有题一次加载。

## 题目、题解与判题

每道新增题均有题目描述、明确输入输出格式、数值范围、公开样例、至少 5 个隐藏边界用例、三级提示、算法说明和针对公开样例的具体手算推演。当前提供可独立运行的 **JavaScript 完整参考程序**；C++、Python、Java 都提供标准输入输出起始程序，并可正常编辑、运行和提交，但不会将尚未实现的参考程序展示为可用。原有 19 道题四语言参考程序保持完整。

新增题共有 600 个基础判题用例，另有 **68 个构造规模用例**；整个题库合计 821 个判题用例。最大规模覆盖包括 100000 长数组、100000 次操作、深链树、500×500 网格、回文计数、1000 字符区间状态、2000 点低链值、以及超 32 位计数和精确大整数几何。

数值特别要求：最小公倍数、快速幂、大下标斐波那契、取模乘法和精确整数几何的 JavaScript 参考解使用 BigInt。其他语言应相应选用 64 位整数或任意精度类型；不要对大整数几何使用浮点数近似叉积符号。

## 学习计划

原四个学习计划保持不变，新增六个专题：数论与整数计算、数组统计与数据结构、字符串与贪心证明、动态规划系统练习、图论与树形状态进阶、精确整数计算几何。计划进度继续按用户正式提交并判定通过的记录计算。

## 资料来源与原创边界

实际浏览并参考的主要资料：

- [CSES 官方题目主题目录](https://cses.fi/problemset/)：用于检查排序/搜索、动态规划、图与树的主题覆盖。
- [cp-algorithms 官方算法目录](https://cp-algorithms.com/)：用于核对数论、数据结构、字符串、图、几何等算法概念。
- [AtCoder Educational DP 官方主题目录](https://atcoder.jp/contests/dp/tasks)：用于核对动态规划状态和主题覆盖。
- [TheAlgorithms JavaScript 仓库](https://github.com/TheAlgorithms/JavaScript)：用于核对数据结构与基础算法主题。

仅参考算法思想与主题组织。题干、中文讲解、程序和数据均为本项目独立编写；没有直接复制以上平台题干、官方题解或仓库源代码。题目不会被标记成来自对应平台的原题。每道新增题的 sourceReferences 都注明资料链接及对应 concept，可在 API 与页面查看。

## 维护与验证

固定内容位于 algorithms.catalog-bulk-data.ts；构造大输入位于 algorithms.catalog-bulk-limits.ts；完整 JS 标准输入输出程序由 algorithms.catalog-bulk.ts 拼装。中文题解与公开样例推演分别位于 algorithms.editorials-bulk.ts、algorithms.editorials-bulk-walkthrough.ts。

离线测试中的 tests/helpers/algorithm_bulk_oracles.py 是独立 Python 验证器，用标准库的穷举、递归、矩阵、最小割、绕数法等方法重新计算基础用例；它不导入参考 JavaScript，不执行学生或第三方源码。生产 API 不依赖 Python。构造大规模用例采用常数、链、等高网格与闭式公式给出期望值，再实际运行本项目固定 JS 参考程序核对。

题库定向验证为：

```bash
npx tsx --test tests/algorithm-bulk.unit.test.ts tests/algorithm-catalog.unit.test.ts tests/algorithm-editorials.unit.test.ts
npm run test:algorithm-references -- --languages=javascript
```

定向基础测试需要本地 python3；它仅用于维护时独立校验数据，生产部署和学生判题仍沿用原有 Judge0 安全执行边界，不在 API 宿主机执行提交源码。完整 4 语言参考程序离线验证应沿用既有脚本按可用语言报告；没有对应参考程序的语言不得冒充已经验证。

## 新增题目与 concept 对应表

| 编号 | ID                         | 题目               | 算法主题                 | 主题资料                                                                       |
| ---- | -------------------------- | ------------------ | ------------------------ | ------------------------------------------------------------------------------ |
| 20   | euclidean-gcd              | 设备同步周期       | 数学、欧几里得算法       | [cp-algorithms：数学算法主题](https://cp-algorithms.com/)                      |
| 21   | common-period              | 双灯重逢           | 数学、最小公倍数         | [cp-algorithms：数学算法主题](https://cp-algorithms.com/)                      |
| 22   | modular-power              | 模运算充电器       | 数学、快速幂             | [cp-algorithms：数学算法主题](https://cp-algorithms.com/)                      |
| 23   | prime-check                | 质数标签           | 数学、质数               | [cp-algorithms：数学算法主题](https://cp-algorithms.com/)                      |
| 24   | prime-count                | 质数巡检区间       | 数学、筛法               | [cp-algorithms：数学算法主题](https://cp-algorithms.com/)                      |
| 25   | divisor-count              | 整除分组方式       | 数学、因数               | [cp-algorithms：数学算法主题](https://cp-algorithms.com/)                      |
| 26   | factorial-zeros            | 阶乘末尾零         | 数学、质因数             | [cp-algorithms：数学算法主题](https://cp-algorithms.com/)                      |
| 27   | base-conversion            | 进制显示器         | 数学、进制               | [cp-algorithms：数学算法主题](https://cp-algorithms.com/)                      |
| 28   | pascal-choice              | 展品选择计数       | 数学、组合数、动态规划   | [cp-algorithms：数学算法主题](https://cp-algorithms.com/)                      |
| 29   | fibonacci-mod              | 增长序列预测       | 数学、快速倍增           | [cp-algorithms：数学算法主题](https://cp-algorithms.com/)                      |
| 30   | nim-winning                | 石堆博弈裁判       | 数学、位运算、博弈       | [cp-algorithms：数学算法主题](https://cp-algorithms.com/)                      |
| 31   | coprime-count              | 互质刻度           | 数学、欧拉函数           | [cp-algorithms：数学算法主题](https://cp-algorithms.com/)                      |
| 32   | unique-values              | 日志不同编号       | 数组、哈希表             | [CSES：排序与搜索主题目录](https://cses.fi/problemset/)                        |
| 33   | second-distinct            | 第二高不同读数     | 数组、遍历               | [CSES：排序与搜索主题目录](https://cses.fi/problemset/)                        |
| 34   | majority-ballot            | 过半投票           | 数组、摩尔投票           | [CSES：排序与搜索主题目录](https://cses.fi/problemset/)                        |
| 35   | sorted-deduplicate         | 有序档案去重       | 数组、双指针             | [CSES：排序与搜索主题目录](https://cses.fi/problemset/)                        |
| 36   | rotate-array               | 轮转值班表         | 数组、模运算             | [CSES：排序与搜索主题目录](https://cses.fi/problemset/)                        |
| 37   | mex-number                 | 缺失的非负编号     | 数组、哈希表             | [CSES：排序与搜索主题目录](https://cses.fi/problemset/)                        |
| 38   | pair-difference            | 相差指定值的索引对 | 数组、哈希表             | [CSES：排序与搜索主题目录](https://cses.fi/problemset/)                        |
| 39   | odd-subarrays              | 奇数和片段         | 数组、前缀和             | [CSES：排序与搜索主题目录](https://cses.fi/problemset/)                        |
| 40   | zero-sum-subarrays         | 净变化为零         | 数组、前缀和、哈希表     | [CSES：排序与搜索主题目录](https://cses.fi/problemset/)                        |
| 41   | product-except-self        | 屏蔽一个乘数       | 数组、前缀积             | [CSES：排序与搜索主题目录](https://cses.fi/problemset/)                        |
| 42   | minimum-value-gap          | 最近的读数差       | 数组、排序               | [CSES：排序与搜索主题目录](https://cses.fi/problemset/)                        |
| 43   | median-movement            | 仓库搬迁距离       | 数组、排序、中位数       | [CSES：排序与搜索主题目录](https://cses.fi/problemset/)                        |
| 44   | shortest-positive-window   | 达到配额的最短段   | 数组、滑动窗口           | [CSES：排序与搜索主题目录](https://cses.fi/problemset/)                        |
| 45   | fixed-window-total         | 固定时段峰值       | 数组、滑动窗口           | [CSES：排序与搜索主题目录](https://cses.fi/problemset/)                        |
| 46   | range-increments           | 批量区间调增       | 数组、差分               | [CSES：排序与搜索主题目录](https://cses.fi/problemset/)                        |
| 47   | range-xor                  | 区间校验异或       | 数组、前缀异或           | [CSES：排序与搜索主题目录](https://cses.fi/problemset/)                        |
| 48   | stack-journal              | 栈指令记录         | 数据结构、栈             | [TheAlgorithms：数据结构主题目录](https://github.com/TheAlgorithms/JavaScript) |
| 49   | queue-journal              | 排队指令记录       | 数据结构、队列           | [TheAlgorithms：数据结构主题目录](https://github.com/TheAlgorithms/JavaScript) |
| 50   | next-greater-index         | 右侧更高观测点     | 数据结构、单调栈         | [TheAlgorithms：数据结构主题目录](https://github.com/TheAlgorithms/JavaScript) |
| 51   | window-maximum             | 滑窗最高读数       | 数据结构、单调队列       | [TheAlgorithms：数据结构主题目录](https://github.com/TheAlgorithms/JavaScript) |
| 52   | histogram-area             | 柱状轮廓最大矩形   | 数据结构、单调栈         | [TheAlgorithms：数据结构主题目录](https://github.com/TheAlgorithms/JavaScript) |
| 53   | priority-dispatch          | 优先派单           | 数据结构、堆             | [TheAlgorithms：数据结构主题目录](https://github.com/TheAlgorithms/JavaScript) |
| 54   | kth-ranked                 | 第k小的观测值      | 数据结构、排序、选择     | [TheAlgorithms：数据结构主题目录](https://github.com/TheAlgorithms/JavaScript) |
| 55   | dynamic-range-sum          | 动态区间账本       | 数据结构、树状数组       | [TheAlgorithms：数据结构主题目录](https://github.com/TheAlgorithms/JavaScript) |
| 56   | anagram-labels             | 重排标签检查       | 字符串、计数             | [cp-algorithms：字符串算法主题](https://cp-algorithms.com/)                    |
| 57   | run-length-encode          | 连续字符压缩       | 字符串、游程编码         | [cp-algorithms：字符串算法主题](https://cp-algorithms.com/)                    |
| 58   | run-length-decode          | 恢复连续字符       | 字符串、解析             | [cp-algorithms：字符串算法主题](https://cp-algorithms.com/)                    |
| 59   | shortest-string-period     | 周期信号单元       | 字符串、前缀函数         | [cp-algorithms：字符串算法主题](https://cp-algorithms.com/)                    |
| 60   | pattern-occurrences        | 文本匹配计数       | 字符串、KMP              | [cp-algorithms：字符串算法主题](https://cp-algorithms.com/)                    |
| 61   | longest-palindrome-length  | 最长镜像片段       | 字符串、中心扩展         | [cp-algorithms：字符串算法主题](https://cp-algorithms.com/)                    |
| 62   | palindrome-substring-count | 镜像片段计数       | 字符串、中心扩展         | [cp-algorithms：字符串算法主题](https://cp-algorithms.com/)                    |
| 63   | subsequence-check          | 抽取字符序列       | 字符串、双指针           | [cp-algorithms：字符串算法主题](https://cp-algorithms.com/)                    |
| 64   | caesar-shift               | 循环字母偏移       | 字符串、模运算           | [cp-algorithms：字符串算法主题](https://cp-algorithms.com/)                    |
| 65   | minimum-rotation           | 最小循环标签       | 字符串、字典序           | [cp-algorithms：字符串算法主题](https://cp-algorithms.com/)                    |
| 66   | word-frequency             | 词汇频率表         | 字符串、哈希表、排序     | [cp-algorithms：字符串算法主题](https://cp-algorithms.com/)                    |
| 67   | bracket-insertions         | 补齐圆括号         | 字符串、贪心             | [cp-algorithms：字符串算法主题](https://cp-algorithms.com/)                    |
| 68   | nonoverlap-events          | 最多不冲突安排     | 数组、贪心、区间         | [CSES：排序与搜索主题目录](https://cses.fi/problemset/)                        |
| 69   | minimum-rooms              | 最少共享房间       | 数组、扫描线             | [CSES：排序与搜索主题目录](https://cses.fi/problemset/)                        |
| 70   | deadline-reward            | 提交时刻总评分     | 数组、贪心、排序         | [CSES：排序与搜索主题目录](https://cses.fi/problemset/)                        |
| 71   | merge-batch-cost           | 分批合并最小开销   | 数据结构、贪心、堆       | [TheAlgorithms：数据结构主题目录](https://github.com/TheAlgorithms/JavaScript) |
| 72   | two-person-carriers        | 双人载具数量       | 数组、贪心、双指针       | [CSES：排序与搜索主题目录](https://cses.fi/problemset/)                        |
| 73   | tolerance-matching         | 容差设备配对       | 数组、贪心、双指针       | [CSES：排序与搜索主题目录](https://cses.fi/problemset/)                        |
| 74   | factory-target-time        | 多机生产达标时间   | 数组、二分答案           | [CSES：排序与搜索主题目录](https://cses.fi/problemset/)                        |
| 75   | contiguous-capacity        | 连续批次容量       | 数组、二分答案、贪心     | [CSES：排序与搜索主题目录](https://cses.fi/problemset/)                        |
| 76   | minimum-jumps              | 跨格最少跳跃       | 数组、贪心               | [CSES：排序与搜索主题目录](https://cses.fi/problemset/)                        |
| 77   | missing-subset-sum         | 最小不可组合金额   | 数组、贪心               | [CSES：排序与搜索主题目录](https://cses.fi/problemset/)                        |
| 78   | increasing-subsequence     | 严格递增选点       | 动态规划、最长递增子序列 | [AtCoder：Educational DP 主题目录](https://atcoder.jp/contests/dp/tasks)       |
| 79   | common-subsequence         | 共同保留字符       | 动态规划、最长公共子序列 | [AtCoder：Educational DP 主题目录](https://atcoder.jp/contests/dp/tasks)       |
| 80   | edit-distance              | 文本最少编辑       | 动态规划、编辑距离       | [AtCoder：Educational DP 主题目录](https://atcoder.jp/contests/dp/tasks)       |
| 81   | zero-one-knapsack          | 限重工具选择       | 动态规划、0/1背包        | [AtCoder：Educational DP 主题目录](https://atcoder.jp/contests/dp/tasks)       |
| 82   | ordered-coin-ways          | 有序充值组合       | 动态规划、完全背包、计数 | [AtCoder：Educational DP 主题目录](https://atcoder.jp/contests/dp/tasks)       |
| 83   | unordered-coin-ways        | 无序兑换方案       | 动态规划、完全背包、计数 | [AtCoder：Educational DP 主题目录](https://atcoder.jp/contests/dp/tasks)       |
| 84   | subset-target              | 独立票券达标       | 动态规划、子集和         | [AtCoder：Educational DP 主题目录](https://atcoder.jp/contests/dp/tasks)       |
| 85   | integer-partitions         | 整数拆分计数       | 动态规划、完全背包       | [AtCoder：Educational DP 主题目录](https://atcoder.jp/contests/dp/tasks)       |
| 86   | bounded-hop-cost           | 跨台阶最小耗能     | 动态规划、状态转移       | [AtCoder：Educational DP 主题目录](https://atcoder.jp/contests/dp/tasks)       |
| 87   | nonadjacent-value          | 隔位展品收益       | 动态规划、线性DP         | [AtCoder：Educational DP 主题目录](https://atcoder.jp/contests/dp/tasks)       |
| 88   | grid-minimum-cost          | 网格最低通行费     | 动态规划、网格           | [AtCoder：Educational DP 主题目录](https://atcoder.jp/contests/dp/tasks)       |
| 89   | largest-one-square         | 最大可用正方形     | 动态规划、二维DP         | [AtCoder：Educational DP 主题目录](https://atcoder.jp/contests/dp/tasks)       |
| 90   | rod-cut-value              | 材料切段最高售价   | 动态规划、完全背包       | [AtCoder：Educational DP 主题目录](https://atcoder.jp/contests/dp/tasks)       |
| 91   | matrix-chain-cost          | 矩阵连乘开销       | 动态规划、区间DP         | [AtCoder：Educational DP 主题目录](https://atcoder.jp/contests/dp/tasks)       |
| 92   | palindromic-subsequence    | 镜像字符保留       | 动态规划、区间DP         | [AtCoder：Educational DP 主题目录](https://atcoder.jp/contests/dp/tasks)       |
| 93   | end-picking-game           | 两端取数最优差     | 动态规划、博弈           | [AtCoder：Educational DP 主题目录](https://atcoder.jp/contests/dp/tasks)       |
| 94   | unweighted-distance        | 最少转接次数       | 图、广度优先搜索         | [cp-algorithms：图算法主题](https://cp-algorithms.com/)                        |
| 95   | bipartite-check            | 两组合作分配       | 图、二分图、染色         | [cp-algorithms：图算法主题](https://cp-algorithms.com/)                        |
| 96   | directed-reach-count       | 可到达系统数       | 图、深度优先搜索         | [cp-algorithms：图算法主题](https://cp-algorithms.com/)                        |
| 97   | strong-component-count     | 互相可达分组       | 图、强连通分量           | [cp-algorithms：图算法主题](https://cp-algorithms.com/)                        |
| 98   | dag-longest-edges          | 依赖最长链         | 图、拓扑排序、动态规划   | [cp-algorithms：图算法主题](https://cp-algorithms.com/)                        |
| 99   | dag-path-count             | 有向路线计数       | 图、拓扑排序、计数       | [cp-algorithms：图算法主题](https://cp-algorithms.com/)                        |
| 100  | all-pairs-routes           | 多次路径距离查询   | 图、Floyd-Warshall       | [cp-algorithms：图算法主题](https://cp-algorithms.com/)                        |
| 101  | zero-one-distance          | 免费与收费通道     | 图、0-1 BFS              | [cp-algorithms：图算法主题](https://cp-algorithms.com/)                        |
| 102  | negative-cycle-check       | 负费用循环检查     | 图、Bellman-Ford         | [cp-algorithms：图算法主题](https://cp-algorithms.com/)                        |
| 103  | bridge-count               | 关键单条连接数     | 图、桥、DFS              | [cp-algorithms：图算法主题](https://cp-algorithms.com/)                        |
| 104  | articulation-count         | 关键中转点数       | 图、割点、DFS            | [cp-algorithms：图算法主题](https://cp-algorithms.com/)                        |
| 105  | euler-trail-check          | 一次遍历所有连接   | 图、欧拉路径             | [cp-algorithms：图算法主题](https://cp-algorithms.com/)                        |
| 106  | bipartite-matching         | 项目伙伴最大配对   | 图、二分图匹配           | [cp-algorithms：图算法主题](https://cp-algorithms.com/)                        |
| 107  | maximum-network-flow       | 通道最大输送量     | 图、最大流               | [cp-algorithms：图算法主题](https://cp-algorithms.com/)                        |
| 108  | tree-diameter              | 树上最远间隔       | 树、直径、BFS            | [CSES：树算法主题目录](https://cses.fi/problemset/)                            |
| 109  | rooted-subtree-sizes       | 各节点子树规模     | 树、树形DP               | [CSES：树算法主题目录](https://cses.fi/problemset/)                            |
| 110  | lowest-common-ancestor     | 共同上级查询       | 树、最近公共祖先、倍增   | [CSES：树算法主题目录](https://cses.fi/problemset/)                            |
| 111  | tree-independent-count     | 树上非相邻选择计数 | 树、树形DP、计数         | [CSES：树算法主题目录](https://cses.fi/problemset/)                            |
| 112  | tree-distance-sums         | 每个站点总距离     | 树、换根DP               | [CSES：树算法主题目录](https://cses.fi/problemset/)                            |
| 113  | tree-maximum-matching      | 树上不共享端点连接 | 树、树形DP、匹配         | [CSES：树算法主题目录](https://cses.fi/problemset/)                            |
| 114  | point-orientation          | 三点转向判断       | 几何、叉积               | [cp-algorithms：计算几何主题](https://cp-algorithms.com/)                      |
| 115  | segment-intersection       | 两条闭线段相交     | 几何、叉积               | [cp-algorithms：计算几何主题](https://cp-algorithms.com/)                      |
| 116  | polygon-double-area        | 多边形面积校验     | 几何、鞋带公式           | [cp-algorithms：计算几何主题](https://cp-algorithms.com/)                      |
| 117  | point-in-polygon           | 定位多边形内外     | 几何、射线法             | [cp-algorithms：计算几何主题](https://cp-algorithms.com/)                      |
| 118  | maximum-manhattan          | 最远街区距离       | 几何、坐标变换           | [cp-algorithms：计算几何主题](https://cp-algorithms.com/)                      |
| 119  | convex-hull-vertices       | 凸包拐点数量       | 几何、凸包、单调链       | [cp-algorithms：计算几何主题](https://cp-algorithms.com/)                      |
