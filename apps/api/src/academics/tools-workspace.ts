import { z } from 'zod';
import { result, table } from './academics.types';
import type { StudyModule, StudyResult } from './academics.types';
import { ensureJson, fail, metric, num, parsed, rounded, str } from './tool-utils';
import type { Inputs } from './tool-utils';
import { moneyCents, moneyText } from './tools-business';

const text = (max = 1000) =>
  z
    .string()
    .trim()
    .min(1)
    .max(max)
    .refine((value) => !value.includes('\0'), '文本不能包含空字符');
const reflection: Record<string, string[]> = {
  'study-notebook': ['哪些内容是你自己的解释，哪些仍需查证？', '下次怎样用一道题或一次复述检查理解？'],
  'research-planning': ['方法产生的证据能直接回应研究问题吗？', '什么结果会让你修改当前假设？'],
  'software-design': ['验收用例是否覆盖权限、失败、恢复与并发？', '别人能按记录重现用户的问题吗？'],
  'architecture-studio': [
    '空间面积是否同时包含交通与支持区域？',
    '面积符合预算后，哪些流线与课程约束仍需绘图核对？',
  ],
  'clinical-reading': ['结果的不确定性和样本选择怎样限制结论？', '你能回到原资料定位每一项观察吗？'],
  'nursing-observation': ['哪些描述是直接给定的事实，哪些属于推测？', '交接是否保留时间、来源和待核实事项？'],
  'writing-studio': ['证据与主张之间的推理是否明确？', '你的回应是否正面处理了最强的反方理由？'],
  'literature-reading': ['当前解释由哪些具体词句支持？', '另一种解读能否解释同一处文本？'],
  'education-design': [
    '每个活动的观察或产出能否检验对应学习目标？',
    '计划时间是否为过渡和学生提问留出空间？',
  ],
  'psychology-design': ['变量的操作定义能被其他人重复测量吗？', '混淆因素、伦理与缺失数据怎样影响解释？'],
  'history-research': ['时间先后之外，有什么证据支持因果联系？', '来源冲突和纪年方式是否清楚保留？'],
  'legal-reasoning': ['你是否把课程假设规则与真实法律依据区分开？', '哪项尚未核实的事实最可能改变论证？'],
  'media-literacy': ['两个来源是否真正独立，而非互相转载？', '哪些主张仍应保留限定语或暂缓写入？'],
  'social-research': ['招募方式可能遗漏哪些群体？', '题目是否中性且一次只询问一个概念？'],
  'tourism-planning': ['活动之间的交通与缓冲是否都计入日程？', '预算哪些项目按人、按次或按其他单位计价？'],
  'philosophy-argument': ['推理有效性与前提可信性是否分别讨论？', '反例针对的是哪个前提或推理步骤？'],
  'translation-studio': [
    '出现相同术语是否足以保证语境中的意思一致？',
    '目标读者、文体和用途怎样影响你的表达选择？',
  ],
  'design-portfolio': ['每项设计决定是否都有可定位的过程证据？', '收到反馈后具体改动了什么，怎样复核效果？'],
};
const append = (base: StudyResult, extra: Partial<StudyResult>) => {
  if (extra.summary) base.summary += ` ${extra.summary}`;
  base.metrics.push(...(extra.metrics || []));
  base.sections.push(...(extra.sections || []));
  base.tables.push(...(extra.tables || []));
};
function architecture(v: Inputs): Partial<StudyResult> {
  const rooms = z
    .array(z.object({ name: text(120), area: z.number().finite().positive().max(1e7) }).strict())
    .min(1)
    .max(30)
    .parse(parsed(v, 'rooms'));
  const budget = num(v, 'areaBudget', 1, 1e7),
    total = rooms.reduce((sum, room) => sum + room.area, 0),
    over = total > budget;
  return {
    summary: over
      ? '空间总面积超出给定预算，请调整面积安排。'
      : '空间总面积在给定预算以内；其他设计要求仍待核验。',
    metrics: [
      metric('空间合计面积', rounded(total, 10), 'm²'),
      metric('剩余面积预算', rounded(budget - total, 10), 'm²'),
      metric('面积预算使用率', rounded((total / budget) * 100, 8), '%'),
    ],
    sections: [
      {
        title: '面积核对',
        content: over
          ? `超出${rounded(total - budget, 10)} m²；调整房间面积并核对交通及支持区域。`
          : '面积总量符合给定上限，不表示动线、尺度或课程给定规范已经合格。',
        status: over ? 'warning' : 'info',
      },
    ],
    tables: [
      table(
        '空间面积表',
        [
          ['index', '序号'],
          ['name', '空间'],
          ['area', '面积（m²）'],
        ],
        rooms.map((room, index) => ({ index: index + 1, ...room })),
      ),
    ],
  };
}
function education(v: Inputs): Partial<StudyResult> {
  const plan = z
    .array(
      z
        .object({
          phase: text(100),
          minutes: z.number().finite().positive().max(240),
          activity: text(1000),
          assessment: text(1000),
        })
        .strict(),
    )
    .min(1)
    .max(15)
    .parse(parsed(v, 'plan'));
  const budget = num(v, 'minutes', 1, 240),
    total = plan.reduce((sum, phase) => sum + phase.minutes, 0),
    over = total > budget;
  let elapsed = 0;
  return {
    summary: over ? '活动合计时长超过给定课时。' : '活动合计时长在给定课时以内。',
    metrics: [
      metric('活动总时长', rounded(total, 10), '分钟'),
      metric('课时剩余', rounded(budget - total, 10), '分钟'),
    ],
    sections: [
      {
        title: '时间分配',
        content: over
          ? `活动超时${rounded(total - budget, 10)}分钟；需要压缩内容或重新分配课时。`
          : `还剩${rounded(budget - total, 10)}分钟，可核对转场、提问与反馈安排。活动有评价栏目只说明结构存在，不证明评价方法有效。`,
        status: over ? 'warning' : 'info',
      },
    ],
    tables: [
      table(
        '教学活动时间表',
        [
          ['phase', '阶段'],
          ['start', '开始（分钟）'],
          ['end', '结束（分钟）'],
          ['activity', '活动'],
          ['assessment', '评价依据'],
        ],
        plan.map((phase) => {
          const start = elapsed;
          elapsed += phase.minutes;
          return {
            phase: phase.phase,
            start: rounded(start, 10),
            end: rounded(elapsed, 10),
            activity: phase.activity,
            assessment: phase.assessment,
          };
        }),
      ),
    ],
  };
}
function history(v: Inputs): Partial<StudyResult> {
  const events = z
    .array(
      z
        .object({ year: z.number().int().min(-1000000).max(1000000), title: text(300), source: text(1000) })
        .strict(),
    )
    .min(1)
    .max(30)
    .parse(parsed(v, 'timeline'));
  const ordered = events
    .map((event, index) => ({ ...event, originalOrder: index + 1 }))
    .sort((a, b) => a.year - b.year || a.originalOrder - b.originalOrder);
  return {
    summary: '事件已按给定整数年份排序，同年事件保留输入顺序与各自来源。',
    metrics: [
      metric('事件数', ordered.length),
      metric('最早年份', ordered[0].year),
      metric('最晚年份', ordered.at(-1)!.year),
    ],
    sections: [
      {
        title: '年代与来源',
        content:
          '排序仅整理输入，不验证事件真实性，也不把先后关系判定为因果。若使用负数或0，请在来源中说明纪年约定；来源不同的同年事件不会合并。',
        status: 'info',
      },
    ],
    tables: [
      table(
        '年代顺序',
        [
          ['year', '输入年份'],
          ['title', '事件'],
          ['source', '来源'],
          ['originalOrder', '原始序号'],
        ],
        ordered,
      ),
    ],
  };
}
function tourism(v: Inputs): Partial<StudyResult> {
  const itinerary = z
    .array(z.object({ activity: text(200), minutes: z.number().finite().positive().max(1440) }).strict())
    .min(1)
    .max(30)
    .parse(parsed(v, 'itinerary'));
  const budget = z
    .array(
      z
        .object({ item: text(200), unitPrice: z.number(), quantity: z.number().finite().positive().max(1e6) })
        .strict(),
    )
    .min(1)
    .max(30)
    .parse(parsed(v, 'budget'));
  const people = num(v, 'people', 1, 1000, true);
  let totalCents = 0;
  const costs = budget.map((line) => {
    const cents = moneyCents(line.unitPrice, '预算单价', 1e6);
    if (!/^\d+(?:\.\d{1,3})?$/.test(String(line.quantity))) fail('预算数量最多保留三位小数');
    const quantityMilli = BigInt(Math.round(line.quantity * 1000));
    const lineCents = Number((BigInt(cents) * quantityMilli + 500n) / 1000n);
    totalCents += lineCents;
    return {
      item: line.item,
      unitPrice: moneyText(cents),
      quantity: line.quantity,
      total: moneyText(lineCents),
    };
  });
  let elapsed = 0;
  const agenda = itinerary.map((entry) => {
    const start = elapsed;
    elapsed += entry.minutes;
    return {
      activity: entry.activity,
      minutes: entry.minutes,
      start: rounded(start, 10),
      end: rounded(elapsed, 10),
    };
  });
  return {
    summary: '活动日程和预算已按输入逐项核算。',
    metrics: [
      metric('日程合计', rounded(elapsed, 10), '分钟'),
      metric('预算合计', moneyText(totalCents)),
      metric(
        '人均预算',
        moneyText(Number((BigInt(totalCents) * 2n + BigInt(people)) / (2n * BigInt(people)))),
      ),
      metric('参加人数', people),
    ],
    sections: [
      {
        title: '预算口径',
        content:
          '单价最多两位小数，数量最多三位小数；每项金额按四舍五入到分后合计。人均金额保留两位小数，显示的人均乘人数可能有分摊尾差。日程采用累计相对分钟，不推断现实交通时间或报价。',
        status: 'info',
      },
    ],
    tables: [
      table(
        '相对日程',
        [
          ['activity', '活动'],
          ['minutes', '时长（分钟）'],
          ['start', '累计开始'],
          ['end', '累计结束'],
        ],
        agenda,
      ),
      table(
        '预算逐项核算',
        [
          ['item', '项目'],
          ['unitPrice', '单价'],
          ['quantity', '数量'],
          ['total', '合计'],
        ],
        costs,
      ),
    ],
  };
}
function translation(v: Inputs): Partial<StudyResult> {
  const terms = z
    .array(z.object({ source: text(160), target: text(160) }).strict())
    .min(1)
    .max(30)
    .parse(parsed(v, 'terms'));
  const source = str(v, 'source').toLowerCase(),
    translated = str(v, 'translation').toLowerCase();
  const rows = terms.map((term) => ({
    ...term,
    sourcePresent: source.includes(term.source.toLowerCase()),
    targetPresent: translated.includes(term.target.toLowerCase()),
  }));
  const present = rows.filter((row) => row.sourcePresent && row.targetPresent).length;
  return {
    summary: `已核对${terms.length}条术语的字面出现情况，${present}条在对应文本中均有匹配字符串。`,
    metrics: [metric('术语条数', terms.length), metric('两侧均出现的术语数', present)],
    sections: [
      {
        title: '术语检查边界',
        content:
          '这里只进行不区分大小写的字面子串查找，不验证词语边界、实际对应关系、语义、译文准确性或表达自然度。字符串出现不能当作翻译正确评分。',
        status: present === terms.length ? 'info' : 'warning',
      },
    ],
    tables: [
      table(
        '术语逐项核对',
        [
          ['source', '源语术语'],
          ['target', '目标术语'],
          ['sourcePresent', '源文出现'],
          ['targetPresent', '译文出现'],
        ],
        rows,
      ),
    ],
  };
}
function notebook(v: Inputs): Partial<StudyResult> {
  const title = str(v, 'title', 160),
    body = str(v, 'body'),
    tagText = str(v, 'tags', 1000, false),
    nextAction = str(v, 'nextAction', 12000, false);
  const tags = [
    ...new Set(
      tagText
        .split(/[,，]/)
        .map((tag) => tag.trim())
        .filter(Boolean),
    ),
  ];
  if (tags.length > 20 || tags.some((tag) => tag.length > 40)) fail('标签最多20个，每个最多40字符');
  return {
    summary: '独立学习笔记已整理，可在当前学习空间的记录中继续复盘。',
    metrics: [metric('标签数', tags.length)],
    sections: [
      { title: '笔记主题', content: title },
      {
        title: '正文预览',
        content:
          body.length > 1200 ? `${body.slice(0, 1200)}\n（预览截断，完整正文保留在记录输入中。）` : body,
      },
      {
        title: '下一步行动',
        content: nextAction || '尚未填写。可以补充一次复述、一个边界测试或一条待查来源。',
        status: nextAction ? 'info' : 'warning',
      },
    ],
    tables: [
      table(
        '笔记标签',
        [['tag', '标签']],
        tags.map((tag) => ({ tag })),
      ),
    ],
  };
}
const specialized: Record<string, (values: Inputs) => Partial<StudyResult>> = {
  'architecture-studio': architecture,
  'education-design': education,
  'history-research': history,
  'tourism-planning': tourism,
  'translation-studio': translation,
  'study-notebook': notebook,
};
export function evaluateWorkspaceModule(module: StudyModule, values: Inputs): StudyResult {
  if (module.kind !== 'workspace') fail('此处理器仅接受学习工作台模块');
  ensureJson(values, 65536);
  if (
    !values ||
    typeof values !== 'object' ||
    Array.isArray(values) ||
    Object.keys(values).some((key) => !module.fields.some((field) => field.key === key))
  )
    fail('工作台包含不支持的字段');
  let characters = 0,
    paragraphs = 0;
  const missing: string[] = [];
  const rows = module.fields.map((field) => {
    const value = values[field.key];
    if (!field.required && (value === undefined || value === '')) {
      missing.push(field.label);
      return { field: field.label, length: 0, paragraphs: 0, preview: '未填写（选填）' };
    }
    if (field.type === 'number') {
      const numeric = num(values, field.key, field.min, field.max);
      return { field: field.label, length: 0, paragraphs: 0, preview: String(numeric) };
    }
    if (field.type === 'json') {
      if (typeof value === 'string') str(values, field.key, 12000);
      const object = parsed(values, field.key);
      ensureJson(object, 36000);
      const serialized = JSON.stringify(object);
      if (serialized.length > 12000) fail(`${field.label}的JSON最多12000字符`);
      return {
        field: field.label,
        length: serialized.length,
        paragraphs: 0,
        preview: serialized.length > 240 ? `${serialized.slice(0, 240)}…` : serialized,
      };
    }
    const source = str(values, field.key, 12000, field.required !== false);
    const size = [...source].length,
      paragraphCount = source ? source.split(/\r?\n\s*\r?\n/).filter((line) => line.trim()).length : 0;
    characters += size;
    paragraphs += paragraphCount;
    return {
      field: field.label,
      length: size,
      paragraphs: paragraphCount,
      preview: source.length > 240 ? `${source.slice(0, 240)}…` : source,
    };
  });
  const output = result(
    '结构检查完成，必填栏目均已提供；内容质量需要人工讨论与复核。',
    [
      metric('必填栏目数', module.fields.filter((field) => field.required).length),
      metric('文本字符总数', characters),
      metric('文本段落数', paragraphs),
    ],
    [
      {
        title: '结构检查范围',
        content:
          '只核对字段类型、是否填写、文本长度和按空行分隔的段落，不计算写作质量分数，也不自动认定论证、来源或专业结论成立。',
        status: 'info',
      },
      {
        title: '可继续补充',
        content: missing.length
          ? `尚未填写的选填栏目：${missing.join('、')}。`
          : '当前栏目均已填写。下一步请核对证据、推理和领域约束，而不是仅增加文字数量。',
        status: missing.length ? 'warning' : 'info',
      },
      {
        title: '专业复盘问题',
        content: (
          reflection[module.id] || ['有哪些来源或步骤尚未核实？', '下一次如何检验并修订当前工作稿？']
        ).join('\n'),
      },
    ],
    [
      table(
        '栏目结构与预览',
        [
          ['field', '栏目'],
          ['length', '字符数'],
          ['paragraphs', '段落数'],
          ['preview', '内容预览'],
        ],
        rows,
      ),
    ],
  );
  if (Object.hasOwn(specialized, module.id)) append(output, specialized[module.id](values));
  ensureJson(output, 65536);
  return output;
}
