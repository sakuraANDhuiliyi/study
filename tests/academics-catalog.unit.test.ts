import test from 'node:test';
import assert from 'node:assert/strict';
import { BadRequestException } from '@nestjs/common';
import { academicModules } from '../apps/api/src/academics/academics.modules';
import { academicSubjects, academicMajors } from '../apps/api/src/academics/academics.catalog';
import {
  evaluateAcademicModule,
  publicAcademicModule,
  validateModuleValues,
} from '../apps/api/src/academics/academics.engine';

test('学科、专业和学习模块的引用完整且内容可实际打开', () => {
  const subjectIds = new Set(academicSubjects.map((subject) => subject.id));
  const moduleIds = new Set(academicModules.map((module) => module.id));
  assert.equal(subjectIds.size, academicSubjects.length);
  assert.equal(new Set(academicMajors.map((major) => major.id)).size, academicMajors.length);
  assert.equal(moduleIds.size, academicModules.length);
  for (const major of academicMajors) {
    assert.ok(subjectIds.has(major.subjectId), major.id);
    assert.ok(major.moduleIds.length >= 2, major.id);
    assert.equal(new Set(major.moduleIds).size, major.moduleIds.length, major.id);
    for (const id of major.moduleIds) assert.ok(moduleIds.has(id), `${major.id}: ${id}`);
  }
  for (const module of academicModules) {
    assert.ok(
      module.learningObjectives.length &&
        module.concepts.length &&
        module.instructions.length &&
        module.examples.length,
      module.id,
    );
    for (const id of module.subjectIds) assert.ok(subjectIds.has(id), module.id);
    assert.equal(new Set(module.fields.map((field) => field.key)).size, module.fields.length, module.id);
    validateModuleValues(module, module.defaultValues);
    for (const example of module.examples) validateModuleValues(module, example.values);
  }
});

test('每个公开起步例和扩展示例都由真实工具处理并产生有限、受限的结果', async () => {
  let evaluated = 0;
  for (const module of academicModules) {
    if (module.kind === 'algorithm') continue;
    for (const example of module.examples) {
      const output = await evaluateAcademicModule(module, structuredClone(example.values));
      assert.ok(output.summary.length && output.sections.length, module.id);
      const walk = (value: unknown) => {
        if (typeof value === 'number') assert.ok(Number.isFinite(value), module.id);
        else if (Array.isArray(value)) value.forEach(walk);
        else if (value && typeof value === 'object') Object.values(value).forEach(walk);
      };
      walk(output);
      assert.ok(Buffer.byteLength(JSON.stringify(output)) <= 262144, module.id);
      evaluated++;
    }
  }
  assert.ok(evaluated >= academicModules.length - 1);
});

test('测验GET投影没有答案或解析，提交后才提供解析并严格校验题目与选项', async () => {
  const quizzes = academicModules.filter((module) => module.kind === 'quiz');
  assert.ok(quizzes.length >= 2);
  for (const module of quizzes) {
    const publicDetail = publicAcademicModule(module);
    const payload = JSON.stringify(publicDetail.questions);
    assert.ok(!payload.includes('correctChoiceId') && !payload.includes('explanation'));
    const answers = Object.fromEntries(
      module.questions!.map((question) => [question.id, question.correctChoiceId]),
    );
    const output = await evaluateAcademicModule(module, { answers });
    assert.equal(
      output.metrics.find((metric) => metric.label === '正确题数')?.value,
      module.questions!.length,
    );
    assert.ok(output.sections.every((section) => section.status === 'success'));
    await assert.rejects(evaluateAcademicModule(module, { answers: { unknown: 'a' } }), BadRequestException);
    await assert.rejects(
      evaluateAcademicModule(module, { answers: { [module.questions![0].id]: 'invalid' } }),
      BadRequestException,
    );
  }
});

test('入口拒绝错误字段、类型、非有限值、过大内容和算法伪执行', async () => {
  const module = academicModules.find((module) => module.id === 'circuit-lab')!;
  for (const values of [
    { ...module.defaultValues, unexpected: true },
    { ...module.defaultValues, voltage: '12' },
    { ...module.defaultValues, voltage: Infinity },
    { ...module.defaultValues, voltage: 1e20 },
    { ...module.defaultValues, mode: 'unsupported' },
    { ...module.defaultValues, resistances: ' '.repeat(65537) },
  ])
    await assert.rejects(evaluateAcademicModule(module, values), BadRequestException);
  await assert.rejects(
    evaluateAcademicModule(
      academicModules.find((module) => module.kind === 'algorithm')!,
      {},
    ),
    BadRequestException,
  );
});
