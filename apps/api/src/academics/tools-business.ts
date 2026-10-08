import { z } from 'zod';
import { result, table } from './academics.types';
import type { StudyResult } from './academics.types';
import { ensureJson, fail, list, metric, num, parsed, rounded } from './tool-utils';
import type { Inputs } from './tool-utils';

const r = (value: number) => rounded(value, 10);
const text = (maximum: number) =>
  z
    .string()
    .trim()
    .min(1)
    .max(maximum)
    .refine((value) => !value.includes('\0'), '文本不能包含空字符');
export function moneyCents(value: number, label = '金额', maximum = 1e9) {
  if (
    typeof value !== 'number' ||
    !Number.isFinite(value) ||
    value < 0 ||
    value > maximum ||
    !/^\d+(?:\.\d{1,2})?$/.test(String(value))
  )
    fail(`${label}必须为0至${maximum}的金额，最多两位小数`);
  return Math.round(value * 100);
}
export const moneyText = (cents: number) => (cents / 100).toFixed(2);
const entrySchema = z
  .array(
    z
      .object({
        memo: text(160),
        lines: z
          .array(z.object({ account: text(100), debit: z.number(), credit: z.number() }).strict())
          .min(2)
          .max(10),
      })
      .strict(),
  )
  .min(1)
  .max(50);
function ledger(v: Inputs): StudyResult {
  const entries = entrySchema.parse(parsed(v, 'entries'));
  const accounts = new Map<string, { debit: number; credit: number }>();
  let debitTotal = 0,
    creditTotal = 0,
    balancedCount = 0;
  const rows = entries.map((entry, index) => {
    let debit = 0,
      credit = 0;
    for (const line of entry.lines) {
      const d = moneyCents(line.debit, '借方金额'),
        c = moneyCents(line.credit, '贷方金额');
      if (d > 0 === c > 0) fail('每行必须且只能在借方或贷方填写正金额，另一方为0');
      debit += d;
      credit += c;
      const account = accounts.get(line.account) || { debit: 0, credit: 0 };
      account.debit += d;
      account.credit += c;
      accounts.set(line.account, account);
    }
    debitTotal += debit;
    creditTotal += credit;
    const balanced = debit === credit;
    if (balanced) balancedCount++;
    return {
      index: index + 1,
      memo: entry.memo,
      debit: moneyText(debit),
      credit: moneyText(credit),
      difference: moneyText(debit - credit),
      balanced,
    };
  });
  const allBalanced = balancedCount === entries.length;
  return result(
    allBalanced
      ? '所有分录的借贷金额分别平衡；这只完成金额核对。'
      : '存在借贷不平衡的分录，请逐笔检查；本次仍可作为学习记录保存。',
    [
      metric('分录数', entries.length),
      metric('逐笔平衡数', balancedCount),
      metric('借方合计', moneyText(debitTotal)),
      metric('贷方合计', moneyText(creditTotal)),
    ],
    [
      {
        title: '核对范围',
        content:
          '金额先转换为整数分再累加。即使总额相等，单笔不平衡也不能通过；漏记整笔、账户误用和不恰当的业务解释仍需要人工复核。',
        status: allBalanced ? 'info' : 'warning',
      },
    ],
    [
      table(
        '逐笔分录',
        [
          ['index', '序号'],
          ['memo', '摘要'],
          ['debit', '借方'],
          ['credit', '贷方'],
          ['difference', '借减贷'],
          ['balanced', '逐笔平衡'],
        ],
        rows,
      ),
      table(
        '账户发生额与净余额',
        [
          ['account', '账户'],
          ['debit', '借方发生额'],
          ['credit', '贷方发生额'],
          ['debitBalance', '借方余额'],
          ['creditBalance', '贷方余额'],
        ],
        [...accounts].map(([account, totals]) => ({
          account,
          debit: moneyText(totals.debit),
          credit: moneyText(totals.credit),
          debitBalance: moneyText(Math.max(0, totals.debit - totals.credit)),
          creditBalance: moneyText(Math.max(0, totals.credit - totals.debit)),
        })),
      ),
    ],
  );
}
function finance(v: Inputs): StudyResult {
  const principal = num(v, 'principal', 0, 1e12),
    percent = num(v, 'ratePercent', -100, 100),
    years = num(v, 'years', 0, 100),
    compounds = num(v, 'compounds', 1, 365, true);
  if (percent <= -100) fail('利率必须大于−100%，才能进行年度折现');
  const rate = percent / 100,
    cashflows = list(v, 'cashflows', 101);
  const future = r(principal * (1 + rate / compounds) ** (compounds * years));
  let npv = 0,
    cumulative = 0,
    payback: number | null = cashflows[0] >= 0 ? 0 : null;
  const rows = cashflows.map((cashflow, period) => {
    const before = cumulative;
    const factor = r(1 / (1 + rate) ** period),
      presentValue = r(cashflow / (1 + rate) ** period);
    npv += cashflow / (1 + rate) ** period;
    cumulative += cashflow;
    if (period > 0 && payback === null && before < 0 && cumulative >= 0 && cashflow > 0)
      payback = period - 1 - before / cashflow;
    return { period, cashflow, factor, presentValue, cumulative: r(cumulative) };
  });
  return result(
    '给定现金流的复利、折现与首次回收时间已核算。',
    [
      metric('复利终值', future),
      metric('净现值 NPV', r(npv)),
      metric(
        '未折现回收期',
        payback === null ? '给定期间内未回收' : r(payback),
        payback === null ? undefined : '年',
      ),
    ],
    [
      {
        title: '时间与利率约定',
        content: `复利每年${compounds}次；现金流序号表示年度，0期不折现。FV=P(1+r/m)^(mt)，NPV=Σcₜ/(1+r)ᵗ，r=${percent}/100。`,
      },
      {
        title: '数值显示',
        content: '复利与折现采用浮点数学计算，展示值经过舍入；现金流表的已显示现值相加可能有尾差。',
        status: 'info',
      },
      {
        title: '回收期与解释范围',
        content:
          '回收期使用未折现累计现金流首次从负转为非负的时点，年内按线性流入插值。若0期已非负，记为0年；后续再出现流出可能令累计值再次为负。结果仅是给定课程假设的计算，不是投资判断。',
        status: 'info',
      },
    ],
    [
      table(
        '逐期现金流',
        [
          ['period', '年'],
          ['cashflow', '现金流'],
          ['factor', '折现因子'],
          ['presentValue', '现值'],
          ['cumulative', '未折现累计'],
        ],
        rows,
      ),
    ],
  );
}
function economics(v: Inputs): StudyResult {
  const a = num(v, 'a', 0, 1e9),
    b = num(v, 'b', 1e-6, 1e9),
    c = num(v, 'c', -1e9, 1e9),
    d = num(v, 'd', 1e-6, 1e9),
    price = num(v, 'price', 0, 1e9);
  const equilibriumPrice = (a - c) / (b + d),
    equilibriumQuantity = a - b * equilibriumPrice,
    demand = a - b * price,
    supply = c + d * price,
    gap = demand - supply;
  const feasible = equilibriumPrice >= 0 && equilibriumQuantity >= 0,
    observationFeasible = demand >= 0 && supply >= 0;
  return result(
    feasible
      ? '已求出给定线性模型的非负均衡点。'
      : '已求出代数交点，但该交点不在非负价格和数量的经济可行范围。',
    [
      metric('均衡价格', r(equilibriumPrice)),
      metric('均衡数量', r(equilibriumQuantity)),
      metric('观察价下需求', r(demand)),
      metric('观察价下供给', r(supply)),
      metric('需求点弹性', demand > 0 ? r((-b * price) / demand) : '不定义（需求数量非正）'),
    ],
    [
      {
        title: '代数过程',
        content: `P*=(a−c)/(b+d)=${r(equilibriumPrice)}；Q*=a−bP*=${r(equilibriumQuantity)}。`,
        status: feasible ? 'info' : 'warning',
      },
      {
        title: '观察价格',
        content: observationFeasible
          ? gap > 0
            ? `需求超过供给${r(gap)}，在模型中表现为短缺。`
            : gap < 0
              ? `供给超过需求${r(-gap)}，在模型中表现为过剩。`
              : '给定观察价格下供需相等。'
          : '观察价格使至少一侧数量为负，已超出该线性模型的经济适用区间；不要把形式上的差值解释为真实短缺或过剩。',
        status: observationFeasible ? 'info' : 'warning',
      },
      {
        title: '弹性边界',
        content:
          '弹性=−bP/Qd；Qd=0时分母为0，不定义。这里也不解释负需求量的形式弹性，且未把负数量自动截断为0。',
      },
    ],
    [
      table(
        '均衡复核',
        [
          ['side', '方程'],
          ['quantity', '均衡数量'],
        ],
        [
          { side: '需求 a−bP*', quantity: r(equilibriumQuantity) },
          { side: '供给 c+dP*', quantity: r(c + d * equilibriumPrice) },
        ],
      ),
    ],
  );
}
function funnel(v: Inputs): StudyResult {
  const visits = num(v, 'visits', 0, 1e9, true),
    leads = num(v, 'leads', 0, 1e9, true),
    sales = num(v, 'sales', 0, 1e9, true),
    marketing = num(v, 'marketing', 0, 1e12),
    price = num(v, 'price', 0, 1e9),
    variable = num(v, 'variable', 0, 1e9),
    fixed = num(v, 'fixed', 0, 1e12);
  if (leads > visits || sales > leads) fail('漏斗计数必须满足访问数≥线索数≥成交数');
  const contribution = price - variable,
    revenue = price * sales,
    variableTotal = variable * sales,
    profit = contribution * sales - fixed;
  const ratio = (top: number, bottom: number) => (bottom ? r((top / bottom) * 100) : '不定义（分母为0）');
  return result(
    '完成给定漏斗与成本场景的数值核对。',
    [
      metric('收入', r(revenue)),
      metric('单件贡献', r(contribution)),
      metric('扣固定成本后结余', r(profit)),
      metric('获客成本', sales ? r(marketing / sales) : '不定义（无成交）'),
      metric('盈亏平衡销量', contribution > 0 ? Math.ceil(fixed / contribution) : '不定义（单件贡献非正）'),
    ],
    [
      {
        title: '成本口径',
        content:
          '结余=成交数×(售价−单件变动成本)−期间固定成本。营销花费独立用于获客成本；若其未包含在固定成本中，还应从结余中扣除，不能重复计入。',
      },
      {
        title: '进一步核对',
        content: `总变动成本=${r(variableTotal)}；若营销是未计入固定成本的新增费用，再扣营销后的结余=${r(profit - marketing)}。盈亏平衡按给定固定成本计算，销量向上取整。`,
        status: contribution > 0 ? 'info' : 'warning',
      },
    ],
    [
      table(
        '漏斗转化',
        [
          ['stage', '转化'],
          ['rate', '比例（%）'],
        ],
        [
          { stage: '访问→线索', rate: ratio(leads, visits) },
          { stage: '线索→成交', rate: ratio(sales, leads) },
          { stage: '访问→成交', rate: ratio(sales, visits) },
        ],
      ),
    ],
  );
}
const taskSchema = z
  .array(
    z
      .object({
        id: text(40),
        duration: z.number().finite().min(0).max(1e9),
        dependencies: z.array(text(40)).max(50),
      })
      .strict(),
  )
  .min(1)
  .max(50);
function project(v: Inputs): StudyResult {
  const tasks = taskSchema.parse(parsed(v, 'tasks'));
  const byId = new Map(tasks.map((task) => [task.id, task]));
  if (byId.size !== tasks.length) fail('任务编号必须唯一');
  const successors = new Map(tasks.map((task) => [task.id, [] as string[]]));
  const remaining = new Map<string, number>();
  for (const task of tasks) {
    if (new Set(task.dependencies).size !== task.dependencies.length) fail('同一任务不能重复列出前置依赖');
    for (const dependency of task.dependencies) {
      if (!byId.has(dependency) || dependency === task.id) fail('前置依赖必须是另一个已定义任务');
      successors.get(dependency)!.push(task.id);
    }
    remaining.set(task.id, task.dependencies.length);
  }
  const queue = tasks.filter((task) => !task.dependencies.length).map((task) => task.id),
    order: string[] = [];
  while (queue.length) {
    const id = queue.shift()!;
    order.push(id);
    for (const next of successors.get(id)!) {
      remaining.set(next, remaining.get(next)! - 1);
      if (remaining.get(next) === 0) queue.push(next);
    }
  }
  if (order.length !== tasks.length) fail('任务网络含循环依赖，无法安排关键路径');
  const timing = new Map<string, { es: number; ef: number; ls: number; lf: number }>();
  for (const id of order) {
    const task = byId.get(id)!;
    const es = Math.max(0, ...task.dependencies.map((dependency) => timing.get(dependency)!.ef));
    timing.set(id, { es, ef: es + task.duration, ls: 0, lf: 0 });
  }
  const duration = Math.max(...[...timing.values()].map((time) => time.ef));
  for (const id of [...order].reverse()) {
    const next = successors.get(id)!;
    const time = timing.get(id)!;
    time.lf = next.length ? Math.min(...next.map((task) => timing.get(task)!.ls)) : duration;
    time.ls = time.lf - byId.get(id)!.duration;
  }
  const epsilon = Math.max(1e-9, Number.EPSILON * Math.max(1, duration) * 16);
  const rows = order.map((id) => {
    const task = byId.get(id)!,
      time = timing.get(id)!,
      slack = time.ls - time.es,
      critical = Math.abs(slack) <= epsilon;
    return {
      id,
      dependencies: task.dependencies.join(', ') || '无',
      duration: task.duration,
      earliestStart: r(time.es),
      earliestFinish: r(time.ef),
      latestStart: r(time.ls),
      latestFinish: r(time.lf),
      slack: critical ? 0 : r(slack),
      critical,
    };
  });
  return result(
    '任务网络无环，已完成关键路径法的正向与逆向计算。',
    [
      metric('项目工期', r(duration)),
      metric('任务数', tasks.length),
      metric('关键任务数', rows.filter((row) => row.critical).length),
      metric('工作量时长总和', r(tasks.reduce((total, task) => total + task.duration, 0))),
    ],
    [
      {
        title: '关键任务',
        content:
          rows
            .filter((row) => row.critical)
            .map((row) => row.id)
            .join('、') || '无',
      },
      {
        title: '多终点与约束',
        content:
          '所有终点共用项目完成时间进行逆推，因此较短的独立分支可以有浮时。零浮时任务可能属于多条并行关键路径，不能简单把其列表当作唯一执行顺序。未考虑有限资源与日历约束。',
      },
    ],
    [
      table(
        '进度网络',
        [
          ['id', '任务'],
          ['dependencies', '前置'],
          ['duration', '时长'],
          ['earliestStart', '最早开始'],
          ['earliestFinish', '最早结束'],
          ['latestStart', '最晚开始'],
          ['latestFinish', '最晚结束'],
          ['slack', '总浮时'],
          ['critical', '关键任务'],
        ],
        rows,
      ),
    ],
  );
}
function inventory(v: Inputs): StudyResult {
  const demand = num(v, 'demand', 0.001, 1e12),
    ordering = num(v, 'ordering', 0.001, 1e9),
    holding = num(v, 'holding', 0.001, 1e9),
    days = num(v, 'days', 1, 366, true),
    leadDays = num(v, 'leadDays', 0, 10000),
    safety = num(v, 'safety', 0, 1e9);
  const quantity = Math.sqrt((2 * demand * ordering) / holding),
    orders = demand / quantity,
    orderingCost = orders * ordering,
    holdingCost = (quantity / 2) * holding,
    daily = demand / days;
  return result(
    '给定条件下的基础EOQ与再订货点已计算。',
    [
      metric('经济订货量 EOQ', r(quantity)),
      metric('再订货点 ROP', r(daily * leadDays + safety)),
      metric('年订货次数', r(orders)),
      metric('订货周期', r(days / orders), '营业日'),
      metric('年订货成本', r(orderingCost)),
      metric('年周期库存持有成本', r(holdingCost)),
      metric('年相关成本合计', r(orderingCost + holdingCost)),
    ],
    [
      {
        title: '公式与时间单位',
        content: `Q*=√(2DS/H)；日需求=D/${days}=${r(daily)}；ROP=日需求×${leadDays}+${safety}。EOQ处的订货成本和周期库存持有成本应相等。`,
      },
      {
        title: '模型范围',
        content: `采用均匀需求、即时补货、无缺货和无数量折扣的连续数量模型。以上持有成本仅包含Q/2；给定安全库存的额外年持有成本为${r(safety * holding)}。不可分的订货单位需要另行比较相邻整数方案。`,
      },
    ],
  );
}
const handlers: Record<string, { fields: string[]; run: (values: Inputs) => StudyResult }> = {
  'accounting-ledger': { fields: ['entries'], run: ledger },
  'finance-lab': { fields: ['principal', 'ratePercent', 'years', 'compounds', 'cashflows'], run: finance },
  'economics-lab': { fields: ['a', 'b', 'c', 'd', 'price'], run: economics },
  'business-analysis': {
    fields: ['visits', 'leads', 'sales', 'marketing', 'price', 'variable', 'fixed'],
    run: funnel,
  },
  'project-planning': { fields: ['tasks'], run: project },
  'inventory-lab': {
    fields: ['demand', 'ordering', 'holding', 'days', 'leadDays', 'safety'],
    run: inventory,
  },
};
export function evaluateBusinessModule(id: string, values: Inputs): StudyResult | undefined {
  if (!Object.hasOwn(handlers, id)) return undefined;
  ensureJson(values);
  const handler = handlers[id];
  if (
    !values ||
    typeof values !== 'object' ||
    Array.isArray(values) ||
    Object.keys(values).some((key) => !handler.fields.includes(key))
  )
    fail('此模块包含不支持的输入字段');
  return handler.run(values);
}
