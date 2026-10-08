import { BadRequestException } from '@nestjs/common';
import { evaluateEngineeringModule } from './tools-engineering';
import { evaluateScienceModule } from './tools-science';
import { evaluateBusinessModule } from './tools-business';
import { evaluateWorkspaceModule } from './tools-workspace';
import { runSqlLab } from './sql-lab';
import { ensureJson } from './tool-utils';
import { result } from './academics.types';
import type { StudyModule, StudyResult } from './academics.types';

export function publicAcademicModule(module: StudyModule) {
  return {
    id: module.id,
    title: module.title,
    description: module.description,
    kind: module.kind,
    subjectIds: module.subjectIds,
    tags: module.tags,
    estimatedMinutes: module.estimatedMinutes,
    learningObjectives: module.learningObjectives,
    concepts: module.concepts,
    instructions: module.instructions,
    fields: module.fields,
    defaultValues: module.defaultValues,
    examples: module.examples,
    resources: module.resources,
    ...(module.questions
      ? { questions: module.questions.map((q) => ({ id: q.id, prompt: q.prompt, choices: q.choices })) }
      : {}),
  };
}
export function validateModuleValues(module: StudyModule, values: Record<string, unknown>) {
  ensureJson(values, 65536);
  const allowed =
    module.kind === 'quiz' ? new Set(['answers']) : new Set(module.fields.map((field) => field.key));
  if (Object.keys(values).some((key) => !allowed.has(key)))
    throw new BadRequestException('输入包含本模块不支持的字段');
  for (const field of module.fields) {
    const value = values[field.key];
    if ((value === undefined || value === null || value === '') && !field.required) continue;
    if (
      field.required &&
      (value === undefined || value === null || (typeof value === 'string' && !value.trim()))
    )
      throw new BadRequestException(`请填写${field.label}`);
    if (
      field.type === 'number' &&
      (typeof value !== 'number' ||
        !Number.isFinite(value) ||
        (field.min !== undefined && value < field.min) ||
        (field.max !== undefined && value > field.max))
    )
      throw new BadRequestException(`${field.label}数值超出范围`);
    if (
      ['text', 'textarea', 'select'].includes(field.type) &&
      (typeof value !== 'string' || value.length > 12000 || value.includes('\0'))
    )
      throw new BadRequestException(`${field.label}需要有效文本`);
    if (field.type === 'checkbox' && value !== undefined && typeof value !== 'boolean')
      throw new BadRequestException(`${field.label}需要布尔值`);
    if (field.type === 'select' && !field.options?.some((option) => option.value === value))
      throw new BadRequestException(`${field.label}选项无效`);
  }
}
function quiz(module: StudyModule, values: Record<string, unknown>): StudyResult {
  const answers = values.answers;
  if (!answers || typeof answers !== 'object' || Array.isArray(answers))
    throw new BadRequestException('请提交题目选择');
  const submitted = answers as Record<string, unknown>,
    questions = module.questions || [];
  if (Object.keys(submitted).some((key) => !questions.some((q) => q.id === key)))
    throw new BadRequestException('含未知题目');
  let correct = 0,
    answered = 0;
  const sections = questions.map((q, index) => {
    const selected = submitted[q.id];
    if (selected !== undefined && !q.choices.some((c) => c.id === selected))
      throw new BadRequestException('选项无效');
    if (selected !== undefined) answered++;
    const right = selected === q.correctChoiceId;
    if (right) correct++;
    const label = q.choices.find((c) => c.id === q.correctChoiceId)?.label;
    return {
      title: `第${index + 1}题：${right ? '正确' : selected === undefined ? '未作答' : '需要复习'}`,
      content: `${q.prompt}\n参考选择：${label}\n${q.explanation}`,
      status: right ? ('success' as const) : ('warning' as const),
    };
  });
  return result(
    `完成本次知识练习，${correct}/${questions.length}题正确。`,
    [
      { label: '正确题数', value: correct },
      { label: '题目总数', value: questions.length },
      { label: '已作答', value: answered },
    ],
    sections,
  );
}
export async function evaluateAcademicModule(
  module: StudyModule,
  values: Record<string, unknown>,
): Promise<StudyResult> {
  validateModuleValues(module, values);
  let output: StudyResult | undefined;
  if (module.kind === 'algorithm') throw new BadRequestException('请进入算法练习工作台运行和提交代码');
  if (module.kind === 'sql') output = await runSqlLab(values);
  else if (module.kind === 'quiz') output = quiz(module, values);
  else if (module.kind === 'workspace') output = evaluateWorkspaceModule(module, values);
  else
    output =
      evaluateEngineeringModule(module.id, values) ??
      evaluateScienceModule(module.id, values) ??
      evaluateBusinessModule(module.id, values);
  if (!output) throw new BadRequestException('本模块暂未提供该练习');
  ensureJson(output, 262144);
  return output;
}
