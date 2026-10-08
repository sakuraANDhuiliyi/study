import { makeModule as m, textField as t, numberField as n } from './academics.types';
import type { StudyModule } from './academics.types';
const workspace = (
  id: string,
  title: string,
  subjects: string[],
  description: string,
  objectives: string[],
  concepts: { title: string; content: string }[],
  fields: StudyModule['fields'],
  values: Record<string, unknown>,
): StudyModule =>
  m({
    id,
    title,
    subjectIds: subjects,
    description,
    learningObjectives: objectives,
    concepts,
    fields,
    defaultValues: values,
    kind: 'workspace',
    tags: ['学习工作台', '过程记录'],
    instructions: [
      '先阅读任务和示例，替换为自己的课堂练习内容。',
      '把观察、依据、推理与结论写在对应栏目。',
      '提交会保存完整工作稿并检查结构完整性；质量仍需要人工讨论与复核。',
    ],
  });
export const humanitiesModules: StudyModule[] = [
  workspace(
    'study-notebook',
    '自由学习笔记',
    ['subject-general'],
    '独立于课程的个人笔记，保存正文、标签、问题和下一步行动，可在学习记录中继续编辑。',
    ['建立可搜索的学习记录', '区分事实、理解和待查问题'],
    [
      {
        title: '主动复盘',
        content: '记录今天解决了什么、依据是什么、还不理解什么。相比粘贴材料，自己的概括能暴露理解上的空缺。',
      },
      {
        title: '后续行动',
        content:
          '把“继续学习”写成一个可执行动作，例如补做边界测试、查证来源、比较两种解法。笔记属于当前账号与学习空间。',
      },
    ],
    [
      t('title', '笔记主题', '', 'text'),
      t('body', '笔记正文'),
      { ...t('tags', '标签', '逗号分隔，例如 数学,复习', 'text'), required: false },
      { ...t('nextAction', '下一步行动'), required: false },
    ],
    {
      title: '前缀和的边界复盘',
      body: 'P[0]=0表示空前缀。闭区间[l,r]的和是P[r]−P[l−1]，不能减P[l]。下次测试l=1、l=r、全负数和大整数。',
      tags: '算法,前缀和,边界',
      nextAction: '不用参考代码，重新写一次并跑四组边界。',
    },
  ),
  workspace(
    'research-planning',
    '研究问题与项目计划',
    ['subject-general', 'subject-interdisciplinary'],
    '从问题、假设、方法到数据与限制形成一个可追踪的研究工作稿。',
    ['把宽泛主题改成可回答的问题', '说明方法怎样对应问题', '把限制与后续验证纳入计划'],
    [
      {
        title: '问题与证据',
        content:
          '问题应指向可观察的对象或可检验的关系。先确认需要什么证据，再决定观察、调查、实验或资料分析方法。',
      },
      {
        title: '可复核计划',
        content:
          '记录样本或材料来源、实施步骤、判定标准、限制与时间安排，使他人能够理解你的工作范围。工具只检查结构，不认定研究结论成立。',
      },
    ],
    [
      t('question', '研究问题'),
      t('hypothesis', '假设或工作主张'),
      t('method', '方法与步骤'),
      t('evidence', '数据、材料与来源计划'),
      t('limitations', '限制与替代解释'),
      t('timeline', '时间安排'),
    ],
    {
      question: '不同输入规模下，前缀和查询与直接扫描耗时如何变化？',
      hypothesis: '查询次数增加时，预处理方法的累计耗时增长更慢。',
      method: '构造同一数组，分别实现两种方法；固定环境，逐组增加n与q，每组重复测量。',
      evidence: '保存源码、参数、运行环境和重复测量结果；记录计时范围。',
      limitations: '小规模时初始化和语言开销可能占主要部分；不能把单次测量当作稳定复杂度证据。',
      timeline: '第一天实现与核对，第二天测量，第三天整理图表并复查。',
    },
  ),
  workspace(
    'software-design',
    '软件需求与测试设计',
    ['subject-engineering'],
    '把需求拆成角色、行为、约束、数据与验收用例，形成可实施的工程任务。',
    ['区分需求与实现选择', '用可观察结果定义验收', '记录异常和权限边界'],
    [
      {
        title: '需求结构',
        content:
          '写清谁在什么条件下完成什么操作，以及成功后的可见结果。不要只写“支持智能管理”等无法验收的描述。',
      },
      {
        title: '测试与边界',
        content:
          '正常路径之外还要考虑无权限、并发更新、无效输入、网络失败和恢复。数据与角色边界应体现在验收用例中。',
      },
    ],
    [
      t('problem', '要解决的问题'),
      t('users', '角色与使用场景'),
      t('requirements', '功能与非功能要求'),
      t('dataModel', '数据模型与所有权'),
      t('acceptance', '验收用例'),
      t('risks', '风险与恢复方案'),
    ],
    {
      problem: '学生离开页面后需要恢复算法草稿。',
      users: '学生编辑；管理员配置服务；不同学生不能互读草稿。',
      requirements: '按题目保存语言和代码；自动保存显示状态；断网保留本机副本。',
      dataModel: '草稿键为组织、用户、题目；记录代码、语言和更新时间。',
      acceptance: '刷新后代码一致；换账号内容为空；旧保存响应不能覆盖新输入；服务器失败仍保留本机草稿。',
      risks: '保存并发、账号切换、浏览器存储不可用；用串行队列与生命周期检查处理。',
    },
  ),
  workspace(
    'architecture-studio',
    '建筑空间任务书',
    ['subject-engineering', 'subject-art'],
    '组织空间需求、使用流程、面积安排、尺度与设计取舍，保留方案演变的依据。',
    ['由使用者需求推导空间', '核对面积预算与动线', '记录约束与设计取舍'],
    [
      {
        title: '从任务到空间',
        content:
          '先定义使用人数、活动和相邻关系，再安排房间。面积表、流程图和方案说明相互核对，避免只画形状而没有需求依据。',
      },
      {
        title: '课程方案范围',
        content:
          '此工作稿用于课堂设计过程记录，不能替代实际项目的规划、结构、消防、无障碍或当地审批标准审查。',
      },
    ],
    [
      t('brief', '设计任务与使用者'),
      n('areaBudget', '给定总面积预算（m²）', 1, 1e7),
      t('rooms', '空间表', 'JSON数组[{name,area}]，最多30项', 'json'),
      t('circulation', '相邻关系与动线'),
      t('constraints', '课程给定约束'),
      t('decision', '方案取舍与待验证问题'),
    ],
    {
      brief: '为20名学生设计小型课程讨论与阅读空间。',
      areaBudget: 120,
      rooms:
        '[{"name":"讨论区","area":40},{"name":"阅读区","area":45},{"name":"储物与支持","area":15},{"name":"交通区域","area":20}]',
      circulation: '入口先到共享交通区，讨论区与安静阅读区分开，储物靠近入口。',
      constraints: '课堂给定面积120m²；方案需说明噪声分隔与流线，规范核验另行完成。',
      decision: '先比较两种功能分区，绘图后用比例尺工具核对尺寸与面积。',
    },
  ),
  workspace(
    'clinical-reading',
    '医学课程证据阅读',
    ['subject-medicine'],
    '按问题、研究设计、样本、结果和局限整理课程文献，练习证据理解。',
    ['区分研究发现与临床适用性', '记录效应方向与不确定性', '识别替代解释和研究限制'],
    [
      {
        title: '结构化阅读',
        content: '记录原文来源、研究对象、比较组、测量方法和结果，不把摘要中的一个数字脱离上下文使用。',
      },
      {
        title: '课程范围',
        content: '工具保存读书稿并检查栏目完整性，不作患者诊断、治疗选择或临床建议；课程示例使用虚构研究。',
      },
    ],
    [
      t('question', '课程研究问题'),
      t('source', '文献来源或课堂材料'),
      t('design', '研究设计与样本'),
      t('findings', '结果与不确定性'),
      t('limitations', '局限与适用范围'),
      t('reflection', '自己的复核问题'),
    ],
    {
      question: '不同学习资料的呈现方式会改变解剖知识保持程度吗？',
      source: '课堂虚构研究材料A，不是真实临床文献。',
      design: '两组学生使用不同课程材料，四周后完成同一知识测验；记录分组与缺失情况。',
      findings: '材料给出两组均值和分散程度，需要复核样本量与区间，不只看均值差。',
      limitations: '未控制先前成绩，测验覆盖范围有限；不能推断对临床工作的效果。',
      reflection: '分组是否随机？评分者是否知道组别？缺失数据如何处理？',
    },
  ),
  workspace(
    'nursing-observation',
    '模拟观察与交接记录',
    ['subject-medicine'],
    '用课堂虚构案例练习观察事实、来源、变化、待核实信息和交接结构。',
    ['区分直接观察与推测', '在交接中保持时间和来源', '列出需向课程指导者核实的问题'],
    [
      {
        title: '事实与解释分开',
        content: '观察栏记录实际给定资料及时间，解释栏明确标为课堂推测。不要为补齐记录而编造没有提供的信息。',
      },
      {
        title: '模拟交接',
        content:
          '围绕背景、已知资料、变化和未决问题组织交接。工具不推荐实际护理处置，也不用于保存真实患者资料。',
      },
    ],
    [
      t('caseTitle', '虚构课堂案例', '', 'text'),
      t('background', '背景与给定资料'),
      t('observations', '带时间的观察事实'),
      t('changes', '资料中的变化'),
      t('unknowns', '未提供/需核实信息'),
      t('handover', '模拟交接摘要'),
    ],
    {
      caseTitle: '课堂模拟观察A',
      background: '课程材料描述一名虚构对象在三个时间点的状态，不提供诊断。',
      observations: '09:00材料记载清醒、可正常交流；10:00出现与先前不同的描述；10:15继续记录。',
      changes: '第二个时间点与最初描述有变化，但原因资料不足。',
      unknowns: '变化的具体量化指标、测量方法和完整背景均需向指导者核实。',
      handover: '交接时先说明虚构背景，依时间列事实，保留未知项，不从有限描述得出真实临床结论。',
    },
  ),
  workspace(
    'writing-studio',
    '论证写作与修订',
    ['subject-literature', 'subject-general'],
    '整理主张、证据、反方与回应，核对文本结构并保存不同阶段的写作稿。',
    ['把主张写成明确句子', '让证据解释与主张相连', '认真回应最强反方意见'],
    [
      {
        title: '主张和证据',
        content:
          '证据本身不会自动说明结论。需要解释它为什么支持主张，以及可能支持的其他解释。引用材料还应标注来源。',
      },
      {
        title: '修订过程',
        content:
          '结构检查只判断栏目是否填写、文本长度和段落数量，不代表文章质量。修订时核对逻辑、事实和表达，再让同学或指导者讨论。',
      },
    ],
    [
      t('topic', '写作题目', '', 'text'),
      t('thesis', '核心主张'),
      t('evidence', '证据与来源'),
      t('counterargument', '最强反方意见'),
      t('response', '回应与限定'),
      t('draft', '文章工作稿'),
    ],
    {
      topic: '为什么学习笔记应包含待查问题',
      thesis: '有待查问题的笔记更容易转化为下一次学习行动。',
      evidence:
        '一次复盘中，把错误公式和待做边界列出来，下一次能够直接按清单验证。这个例子只说明一个可能机制。',
      counterargument: '待查列表可能越来越长，使学习者感到负担。',
      response: '每次只保留一个最重要的问题，并把其余归档，可降低负担；效果仍需观察。',
      draft:
        '学习笔记不仅是记录结果，也可以安排下一步行动。把还不理解的条件写清，会使下次查证更具体。\n然而，问题过多可能分散注意力。因此应区分当前优先事项和暂存事项，并在解决后及时更新。',
    },
  ),
  workspace(
    'literature-reading',
    '文学文本细读',
    ['subject-literature'],
    '从原文片段、叙述、意象、结构和证据形成有依据的阅读札记。',
    ['把解释建立在具体文本上', '区分作者、叙述者与人物', '容纳不同读法并解释理由'],
    [
      {
        title: '细读证据',
        content:
          '先记录句子、词语和结构，再提出解释。语气、重复、视角和时间转换都可以成为证据；避免只用“生动、深刻”等标签。',
      },
      {
        title: '解释的限度',
        content:
          '同一细节可能支持不同读法。写出替代解释，以及哪些后文或背景材料会帮助判断，而不是把个人感受直接当唯一答案。',
      },
    ],
    [
      t('passage', '阅读片段'),
      t('observations', '语言、视角与结构观察'),
      t('interpretation', '主要解释'),
      t('evidence', '具体词句依据'),
      t('alternative', '另一种可能读法'),
      t('questions', '后续阅读问题'),
    ],
    {
      passage:
        '（原创练习片段）雨停后，窗台还留着一小片水。她把书合上，却没有关灯。楼下的脚步声渐渐远了，屋里仍亮着。',
      observations: '雨停、合书与脚步远去都像结束信号，灯却保持亮着；外部与内部节奏不同。',
      interpretation: '灯的持续可能表现尚未结束的等待。',
      evidence: '“却没有关灯”和“仍亮着”重复强调未结束状态。',
      alternative: '也可能只是日常习惯，不能仅凭这一段确定等待对象或人物背景。',
      questions: '后文是否出现等待对象？叙述者是否一直采用外部观察视角？',
    },
  ),
  workspace(
    'education-design',
    '教学目标与课堂活动',
    ['subject-education'],
    '把可观察的学习目标、教学活动和形成性评价对应起来，核对课程时间。',
    ['写出可观察的学习目标', '让评价直接覆盖目标', '为不同基础的学习者提供支持'],
    [
      {
        title: '目标与评价对应',
        content:
          '“理解某概念”需要进一步说明学生能够做什么，如解释、分类、推导或解决问题。评价任务应采集这些行为的证据。',
      },
      {
        title: '时间与支架',
        content:
          '设计每阶段时间、活动和检查点，给出基础支持与延伸挑战。结构完整不等于教学有效，实施后仍需根据反馈修订。',
      },
    ],
    [
      t('learners', '学习者与已有基础'),
      t('objectives', '可观察学习目标'),
      n('minutes', '给定课时（分钟）', 1, 240),
      t('plan', '活动表', 'JSON[{phase,minutes,activity,assessment}]，最多15阶段', 'json'),
      t('support', '差异支持与延伸'),
      t('reflection', '课后需收集的反馈'),
    ],
    {
      learners: '已学会读取数组，但尚未接触前缀和的学生。',
      objectives: '能画出P[r]与P[l−1]的抵消区域，正确计算三个闭区间查询。',
      minutes: 45,
      plan: '[{"phase":"导入","minutes":5,"activity":"比较重复扫描","assessment":"提出耗时疑问"},{"phase":"推导","minutes":15,"activity":"画前缀并抵消","assessment":"说明l−1的理由"},{"phase":"练习","minutes":15,"activity":"独立实现并测试","assessment":"三个边界用例"},{"phase":"总结","minutes":10,"activity":"写易错点","assessment":"离堂题"}]',
      support: '提供带下标的数组图；延伸挑战为二维前缀和。',
      reflection: '收集错用P[l]的频率及学生对空前缀的解释。',
    },
  ),
  workspace(
    'psychology-design',
    '心理与行为研究设计',
    ['subject-science', 'subject-education', 'subject-interdisciplinary'],
    '把假设、变量、对照、混淆因素和伦理安排写成课程研究计划。',
    ['用可测量方式定义变量', '区分相关观察与因果实验', '提出混淆控制和伦理边界'],
    [
      {
        title: '变量与控制',
        content:
          '独立变量是比较或操纵的条件，因变量是测量结果。随机分组、盲法或匹配等方法各有前提，不能只写术语而没有步骤。',
      },
      {
        title: '伦理与解释',
        content:
          '课程设计需说明知情、自愿、退出与资料保护，并经相应课程程序评审。工具不进行心理诊断或个体标签判断。',
      },
    ],
    [
      t('hypothesis', '可检验假设'),
      t('variables', '变量及操作定义'),
      t('groups', '比较组与分配方式'),
      t('confounders', '混淆因素与控制'),
      t('analysis', '分析计划'),
      t('ethics', '伦理与资料保护'),
    ],
    {
      hypothesis: '在同一测验条件下，间隔复习组的知识保持更好。',
      variables: '条件为连续复习或间隔复习；结果为四周后相同测验得分。',
      groups: '课程给定样本，说明随机分配方法并保存分配过程。',
      confounders: '控制先前成绩、总学习时长与测验难度，记录额外学习活动。',
      analysis: '先报告描述统计及缺失情况，再按课程方法分析差异与不确定性。',
      ethics: '自愿参与、可退出，使用匿名课程数据，方案须由指导者审核。',
    },
  ),
  workspace(
    'history-research',
    '史料整理与年代脉络',
    ['subject-history', 'subject-military'],
    '整理来源、事件年代、资料差异与论证，将给定事件自动排成年代顺序。',
    ['区分原始资料与后来的解释', '记录史料产生情境', '在冲突来源之间保持不确定性'],
    [
      {
        title: '来源与情境',
        content:
          '史料需要记录作者或机构、产生时间、体裁、面向对象和保存过程。接近事件不自动等于可靠，较晚材料也可能保存其他证据。',
      },
      {
        title: '时间线与论证',
        content:
          '时间顺序帮助发现先后关系，却不能单独证明因果。工具对填写的整数年份排序，不把虚构示例当真实历史事实。',
      },
    ],
    [
      t('question', '研究问题'),
      t('sources', '来源与元数据'),
      t('timeline', '事件资料', 'JSON[{year,title,source}]，最多30项', 'json'),
      t('comparison', '来源异同与冲突'),
      t('argument', '当前论证'),
      t('uncertainty', '不确定性与待查资料'),
    ],
    {
      question: '虚构镇史材料中的公共阅读空间如何演变？',
      sources: '课堂虚构档案A、B及后来编写的回忆材料C。',
      timeline:
        '[{"year":1935,"title":"虚构档案B记载迁址","source":"B"},{"year":1920,"title":"虚构档案A记载设立","source":"A"},{"year":1950,"title":"虚构回忆C描述使用情况","source":"C"}]',
      comparison: 'A说明设立，B说明迁址，C描述体验；需要核对C的记忆与同期材料。',
      argument: '空间在不同时间具有不同功能，尚不能只凭三份材料说明变化原因。',
      uncertainty: '缺少当时预算、地图与使用者记录，应保留多个解释。',
    },
  ),
  workspace(
    'legal-reasoning',
    '法律案例论证工作台',
    ['subject-law'],
    '将虚构课程案例拆成事实、争点、规则来源、双方论证和待核实事项。',
    ['区分给定事实与自行假设', '明确规则来自何处及适用范围', '以双方最强理由分析争点'],
    [
      {
        title: '事实与规则',
        content:
          '先写案件材料确实提供的事实，再指出需要哪条规则及其来源。课程假设规则不等于现行法律，适用法域和时间应另行确认。',
      },
      {
        title: '论证而非裁决',
        content:
          '围绕争点比较双方理由，区分结论的依据与未决事实。工具只帮助组织课堂分析，不提供个案法律结论。',
      },
    ],
    [
      t('facts', '虚构案例中的已知事实'),
      t('issues', '需要分析的争点'),
      t('rules', '规则依据与适用范围'),
      t('sideA', '一方最强论证'),
      t('sideB', '另一方最强论证'),
      t('conclusion', '限定结论与待核实事项'),
    ],
    {
      facts: '课堂假设：甲乙约定某成果在周五交付，实际于下周一提供；材料未说明延期原因与通知内容。',
      issues: '如何解释约定时点、延期原因和双方沟通，哪些事实影响课程规则适用？',
      rules: '仅采用课堂给定的假设规则；真实法域与法律依据尚未提供。',
      sideA: '主张约定时点明确，延期影响后续安排，并提出相应事实依据。',
      sideB: '主张双方沟通或给定例外可能影响分析，需提交通知与原因证据。',
      conclusion: '资料不足以给出确定结论，先核对通知、原因和完整条款；这是课程论证稿。',
    },
  ),
  workspace(
    'media-literacy',
    '新闻五要素与来源核验',
    ['subject-literature', 'subject-law'],
    '把报道主张拆成五要素、来源链、交叉核验和发布前问题。',
    ['区分原始来源与转述', '把重要主张对应证据', '记录未能核实的信息'],
    [
      {
        title: '五要素',
        content:
          '围绕谁、何事、何时、何地、为何及如何组织资料。缺失的要素应明确标注，而不能为完成叙述而猜测。',
      },
      {
        title: '核验链',
        content:
          '逐条记录主张、来源、是否独立以及核验结果。两篇互相转载的文章不能当作两个独立证据；时间、图片背景和原话语境也需要检查。',
      },
    ],
    [
      t('claim', '待核验的重要主张'),
      t('elements', '五要素与过程'),
      t('sources', '原始与转述来源'),
      t('verification', '交叉核验步骤与结果'),
      t('unknowns', '未核实项与可能误导'),
      t('draft', '带限定语的报道工作稿'),
    ],
    {
      claim: '虚构校园图书角将在下月扩展开放时段。',
      elements: '谁：课程假设的管理小组；何事：延长时段；何时：下月；何地：图书角；原因尚待核实。',
      sources: '课堂给定公告A和一篇转载B，B不能算独立来源。',
      verification: '核对原公告日期、发布者、适用对象及是否有后续更正。',
      unknowns: '具体日期、工作人员安排与试运行期限未提供。',
      draft: '依据课堂给定公告，图书角计划于下月试行延长开放，具体安排仍需核对完整通知。',
    },
  ),
  workspace(
    'social-research',
    '社会调查与访谈设计',
    ['subject-law', 'subject-management'],
    '把调查问题、抽样、题目、访谈提纲、分析和资料保护整理成可复核计划。',
    ['让调查问题对应研究目标', '识别便利样本的限制', '避免诱导性提问与过度推断'],
    [
      {
        title: '抽样与问题',
        content: '写清总体、招募渠道和样本选择方式。题目应中性、一次只问一个概念，并明确时间范围。',
      },
      {
        title: '分析与边界',
        content:
          '记录非回应、缺失与不适用情况。自愿便利样本通常不能直接代表整个总体；结果解释应与样本来源和问题设计相匹配。',
      },
    ],
    [
      t('question', '研究目标'),
      t('sample', '总体与抽样方案'),
      t('questions', '调查题目或访谈提纲'),
      t('bias', '潜在偏差与改进'),
      t('analysis', '分析与报告计划'),
      t('ethics', '自愿、匿名与保存安排'),
    ],
    {
      question: '课程给定班级中的学生如何使用学习笔记？',
      sample: '向该班自愿招募，记录回应人数，说明便利样本限制。',
      questions: '过去一周记录笔记的天数？通常记录哪些内容？最近一次笔记如何帮助后续学习？',
      bias: '避免把“不记笔记”预设为不好；允许“不适用”和不愿回答。',
      analysis: '报告样本范围、题目原文、分布与开放回答主题，不推断到全校。',
      ethics: '不采集不必要身份，自愿回答，可撤回，保存和删除时间依课程方案。',
    },
  ),
  workspace(
    'tourism-planning',
    '课程行程与服务预算',
    ['subject-management'],
    '按给定虚构地点设计日程、服务说明与预算，自动核算时长和费用。',
    ['核对活动与交通时间', '把单价、人数和合计对应', '说明预算未包含的项目'],
    [
      {
        title: '日程顺序',
        content:
          '每个环节应包含活动、时长、过渡或交通、集合要求与替代方案。工具只分析输入的课程资料，不推荐实际目的地。',
      },
      {
        title: '成本核算',
        content:
          '单项合计=单价×数量，总费用为各项之和。预算与实际报价有时间差，应说明课程模型中未计入的费用。',
      },
    ],
    [
      t('goal', '课程任务与参与者'),
      t('itinerary', '活动日程', 'JSON[{activity,minutes}]，最多30项', 'json'),
      t('budget', '预算表', 'JSON[{item,unitPrice,quantity}]，最多30项', 'json'),
      n('people', '人数', 1, 1000),
      t('service', '服务沟通与替代安排'),
      t('limits', '课程范围与未计入项'),
    ],
    {
      goal: '为10人设计虚构校园文化半日活动。',
      itinerary:
        '[{"activity":"集合与说明","minutes":20},{"activity":"虚构展厅阅读","minutes":60},{"activity":"交通与休息","minutes":30},{"activity":"交流总结","minutes":40}]',
      budget:
        '[{"item":"课程资料","unitPrice":5,"quantity":10},{"item":"交通模型费用","unitPrice":20,"quantity":1}]',
      people: 10,
      service: '提前说明集合时间、活动资料与可选休息；迟到者有补充说明。',
      limits: '只使用虚构课程数据，没有真实门票报价或现实行程预订。',
    },
  ),
  workspace(
    'philosophy-argument',
    '哲学论证与反例',
    ['subject-philosophy', 'subject-general'],
    '用前提、推理、结论和反例整理论证，辨别有效性与前提可信性。',
    ['把隐含前提显式写出', '区分有效论证与真实前提', '用最强反例推动修订'],
    [
      {
        title: '论证结构',
        content: '结论由哪些前提支持？中间推理是否有跳步？可以先写成编号前提和结论，再说明每一步连接。',
      },
      {
        title: '评价维度',
        content:
          '逻辑有效并不保证前提真实；前提可信也不自动保证推理有效。反例可以针对推理形式、前提或概念边界，需说明具体针对哪里。',
      },
    ],
    [
      t('claim', '待讨论主张'),
      t('premises', '编号前提'),
      t('inference', '推理步骤'),
      t('objection', '最强反例或异议'),
      t('reply', '回应与修订'),
      t('remaining', '仍未解决的问题'),
    ],
    {
      claim: '所有适合记忆的学习内容都可以用同一种复习方式。',
      premises: 'P1：许多事实可以通过反复回忆保持。P2：不同内容的表现形式可以转换。',
      inference: '从部分事实的复习经验推广到所有内容，这一步需要额外前提。',
      objection: '需要技能操作、证明构造或创作判断的内容，可能不能只用事实回忆方式。',
      reply: '将主张限定为特定事实性目标，并分别讨论技能与推理任务。',
      remaining: '如何定义“适合记忆”和“同一种方式”？有哪些实证材料可比较？',
    },
  ),
  workspace(
    'translation-studio',
    '翻译策略与术语表',
    ['subject-literature'],
    '并置源文、译文、术语和修订理由，自动核对术语是否在对应文本中出现。',
    ['根据目的与读者选择表达', '保持重要术语的一致性', '记录无法一一对应的取舍'],
    [
      {
        title: '目的与语境',
        content: '译文选择受到读者、文体和使用目的影响。词典对应词不能直接代替句子中具体的语义和功能。',
      },
      {
        title: '术语复核',
        content:
          '词表检查只提示给定术语的字符串是否出现，不判断译文是否准确或自然。需结合上下文、原作者意图和人工讨论。',
      },
    ],
    [
      t('purpose', '用途与目标读者'),
      t('source', '源文'),
      t('translation', '译文'),
      t('terms', '术语表', 'JSON[{source,target}]，最多30条', 'json'),
      t('decisions', '主要取舍与修订理由'),
      t('uncertainty', '待确认表达'),
    ],
    {
      purpose: '面向初学者的课程说明。',
      source: 'Machine learning models should be evaluated on data not used for fitting.',
      translation: '机器学习模型应使用未参与拟合的数据进行评估。',
      terms: '[{"source":"machine learning","target":"机器学习"},{"source":"fitting","target":"拟合"}]',
      decisions: '用“未参与拟合”保持数据范围清晰，避免泛化为所有未见场景。',
      uncertainty: '是否需解释训练集与测试集，取决于读者已有知识。',
    },
  ),
  workspace(
    'design-portfolio',
    '设计作品集与过程证据',
    ['subject-art'],
    '整理任务、探索、选择、验证和修订，让作品集展示思考过程与成果。',
    ['从任务说明设计目标', '以过程资料支持选择', '记录验证反馈及修订'],
    [
      {
        title: '过程不是装饰',
        content:
          '作品集应解释需求、备选、选择依据与验证。每张图或每段说明都应帮助读者理解决策，而不只是增加页数。',
      },
      {
        title: '验证与反思',
        content:
          '把反馈来源、方法、观察和改变联系起来。可读性、尺度与任务符合度等工具检查只覆盖部分问题，仍需真实用户或课程评价。',
      },
    ],
    [
      t('brief', '任务与受众'),
      t('exploration', '备选与探索记录'),
      t('decision', '选择依据'),
      t('evidence', '原型、测量与验证证据'),
      t('revision', '收到的反馈与修订'),
      t('reflection', '结果、限制与下一步'),
    ],
    {
      brief: '为专业学习中心设计能在手机阅读的模块卡片。',
      exploration: '比较图标突出、学科突出与任务突出三种信息顺序。',
      decision: '选择任务优先，便于读者知道进入后能完成什么。',
      evidence: '记录390px测试、标题换行、触达按钮和颜色对比数值。',
      revision: '缩短说明，调整间距，保持按钮可见并减少横向滚动。',
      reflection: '布局检查通过不等于所有用户都容易理解，还需课程用户访谈。',
    },
  ),
];

export const quizModules: StudyModule[] = [
  m({
    id: 'anatomy-quiz',
    title: '基础解剖与循环知识练习',
    kind: 'quiz',
    subjectIds: ['subject-medicine', 'subject-science'],
    tags: ['解剖', '知识练习'],
    description: '练习心脏结构与循环路径的基础课程概念，提交后逐题显示解释。',
    learningObjectives: ['识别心脏腔室', '区分肺循环与体循环', '把结构与血流方向对应'],
    concepts: [
      {
        title: '结构与路径',
        content: '心脏有左右心房和左右心室。学习时沿血液经过的结构画箭头，比只记名称更有助于理解方向。',
      },
      {
        title: '课程用途',
        content:
          '这些题目只检查基础解剖概念，不讨论个人疾病、诊断或治疗。先作答，再阅读解释，并核对课程原文。',
      },
    ],
    fields: [],
    defaultValues: { answers: {} },
    questions: [
      {
        id: 'chambers',
        prompt: '正常心脏共有多少个腔室？',
        choices: [
          { id: 'a', label: '2个' },
          { id: 'b', label: '3个' },
          { id: 'c', label: '4个' },
          { id: 'd', label: '6个' },
        ],
        correctChoiceId: 'c',
        explanation: '左右心房、左右心室，共4个腔室。',
      },
      {
        id: 'pulmonary',
        prompt: '肺循环中，从心脏向肺动脉送出血液的腔室是？',
        choices: [
          { id: 'a', label: '右心室' },
          { id: 'b', label: '左心室' },
          { id: 'c', label: '左心房' },
          { id: 'd', label: '右心房' },
        ],
        correctChoiceId: 'a',
        explanation: '右心室经肺动脉干把血液送入肺循环。',
      },
      {
        id: 'return',
        prompt: '从肺返回心脏的血液首先进入？',
        choices: [
          { id: 'a', label: '右心房' },
          { id: 'b', label: '左心房' },
          { id: 'c', label: '右心室' },
          { id: 'd', label: '主动脉' },
        ],
        correctChoiceId: 'b',
        explanation: '肺静脉将血液送入左心房。',
      },
      {
        id: 'systemic',
        prompt: '向主动脉送出血液的腔室是？',
        choices: [
          { id: 'a', label: '左心房' },
          { id: 'b', label: '右心房' },
          { id: 'c', label: '右心室' },
          { id: 'd', label: '左心室' },
        ],
        correctChoiceId: 'd',
        explanation: '左心室收缩把血液送入主动脉和体循环。',
      },
      {
        id: 'valve',
        prompt: '心脏瓣膜在正常血流中的主要作用是？',
        choices: [
          { id: 'a', label: '产生血细胞' },
          { id: 'b', label: '帮助维持单向流动' },
          { id: 'c', label: '交换氧气' },
          { id: 'd', label: '储存消化酶' },
        ],
        correctChoiceId: 'b',
        explanation: '瓣膜随压力差开闭，帮助限制回流并维持血液方向。',
      },
      {
        id: 'coronary',
        prompt: '为心肌提供自身供血的循环称为？',
        choices: [
          { id: 'a', label: '冠状循环' },
          { id: 'b', label: '消化循环' },
          { id: 'c', label: '淋巴循环' },
          { id: 'd', label: '脑脊液循环' },
        ],
        correctChoiceId: 'a',
        explanation: '冠状血管为心肌提供血液，结构名称应与供血对象对应。',
      },
    ],
    resources: [
      {
        title: 'OpenStax：心脏解剖',
        url: 'https://openstax.org/books/anatomy-and-physiology-2e/pages/19-1-heart-anatomy',
      },
    ],
  }),
  m({
    id: 'language-lab',
    title: '学术英语与表达练习',
    kind: 'quiz',
    subjectIds: ['subject-literature'],
    tags: ['英语', '学术表达'],
    description: '通过原创语境题练习论证、证据、谨慎表达和基本语法，作答后查看解释。',
    learningObjectives: ['识别学术表达的功能', '区分相关与因果措辞', '核对主谓和数量表达'],
    concepts: [
      {
        title: '功能优先',
        content:
          '先判断句子要提出主张、描述方法、展示证据还是限定结论，再选择词语。不能只依据一个词的中文译法答题。',
      },
      {
        title: '谨慎表达',
        content: '当证据有限时，可能、提示或在本样本中等限定语帮助保持结论范围。语法正确也不能保证事实可靠。',
      },
    ],
    fields: [],
    defaultValues: { answers: {} },
    questions: [
      {
        id: 'evidence',
        prompt: 'Which word best completes: “We need more ___ to support the claim.”',
        choices: [
          { id: 'a', label: 'evidence' },
          { id: 'b', label: 'evidences' },
          { id: 'c', label: 'evident' },
          { id: 'd', label: 'evidently' },
        ],
        correctChoiceId: 'a',
        explanation: '这里evidence作不可数名词，表示支持主张的证据。',
      },
      {
        id: 'cautious',
        prompt: 'A small observational sample shows an association. Which wording best preserves that limit?',
        choices: [
          { id: 'a', label: 'X definitely causes Y in everyone.' },
          { id: 'b', label: 'X and Y were associated in this sample.' },
          { id: 'c', label: 'No further evidence is needed.' },
          { id: 'd', label: 'The result proves every case.' },
        ],
        correctChoiceId: 'b',
        explanation: '观察样本中的相关不能直接推出普遍因果，B保留样本与关系的范围。',
      },
      {
        id: 'contrast',
        prompt: '“The method is fast. ___, it requires extra memory.” Choose a contrast connector.',
        choices: [
          { id: 'a', label: 'For example' },
          { id: 'b', label: 'Similarly' },
          { id: 'c', label: 'However' },
          { id: 'd', label: 'Therefore' },
        ],
        correctChoiceId: 'c',
        explanation: 'However引入相对的限制；therefore通常表示结果或推论。',
      },
      {
        id: 'agreement',
        prompt: 'Choose the grammatical sentence.',
        choices: [
          { id: 'a', label: 'Each participant complete the task.' },
          { id: 'b', label: 'Each participant completes the task.' },
          { id: 'c', label: 'Each participants completes the task.' },
          { id: 'd', label: 'Each participant completing task.' },
        ],
        correctChoiceId: 'b',
        explanation: 'Each participant作单数主语，一般现在时谓语用completes。',
      },
      {
        id: 'method',
        prompt: 'Which sentence describes a method rather than a conclusion?',
        choices: [
          { id: 'a', label: 'The result was surprising.' },
          { id: 'b', label: 'The hypothesis is universally true.' },
          { id: 'c', label: 'We measured each sample three times.' },
          { id: 'd', label: 'The model is the best possible model.' },
        ],
        correctChoiceId: 'c',
        explanation: 'C说明测量次数与操作过程，可供复核。',
      },
      {
        id: 'limitation',
        prompt: '“These findings may not ___ to other groups.”',
        choices: [
          { id: 'a', label: 'generalize' },
          { id: 'b', label: 'general' },
          { id: 'c', label: 'generally' },
          { id: 'd', label: 'generality' },
        ],
        correctChoiceId: 'a',
        explanation: 'may not后接动词原形generalize，表示结果未必可推广。',
      },
    ],
    resources: [],
  }),
];
