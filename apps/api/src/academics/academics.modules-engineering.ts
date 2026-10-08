import { makeModule as m, numberField as n, textField as t, selectField as s } from './academics.types';
import type { StudyModule } from './academics.types';
const engineering = ['subject-engineering'];
export const engineeringModules: StudyModule[] = [
  m({
    id: 'algorithms',
    title: '算法题与在线编译',
    kind: 'algorithm',
    subjectIds: engineering,
    tags: ['算法', '编译', '代码'],
    description: '进入已有四语言算法工作台，完成样例运行、隐藏用例判题、逐步题解与AI分析。',
    learningObjectives: ['按标准输入输出实现完整程序', '用边界测试复核算法', '解释正确性与复杂度'],
    concepts: [
      {
        title: '运行与提交',
        content:
          '运行用于检查公开样例或自定义输入；正式提交运行公开及隐藏用例。只有正式提交全部通过才计为已解决。',
      },
      {
        title: '学习与复盘',
        content:
          '题解提供渐进提示、方法比较和四语言参考实现。自己的草稿、提交历史和笔记都按账号与空间隔离保存。',
      },
    ],
    fields: [],
    defaultValues: {},
    instructions: [
      '选择学习路线和题目。',
      '选择C++、Python、JavaScript或Java，独立编写代码。',
      '先跑样例，再提交判题；记录关键观察与错误。',
    ],
    resources: [{ title: '算法练习工作台', url: '/algorithms' }],
  }),
  m({
    id: 'sql-lab',
    title: 'SQL查询与关系数据库练习',
    kind: 'sql',
    subjectIds: engineering,
    tags: ['数据库', 'SQL'],
    description: '在每次重新创建的只读教学数据库中练习SELECT、筛选、JOIN与聚合，按任务对比实际查询结果。',
    learningObjectives: ['区分选择列、过滤行和排序', '理解JOIN与分组平均值', '用预期结果检验查询语义'],
    concepts: [
      {
        title: '教学数据表',
        content:
          'students(id,name,major,score)有Alice(92)、Bob(76)、Chen(88)、Dana(95)、Evan(64)、Faye(81)。courses(id,title,credits)为Algorithms、Statistics、Physics。enrollments(student_id,course_id,grade)保存选课成绩。数据库只含这些虚构数据。',
      },
      {
        title: '查询顺序',
        content:
          'FROM/JOIN形成行集，WHERE筛选，GROUP BY分组，HAVING筛选组，SELECT选择表达式，ORDER BY控制顺序。任务要求列名和排序也属于答案的一部分。工具限定单条SELECT，不支持写入、递归查询或外部数据。',
      },
    ],
    fields: [
      s('exercise', '练习任务', [
        ['high-scores', '列出总分至少80的name、score，按score降序、id升序'],
        ['course-average', '每门课程title、avg_grade，按title升序（保留无选课课程）'],
        ['student-courses', 'Alice所选课程的name、title，按title升序'],
      ]),
      t('query', 'SQL查询', '只支持单条SELECT，可有JOIN、聚合和排序。最大4000字符。'),
    ],
    defaultValues: {
      exercise: 'high-scores',
      query: 'SELECT name, score FROM students WHERE score >= 80 ORDER BY score DESC, id ASC;',
    },
    resources: [{ title: 'SQLite SELECT文档', url: 'https://www.sqlite.org/lang_select.html' }],
  }),
  m({
    id: 'subnet-lab',
    title: 'IPv4子网与CIDR规划',
    kind: 'calculator',
    subjectIds: engineering,
    tags: ['网络', 'CIDR'],
    description: '计算网络地址、掩码、广播地址、主机范围和子网划分，理解/31与/32的特殊计数。',
    learningObjectives: ['把IPv4转换成32位整数', '解释前缀长度与地址块大小', '核对划分后的子网边界'],
    concepts: [
      {
        title: '地址块',
        content:
          '前缀长度p保留网络位，其余32−p位形成大小为2^(32−p)的地址块。通常网络与广播地址不分配给主机；/31点对点链路可使用两个地址，/32表示单个地址。',
      },
      {
        title: '继续划分',
        content:
          '新前缀必须不短于原前缀，子网数量=2^(新前缀−原前缀)。界面只列前16个子网，避免大范围结果淹没学习目标。',
      },
    ],
    fields: [
      t('address', 'IPv4地址', '四段0至255的十进制整数', 'text'),
      n('prefix', '原前缀长度', 0, 32),
      n('splitPrefix', '划分后的前缀长度', 0, 32),
    ],
    defaultValues: { address: '192.168.10.77', prefix: 24, splitPrefix: 26 },
    resources: [{ title: 'RFC3021：点对点/31地址', url: 'https://www.rfc-editor.org/rfc/rfc3021' }],
  }),
  m({
    id: 'cybersecurity-lab',
    title: '经典密码变换与频率分析',
    kind: 'calculator',
    subjectIds: engineering,
    tags: ['密码学入门', '防御学习'],
    description: '演示Caesar和Vigenère字母变换及频率统计，观察密钥和重复模式的关系。',
    learningObjectives: ['写出加密与解密的逆运算', '理解密钥周期与频率泄露', '区分教学变换与现实安全加密'],
    concepts: [
      {
        title: '字母模运算',
        content:
          '把A到Z映射到0到25，Caesar每个字母加固定偏移，Vigenère依次加密钥字母对应偏移，再模26。解密用减法。大小写保留，非英文字母不变。',
      },
      {
        title: '频率可见性',
        content:
          '固定或周期替换会保留可分析的结构。工具只展示经典密码课程机制，不能用来保护真实账号、密码或敏感信息。',
      },
    ],
    fields: [
      s('cipher', '变换', [
        ['caesar', 'Caesar'],
        ['vigenere', 'Vigenère'],
      ]),
      s('mode', '方向', [
        ['encrypt', '加密'],
        ['decrypt', '解密'],
      ]),
      t('text', '原文或密文', '最多4000字符'),
      n('shift', 'Caesar偏移', -1000, 1000),
      t('key', 'Vigenère密钥', '仅英文，1至64个字母', 'text'),
    ],
    defaultValues: { cipher: 'caesar', mode: 'encrypt', text: 'Hello, World!', shift: 3, key: 'LEMON' },
  }),
  m({
    id: 'data-science',
    title: '数据标准化与二维聚类',
    kind: 'calculator',
    subjectIds: [...engineering, 'subject-interdisciplinary'],
    tags: ['数据科学', '聚类'],
    description: '用固定初始中心完成二维K-means迭代，可先做z-score标准化，查看中心、分组和误差。',
    learningObjectives: [
      '比较量纲改变前后的距离',
      '跟踪分配和更新两个交替步骤',
      '理解初始化、空簇与局部最优',
    ],
    concepts: [
      {
        title: '两步迭代',
        content:
          '先将每点分给最近中心，再将每簇中心更新为成员均值。这里按输入顺序选前k个不同点初始化，所以相同输入得到相同结果。',
      },
      {
        title: '标准化与限制',
        content:
          'z-score减均值后除总体标准差，常数维设为0。平方误差下降不保证全局最优，聚类编号也没有天然类别语义；空簇保持旧中心。',
      },
    ],
    fields: [
      t('points', '二维数据点', '例如 [[1,1],[2,1],[8,8],[9,8]]，最多200点', 'matrix'),
      n('clusters', '簇数 k', 1, 10),
      n('iterations', '最大迭代数', 1, 50),
      { key: 'normalize', label: '先进行z-score标准化', type: 'checkbox' },
    ],
    defaultValues: { points: '[[1,1],[2,1],[8,8],[9,8]]', clusters: 2, iterations: 20, normalize: false },
  }),
  m({
    id: 'circuit-lab',
    title: '电阻网络与RC响应',
    kind: 'calculator',
    subjectIds: engineering,
    tags: ['电路', '电子'],
    description: '核算理想串联/并联电阻、支路电流与功率，并用等效电阻演示RC充电模型。',
    learningObjectives: ['串联电流相同、并联电压相同', '核对功率与电压电流关系', '用时间常数解释指数响应'],
    concepts: [
      {
        title: '电阻等效',
        content: '串联R总=ΣRᵢ；并联1/R总=Σ(1/Rᵢ)。理想欧姆电阻满足I=V/R，功率P=VI。输入电阻必须为正。',
      },
      {
        title: 'RC课程模型',
        content:
          '这里把等效电阻与给定电容构成一阶RC，初始电容电压为0，Vc(t)=V(1−e^(−t/RC))。忽略实际寄生和器件非线性，只作数学模型练习。',
      },
    ],
    fields: [
      s('topology', '拓扑', [
        ['series', '串联'],
        ['parallel', '并联'],
      ]),
      t('resistances', '电阻列表（Ω）', '1至20个正数', 'json'),
      n('voltage', '电源电压（V）', -1e6, 1e6),
      n('capacitanceMicro', '给定电容（μF），0表示不计算RC', 0, 1e9),
      n('time', '观测时间（s）', 0, 1e6),
    ],
    defaultValues: {
      topology: 'series',
      resistances: '[100,200,300]',
      voltage: 12,
      capacitanceMicro: 100,
      time: 0.06,
    },
  }),
  m({
    id: 'digital-logic',
    title: '逻辑门与真值表',
    kind: 'calculator',
    subjectIds: engineering,
    tags: ['数字逻辑', '布尔代数'],
    description:
      '生成逻辑表达式的真值表，或比较两条表达式是否等价，用实际反例检查德摩根律、吸收律与运算优先级。',
    learningObjectives: [
      '区分非、与、异或、或',
      '按变量组合枚举所有输入',
      '用两条表达式的真值表比较逻辑等价',
      '用具体输入反例解释不等价，而不是仅凭表达式外观判断',
    ],
    concepts: [
      {
        title: '语法约定',
        content:
          '变量只用A、B、C、D，!表示非，&&表示与，^表示异或，||表示或，可用括号。优先级从高到低为!、&&、^、||。不执行JavaScript代码。',
      },
      {
        title: '完整枚举与变量并集',
        content:
          '单表达式枚举其中出现的变量；比较时取两条表达式出现变量的并集，按A至D排序。有n个变量就检查2ⁿ种输入，最多4个变量、16种组合。即使某个变量只出现在一边，也必须一起枚举，不能把两张不同输入范围的表直接比较。',
      },
      {
        title: '等价、反例与德摩根律',
        content:
          '两条表达式在全部输入组合上输出相同，才是逻辑等价；找到一条输出不同的赋值就足以否定等价。例如!(A && B)等价于!A || !B，取反时既要分别取反，也要交换与、或。结果中的首个反例便于手算复核，全部反例表保留每一种差异输入。',
      },
      {
        title: '记录你的判断依据',
        content:
          '先预测哪些输入可能产生差异，再用真值表核对。等价结论来自本语法范围内的全部布尔赋值，不是随机抽样或AI评分。不等价也是有效实验；保存后用笔记解释运算顺序、反例以及修改后的规律，学习记录的完成状态不代表表达式等价。',
      },
    ],
    instructions: [
      '先阅读语法与优先级，预测表达式输出；若填写对照表达式，先写下是否等价的判断。',
      '运行并保存结果。对照栏留空时生成单表达式真值表，填写后枚举两边变量的并集。',
      '核对全部真值行；不等价时手算首个反例，再检查全部反例表中的差异组合。',
      '修改一个运算符或一对括号后重新运行，比较前后结论；载入示例会替换当前输入。',
      '在结果页的学习笔记中解释判断依据、反例和修改原因；需要继续推敲时可标为继续研究。',
    ],
    fields: [
      {
        ...t('expression', '逻辑表达式', '例如 !(A && B) || C。最多200字符。', 'text'),
        max: 200,
        placeholder: '例如 !(A && B) || C',
      },
      {
        ...t(
          'compareExpression',
          '对照表达式（可选）',
          '留空只生成第一条表达式的真值表；填写后逐项验证两者是否等价。最多200字符。',
          'text',
        ),
        required: false,
        max: 200,
        placeholder: '例如 !A || !B || C',
      },
    ],
    defaultValues: { expression: '!(A && B) || C', compareExpression: '' },
    examples: [
      {
        title: '起步单表达式',
        values: { expression: '!(A && B) || C', compareExpression: '' },
        explanation: '清空对照栏，只检查A、B、C的8种输入：7行输出1，1行输出0；唯一的0出现在A=1、B=1、C=0。',
      },
      {
        title: '德摩根律：等价',
        values: { expression: '!(A && B)', compareExpression: '!A || !B' },
        explanation: 'A、B的4种输入全部一致，差异为0。思考整体取反时为什么必须同时交换与、或。',
      },
      {
        title: '与或误写：找反例',
        values: { expression: '!(A && B)', compareExpression: '!A && !B' },
        explanation:
          '4种输入中有2种不同。按A、B从0开始枚举，首个反例是A=0、B=1：原表达式输出1，对照表达式输出0。',
      },
      {
        title: '吸收律：不同变量集合',
        values: { expression: 'A || (A && B)', compareExpression: 'A' },
        explanation:
          '虽然对照表达式没有B，仍按变量并集A、B检查4种输入；全部一致，差异为0。B的变化不影响最终输出。',
      },
      {
        title: '优先级：括号改变逻辑',
        values: { expression: 'A || B && C', compareExpression: '(A || B) && C' },
        explanation:
          '8种输入中有2种不同。首个反例A=1、B=0、C=0时，原表达式输出1，对照表达式输出0；&&优先于||。',
      },
    ],
  }),
  m({
    id: 'mechanics-lab',
    title: '齿轮传动与功率关系',
    kind: 'calculator',
    subjectIds: engineering,
    tags: ['机械', '传动'],
    description: '计算一对理想外啮合齿轮的传动比、输出转速、效率修正扭矩与功率。',
    learningObjectives: ['用齿数比推导转速比', '区分转速大小与转向', '检验输入输出功率与效率的关系'],
    concepts: [
      {
        title: '传动比',
        content:
          'i=从动齿数/主动齿数，输出转速大小=输入转速/i。单对外啮合齿轮转向相反；本工具仅处理一对齿轮，不包含复合轮系。',
      },
      {
        title: '扭矩与效率',
        content:
          '输出扭矩=输入扭矩·i·η，功率P=T·2πn/60。效率η取0至1，理想功率相等，实际模型按给定效率减少。没有进行齿强度或制造检验。',
      },
    ],
    fields: [
      n('driverTeeth', '主动齿轮齿数', 1, 2000),
      n('drivenTeeth', '从动齿轮齿数', 1, 2000),
      n('rpm', '输入转速（rpm）', 0, 1e6),
      n('torque', '输入扭矩（N·m）', 0, 1e9),
      n('efficiency', '给定传动效率', 0, 1),
    ],
    defaultValues: { driverTeeth: 20, drivenTeeth: 60, rpm: 1200, torque: 10, efficiency: 0.9 },
  }),
  m({
    id: 'civil-beam',
    title: '简支梁反力与弯矩',
    kind: 'calculator',
    subjectIds: engineering,
    tags: ['土木', '静力学'],
    description: '在全跨均布载荷与一个集中载荷下，计算支座反力、剪力采样和最大弯矩位置。',
    learningObjectives: ['用力与力矩平衡求反力', '理解集中力造成剪力跳变', '比较弯矩表达式与最大值条件'],
    concepts: [
      {
        title: '模型与单位',
        content:
          '梁长L以m，均布载荷q以kN/m，集中力P以kN输入，a为集中力距左端位置。假设静力、简支、向下非负载荷，忽略自重以外未输入载荷。',
      },
      {
        title: '分段弯矩',
        content:
          '左反力RA=qL/2+P(L−a)/L，M(x)=RAx−qx²/2−P·max(x−a,0)。集中力处剪力跳变，最大弯矩在端点、集中力位置或各分段剪力为0处检查。此模型不是工程设计验算。',
      },
    ],
    fields: [
      n('length', '跨长 L（m）', 0.001, 10000),
      n('uniform', '均布载荷 q（kN/m）', 0, 1e6),
      n('point', '集中载荷 P（kN）', 0, 1e6),
      n('position', '距左端 a（m）', 0, 10000),
    ],
    defaultValues: { length: 6, uniform: 2, point: 10, position: 3 },
  }),
  m({
    id: 'scale-lab',
    title: '图纸比例与面积换算',
    kind: 'calculator',
    subjectIds: engineering,
    tags: ['建筑', '比例尺'],
    description: '将真实长度、面积换成1:n图纸上的厘米与平方厘米，核对线性与平方比例。',
    learningObjectives: ['将米换成厘米再缩放', '解释面积为什么除以比例平方', '用反向换算检查图纸尺寸'],
    concepts: [
      { title: '长度比例', content: '1:n表示图上1单位对应实际n单位。真实长度m换算为图上cm为长度·100/n。' },
      {
        title: '面积比例',
        content: '两个方向均缩小n倍，面积缩小n²倍；1 m²=10000 cm²。面积不能像长度一样只除以n。',
      },
    ],
    fields: [
      n('scale', '比例尺分母 n', 1, 100000),
      n('length', '真实长度（m）', 0, 1e9),
      n('area', '真实面积（m²）', 0, 1e12),
    ],
    defaultValues: { scale: 100, length: 12, area: 144 },
  }),
  m({
    id: 'design-contrast',
    title: '色彩对比与可读性核对',
    kind: 'calculator',
    subjectIds: ['subject-art', 'subject-engineering'],
    tags: ['设计', '无障碍'],
    description: '计算两种sRGB颜色的相对亮度和对比度，核对WCAG普通文本与大文本阈值。',
    learningObjectives: [
      '区分颜色通道与线性亮度',
      '计算亮暗颜色的对比比值',
      '把自动数值核对与人工阅读检查结合',
    ],
    concepts: [
      {
        title: '亮度与对比',
        content:
          '将sRGB通道归一化并线性化，相对亮度L=0.2126R+0.7152G+0.0722B。对比度=(较亮L+0.05)/(较暗L+0.05)，范围1至21。',
      },
      {
        title: '文本条件',
        content:
          'WCAG AA普通文本通常要求4.5:1，大文本3:1；AAA普通文本7:1、大文本4.5:1。大文本有明确字号条件，颜色对比也不能代替字体、背景和用户测试。',
      },
    ],
    fields: [
      t('foreground', '前景色', '十六进制#RGB或#RRGGBB', 'text'),
      t('background', '背景色', '十六进制#RGB或#RRGGBB', 'text'),
    ],
    defaultValues: { foreground: '#1d4ed8', background: '#ffffff' },
    resources: [
      {
        title: 'W3C：对比度最低要求',
        url: 'https://www.w3.org/WAI/WCAG22/Understanding/contrast-minimum.html',
      },
    ],
  }),
  m({
    id: 'music-lab',
    title: '十二平均律与音程',
    kind: 'calculator',
    subjectIds: ['subject-art'],
    tags: ['音乐', '频率'],
    description: '根据MIDI音高与A4参考频率计算音符频率、目标音程及大调音阶，观察指数关系。',
    learningObjectives: ['理解每半音频率比2^(1/12)', '核对八度频率翻倍', '区分平均律计算与实际音色和音准'],
    concepts: [
      {
        title: '音高编号',
        content: 'MIDI 69对应A4。频率f=fA4·2^((编号−69)/12)，MIDI 60对应C4。编号上升12，频率变为两倍。',
      },
      {
        title: '音程与音阶',
        content:
          '相差s个半音的频率比为2^(s/12)。大调从主音出发半音偏移0、2、4、5、7、9、11、12。工具显示等音名称，不做复杂调号拼写。',
      },
    ],
    fields: [
      n('midi', 'MIDI音高编号', 0, 127),
      n('reference', 'A4参考频率（Hz）', 1, 1000),
      n('semitones', '目标音程（半音）', -24, 24),
    ],
    defaultValues: { midi: 69, reference: 440, semitones: 7 },
  }),
  m({
    id: 'sports-analysis',
    title: '配速与运动数据分析',
    kind: 'calculator',
    subjectIds: ['subject-education', 'subject-medicine'],
    tags: ['体育', '配速'],
    description: '用给定距离与时间核算平均配速、速度及等配速的时间换算，比较分段表现。',
    learningObjectives: ['正确转换分钟、秒和小时', '区分平均速度与每公里配速', '将等配速外推标注为数学假设'],
    concepts: [
      {
        title: '配速与速度',
        content:
          '配速=总分钟/公里数，速度=公里数/小时数。配速数值越小，单位距离耗时越少；不要把它与速度的变化方向混淆。',
      },
      {
        title: '给定数据分析',
        content:
          '可填写每公里分钟数，计算最慢、最快与离散程度。外推目标距离只假设维持同一配速，不给训练或医疗建议。',
      },
    ],
    fields: [
      n('distance', '完成距离（km）', 0.001, 1000),
      n('minutes', '完成时间（min）', 0.001, 100000),
      n('targetDistance', '换算目标距离（km）', 0.001, 1000),
      { ...t('splits', '每公里配速（分钟）', '可留空，最多100项', 'json'), required: false },
    ],
    defaultValues: { distance: 5, minutes: 30, targetDistance: 10, splits: '[6.2,6.1,6,5.9,5.8]' },
  }),
  m({
    id: 'pharmacology-units',
    title: '模拟单位与浓度核算',
    kind: 'calculator',
    subjectIds: ['subject-medicine'],
    tags: ['量纲', '课程模拟'],
    description: '把给定虚构质量换成mg，再按题目给定浓度核算体积，并显示单位取消过程。',
    learningObjectives: ['正确区分g、mg与μg', '以质量除浓度得到体积', '完成独立复核而不把算术练习当处方'],
    concepts: [
      { title: '量纲换算', content: '1 g=1000 mg，1 mg=1000 μg。给定质量先统一为mg，再除以mg/mL，得到mL。' },
      {
        title: '使用范围',
        content:
          '只对用户给定的虚构课堂数值做单位核算；不选择药物、适应证、患者剂量、用药频率或给药方案。真实临床不能仅凭这个算术结果行动。',
      },
    ],
    fields: [
      n('amount', '题目给定质量', 0, 1e9),
      s('unit', '质量单位', [
        ['g', 'g'],
        ['mg', 'mg'],
        ['mcg', 'μg'],
      ]),
      n('concentration', '题目给定浓度（mg/mL）', 0.000001, 1e9),
    ],
    defaultValues: { amount: 500, unit: 'mg', concentration: 250 },
    examples: [
      {
        title: '虚构课堂换算',
        values: { amount: 500, unit: 'mg', concentration: 250 },
        explanation: '500 mg ÷ 250 mg/mL = 2 mL，仅展示单位核算。',
      },
    ],
  }),
];
