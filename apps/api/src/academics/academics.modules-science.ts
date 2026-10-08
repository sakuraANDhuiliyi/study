import { makeModule as m, numberField as n, textField as t, selectField as s } from './academics.types';
import type { StudyModule } from './academics.types';
const science = ['subject-science'];
const open = (path: string, title: string) => ({ title, url: `https://openstax.org/books/${path}` });
export const scienceModules: StudyModule[] = [
  m({
    id: 'matrix-lab',
    title: '矩阵与线性方程实验室',
    kind: 'calculator',
    subjectIds: science,
    tags: ['线性代数', '矩阵'],
    description: '计算矩阵乘法、行列式、秩与线性方程组，展示消元过程及唯一解、无解或多解状态。',
    learningObjectives: [
      '核对矩阵运算的维度条件',
      '用行变换理解秩和方程的可解性',
      '区分近似浮点结果与精确符号推导',
    ],
    concepts: [
      {
        title: '矩阵乘法',
        content: 'A的列数必须等于B的行数。结果C[i,j]是A第i行与B第j列对应元素乘积之和。乘法通常不可交换。',
      },
      {
        title: '高斯消元',
        content:
          '交换行、缩放非零行及一行加另一行的倍数不改变方程解集。主元列数给出秩；零系数行配非零常数说明无解。这里用浮点消元，近奇异矩阵需要留意数值误差。',
      },
    ],
    fields: [
      s('operation', '运算', [
        ['multiply', '矩阵相乘'],
        ['determinant', '行列式'],
        ['solve', '线性方程组 A·x=b'],
        ['rank', '矩阵的秩'],
      ]),
      t('a', '矩阵 A', '二维JSON数组，例如 [[2,1],[1,3]]', 'matrix'),
      t('b', '矩阵 B 或列向量 b', '乘法为二维数组；解方程可用 [5,7]。其余运算忽略此项。', 'matrix'),
    ],
    defaultValues: { operation: 'solve', a: '[[2,1],[1,3]]', b: '[5,7]' },
    examples: [
      {
        title: '两元方程',
        values: { operation: 'solve', a: '[[2,1],[1,3]]', b: '[5,7]' },
        explanation: '2x+y=5，x+3y=7，解为x=1.6、y=1.8。把结果代回原方程检查残差。',
      },
    ],
  }),
  m({
    id: 'calculus-lab',
    title: '多项式微积分与数值积分',
    kind: 'calculator',
    subjectIds: science,
    tags: ['微积分', '数值方法'],
    description: '输入多项式系数，求函数值、导数、定积分和复合Simpson近似，比较数值误差。',
    learningObjectives: ['理解系数从低次到高次的约定', '连接导数、原函数和定积分', '用细分数量观察近似误差'],
    concepts: [
      {
        title: '多项式表示',
        content: '系数数组[c₀,c₁,…]表示c₀+c₁x+c₂x²+…。导数系数为[i·cᵢ]，原函数每项除以新的次数。',
      },
      {
        title: 'Simpson方法',
        content:
          '把区间分成偶数个等长小区间，用端点和中点的加权值近似积分。它对不超过三次的多项式在精确算术中可给出精确值，但浮点仍有舍入误差。',
      },
    ],
    fields: [
      t('coefficients', '系数数组', '低次在前，最多12项', 'json'),
      n('x', '求值位置 x'),
      n('left', '积分下限'),
      n('right', '积分上限'),
      n('intervals', '细分数量（偶数）', 2, 2000),
    ],
    defaultValues: { coefficients: '[0,0,1]', x: 2, left: 0, right: 3, intervals: 20 },
    examples: [
      {
        title: '积分 x²',
        values: { coefficients: '[0,0,1]', x: 2, left: 0, right: 3, intervals: 20 },
        explanation: 'f(2)=4，f′(2)=4；从0到3的积分为9。',
      },
    ],
  }),
  m({
    id: 'statistics-lab',
    title: '统计描述与线性拟合',
    kind: 'calculator',
    subjectIds: science,
    tags: ['统计', '数据分析'],
    description: '计算均值、中位数、分位数、方差和标准差；可附成对y数据计算相关系数与一元线性回归。',
    learningObjectives: [
      '区分总体方差与样本方差',
      '用多项统计量描述同一数据集',
      '检查线性拟合是否由有效的成对样本构成',
    ],
    concepts: [
      {
        title: '位置与离散',
        content:
          '均值容易受极端值影响，中位数更关注排序位置。总体方差除以n，样本方差除以n−1；n=1时样本方差不定义。分位数采用排序位置线性插值，可能与其他软件约定不同。',
      },
      {
        title: '相关与回归',
        content:
          '用平方误差最小化得到y=截距+斜率·x。相关系数衡量线性关系强弱，不能单独证明因果；x全相同时无法识别斜率。',
      },
    ],
    fields: [
      t('x', '数据 x', '逗号、空白或JSON数组，1至500项', 'json'),
      { ...t('y', '成对数据 y', '留空则只做描述统计；填写时与x同样长度', 'json'), required: false },
    ],
    defaultValues: { x: '[1,2,3,4,5]', y: '[2,4,5,4,5]' },
  }),
  m({
    id: 'probability-lab',
    title: '二项分布与概率试验',
    kind: 'calculator',
    subjectIds: science,
    tags: ['概率', '分布'],
    description: '计算n次独立同概率试验中恰好k次、至多k次成功的概率，以及期望、方差和完整分布。',
    learningObjectives: [
      '明确独立、固定成功概率和试验次数三个前提',
      '理解组合数与成功失败概率的乘积',
      '检查概率分布的总和',
    ],
    concepts: [
      {
        title: '二项模型',
        content:
          'P(X=k)=C(n,k)pᵏ(1−p)ⁿ⁻ᵏ。它需要独立且同概率的试验；抽样条件改变或试验相互影响时不能直接套用。',
      },
      {
        title: '期望与方差',
        content:
          '独立伯努利变量的和有期望np与方差np(1−p)。累计概率把0到k的概率加起来；p=0或1时分布退化到单个结果。',
      },
    ],
    fields: [
      n('trials', '试验次数 n', 0, 200),
      n('successes', '成功次数 k', 0, 200),
      n('probability', '单次成功概率 p', 0, 1),
    ],
    defaultValues: { trials: 10, successes: 3, probability: 0.5 },
    examples: [
      {
        title: '十次公平试验',
        values: { trials: 10, successes: 3, probability: 0.5 },
        explanation: '恰好3次概率为120/1024=0.1171875，期望5，方差2.5。',
      },
    ],
  }),
  m({
    id: 'physics-motion',
    title: '运动学与抛体实验',
    kind: 'calculator',
    subjectIds: [...science, 'subject-engineering'],
    tags: ['物理', '运动学'],
    description: '分析匀加速直线运动或同高起落抛体，展示位置采样与单位，观察理想模型的限制。',
    learningObjectives: [
      '区分初速度、加速度与位移',
      '从角度分解速度为水平和竖直分量',
      '将模型假设写进实验记录',
    ],
    concepts: [
      {
        title: '匀加速运动',
        content:
          'v=v₀+at，位移s=v₀t+at²/2，适用于加速度恒定的时间段。负速度或负位移表示相对约定正方向的运动。',
      },
      {
        title: '同高起落抛体',
        content:
          '忽略空气阻力、重力加速度为常数，T=2v₀sinθ/g，水平射程=v₀cosθ·T，最高高度=(v₀sinθ)²/(2g)。输入角度单位是度；该模型不覆盖不同高程落地。',
      },
    ],
    fields: [
      s('mode', '模式', [
        ['linear', '匀加速直线运动'],
        ['projectile', '同高起落抛体'],
      ]),
      n('speed', '初速度（m/s）', 0, 10000),
      n('acceleration', '直线加速度（m/s²）', -10000, 10000),
      n('time', '直线运动时间（s）', 0, 10000),
      n('angle', '抛射角度（°）', 0, 90),
      n('gravity', '重力加速度（m/s²）', 0.01, 100),
    ],
    defaultValues: { mode: 'projectile', speed: 20, acceleration: 2, time: 5, angle: 45, gravity: 9.8 },
  }),
  m({
    id: 'chemistry-balance',
    title: '化学方程式配平',
    kind: 'calculator',
    subjectIds: science,
    tags: ['化学', '守恒', '线性方程'],
    description: '把中性分子反应转换为元素守恒矩阵，用有理数消元求最简正整数系数，展示元素核对表。',
    learningObjectives: [
      '识别化学式中的元素、下标与括号',
      '理解系数不会改变分子内部原子比例',
      '用元素逐项守恒检查配平结果',
    ],
    concepts: [
      {
        title: '元素守恒',
        content:
          '对于每种元素，反应物原子总数等于生成物原子总数。未知量是各分子前的系数；改变分子下标会改变物质本身，不能用来配平。',
      },
      {
        title: '矩阵与整数解',
        content:
          '给反应物正号、生成物负号，构建A·c=0。这里支持唯一比例的一维零空间，取最简正整数解。多条独立反应混在一个式子、离子电荷和电子守恒不在此工具范围。',
      },
    ],
    fields: [t('equation', '未配平反应式', '例如 Fe + O2 -> Fe2O3；可用圆括号，不写状态或离子电荷', 'text')],
    defaultValues: { equation: 'Fe + O2 -> Fe2O3' },
    examples: [
      {
        title: '铁与氧',
        values: { equation: 'Fe + O2 -> Fe2O3' },
        explanation: '结果4 Fe + 3 O2 -> 2 Fe2O3；左右各4个Fe和6个O。',
      },
      {
        title: '含括号反应',
        values: { equation: 'Ca(OH)2 + HCl -> CaCl2 + H2O' },
        explanation: '括号中的OH有两个，配平后系数为1、2、1、2。',
      },
    ],
    resources: [
      open('chemistry-2e/pages/4-1-writing-and-balancing-chemical-equations', 'OpenStax：化学方程式与配平'),
    ],
  }),
  m({
    id: 'chemistry-solution',
    title: '溶液浓度与稀释计算',
    kind: 'calculator',
    subjectIds: science,
    tags: ['化学', '实验单位'],
    description: '从质量、摩尔质量与体积计算物质的量、摩尔浓度，并按溶质守恒求稀释所需原液体积。',
    learningObjectives: ['将mL换成L再计算mol/L', '区分物质的量与物质质量', '识别只加溶剂时的守恒量'],
    concepts: [
      {
        title: '摩尔浓度',
        content:
          'n=m/M，c=n/V。质量用g、摩尔质量用g/mol、溶液体积用L，得到mol/L。体积指最终溶液体积，不是所加溶剂体积。',
      },
      {
        title: '理想稀释',
        content:
          '只加入溶剂而不损失溶质时，c₁V₁=c₂V₂。目标浓度高于原液时，无法通过加水稀释达到。该工具用于课程计算，不给真实实验操作指令。',
      },
    ],
    fields: [
      n('mass', '溶质质量（g）', 0, 1e6),
      n('molarMass', '摩尔质量（g/mol）', 0.001, 1e6),
      n('volumeMl', '最终溶液体积（mL）', 0.001, 1e9),
      n('targetConcentration', '目标浓度（mol/L）', 0, 1e6),
      n('targetVolumeMl', '目标最终体积（mL）', 0.001, 1e9),
    ],
    defaultValues: {
      mass: 5.844,
      molarMass: 58.44,
      volumeMl: 1000,
      targetConcentration: 0.02,
      targetVolumeMl: 250,
    },
  }),
  m({
    id: 'genetics-lab',
    title: '单基因遗传棋盘',
    kind: 'calculator',
    subjectIds: [...science, 'subject-agriculture'],
    tags: ['生物', '遗传'],
    description: '输入一对二倍体单基因型，生成Punnett棋盘、基因型概率与显性表型比例，比较简单模型。',
    learningObjectives: ['把双亲基因型拆成配子', '区分基因型比例与表型比例', '写明完全显性及随机受精假设'],
    concepts: [
      {
        title: '配子组合',
        content: '每个亲本提供一个等位基因。对Aa×Aa，四个等可能组合为AA、Aa、aA和aa，规范化后为1:2:1。',
      },
      {
        title: '表型假设',
        content:
          '这里假定A对a完全显性，所以AA和Aa归为显性表型。共显性、不完全显性、连锁、性染色体和多基因性状需要不同模型；不能用于预测具体人的健康。',
      },
    ],
    fields: [
      s('parentA', '亲本一', [
        ['AA', 'AA'],
        ['Aa', 'Aa'],
        ['aa', 'aa'],
      ]),
      s('parentB', '亲本二', [
        ['AA', 'AA'],
        ['Aa', 'Aa'],
        ['aa', 'aa'],
      ]),
    ],
    defaultValues: { parentA: 'Aa', parentB: 'Aa' },
    resources: [open('biology-2e/pages/12-2-characteristics-and-traits', 'OpenStax：遗传性状')],
  }),
  m({
    id: 'geography-lab',
    title: '经纬度与球面距离',
    kind: 'calculator',
    subjectIds: science,
    tags: ['地理', '空间测量'],
    description: '用两点经纬度计算球面大圆距离和初始方位角，检查经纬度符号与弧度转换。',
    learningObjectives: [
      '区分经度与纬度的有效范围',
      '使用Haversine公式近似球面距离',
      '说明球体假设和实际地表路线的区别',
    ],
    concepts: [
      {
        title: '坐标约定',
        content:
          '纬度在−90°到90°之间，北纬为正；经度在−180°到180°之间，东经为正。三角函数接收弧度，需要先乘π/180。',
      },
      {
        title: '大圆距离',
        content:
          '以平均半径6371 km的球体近似地球，计算球面两点之间最短弧长。结果不包含道路、地形或椭球修正，也不构成实际导航路线。',
      },
    ],
    fields: [
      n('lat1', '第一点纬度（°）', -90, 90),
      n('lon1', '第一点经度（°）', -180, 180),
      n('lat2', '第二点纬度（°）', -90, 90),
      n('lon2', '第二点经度（°）', -180, 180),
    ],
    defaultValues: { lat1: 0, lon1: 0, lat2: 0, lon2: 90 },
    examples: [
      {
        title: '赤道四分之一圆',
        values: { lat1: 0, lon1: 0, lat2: 0, lon2: 90 },
        explanation: '距离约10007.54 km，初始方位角90°。相同点距离为0，方位角不定义。',
      },
    ],
  }),
  m({
    id: 'environment-lab',
    title: '水体混合质量守恒',
    kind: 'calculator',
    subjectIds: ['subject-engineering', 'subject-agriculture'],
    tags: ['环境', '质量平衡'],
    description: '计算两股水流完全混合后的浓度、每日质量负荷和指定去除率下的出口浓度。',
    learningObjectives: [
      '以流量乘浓度表达质量流率',
      '在同一单位体系中完成加权平均',
      '辨别理想完全混合模型的适用条件',
    ],
    concepts: [
      {
        title: '完全混合',
        content: '假设水量和被测物质量无额外损失，混合浓度=(Q₁C₁+Q₂C₂)/(Q₁+Q₂)，不能直接把浓度做算术平均。',
      },
      {
        title: '质量负荷',
        content:
          'Q以m³/day、C以mg/L输入时，Q·C/1000得到kg/day。去除率以小数r表示，出口浓度=C·(1−r)。本工具不评价排放合规，也不替代实测。',
      },
    ],
    fields: [
      n('flow1', '流量一（m³/day）', 0, 1e9),
      n('concentration1', '浓度一（mg/L）', 0, 1e9),
      n('flow2', '流量二（m³/day）', 0, 1e9),
      n('concentration2', '浓度二（mg/L）', 0, 1e9),
      n('removalPercent', '理想去除率（%）', 0, 100),
    ],
    defaultValues: { flow1: 100, concentration1: 20, flow2: 300, concentration2: 4, removalPercent: 50 },
  }),
  m({
    id: 'agriculture-lab',
    title: '农田水量与灌溉模型',
    kind: 'calculator',
    subjectIds: ['subject-agriculture'],
    tags: ['农学', '水量平衡'],
    description: '在给定作物系数、蒸散量与有效降雨的课程条件下，核算净水深、毛水深和田块水量。',
    learningObjectives: [
      '解释ETc=Kc·ET0各项意义',
      '区分净需水与计入效率的毛需水',
      '将毫米水深转换为立方米体积',
    ],
    concepts: [
      {
        title: '水深平衡',
        content:
          '在本练习的简化期间，净需水=max(Kc·ET0−有效降雨,0)。系数和气象数据由题目给定，工具不推荐现实作物的系数或灌溉计划。',
      },
      {
        title: '体积与效率',
        content:
          '1 mm作用于1 m²相当于1 L，即0.001 m³。毛水深=净水深/效率，效率以0到1的小数输入。忽略土壤储水变化和其他通量时，结论仅适用于该课堂模型。',
      },
    ],
    fields: [
      n('area', '田块面积（m²）', 0.01, 1e9),
      n('et0', '期间参考蒸散 ET0（mm）', 0, 10000),
      n('kc', '给定作物系数 Kc', 0, 3),
      n('rain', '有效降雨（mm）', 0, 10000),
      n('efficiency', '给定灌溉效率', 0.01, 1),
    ],
    defaultValues: { area: 10000, et0: 40, kc: 1.1, rain: 10, efficiency: 0.8 },
  }),
  m({
    id: 'food-science',
    title: '食品配料与能量核算',
    kind: 'calculator',
    subjectIds: ['subject-agriculture'],
    tags: ['食品', '比例', '单位'],
    description: '把给定蛋白质、碳水化合物和脂肪组成换算为课程用能量与批次用量，核对比例。',
    learningObjectives: ['区分每100g组成与整份含量', '按比例放大配方', '说明简化能量因子的范围'],
    concepts: [
      {
        title: '比例放大',
        content:
          '若组成以每100g给出，一份质量为m克时，每项乘以m/100。批次再乘份数，注意每100g三项总和不能超过100g。',
      },
      {
        title: '课程能量因子',
        content:
          '本练习采用蛋白质4、可利用碳水4、脂肪9 kcal/g的简化因子，不计其他成分差异、消化率和个体需求；结果是算术练习，不是膳食建议。',
      },
    ],
    fields: [
      n('protein', '每100g蛋白质（g）', 0, 100),
      n('carbs', '每100g碳水化合物（g）', 0, 100),
      n('fat', '每100g脂肪（g）', 0, 100),
      n('portion', '每份质量（g）', 0.01, 1e6),
      n('servings', '份数', 1, 10000),
    ],
    defaultValues: { protein: 10, carbs: 30, fat: 5, portion: 150, servings: 20 },
  }),
];
