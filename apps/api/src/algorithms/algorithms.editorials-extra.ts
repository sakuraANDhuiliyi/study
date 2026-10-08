import type { AlgorithmEditorial } from './algorithms.editorials.types';
import { extraReferenceCode } from './algorithms.editorials-extra-references';

/** Original teaching material. Reference programs operate on the stated standard-input format. */
export const extraAlgorithmEditorials: AlgorithmEditorial[] = [
  {
    problemId: 'range-sum',
    introduction:
      '本题的关键信息是“数组不再修改”和“多次查询”。一次区间求和很容易，但每次重新相加会做大量重复工作。前缀和用一次预处理，把任意区间表示成两个前缀的差。',
    prerequisites: ['数组下标与闭区间', '累加器', '64位整数与数值范围'],
    readingGuide: [
      '把 [l,r] 画成含两端的区间：元素个数为 r−l+1。',
      'n 最大10万，q 最大5万，最坏逐次扫描需要约50亿次加法。',
      '元素允许为负，但加法的可逆性依然成立；不需要数组有序。',
      '最大绝对区间和为10¹⁴，C++使用long long、Java使用long；JavaScript Number在此范围仍精确。',
    ],
    hints: [
      '两次查询若都从第1个元素开始，能否共享计算结果？',
      '保存 P[i]=a₁+…+aᵢ。P[r] 比目标区间多算了哪些元素？',
      '多算的是前 l−1 个元素，所以相减即可；补上 P[0]=0，让 l=1 不需要特殊分支。',
    ],
    approaches: [
      {
        name: '逐次扫描区间',
        intuition: '直接按定义相加，是检查小样例最容易写对的方法。',
        steps: ['读取并保存数组。', '每次查询令 sum=0，从 l 到 r 累加并输出。'],
        correctness: '循环恰好访问区间内每一个元素一次，没有加入区间外元素，因此累加值等于定义的区间和。',
        timeComplexity: 'O(n+q·n)，最坏不可通过最大数据。',
        spaceComplexity: 'O(n) 保存数组，单次查询额外 O(1)。',
        tradeoff: '适合手算和小数据对拍；查询很多或区间很长时重复工作过多。',
      },
      {
        name: '一维前缀和（推荐）',
        intuition: '用空间保存公共前缀，把区间相加转换成常数次运算。',
        steps: [
          '创建长度 n+1 的 prefix，prefix[0]=0。',
          '依次读入 a[i]，令 prefix[i]=prefix[i−1]+a[i]。',
          '每次查询输出 prefix[r]−prefix[l−1]。',
          '批量构造输出，避免频繁刷新输出流。',
        ],
        correctness:
          '由归纳法，prefix[i] 等于前 i 项之和。prefix[r] 与 prefix[l−1] 中前 l−1 项逐项抵消，剩下的正好是 a[l] 到 a[r]，所以答案正确。',
        timeComplexity: 'O(n+q)：预处理 n 次，每次查询 O(1)。',
        spaceComplexity: '算法辅助空间 O(n)；若批量保存输出还需 O(q)。',
        tradeoff:
          '非常适合静态数组。若数组会频繁修改，更新一次可能要修改后面所有前缀，应考虑树状数组或线段树。',
      },
    ],
    walkthrough: {
      input: '5 3\n2 -1 4 3 -2\n1 3\n2 5\n4 4',
      steps: [
        {
          step: 1,
          state: 'prefix = [0, 2, 1, 5, 8, 6]',
          explanation: '从0开始逐个累加；加入负数时前缀和可以下降。',
        },
        {
          step: 2,
          state: '[1,3] → prefix[3]−prefix[0] = 5−0',
          explanation: '查询从第一个元素开始，所以减去空前缀。',
        },
        {
          step: 3,
          state: '[2,5] → prefix[5]−prefix[1] = 6−2',
          explanation: '总和中去掉第一个元素2，得到4。',
        },
        { step: 4, state: '[4,4] → prefix[4]−prefix[3] = 8−5', explanation: '单点查询也直接使用同一公式。' },
      ],
      result: '5\n4\n3',
    },
    edgeCases: [
      { case: 'l=1 或 l=r', why: '验证空前缀和闭区间边界是否正确。' },
      { case: '全负数与正负抵消', why: '前缀和不一定单调，不能套用滑动窗口的正数假设。' },
      { case: '10万个10⁹相加', why: '结果10¹⁴检验是否发生32位溢出。' },
    ],
    mistakes: [
      { mistake: '使用 prefix[r]−prefix[l]', fix: '会漏掉 a[l]，闭区间应减 prefix[l−1]。' },
      { mistake: '将每次查询的 sum 沿用到下一次', fix: '查询相互独立；使用前缀公式不依赖上一次答案。' },
      { mistake: '先用 int 累加再赋给 long', fix: '从 prefix 数组和加法运算开始就使用64位类型。' },
    ],
    followUp: [
      '如果要统计二维子矩阵和，如何用四个二维前缀表示？',
      '如果支持单点更新，应怎样用树状数组把更新和查询都降到 O(log n)？',
      '如何使用前缀和与哈希表统计和为 k 的连续子数组？',
    ],
    relatedProblemIds: ['array-maximum', 'maximum-subarray', 'two-sum-indices'],
    referenceCode: extraReferenceCode['range-sum'],
  },
  {
    problemId: 'merge-intervals',
    introduction:
      '区间题首先要明确端点语义。本题是闭区间，端点相同需要合并，但两个不相交的相邻整数区间不合并。排序之后，维护一个“还可能继续延伸”的当前区间即可完成扫描。',
    prerequisites: ['排序与比较器', '闭区间交集', '扫描过程的不变量'],
    readingGuide: [
      '输入顺序没有任何保证，不能直接按读入顺序贪心。',
      '区间可能包含别的区间，更新右端点必须取最大值。',
      '输出不仅要有区间，还必须先输出数量并按左端点排序。',
      '[1,2] 与 [2,3] 合并；[1,2] 与 [3,4] 不合并。',
    ],
    hints: [
      '先按左端点排序，较晚的区间有没有机会与更早已经结束的区间重叠？',
      '维护当前合并区间 [L,R]；只比较下一个区间的左端点与 R。',
      'l≤R 时扩大 R=max(R,r)，l>R 时才把旧区间输出。',
    ],
    approaches: [
      {
        name: '反复寻找重叠对',
        intuition: '按定义找到任意重叠区间，合并后重新检查，直到没有重叠。',
        steps: [
          '枚举一对区间，用 max(l₁,l₂)≤min(r₁,r₂) 判断是否相交。',
          '找到后替换成 [min(l₁,l₂),max(r₁,r₂)] 并删除另一项。',
          '重新扫描所有区间对，最终排序输出。',
        ],
        correctness:
          '每次把两个有交集的闭区间替换成其并集，不改变覆盖范围；每次有效合并减少一个区间，因此终止。终止时任意两个区间都不重叠，得到所需并集。',
        timeComplexity: '朴素反复全扫描最坏 O(n³)。',
        spaceComplexity: 'O(n) 保存可变区间集合。',
        tradeoff: '适合理解定义或给小数据提供暴力基准；在5万个区间下无法满足时间要求。',
      },
      {
        name: '排序后线性合并（推荐）',
        intuition: '排序使后续左端点只会变大，已经与当前区间分离的后续区间，不可能回头连接更早的区间。',
        steps: [
          '按左端点升序排序，右端点相同或不同都可正常处理。',
          '答案为空，或新区间 l 大于答案最后区间的右端点时，追加新区间。',
          '否则仅把最后区间的右端点改为两者最大值。',
          '扫描结束后输出答案数量和区间列表。',
        ],
        correctness:
          '维护不变量：已处理前缀的并集由答案中的有序且不相交区间表示。若 l≤最后右端点，两者相交，取右端点最大值维持并集；若 l>最后右端点，由有序性它也不会与更早区间相交，可独立追加。归纳得到整个输入的正确并集。',
        timeComplexity: 'O(n log n) 排序 + O(n) 扫描。',
        spaceComplexity: 'O(n) 存储输入和输出；排序辅助空间依语言实现而异。',
        tradeoff: '无需根据坐标范围开数组，支持负数和跨度极大的端点；参考实现采用此方案。',
      },
    ],
    walkthrough: {
      input: '5\n8 10\n1 3\n2 6\n10 12\n15 15',
      steps: [
        {
          step: 1,
          state: '[1,3], [2,6], [8,10], [10,12], [15,15]',
          explanation: '先排序，忽略原始输入顺序。',
        },
        { step: 2, state: '当前 [1,3] → [1,6]', explanation: '下一个左端点2≤3，两个区间合并。' },
        { step: 3, state: '确定 [1,6]；当前 [8,10]', explanation: '8>6，出现间隔，可以输出前一个区间。' },
        { step: 4, state: '当前 [8,10] → [8,12]', explanation: '10等于当前右端点，共享端点也要合并。' },
        { step: 5, state: '[1,6], [8,12], [15,15]', explanation: '15>12，最后的单点区间独立保留。' },
      ],
      result: '3\n1 6\n8 12\n15 15',
    },
    edgeCases: [
      { case: '所有区间互相包含或完全重复', why: '答案只能保留最外层，不能把右端点缩小。' },
      { case: '所有区间不相交', why: '答案数量等于n，检验输出数量及排序。' },
      { case: '共享端点、负端点与单点区间', why: '验证闭区间判定与比较器。' },
    ],
    mistakes: [
      { mistake: '把 l<R 作为唯一重叠条件', fix: '应使用 l≤R，否则会漏掉共享端点。' },
      { mistake: '重叠时直接令 R=r', fix: '被包含区间的r可能更小，必须取max。' },
      { mistake: '判断 l≤R+1 就合并', fix: '题目按连续闭区间的相交定义，不是按整数点的相邻定义。' },
    ],
    followUp: [
      '如果输入已经按左端点排序，复杂度会变成多少？',
      '如何计算所有区间覆盖的总长度？闭区间在连续长度与整数点数量上有何区别？',
      '在线持续插入新区间时，可以使用什么有序结构？',
    ],
    relatedProblemIds: ['first-position', 'range-sum', 'inversion-count'],
    referenceCode: extraReferenceCode['merge-intervals'],
  },
  {
    problemId: 'binary-tree-depth',
    introduction:
      '深度由树上的父子关系决定，不由结点编号决定。本题输入最多10万个结点，树可能退化成长链，因此推荐显式维护队列或栈，避免递归深度限制。',
    prerequisites: ['树的根、孩子与叶结点', '队列和栈', '数组表示结点关系'],
    readingGuide: [
      '先判断n是否为0；空树没有编号1的结点。',
      '深度按路径上的结点数计算，所以只有根的树深度为1。',
      '孩子编号为0表示不存在，不能把0当成普通结点入队。',
      '输入保证合法树，无需处理环；孩子编号不保证比父结点大。',
    ],
    hints: [
      '按层遍历根、孩子、孙子，遍历了多少层就有多深。',
      '每轮先记住队列长度，这些结点恰好构成当前层。',
      '处理当前层时加入孩子，但不要把新增孩子算进当前层。',
    ],
    approaches: [
      {
        name: '递归深度公式（理解用）',
        intuition: '以某个结点为根的树，其深度比左右子树中更深的一棵多1。',
        steps: [
          '定义 depth(0)=0。',
          '对非空结点u返回1+max(depth(left[u]),depth(right[u]))。',
          '最终求depth(1)，空树直接返回0。',
        ],
        correctness:
          '叶结点两个孩子为空，深度为1；假设左右子树深度正确，任意根到叶路径都经过根并进入一棵子树，最长路径必然选择深度较大的一棵，所以递推成立。',
        timeComplexity: 'O(n)，每个结点求值一次。',
        spaceComplexity: '递归栈 O(h)，h是树高；输入数组 O(n)。',
        tradeoff: '公式简洁，但长链h=n时可能栈溢出。题目最大规模下不要直接依赖语言默认递归栈。',
      },
      {
        name: '队列分层遍历（推荐）',
        intuition: '队列天然按距离根的层数处理结点，用层数作为答案。',
        steps: [
          '读入左右孩子数组；空树直接输出0。',
          '把根1入队，depth初始化为0。',
          '每轮先保存本层大小，再将depth加1。',
          '恰好弹出本层大小个结点，将存在的孩子入队。',
          '队列为空时输出depth。',
        ],
        correctness:
          '初始队列只有第一层根。若一轮开始队列包含且仅包含某一层结点，处理它们后加入的孩子恰好是下一层；合法树保证每个非根结点只由一个父结点加入。因此循环轮数等于非空层数，也等于最大深度。',
        timeComplexity: 'O(n)。',
        spaceComplexity: '孩子数组 O(n)；逻辑活跃队列 O(w)，w为最大层宽。JavaScript参考程序使用队首下标，底层数组保留已处理元素为 O(n)；合计 O(n)。',
        tradeoff: '避免递归溢出；宽树队列较大。JavaScript用队首下标，Python用deque，避免数组头删引发搬移。',
      },
      {
        name: '显式栈深度优先遍历',
        intuition: '栈中保存(结点,深度)，每访问一个结点更新最大深度。',
        steps: [
          '若n=0，直接输出0；否则初始化answer=0，栈放入(1,1)。',
          '弹出(u,d)，更新answer=max(answer,d)。',
          '把非空孩子与d+1一起压栈，直到栈为空。',
        ],
        correctness:
          '每次沿父子边移动时深度恰好加1；合法树保证每个结点都有唯一根路径，因此记录的深度正确。取所有结点深度最大值即可。',
        timeComplexity: 'O(n)。',
        spaceComplexity: '孩子数组 O(n)；显式DFS栈最坏 O(h)。',
        tradeoff: '同样不依赖调用栈，适合扩展成路径相关题目。',
      },
    ],
    walkthrough: {
      input: '5\n2 3\n4 0\n0 5\n0 0\n0 0',
      steps: [
        { step: 1, state: 'queue=[1], depth=0', explanation: '根尚未处理，深度计数为0。' },
        {
          step: 2,
          state: '处理第1层[1] → queue=[2,3], depth=1',
          explanation: '本轮大小为1，只处理根；它的两个孩子进入下一层。',
        },
        {
          step: 3,
          state: '处理第2层[2,3] → queue=[4,5], depth=2',
          explanation: '编号2有孩子4，编号3有孩子5，空孩子0忽略。',
        },
        {
          step: 4,
          state: '处理第3层[4,5] → queue=[], depth=3',
          explanation: '两个叶结点都没有孩子，遍历结束。',
        },
      ],
      result: '3',
    },
    edgeCases: [
      { case: '空树与单结点树', why: '分别应输出0和1，防止把边数当深度。' },
      { case: '10万个结点组成长链', why: '检验是否依赖递归栈，以及层数是否能到达n。' },
      { case: '孩子编号小于父结点', why: '不能按照编号顺序直接计算深度。' },
    ],
    mistakes: [
      {
        mistake: 'while队列非空时始终处理全部新增孩子，最后只加一层',
        fix: '进入本层循环前固定levelSize或levelEnd。',
      },
      { mistake: '用循环i<queue.length当作本层边界', fix: 'queue.length会随入队变化，应保存初始长度。' },
      { mistake: '根深度设为0却直接输出', fix: '题目统计结点数，根深度应为1。' },
    ],
    followUp: [
      '如何同时输出一条最长根到叶路径？',
      '求最小深度时，为什么不能直接把max换成min而不处理空孩子？',
      '如果输入不保证是树，怎样检测环和多父结点？',
    ],
    relatedProblemIds: ['island-count', 'course-order', 'connected-components'],
    referenceCode: extraReferenceCode['binary-tree-depth'],
  },
  {
    problemId: 'island-count',
    introduction:
      '把每块陆地看成一个图结点，相邻陆地之间存在无向边，岛屿就是图的连通分量。无需真的建立每条边，通过四个方向即时生成邻居即可。',
    prerequisites: ['二维数组边界', 'BFS或DFS', '访问标记与连通性'],
    readingGuide: [
      '只有上下左右四个方向相连，不能加入斜对角。',
      '行列最多各500，可能有25万块陆地。',
      '输入每行是一个紧凑字符串，不是空格分隔的整数。',
      '题目只求数量，若不需要保留网格，可把访问过的1直接改为0。',
    ],
    hints: [
      '扫描到未访问的1，就发现了一座还未计数的岛屿。',
      '从这个位置出发搜索，把整座岛的陆地全部标记。',
      '在加入队列时就标记，可保证一个格子最多入队一次。',
    ],
    approaches: [
      {
        name: '递归DFS染色',
        intuition: '从一块陆地出发，递归访问四个方向的所有相邻陆地。',
        steps: [
          '扫描每格，遇到1将岛数加1。',
          '递归函数先判断边界及是否为1；若合法就改成0。',
          '递归访问四个方向，扫描继续寻找下一块未染色陆地。',
        ],
        correctness:
          '搜索只沿陆地邻接边移动，访问的格子一定属于同一座岛；任何同岛陆地均存在一条陆地路径，搜索会沿该路径到达。因此每次搜索恰好消除一座完整岛屿。',
        timeComplexity: 'O(r·c)。',
        spaceComplexity: '递归栈最坏 O(r·c)。',
        tradeoff: '逻辑直观，但大片陆地或蛇形岛屿会使递归非常深；最大数据建议改用显式队列或栈。',
      },
      {
        name: 'BFS整岛标记（推荐）',
        intuition: '用队列保存待探索陆地，逐圈向外扩展，覆盖整个连通块。',
        steps: [
          '按行按列扫描，遇到1时答案加1并将该格改为0后入队。',
          '弹出一格，枚举四个方向。',
          '邻居在网格内且为1时立即改为0并入队。',
          '队列清空后，继续外层扫描。',
        ],
        correctness:
          '每块陆地入队前立即标记，保证只入队一次。一次BFS可达且仅可达起点所属岛屿的所有陆地，扫描不会再次计数这些格子；任意尚未计数的岛最终会被扫描到，因此计数恰好等于岛屿数。',
        timeComplexity: 'O(r·c)，每格最多检查4个邻居。',
        spaceComplexity: '输入网格 O(r·c)，队列最坏 O(r·c)；原地标记无需单独visited。',
        tradeoff: '适合大网格，不依赖递归调用栈；如果题目要求保留原图，则需要额外visited数组。',
      },
    ],
    walkthrough: {
      input: '4 5\n11000\n01001\n00101\n00011',
      steps: [
        {
          step: 1,
          state: '起点(1,1)，访问{(1,1),(1,2),(2,2)}，islands=1',
          explanation: '坐标按1起始书写。左上三块陆地通过四方向相连。',
        },
        {
          step: 2,
          state: '起点(2,5)，访问{(2,5),(3,5),(4,5),(4,4)}，islands=2',
          explanation: '沿右侧向下，再向左到(4,4)，构成第二座岛。',
        },
        {
          step: 3,
          state: '起点(3,3)，只访问自身，islands=3',
          explanation: '它与(2,2)、(4,4)只有对角关系，不能连接。',
        },
        {
          step: 4,
          state: '扫描剩余格子，没有未访问陆地',
          explanation: '所有岛屿都已完整标记，不会重复计数。',
        },
      ],
      result: '3',
    },
    edgeCases: [
      { case: '全水与全陆地', why: '答案分别为0和1；全陆地还检验栈/队列规模。' },
      { case: '棋盘状陆地', why: '每个1单独成岛，检验是否误加了对角方向。' },
      { case: '有水域空洞的环形岛', why: '一圈陆地仍是一座岛，内部水域不增加岛数。' },
    ],
    mistakes: [
      { mistake: '出队时才标记已访问', fix: '同一格可能被多个邻居重复入队，应在入队时标记。' },
      { mistake: '每访问一块陆地就让答案加1', fix: '答案只在启动一次新的搜索时加1。' },
      { mistake: '行和列的边界混用', fix: '行与rows比较，列与cols比较，用非方形样例检查。' },
    ],
    followUp: [
      '如何返回最大岛屿面积以及每座岛的面积列表？',
      '如果改成八方向连接，答案会发生什么变化？',
      '如果陆地逐个加入，如何用并查集维护动态岛屿数？',
    ],
    relatedProblemIds: ['connected-components', 'binary-tree-depth', 'grid-paths'],
    referenceCode: extraReferenceCode['island-count'],
  },
  {
    problemId: 'shortest-path',
    introduction:
      '路径最短不一定意味着边数最少。非负边权允许使用Dijkstra：不断确定暂定距离最小的结点，再尝试通过它改善邻居。用最小堆替代线性找最小值，才能应对10万个结点。',
    prerequisites: ['有向图与邻接表', '最小堆', '路径松弛', '64位整数'],
    readingGuide: [
      '道路有方向，只加入u→v，不要擅自补反向边。',
      '所有边权非负（允许0），这正是Dijkstra正确性的前提。',
      '有重边和自环，不影响算法，但要避免无意义的反复更新。',
      's=t时空路径成本为0；不可达需要输出−1。',
      '最短简单路径最多n−1条边，最大必要距离小于10¹⁴；64位整数足够。',
    ],
    hints: [
      'BFS最先到达终点只保证边数少；如果一条边成本100、两条边各1，会发生什么？',
      '每次选择尚未确定且距离最小的结点，其余路径即使再延伸非负边也不会更短。',
      '将改善后的距离入最小堆；同一个结点可能有多个堆条目，弹出时用dist数组识别旧条目。',
    ],
    approaches: [
      {
        name: '朴素Dijkstra',
        intuition: '用数组存暂定距离，每轮遍历所有未确定结点，找出距离最小的一个。',
        steps: [
          'dist[s]=0，其余为无穷，并维护visited。',
          '每轮扫描n个结点选出未确定的最小距离结点；如果不存在可达结点则结束。',
          '标记该点确定，并尝试松弛它的所有出边。',
        ],
        correctness:
          '设选中u的距离不是最短，则更短路径上第一个未确定结点x的前驱已确定，此前已将到x的最短前缀加入候选。非负边权使这个前缀距离不大于到u的更短距离，与u是当前最小候选矛盾。因此每次确定都正确。',
        timeComplexity: 'O(n²+m)，最大规模过慢。',
        spaceComplexity: '邻接表 O(n+m)，距离和标记 O(n)。',
        tradeoff: '实现较容易，适合较小或稠密图；本题n大且m相对稀疏，应使用堆。',
      },
      {
        name: '最小堆Dijkstra（推荐）',
        intuition: '把待处理距离放入优先队列，每次快速取出最小候选，使用懒删除处理旧状态。',
        steps: [
          '邻接表建有向图，初始化dist和堆(0,s)。',
          '弹出(d,u)。若d与dist[u]不同，说明已有更短路径，跳过。',
          '若此时u=t，可提前结束；不能在第一次把t入堆时结束。',
          '对每条u→v计算candidate=d+w；仅在严格小于dist[v]时更新并入堆。',
          'dist[t]仍为无穷时输出−1，否则输出距离。',
        ],
        correctness:
          '去除旧状态后，堆顶正是所有当前候选中的最小距离，满足朴素Dijkstra的选点条件，因此沿用其贪心正确性证明。严格改善才入堆，0权环也不会无限生成相等状态。',
        timeComplexity: '懒删除堆实现 O((n+m)log(n+m))；堆中最多 O(m) 个候选。',
        spaceComplexity: 'O(n+m)，包含邻接表、距离数组和堆。',
        tradeoff: '适合本题稀疏非负权图；不适用于存在负权边的图。参考代码保留重边，只跳过过期候选。',
      },
    ],
    walkthrough: {
      input: '5 6 1 5\n1 2 4\n1 3 1\n3 2 2\n2 4 1\n3 4 6\n4 5 3',
      steps: [
        {
          step: 1,
          state: 'dist=[0,∞,∞,∞,∞]；heap=[(0,1)]',
          explanation: '这里只展示结点1到5的距离，起点为0。',
        },
        {
          step: 2,
          state: '取出1 → dist=[0,4,1,∞,∞]',
          explanation: '通过1的两条出边，发现到2成本4，到3成本1。',
        },
        {
          step: 3,
          state: '取出3 → dist=[0,3,1,7,∞]',
          explanation: '通过3把到2改善成1+2=3，并发现到4成本7。旧候选(4,2)仍可能留在堆中。',
        },
        {
          step: 4,
          state: '取出2（距离3）→ dist=[0,3,1,4,∞]',
          explanation: '通过2把到4改善成3+1=4。之后弹出的旧(4,2)应跳过。',
        },
        {
          step: 5,
          state: '取出4（距离4）→ dist=[0,3,1,4,7]',
          explanation: '通过4到5成本7。旧候选(7,4)不再需要展开。',
        },
        {
          step: 6,
          state: '取出5（距离7）→ 答案确定',
          explanation: '只有终点以当前最小有效距离出堆时，才能安全提前结束。',
        },
      ],
      result: '7',
    },
    edgeCases: [
      { case: 's=t，且存在0权自环', why: '空路径已是最优，严格改善避免重复状态。' },
      { case: '重边与多次改善同一结点', why: '检验是否正确处理旧堆条目，不能入堆即永久标记。' },
      { case: '反向不可达与孤立终点', why: '检验有向建图和−1输出。' },
      { case: '很长路径与10⁹边权', why: '检验64位距离及足够大的INF。' },
    ],
    mistakes: [
      { mistake: '第一次发现终点就停止', fix: '发现的只是暂定距离，必须等它以当前有效最小距离出堆。' },
      { mistake: '使用普通FIFO队列并把首次访问当作最优', fix: '非等权图应按总距离选择候选，使用最小堆。' },
      { mistake: 'candidate≤dist[v]也重新入堆', fix: '使用严格小于，避免0权环造成无限相等更新。' },
      {
        mistake: '用减法比较两个Java long距离并转int',
        fix: '使用Long.compare或Comparator.comparingLong，防止截断。',
      },
    ],
    followUp: [
      '如何记录predecessor数组还原一条最短路径？',
      '所有权重都是0或1时，如何用双端队列得到 O(n+m)？',
      '若允许负权边，需要换成哪些算法？怎样检测负环？',
    ],
    relatedProblemIds: ['course-order', 'connected-components', 'island-count'],
    referenceCode: extraReferenceCode['shortest-path'],
  },
  {
    problemId: 'connected-components',
    introduction:
      '如果只关心结点是否属于同一个集合，不需要保存全部路径。并查集用一棵父指针森林表示集合，连接两个不同根的集合时，连通分量数量恰好减少1。',
    prerequisites: ['无向图与连通分量', '父指针表示集合', '路径压缩与按大小合并'],
    readingGuide: [
      'n个结点都会出现于图中，即使它们没有任何边。',
      '自环和重复边允许存在，但不会重复减少分量数。',
      '边是无向的；使用遍历解法时需要双向建边。',
      '只输出分量数量，无需输出每个分量的结点。',
    ],
    hints: [
      '最初每个结点独立时，答案是多少？',
      '一条边的两个端点已经连通时，加入这条边是否会改变答案？',
      '查找两个端点的集合根，仅在根不同的情况下合并并减1。',
    ],
    approaches: [
      {
        name: '邻接表BFS/DFS',
        intuition: '从每个尚未访问的结点启动一次遍历，每次会覆盖一个完整分量。',
        steps: [
          '建立双向邻接表，并创建visited数组。',
          '按1到n检查结点，遇到未访问结点就让答案加1。',
          '用队列或显式栈遍历其可达结点，入队时标记。',
        ],
        correctness:
          '一次遍历会访问且仅访问起点所在连通分量。已访问结点不再发起新遍历，每个分量又至少有一个结点会被扫描到，因此启动次数等于分量数。',
        timeComplexity: 'O(n+m)。',
        spaceComplexity: 'O(n+m)，需要保存全部边。',
        tradeoff: '适合需要输出每个分量成员或路径的任务；本题仅求数量时可避免邻接表。',
      },
      {
        name: '并查集（推荐）',
        intuition: '把每个连通分量视作一个集合，以集合根判断是否已经连通。',
        steps: [
          '初始化parent[i]=i、size[i]=1、components=n。',
          '每条边(u,v)先求a=find(u)、b=find(v)。',
          '若a=b，跳过该边；否则把较小集合的根挂到较大集合的根上，更新size，components减1。',
          'find沿父指针向上，同时做路径压缩，让之后查询更快。',
        ],
        correctness:
          '初始集合恰好对应无边图的n个分量。对每条边，若两端已同根，边只在分量内部，不改变连通关系；否则该边恰好连接两个分量，合并它们与图的连通性变化一致。由对处理边数的归纳，最终集合数就是图的连通分量数。',
        timeComplexity: '路径压缩+按大小合并，摊还 O((n+m)α(n))，α是增长极慢的反阿克曼函数。',
        spaceComplexity: '并查集本身 O(n)；参考程序若一次性读入输入，解析缓冲另占 O(m)。',
        tradeoff: '适合持续添加边的连通性维护；普通并查集不直接支持删边，也不能还原路径。',
      },
    ],
    walkthrough: {
      input: '6 4\n1 2\n2 3\n4 5\n1 3',
      steps: [
        {
          step: 1,
          state: '{1},{2},{3},{4},{5},{6} → components=6',
          explanation: '包括孤立结点在内，最初都是独立集合。',
        },
        { step: 2, state: '加入1—2：{1,2},{3},{4},{5},{6} → 5', explanation: '两个不同集合合并，答案减1。' },
        {
          step: 3,
          state: '加入2—3：{1,2,3},{4},{5},{6} → 4',
          explanation: 'find(2)会找到{1,2}的代表根，再与3合并。',
        },
        {
          step: 4,
          state: '加入4—5：{1,2,3},{4,5},{6} → 3',
          explanation: '第二个非平凡分量形成，孤立结点6保留。',
        },
        {
          step: 5,
          state: '加入1—3：find(1)=find(3) → 仍为3',
          explanation: '这条边只是形成环，没有合并两个不同分量。',
        },
      ],
      result: '3',
    },
    edgeCases: [
      { case: 'm=0', why: '答案为n，不能只统计在边中出现的结点。' },
      { case: '大量重边和自环', why: '只有真正连接不同集合时才能减1。' },
      { case: '长链或星形图', why: '检验合并策略是否会退化，以及最终是否连通。' },
    ],
    mistakes: [
      { mistake: '每读取一条边就减1', fix: '有环、重边、自环时都错误，应比较find后的根。' },
      { mistake: '直接令parent[u]=v而不找根', fix: '可能破坏已有集合，合并必须操作两个代表根。' },
      { mistake: '把size更新到已经成为孩子的根', fix: '交换根以后，以新的父根为准累加size。' },
    ],
    followUp: [
      '如何判断新增的一条无向边是否形成环？',
      '怎样回答任意两个结点是否连通，以及所在分量大小？',
      '如果存在删边，为什么简单并查集难以处理？了解离线倒序或可回滚并查集。',
    ],
    relatedProblemIds: ['island-count', 'course-order', 'shortest-path'],
    referenceCode: extraReferenceCode['connected-components'],
  },
];
