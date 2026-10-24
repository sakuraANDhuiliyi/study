import 'reflect-metadata';
import test from 'node:test';
import assert from 'node:assert/strict';
import { z } from 'zod';
import {
  questionPatchSchema,
  assignmentPatchSchema,
  examPatchSchema,
} from '../apps/api/src/assessment/assessment.schemas';
import { taskPatch } from '../apps/api/src/planner/planner.schemas';
import { academicMajorPatch } from '../apps/api/src/academics/academics.schemas';
import { strictJsonSchema } from '../apps/api/src/ai-study/ai.gateway';
test('oversized constrained arrays, sets and maps stop before parsing child values', () => {
  let children = 0;
  const element = z.preprocess((value) => {
    children++;
    return value;
  }, z.string());
  const schemas: [z.ZodType, unknown][] = [
    [z.array(element).max(2), Array(5000).fill(1)],
    [z.set(element).max(2), new Set([1, 2, 3])],
    [
      z.map(element, element).max(2),
      new Map([
        [1, 1],
        [2, 2],
        [3, 3],
      ]),
    ],
  ];
  for (const [schema, value] of schemas) {
    const parsed = schema.safeParse(value);
    assert.equal(parsed.success, false);
    if (parsed.success) throw new Error('Oversized collection accepted');
    assert.equal(parsed.error.issues.length, 1);
    assert.equal(parsed.error.issues[0].code, 'too_big');
  }
  assert.equal(children, 0);
});
test('Zod4 PATCH validation preserves omissions instead of applying create defaults', () => {
  assert.deepEqual(questionPatchSchema.parse({ expectedVersion: 1, active: false }), {
    expectedVersion: 1,
    active: false,
  });
  assert.deepEqual(assignmentPatchSchema.parse({ revision: 0, title: 'Updated' }), {
    revision: 0,
    title: 'Updated',
  });
  assert.deepEqual(examPatchSchema.parse({ revision: 0, title: 'Updated' }), {
    revision: 0,
    title: 'Updated',
  });
  assert.deepEqual(taskPatch.parse({ revision: 0, completed: true }), { revision: 0, completed: true });
  assert.deepEqual(academicMajorPatch.parse({ revision: 0, active: false }), { revision: 0, active: false });
  assert.equal(questionPatchSchema.safeParse({ expectedVersion: 1, options: 'invalid' }).success, false);
  assert.equal(taskPatch.safeParse({ revision: 0, completed: 'true' }).success, false);
});
test('AI strict JSON conversion uses public Zod4 object, array, enum and string shapes', () => {
  const value = z
    .object({
      items: z.array(
        z
          .object({
            kind: z.enum(['hint', 'explain']),
            body: z
              .string()
              .min(1)
              .refine((v) => !v.includes('\0')),
          })
          .strict(),
      ),
    })
    .strict()
    .refine((v) => v.items.length < 5);
  assert.deepEqual(strictJsonSchema(value), {
    type: 'object',
    properties: {
      items: {
        type: 'array',
        items: {
          type: 'object',
          properties: { kind: { type: 'string', enum: ['hint', 'explain'] }, body: { type: 'string' } },
          required: ['kind', 'body'],
          additionalProperties: false,
        },
      },
    },
    required: ['items'],
    additionalProperties: false,
  });
  assert.throws(() => strictJsonSchema(z.number()));
});
