import { result, table } from './academics.types';
import type { StudyResult } from './academics.types';
import { choice, fail, list, metric, num, parsed, rounded, str } from './tool-utils';
import type { Inputs } from './tool-utils';

const ipv4 = (address: number) =>
  [24, 16, 8, 0].map((shift) => Math.floor(address / 2 ** shift) % 256).join('.');
function subnet(v: Inputs): StudyResult {
  const address = str(v, 'address', 50),
    parts = address.split('.');
  if (parts.length !== 4 || parts.some((part) => !/^\d{1,3}$/.test(part) || Number(part) > 255))
    fail('请输入四段0至255的IPv4地址');
  const p = num(v, 'prefix', 0, 32, true),
    split = num(v, 'splitPrefix', 0, 32, true);
  if (split < p) fail('划分后的前缀不能短于原前缀');
  const value = parts.reduce((sum, part) => sum * 256 + Number(part), 0),
    size = 2 ** (32 - p),
    network = Math.floor(value / size) * size,
    broadcast = network + size - 1;
  const usable = p >= 31 ? size : size - 2,
    first = p >= 31 ? network : network + 1,
    last = p >= 31 ? broadcast : broadcast - 1;
  const count = 2 ** (split - p),
    childSize = 2 ** (32 - split);
  const rows = Array.from({ length: Math.min(count, 16) }, (_, i) => {
    const start = network + i * childSize;
    return {
      index: i + 1,
      network: `${ipv4(start)}/${split}`,
      last: ipv4(start + childSize - 1),
      addresses: childSize,
    };
  });
  return result(
    '按32位地址块完成CIDR计算。',
    [metric('地址总数', size), metric('可用主机数', usable), metric('划分子网数', count)],
    [
      {
        title: '地址与掩码',
        content: `网络 ${ipv4(network)}/${p}；掩码 ${ipv4(2 ** 32 - size)}；地址块末尾 ${ipv4(broadcast)}；通配掩码 ${ipv4(size - 1)}。`,
      },
      {
        title: '主机范围',
        content: `${ipv4(first)} 至 ${ipv4(last)}。${p === 31 ? '/31按点对点链路两个地址计数。' : p === 32 ? '/32表示单个地址。' : '通常保留网络和广播地址。'}`,
      },
      {
        title: '展示范围',
        content: count > 16 ? '这里只列前16个子网，数量指标包含所有子网。' : '列出全部子网。',
      },
    ],
    [
      table(
        '子网划分',
        [
          ['index', '序号'],
          ['network', '网络'],
          ['last', '地址块末尾'],
          ['addresses', '地址数'],
        ],
        rows,
      ),
    ],
  );
}
function cipher(v: Inputs): StudyResult {
  const algorithm = choice(v, 'cipher', ['caesar', 'vigenere']),
    mode = choice(v, 'mode', ['encrypt', 'decrypt']),
    text = v.text,
    shift = num(v, 'shift', -1000, 1000, true),
    key = str(v, 'key', 64);
  if (typeof text !== 'string' || text.length < 1 || text.length > 4000 || text.includes('\0'))
    fail('文本需要1至4000个字符');
  if (!/^[a-z]+$/i.test(key)) fail('密钥只允许英文A至Z');
  let index = 0;
  const frequencies = new Array(26).fill(0);
  const transformed = [...text]
    .map((char) => {
      if (!/^[a-z]$/i.test(char)) return char;
      const base = char === char.toUpperCase() ? 65 : 97;
      const amount = algorithm === 'caesar' ? shift : key.toUpperCase().charCodeAt(index++ % key.length) - 65;
      const position =
        (((char.charCodeAt(0) - base + (mode === 'encrypt' ? amount : -amount)) % 26) + 26) % 26;
      frequencies[position]++;
      return String.fromCharCode(base + position);
    })
    .join('');
  const letters = frequencies.reduce((a, b) => a + b, 0);
  return result(
    '完成经典字母变换，非英文字母保留。',
    [metric('变换字母数', letters), metric('文本字符数', [...text].length)],
    [
      { title: mode === 'encrypt' ? '密文' : '恢复文本', content: transformed },
      {
        title: '可逆性检查',
        content: '用相同密钥切换方向，应恢复原英文字母；这不表示经典替换能提供现实数据安全。',
      },
    ],
    [
      table(
        '输出字母频率',
        [
          ['letter', '字母'],
          ['count', '次数'],
          ['percent', '占比（%）'],
        ],
        frequencies.map((count, i) => ({
          letter: String.fromCharCode(65 + i),
          count,
          percent: letters ? rounded((count / letters) * 100) : 0,
        })),
      ),
    ],
  );
}
function cluster(v: Inputs): StudyResult {
  const raw = parsed(v, 'points');
  if (
    !Array.isArray(raw) ||
    !raw.length ||
    raw.length > 200 ||
    !raw.every(
      (p) =>
        Array.isArray(p) &&
        p.length === 2 &&
        p.every((x) => typeof x === 'number' && Number.isFinite(x) && Math.abs(x) <= 1e9),
    )
  )
    fail('需要1至200个二维有限数值点');
  const original = raw as number[][],
    k = num(v, 'clusters', 1, 10, true),
    maximum = num(v, 'iterations', 1, 50, true);
  if (typeof v.normalize !== 'boolean') fail('normalize需要布尔值');
  const means = [0, 1].map((d) => original.reduce((s, p) => s + p[d], 0) / original.length),
    sd = [0, 1].map((d) =>
      Math.sqrt(original.reduce((s, p) => s + (p[d] - means[d]) ** 2, 0) / original.length),
    );
  const points = original.map((p) =>
    p.map((x, d) => (v.normalize ? (sd[d] ? (x - means[d]) / sd[d] : 0) : x)),
  );
  const distinct = [...new Map(points.map((p) => [JSON.stringify(p), p])).values()];
  if (k > distinct.length) fail('簇数不能超过不同数据点数量');
  let centers = distinct.slice(0, k).map((p) => [...p]),
    assignments = new Array(points.length).fill(-1),
    iteration = 0,
    empty = false;
  for (; iteration < maximum; iteration++) {
    const next = points.map((p) => {
      let best = 0;
      for (let i = 1; i < k; i++)
        if (
          (p[0] - centers[i][0]) ** 2 + (p[1] - centers[i][1]) ** 2 <
          (p[0] - centers[best][0]) ** 2 + (p[1] - centers[best][1]) ** 2
        )
          best = i;
      return best;
    });
    const unchanged = next.every((x, i) => x === assignments[i]);
    assignments = next;
    centers = centers.map((old, c) => {
      const members = points.filter((_, i) => assignments[i] === c);
      if (!members.length) {
        empty = true;
        return old;
      }
      return [0, 1].map((d) => members.reduce((s, p) => s + p[d], 0) / members.length);
    });
    if (unchanged) {
      iteration++;
      break;
    }
  }
  // Reassign to the returned centers so labels and reported SSE refer to the same state.
  assignments = points.map((p) => {
    let best = 0;
    for (let i = 1; i < k; i++)
      if (
        (p[0] - centers[i][0]) ** 2 + (p[1] - centers[i][1]) ** 2 <
        (p[0] - centers[best][0]) ** 2 + (p[1] - centers[best][1]) ** 2
      )
        best = i;
    return best;
  });
  const sse = points.reduce(
    (sum, p, i) => sum + (p[0] - centers[assignments[i]][0]) ** 2 + (p[1] - centers[assignments[i]][1]) ** 2,
    0,
  );
  const output = result(
    '完成确定性二维K-means练习。',
    [metric('迭代轮数', iteration), metric('点数', points.length), metric('平方误差', sse)],
    [
      {
        title: '初始化与坐标',
        content: `中心来自输入的前${k}个不同点。${v.normalize ? '结果中心在z-score坐标中，原始点仍在记录中。' : '使用原始坐标。'}`,
      },
      {
        title: '结果限制',
        content: empty
          ? '曾出现空簇，保留旧中心；请比较其他初始化。'
          : '标签只是组号，不表示已识别现实类别或达到全局最优。',
        status: empty ? 'warning' : 'info',
      },
    ],
    [
      table(
        '簇中心',
        [
          ['cluster', '簇'],
          ['x', 'x'],
          ['y', 'y'],
          ['count', '成员数'],
        ],
        centers.map((p, i) => ({
          cluster: i + 1,
          x: rounded(p[0]),
          y: rounded(p[1]),
          count: assignments.filter((c) => c === i).length,
        })),
      ),
      table(
        '数据点与归属',
        [
          ['index', '序号'],
          ['x', 'x'],
          ['y', 'y'],
          ['cluster', '簇'],
        ],
        original.map((p, i) => ({ index: i + 1, x: p[0], y: p[1], cluster: assignments[i] + 1 })),
      ),
    ],
  );
  output.chart = {
    title: '原始二维数据点',
    points: original.map((p, i) => ({ x: p[0], y: p[1], label: `簇${assignments[i] + 1}` })),
  };
  return output;
}
function circuit(v: Inputs): StudyResult {
  const resistances = list(v, 'resistances', 20);
  if (resistances.some((x) => x <= 0)) fail('电阻必须为正');
  const topology = choice(v, 'topology', ['series', 'parallel']),
    voltage = num(v, 'voltage', -1e6, 1e6),
    cap = num(v, 'capacitanceMicro', 0, 1e9),
    time = num(v, 'time', 0, 1e6);
  const resistance =
      topology === 'series'
        ? resistances.reduce((s, x) => s + x, 0)
        : 1 / resistances.reduce((s, x) => s + 1 / x, 0),
    current = voltage / resistance,
    tau = resistance * cap * 1e-6;
  const rows = resistances.map((r, i) => {
    const iv = topology === 'series' ? current : voltage / r,
      vv = topology === 'series' ? current * r : voltage;
    return {
      index: i + 1,
      resistance: r,
      voltage: rounded(vv),
      current: rounded(iv),
      power: rounded(vv * iv),
    };
  });
  return result(
    '理想电阻网络计算完成。',
    [
      metric('等效电阻', resistance, 'Ω'),
      metric('总电流', current, 'A'),
      metric('总功率', voltage * current, 'W'),
      ...(cap
        ? [
            metric('RC时间常数', tau, 's'),
            metric('给定时刻电容电压', voltage * (1 - Math.exp(-time / tau)), 'V'),
          ]
        : []),
    ],
    [
      {
        title: '复核',
        content:
          topology === 'series'
            ? '各支路电流相同，电压之和等于电源。'
            : '各支路电压相同，电流之和等于总电流。',
      },
      {
        title: 'RC模型',
        content: cap
          ? '将等效电阻接到给定电容，用初始电压0的一阶模型计算；实际器件条件尚未建模。'
          : '电容为0，本次没有计算RC响应。',
      },
    ],
    [
      table(
        '各电阻',
        [
          ['index', '序号'],
          ['resistance', 'Ω'],
          ['voltage', 'V'],
          ['current', 'A'],
          ['power', 'W'],
        ],
        rows,
      ),
    ],
  );
}
function logic(v: Inputs): StudyResult {
  const expression = str(v, 'expression', 200);
  let compareExpression = '';
  if (v.compareExpression !== undefined && v.compareExpression !== null) {
    if (
      typeof v.compareExpression !== 'string' ||
      v.compareExpression.length > 200 ||
      v.compareExpression.includes('\0')
    )
      fail('对照表达式必须是文本，最多200字符');
    compareExpression = v.compareExpression.trim();
  }
  type Node =
    | { type: 'var'; name: string }
    | { type: 'not'; child: Node }
    | { type: 'and' | 'xor' | 'or'; left: Node; right: Node };
  const parse = (source: string, comparison = false) => {
    const invalid = (message: string): never => fail(`${comparison ? '对照表达式：' : ''}${message}`);
    const compact = source.replace(/\s+/g, '');
    const tokens = compact.match(/&&|\|\||[!^()A-D]/g) || [];
    if (tokens.join('') !== compact) invalid('只允许A至D、!、&&、^、||和括号');
    let pos = 0,
      depth = 0;
    const unary = (): Node => {
      if (++depth > 20) invalid('表达式嵌套过深');
      let node: Node;
      const token = tokens[pos++];
      if (token === '!') node = { type: 'not', child: unary() };
      else if (token === '(') {
        node = or();
        if (tokens[pos++] !== ')') invalid('括号不匹配');
      } else if (token && /^[A-D]$/.test(token)) node = { type: 'var', name: token };
      else return invalid('表达式缺少变量或子表达式');
      depth--;
      return node;
    };
    const and = (): Node => {
      let node = unary();
      while (tokens[pos] === '&&') {
        pos++;
        node = { type: 'and', left: node, right: unary() };
      }
      return node;
    };
    const xor = (): Node => {
      let node = and();
      while (tokens[pos] === '^') {
        pos++;
        node = { type: 'xor', left: node, right: and() };
      }
      return node;
    };
    const or = (): Node => {
      let node = xor();
      while (tokens[pos] === '||') {
        pos++;
        node = { type: 'or', left: node, right: xor() };
      }
      return node;
    };
    const tree = or();
    if (pos !== tokens.length) invalid('表达式包含未连接的项');
    return { tree, variables: [...new Set(tokens.filter((x) => /^[A-D]$/.test(x)))].sort() };
  };
  const original = parse(expression),
    comparison = compareExpression ? parse(compareExpression, true) : null,
    variables = [...new Set([...original.variables, ...(comparison?.variables ?? [])])].sort();
  const evaluate = (node: Node, input: Record<string, boolean>): boolean =>
    node.type === 'var'
      ? input[node.name]
      : node.type === 'not'
        ? !evaluate(node.child, input)
        : node.type === 'and'
          ? evaluate(node.left, input) && evaluate(node.right, input)
          : node.type === 'or'
            ? evaluate(node.left, input) || evaluate(node.right, input)
            : evaluate(node.left, input) !== evaluate(node.right, input);
  const rows: StudyResult['tables'][number]['rows'] = Array.from(
    { length: 2 ** variables.length },
    (_, mask) => {
      const input = Object.fromEntries(
        variables.map((name, i) => [name, !!(mask & (1 << (variables.length - i - 1)))]),
      );
      const output = evaluate(original.tree, input) ? 1 : 0;
      const row = {
        ...Object.fromEntries(variables.map((name) => [name, input[name] ? 1 : 0])),
        output,
      };
      if (!comparison) return row;
      const comparisonOutput = evaluate(comparison.tree, input) ? 1 : 0;
      return { ...row, comparisonOutput, matches: output === comparisonOutput ? '一致' : '不同' };
    },
  );
  if (comparison) {
    const counterexamples = rows.filter((row) => row.matches === '不同');
    const equivalent = counterexamples.length === 0;
    const summary = equivalent
      ? `逻辑等价：已检查全部${rows.length}组输入组合，差异组合数为0。`
      : `逻辑不等价：已检查全部${rows.length}组输入组合，发现${counterexamples.length}组差异。`;
    const columns: [string, string][] = [
      ...variables.map((name) => [name, name] as [string, string]),
      ['output', '原表达式输出'],
      ['comparisonOutput', '对照表达式输出'],
      ['matches', '结果比较'],
    ];
    const sections: StudyResult['sections'] = [
      { title: '原表达式', content: expression },
      { title: '对照表达式', content: compareExpression },
      {
        title: '等价判断',
        content: equivalent
          ? '在两个表达式所含变量的全部输入组合上，输出均相同，因此逻辑等价。'
          : '两个表达式存在输出不同的输入组合，因此逻辑不等价；下表完整列出全部反例。',
        status: equivalent ? 'success' : 'warning',
      },
    ];
    if (counterexamples.length) {
      const first = counterexamples[0];
      sections.push({
        title: '首个反例',
        content: `当${variables.map((name) => `${name}=${first[name]}`).join('，')}时，原表达式输出为${first.output}，对照表达式输出为${first.comparisonOutput}。这一组输入已足以说明两者不等价。`,
        status: 'warning',
      });
    }
    return result(
      summary,
      [
        metric('输入变量', variables.length),
        metric('检查组合数', rows.length),
        metric('一致组合数', rows.length - counterexamples.length),
        metric('差异组合数', counterexamples.length),
      ],
      sections,
      [
        table('真值表', columns, rows),
        ...(counterexamples.length ? [table('全部反例', columns, counterexamples)] : []),
      ],
    );
  }
  return result(
    '表达式通过专用布尔语法解析，无代码执行。',
    [
      metric('输入变量', variables.length),
      metric('真值行数', rows.filter((r) => r.output === 1).length),
      metric('假值行数', rows.filter((r) => r.output === 0).length),
    ],
    [{ title: '表达式', content: expression }],
    [
      table(
        '真值表',
        [...variables.map((name) => [name, name] as [string, string]), ['output', '输出']],
        rows,
      ),
    ],
  );
}
function gear(v: Inputs): StudyResult {
  const driver = num(v, 'driverTeeth', 1, 2000, true),
    driven = num(v, 'drivenTeeth', 1, 2000, true),
    rpm = num(v, 'rpm', 0, 1e6),
    torque = num(v, 'torque', 0, 1e9),
    efficiency = num(v, 'efficiency', 0, 1),
    ratio = driven / driver,
    power = (torque * 2 * Math.PI * rpm) / 60;
  return result(
    '一对外啮合齿轮的理想传动计算完成。',
    [
      metric('传动比', ratio),
      metric('输出转速大小', rpm / ratio, 'rpm'),
      metric('输出扭矩', torque * ratio * efficiency, 'N·m'),
      metric('输入功率', power, 'W'),
      metric('输出功率', power * efficiency, 'W'),
    ],
    [
      {
        title: '方向与效率',
        content: '外啮合的输出转向与输入相反。输出/输入功率应等于给定效率；零输入功率时不能用除法核对比值。',
      },
    ],
  );
}
function beam(v: Inputs): StudyResult {
  const length = num(v, 'length', 0.001, 10000),
    uniform = num(v, 'uniform', 0, 1e6),
    point = num(v, 'point', 0, 1e6),
    position = num(v, 'position', 0, length);
  const left = (uniform * length) / 2 + (point * (length - position)) / length,
    right = uniform * length + point - left;
  const moment = (x: number) => left * x - (uniform * x * x) / 2 - point * Math.max(x - position, 0);
  const candidates = [0, length, position];
  if (uniform) {
    const before = left / uniform,
      after = (left - point) / uniform;
    if (before >= 0 && before <= position) candidates.push(before);
    if (after >= position && after <= length) candidates.push(after);
  }
  const maxPosition = candidates.reduce((best, x) => (moment(x) > moment(best) ? x : best), 0),
    maximum = moment(maxPosition);
  const xs = [...new Set([...Array.from({ length: 21 }, (_, i) => (i * length) / 20), position])].sort(
    (a, b) => a - b,
  );
  const rows = xs.map((x) => ({
    x: rounded(x),
    shear: rounded(left - uniform * x - (x >= position ? point : 0)),
    moment: rounded(moment(x)),
  }));
  const output = result(
    '简支梁静力模型计算完成。',
    [
      metric('左支座反力', left, 'kN'),
      metric('右支座反力', right, 'kN'),
      metric('最大弯矩', maximum, 'kN·m'),
      metric('最大弯矩位置', maxPosition, 'm'),
    ],
    [
      {
        title: '守恒复核',
        content: `两端反力之和=${rounded(left + right)} kN，与总载荷qL+P一致。表中集中力点显示力作用后的右侧剪力。`,
      },
      {
        title: '范围',
        content: '只求给定载荷下的静力反力与弯矩，不包含材料、截面、挠度、稳定性或规范验算。',
      },
    ],
    [
      table(
        '剪力与弯矩采样',
        [
          ['x', 'x（m）'],
          ['shear', '剪力（kN）'],
          ['moment', '弯矩（kN·m）'],
        ],
        rows,
      ),
    ],
  );
  output.chart = { title: '弯矩采样', points: rows.map((row) => ({ x: row.x, y: row.moment })) };
  return output;
}
function scale(v: Inputs): StudyResult {
  const denominator = num(v, 'scale', 1, 100000),
    length = num(v, 'length', 0, 1e9),
    area = num(v, 'area', 0, 1e12);
  return result(
    '长度和面积分别按一次与二次比例换算。',
    [
      metric('图上长度', (length * 100) / denominator, 'cm'),
      metric('图上面积', (area * 10000) / denominator ** 2, 'cm²'),
    ],
    [
      {
        title: '过程',
        content: `比例1:${denominator}；长度乘100再除${denominator}，面积乘10000再除${denominator}²。`,
      },
    ],
  );
}
function color(v: Inputs): StudyResult {
  const parse = (key: string) => {
    let value = str(v, key, 7);
    if (!/^#(?:[a-f\d]{3}|[a-f\d]{6})$/i.test(value)) fail('颜色需要#RGB或#RRGGBB');
    if (value.length === 4) value = '#' + [...value.slice(1)].map((c) => c + c).join('');
    return [1, 3, 5].map((i) => parseInt(value.slice(i, i + 2), 16) / 255);
  };
  const luminance = (rgb: number[]) =>
    rgb
      .map((x) => (x <= 0.04045 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4))
      .reduce((s, x, i) => s + x * [0.2126, 0.7152, 0.0722][i], 0);
  const fore = luminance(parse('foreground')),
    back = luminance(parse('background')),
    ratio = (Math.max(fore, back) + 0.05) / (Math.min(fore, back) + 0.05);
  return result(
    '按sRGB相对亮度计算颜色对比。',
    [metric('对比度', ratio, ':1'), metric('前景相对亮度', fore), metric('背景相对亮度', back)],
    [
      {
        title: '核对范围',
        content: '使用未舍入比值判定阈值。普通文本与大文本条件不同；字体、尺寸、背景和交互状态仍需人工检查。',
      },
    ],
    [
      table(
        '文本阈值',
        [
          ['level', '级别'],
          ['minimum', '最低比值'],
          ['pass', '是否达到'],
        ],
        [
          { level: 'AA普通文本', minimum: 4.5, pass: ratio >= 4.5 },
          { level: 'AA大文本', minimum: 3, pass: ratio >= 3 },
          { level: 'AAA普通文本', minimum: 7, pass: ratio >= 7 },
          { level: 'AAA大文本', minimum: 4.5, pass: ratio >= 4.5 },
        ],
      ),
    ],
  );
}
function music(v: Inputs): StudyResult {
  const midi = num(v, 'midi', 0, 127, true),
    reference = num(v, 'reference', 1, 1000),
    interval = num(v, 'semitones', -24, 24, true);
  const names = ['C', 'C♯/D♭', 'D', 'D♯/E♭', 'E', 'F', 'F♯/G♭', 'G', 'G♯/A♭', 'A', 'A♯/B♭', 'B'];
  const freq = (pitch: number) => reference * 2 ** ((pitch - 69) / 12),
    name = (pitch: number) => `${names[((pitch % 12) + 12) % 12]}${Math.floor(pitch / 12) - 1}`;
  return result(
    '十二平均律频率和音程计算完成。',
    [
      metric('基础频率', freq(midi), 'Hz'),
      metric('目标频率', freq(midi + interval), 'Hz'),
      metric('频率比', 2 ** (interval / 12)),
    ],
    [
      {
        title: '音高',
        content: `基础${name(midi)}，目标${name(midi + interval)}。采用A4=${reference} Hz。等音名称不替代实际调号拼写。`,
      },
    ],
    [
      table(
        '以基础音为主音的大调音阶',
        [
          ['degree', '级数'],
          ['semitones', '半音偏移'],
          ['name', '名称'],
          ['frequency', '频率（Hz）'],
        ],
        [0, 2, 4, 5, 7, 9, 11, 12].map((offset, i) => ({
          degree: i + 1,
          semitones: offset,
          name: name(midi + offset),
          frequency: rounded(freq(midi + offset)),
        })),
      ),
    ],
  );
}
function sports(v: Inputs): StudyResult {
  const distance = num(v, 'distance', 0.001, 1000),
    minutes = num(v, 'minutes', 0.001, 100000),
    target = num(v, 'targetDistance', 0.001, 1000),
    pace = minutes / distance;
  const splitText = v.splits;
  if (splitText !== undefined && splitText !== '' && splitText !== null) {
    const splits = list(v, 'splits', 100);
    if (splits.some((x) => x <= 0)) fail('分段配速需要正数');
    const mean = splits.reduce((s, x) => s + x, 0) / splits.length;
    return result(
      '基于给定运动数据完成算术核对。',
      [
        metric('平均配速', pace, 'min/km'),
        metric('平均速度', (distance / minutes) * 60, 'km/h'),
        metric('等配速目标时间', pace * target, 'min'),
        metric('分段均值', mean, 'min/km'),
        metric(
          '分段标准差',
          Math.sqrt(splits.reduce((s, x) => s + (x - mean) ** 2, 0) / splits.length),
          'min/km',
        ),
      ],
      [
        {
          title: '数据范围',
          content:
            '分段表是独立给定数据；未假设它与总距离逐项对应。目标时间仅在维持同一配速的数学假设下成立。',
        },
      ],
      [
        table(
          '分段配速',
          [
            ['index', '分段'],
            ['pace', 'min/km'],
          ],
          splits.map((x, i) => ({ index: i + 1, pace: x })),
        ),
      ],
    );
  }
  return result(
    '基于给定距离与时间完成配速核对。',
    [
      metric('平均配速', pace, 'min/km'),
      metric('平均速度', (distance / minutes) * 60, 'km/h'),
      metric('等配速目标时间', pace * target, 'min'),
    ],
    [{ title: '外推假设', content: '只按同一平均配速换算，不代表实际目标时间或训练建议。' }],
  );
}
function units(v: Inputs): StudyResult {
  const amount = num(v, 'amount', 0, 1e9),
    unit = choice(v, 'unit', ['g', 'mg', 'mcg']),
    concentration = num(v, 'concentration', 1e-6, 1e9),
    mg = amount * (unit === 'g' ? 1000 : unit === 'mcg' ? 0.001 : 1);
  return result(
    '仅完成虚构课堂给定质量的单位核算。',
    [metric('统一质量', mg, 'mg'), metric('按给定浓度换算体积', mg / concentration, 'mL')],
    [
      {
        title: '量纲过程',
        content: `${amount} ${unit === 'mcg' ? 'μg' : unit} → ${rounded(mg)} mg；${rounded(mg)} mg ÷ ${concentration} mg/mL = ${rounded(mg / concentration)} mL。`,
      },
      {
        title: '课程用途',
        content: '未选择任何患者剂量、药物或给药方案。实际临床不可依据这个课程算术结果行动。',
      },
    ],
  );
}
export function evaluateEngineeringModule(id: string, v: Inputs): StudyResult | undefined {
  const handlers: Record<string, (input: Inputs) => StudyResult> = {
    'subnet-lab': subnet,
    'cybersecurity-lab': cipher,
    'data-science': cluster,
    'circuit-lab': circuit,
    'digital-logic': logic,
    'mechanics-lab': gear,
    'civil-beam': beam,
    'scale-lab': scale,
    'design-contrast': color,
    'music-lab': music,
    'sports-analysis': sports,
    'pharmacology-units': units,
  };
  return handlers[id]?.(v);
}
