import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { runInNewContext } from 'node:vm';
import { resolve } from 'node:path';
import {
  bulkAlgorithmContents,
  bulkReferencePrograms,
} from '../apps/api/src/algorithms/algorithms.catalog-bulk';
import { bulkExampleReasoning } from '../apps/api/src/algorithms/algorithms.editorials-bulk-walkthrough';
import { bulkAlgorithmLimitCases } from '../apps/api/src/algorithms/algorithms.catalog-bulk-limits';
import { bulkAlgorithmDefinitions } from '../apps/api/src/algorithms/algorithms.catalog-bulk-data';
import { algorithmProblems } from '../apps/api/src/algorithms/algorithms.catalog';

const normalize = (value: string) => value.trimEnd();

test('every original expansion problem has independently verified fixtures and executable JavaScript reference', () => {
  assert.ok(bulkAlgorithmContents.length >= 100);
  const rows = bulkAlgorithmDefinitions.flatMap((problem) => [
    ...problem.examples.map(({ input, output }) => ({ id: problem.id, input, output })),
    ...problem.hiddenCases.map(([input, output]) => ({ id: problem.id, input, output })),
  ]);
  const independent = spawnSync('python3', [resolve('tests/helpers/algorithm_bulk_oracles.py')], {
    input: JSON.stringify(rows),
    encoding: 'utf8',
    timeout: 30_000,
    maxBuffer: 4 * 1048576,
  });
  assert.equal(independent.status, 0, independent.stderr);
  const expected: string[] = JSON.parse(independent.stdout);
  assert.equal(expected.length, rows.length);
  rows.forEach((row, index) => {
    assert.equal(normalize(expected[index]), normalize(row.output), `${row.id}: independent oracle`);
    const output: string[] = [];
    runInNewContext(
      bulkReferencePrograms[row.id],
      {
        require(name: string) {
          assert.equal(name, 'fs');
          return {
            readFileSync(fd: number) {
              assert.equal(fd, 0);
              return row.input;
            },
          };
        },
        console: {
          log(value: unknown) {
            output.push(String(value));
          },
        },
      },
      { timeout: 3000 },
    );
    assert.equal(normalize(output.join('\n')), normalize(row.output), `${row.id}: executable JS reference`);
  });
});

test('expansion preserves stable first 19 numbers and covers distinct statements with source concepts', () => {
  assert.equal(algorithmProblems[0].id, 'sum-of-two');
  assert.equal(algorithmProblems[18].id, 'minimum-spanning-tree');
  assert.equal(
    new Set(bulkAlgorithmContents.map((problem) => problem.id)).size,
    bulkAlgorithmContents.length,
  );
  assert.equal(
    new Set(bulkAlgorithmContents.map((problem) => problem.description)).size,
    bulkAlgorithmContents.length,
  );
  for (const problem of bulkAlgorithmContents) {
    assert.equal(
      bulkExampleReasoning[problem.id]?.length,
      2,
      `${problem.id}: public sample-specific walkthrough`,
    );
    assert.ok(problem.hiddenCases.length >= 4 && problem.hiddenCases.length <= 9);
    assert.ok(problem.sourceReferences?.every((source) => source.concept && /^https:\/\//.test(source.url)));
    assert.deepEqual(Object.keys(algorithmProblems.find((p) => p.id === problem.id)!.starterCode).sort(), [
      'cpp',
      'java',
      'javascript',
      'python',
    ]);
  }
});

// Large fixture answers follow the documented constant/chain constructions rather than slow brute force.
test('constructed maximum-scale boundaries also pass the executable trusted references', () => {
  assert.ok(Object.keys(bulkAlgorithmLimitCases).length >= 60);
  for (const [id, cases] of Object.entries(bulkAlgorithmLimitCases))
    for (const [input, expected] of cases) {
      const output: string[] = [];
      runInNewContext(
        bulkReferencePrograms[id],
        {
          require(name: string) {
            assert.equal(name, 'fs');
            return {
              readFileSync() {
                return input;
              },
            };
          },
          console: {
            log(value: unknown) {
              output.push(String(value));
            },
          },
        },
        { timeout: 5000 },
      );
      assert.equal(normalize(output.join('\n')), normalize(expected), id);
    }
});
