import { makeModule as m, numberField as n, textField as t } from './academics.types';
import type { StudyModule } from './academics.types';
export const businessModules: StudyModule[] = [
  m({
    id: 'accounting-ledger',
    title: '复式记账与试算平衡',
    kind: 'calculator',
    subjectIds: ['subject-management'],
    tags: ['会计', '借贷平衡'],
    description: '核对每笔分录借贷金额，汇总账户借方和贷方余额，并解释试算平衡的局限。',
    learningObjectives: [
      '用分录把业务拆成多个账户变动',
      '核对每一笔而非仅合计平衡',
      '理解金额平衡不等于会计处理正确',
    ],
    concepts: [
      {
        title: '分录结构',
        content:
          '输入[{memo,lines:[{account,debit,credit}]}]。每行只在借方或贷方填正金额，另一方为0；每笔分录的借方合计应等于贷方合计。货币计算换成整数分，避免浮点累加差异。',
      },
      {
        title: '试算平衡',
        content:
          '把各账户全部借、贷发生额汇总，按净额列示借方或贷方余额。漏记整笔、错用账户等错误也可能保持平衡，所以工具只核对数值，不替代会计准则判断。',
      },
    ],
    fields: [t('entries', '分录JSON', '最多50笔、每笔最多10行。金额最多两位小数。', 'json')],
    defaultValues: {
      entries:
        '[{"memo":"投入资本","lines":[{"account":"现金","debit":10000,"credit":0},{"account":"实收资本","debit":0,"credit":10000}]},{"memo":"购入材料","lines":[{"account":"材料","debit":3000,"credit":0},{"account":"现金","debit":0,"credit":3000}]}]',
    },
  }),
  m({
    id: 'finance-lab',
    title: '复利与现金流折现',
    kind: 'calculator',
    subjectIds: ['subject-economics', 'subject-management'],
    tags: ['金融数学', '现金流'],
    description: '核算复利终值、现金流净现值和回收期，逐期展示折现因子，不给投资建议。',
    learningObjectives: ['将百分比利率换成小数', '区分期末现金流与初始投入', '解释折现率选择对净现值的影响'],
    concepts: [
      {
        title: '复利',
        content: '每年复利m次时，FV=本金·(1+r/m)^(m·年数)。利率字段输入百分数，计算时除100。',
      },
      {
        title: '净现值',
        content:
          '输入现金流[c₀,c₁,…]，c₀为现在发生的投入或收入，NPV=Σcₜ/(1+r)ᵗ。这里每个序号代表一年，回收期采用未折现现金流的线性年内插值。结果只说明给定假设下的数学值。',
      },
    ],
    fields: [
      n('principal', '本金', 0, 1e12),
      n('ratePercent', '给定年利率/折现率（%）', -99, 100),
      n('years', '复利年数', 0, 100),
      n('compounds', '每年复利次数', 1, 365),
      t('cashflows', '年度现金流', '含第0期，最多101项', 'json'),
    ],
    defaultValues: {
      principal: 10000,
      ratePercent: 5,
      years: 3,
      compounds: 1,
      cashflows: '[-10000,4000,4000,4000]',
    },
  }),
  m({
    id: 'economics-lab',
    title: '线性供需与弹性模型',
    kind: 'calculator',
    subjectIds: ['subject-economics'],
    tags: ['经济学', '供需'],
    description: '给定Qd=a−bP、Qs=c+dP，求均衡、指定价格的短缺/过剩和需求点弹性。',
    learningObjectives: ['用供需相等求解均衡', '识别经济上不可行的负价格/数量', '区分斜率与无量纲弹性'],
    concepts: [
      {
        title: '线性均衡',
        content:
          '在a−bP=c+dP下，P*=(a−c)/(b+d)，Q*=a−bP*。b与d取正值，本模型只讨论给定区间中的非负价格数量。',
      },
      {
        title: '点弹性',
        content: '线性需求导数为−b，点弹性为−b·P/Qd。数量为0时弹性不定义；曲线斜率固定也不意味着弹性固定。',
      },
    ],
    fields: [
      n('a', '需求截距 a', 0, 1e9),
      n('b', '需求斜率系数 b', 0.000001, 1e9),
      n('c', '供给截距 c', -1e9, 1e9),
      n('d', '供给斜率系数 d', 0.000001, 1e9),
      n('price', '观察价格 P', 0, 1e9),
    ],
    defaultValues: { a: 100, b: 2, c: 10, d: 1, price: 20 },
    resources: [
      {
        title: 'OpenStax：供需与均衡',
        url: 'https://openstax.org/books/principles-economics-3e/pages/3-1-demand-supply-and-equilibrium-in-markets-for-goods-and-services',
      },
    ],
  }),
  m({
    id: 'business-analysis',
    title: '营销漏斗与盈亏平衡',
    kind: 'calculator',
    subjectIds: ['subject-management', 'subject-economics'],
    tags: ['经营分析', '营销'],
    description: '核算从访问到成交的转化、获客成本、收入和贡献毛利，并求固定成本下的盈亏平衡销量。',
    learningObjectives: [
      '核对漏斗计数不能逆增',
      '区分收入、变动成本与固定成本',
      '识别单件贡献为零或负时的限制',
    ],
    concepts: [
      {
        title: '漏斗',
        content: '访问≥线索≥成交，逐级转化率的分母不同。获客成本=营销花费/成交数；零成交时该指标不定义。',
      },
      {
        title: '盈亏平衡',
        content:
          '单件贡献=售价−单件变动成本。贡献为正时，盈亏平衡销量=向上取整(固定成本/单件贡献)。现实约束可能改变售价和成本，工具仅分析输入场景。',
      },
    ],
    fields: [
      n('visits', '访问数', 0, 1e9),
      n('leads', '线索数', 0, 1e9),
      n('sales', '成交件数', 0, 1e9),
      n('marketing', '营销花费', 0, 1e12),
      n('price', '每件售价', 0, 1e9),
      n('variable', '每件变动成本', 0, 1e9),
      n('fixed', '期间固定成本', 0, 1e12),
    ],
    defaultValues: {
      visits: 1000,
      leads: 200,
      sales: 50,
      marketing: 1000,
      price: 100,
      variable: 40,
      fixed: 2000,
    },
  }),
  m({
    id: 'project-planning',
    title: '项目关键路径与进度网络',
    kind: 'calculator',
    subjectIds: ['subject-management', 'subject-engineering'],
    tags: ['项目管理', '拓扑排序'],
    description: '输入任务时长和前置关系，计算最早/最晚时间、总浮时与关键任务，检测循环依赖。',
    learningObjectives: ['把先后关系建成有向无环图', '区分工作量总和与项目工期', '解释零浮时的关键任务'],
    concepts: [
      {
        title: '正向计算',
        content:
          '任务最早开始=所有前置任务最早结束的最大值，最早结束=最早开始+时长。可同时进行的任务不能简单相加。',
      },
      {
        title: '逆向计算',
        content:
          '从项目完工时间逆推最晚结束与最晚开始，总浮时=最晚开始−最早开始。零浮时任务位于某条关键路径；工具假定资源无限，不处理人员资源冲突。',
      },
    ],
    fields: [
      t(
        'tasks',
        '任务网络',
        'JSON数组，每项{id,duration,dependencies:[]}，最多50任务。时长单位由你统一约定。',
        'json',
      ),
    ],
    defaultValues: {
      tasks:
        '[{"id":"A","duration":3,"dependencies":[]},{"id":"B","duration":4,"dependencies":["A"]},{"id":"C","duration":2,"dependencies":["A"]},{"id":"D","duration":2,"dependencies":["B","C"]}]',
    },
    examples: [
      {
        title: '并行两条分支',
        values: {
          tasks:
            '[{"id":"A","duration":3,"dependencies":[]},{"id":"B","duration":4,"dependencies":["A"]},{"id":"C","duration":2,"dependencies":["A"]},{"id":"D","duration":2,"dependencies":["B","C"]}]',
        },
        explanation: '工期9，A/B/D零浮时，C有2个时间单位浮时。',
      },
    ],
  }),
  m({
    id: 'inventory-lab',
    title: '库存EOQ与再订货点',
    kind: 'calculator',
    subjectIds: ['subject-management'],
    tags: ['供应链', '库存'],
    description: '计算基础经济订货量、订货与持有成本、周转周期和给定安全库存下的再订货点。',
    learningObjectives: [
      '核对年需求与年持有成本的时间单位',
      '解释订货量增大时两类成本如何变化',
      '区分再订货点与订货批量',
    ],
    concepts: [
      {
        title: 'EOQ',
        content:
          'Q*=√(2DS/H)，D为年需求，S为每次订货成本，H为每单位每年持有成本。这里假设需求均匀、无缺货、补货即时、没有数量折扣。',
      },
      {
        title: '再订货点',
        content:
          '日需求=D/年营业天数，ROP=日需求·给定交货天数+安全库存。安全库存由题目给定，不从现实需求风险自动推荐。',
      },
    ],
    fields: [
      n('demand', '年需求 D', 0.001, 1e12),
      n('ordering', '每次订货成本 S', 0.001, 1e9),
      n('holding', '单位年持有成本 H', 0.001, 1e9),
      n('days', '每年营业天数', 1, 366),
      n('leadDays', '给定交货天数', 0, 10000),
      n('safety', '给定安全库存', 0, 1e9),
    ],
    defaultValues: { demand: 10000, ordering: 50, holding: 2, days: 250, leadDays: 5, safety: 100 },
  }),
];
