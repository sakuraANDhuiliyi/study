import test from 'node:test';
import assert from 'node:assert/strict';
import { BadRequestException } from '@nestjs/common';
import { engineeringModules } from '../apps/api/src/academics/academics.modules-engineering';
import { evaluateEngineeringModule } from '../apps/api/src/academics/tools-engineering';
import type { StudyResult } from '../apps/api/src/academics/academics.types';

const ids = [
  'subnet-lab',
  'cybersecurity-lab',
  'data-science',
  'circuit-lab',
  'digital-logic',
  'mechanics-lab',
  'civil-beam',
  'scale-lab',
  'design-contrast',
  'music-lab',
  'sports-analysis',
  'pharmacology-units',
];
function evaluate(id: string, overrides: Record<string, unknown> = {}) {
  const module = engineeringModules.find((item) => item.id === id);
  assert.ok(module, `Missing teaching module ${id}`);
  const output = evaluateEngineeringModule(id, { ...structuredClone(module.defaultValues), ...overrides });
  assert.ok(output, `Missing calculator ${id}`);
  return output;
}
function metric(output: StudyResult, label: string) {
  const value = output.metrics.find((item) => item.label === label)?.value;
  assert.equal(typeof value, 'number', `Missing numeric metric ${label}`);
  return value as number;
}
function rows(output: StudyResult, title: string) {
  const found = output.tables.find((item) => item.title === title);
  assert.ok(found, `Missing result table ${title}`);
  return found.rows;
}
function close(actual: number, expected: number, relative = 1e-6) {
  assert.ok(Number.isFinite(actual));
  assert.ok(
    Math.abs(actual - expected) <= Math.max(1, Math.abs(expected)) * relative,
    `${actual} differs from ${expected}`,
  );
}
function rejected(id: string, overrides: Record<string, unknown>) {
  assert.throws(
    () => evaluate(id, overrides),
    (error) => error instanceof BadRequestException && error.getStatus() === 400,
  );
}

test('all twelve engineering calculators accept their published default teaching inputs', () => {
  assert.equal(new Set(ids).size, 12);
  for (const id of ids) {
    const output = evaluate(id);
    assert.ok(output.summary.length > 0, id);
    assert.doesNotThrow(() => JSON.stringify(output));
    for (const item of output.metrics)
      if (typeof item.value === 'number') assert.ok(Number.isFinite(item.value), `${id}: ${item.label}`);
  }
  assert.equal(evaluateEngineeringModule('unknown-module', {}), undefined);
});

test('IPv4 /24 subdivision has four complete non-overlapping /26 blocks', () => {
  const output = evaluate('subnet-lab');
  assert.equal(metric(output, '地址总数'), 256);
  assert.equal(metric(output, '可用主机数'), 254);
  assert.equal(metric(output, '划分子网数'), 4);
  assert.deepEqual(
    rows(output, '子网划分').map((row) => [row.network, row.last, row.addresses]),
    [
      ['192.168.10.0/26', '192.168.10.63', 64],
      ['192.168.10.64/26', '192.168.10.127', 64],
      ['192.168.10.128/26', '192.168.10.191', 64],
      ['192.168.10.192/26', '192.168.10.255', 64],
    ],
  );
});

test('IPv4 /0 counts are exact integers; /31 and /32 preserve point-to-point and host semantics', () => {
  const all = evaluate('subnet-lab', { address: '203.0.113.5', prefix: 0, splitPrefix: 0 });
  assert.equal(metric(all, '地址总数'), 4_294_967_296);
  assert.equal(metric(all, '可用主机数'), 4_294_967_294);
  assert.deepEqual(
    rows(all, '子网划分').map((row) => [row.network, row.last]),
    [['0.0.0.0/0', '255.255.255.255']],
  );
  const pair = evaluate('subnet-lab', { address: '192.0.2.5', prefix: 31, splitPrefix: 32 });
  assert.equal(metric(pair, '可用主机数'), 2);
  assert.deepEqual(
    rows(pair, '子网划分').map((row) => row.network),
    ['192.0.2.4/32', '192.0.2.5/32'],
  );
  const single = evaluate('subnet-lab', { address: '255.255.255.255', prefix: 32, splitPrefix: 32 });
  assert.equal(metric(single, '地址总数'), 1);
  assert.equal(metric(single, '可用主机数'), 1);
  rejected('subnet-lab', { address: '256.0.0.1' });
  rejected('subnet-lab', { splitPrefix: 23 });
  rejected('subnet-lab', { prefix: 24.5 });
});

test('classic ciphers match known examples and round-trip punctuation, case, Unicode and boundary whitespace', () => {
  assert.equal(evaluate('cybersecurity-lab').sections[0].content, 'Khoor, Zruog!');
  assert.equal(
    evaluate('cybersecurity-lab', { cipher: 'vigenere', text: 'ATTACK AT DAWN', key: 'LEMON' }).sections[0]
      .content,
    'LXFOPV EF RNHR',
  );
  const plaintext = '  AbC xyz! 中文 123\n';
  for (const cipher of ['caesar', 'vigenere']) {
    const encrypted = evaluate('cybersecurity-lab', { cipher, text: plaintext, shift: -27, key: 'AbZ' })
      .sections[0].content;
    const recovered = evaluate('cybersecurity-lab', {
      cipher,
      mode: 'decrypt',
      text: encrypted,
      shift: -27,
      key: 'AbZ',
    }).sections[0].content;
    assert.equal(recovered, plaintext, cipher);
  }
  rejected('cybersecurity-lab', { key: 'A1' });
  rejected('cybersecurity-lab', { shift: 1.5 });
});

test('K-means separates the two default point pairs with SSE 1, without assuming arbitrary cluster names', () => {
  const output = evaluate('data-science');
  const memberships = rows(output, '数据点与归属');
  assert.equal(memberships[0].cluster, memberships[1].cluster);
  assert.equal(memberships[2].cluster, memberships[3].cluster);
  assert.notEqual(memberships[0].cluster, memberships[2].cluster);
  assert.deepEqual(
    rows(output, '簇中心')
      .map((row) => [row.x, row.y])
      .sort((a, b) => Number(a[0]) - Number(b[0])),
    [
      [1.5, 1],
      [8.5, 8],
    ],
  );
  assert.equal(metric(output, '平方误差'), 1);
});

test('K-means returned labels, member counts and SSE refer to returned centers even at the iteration limit', () => {
  const output = evaluate('data-science', { points: '[[0,0],[1,0],[10,0]]', clusters: 2, iterations: 1 });
  const centers = rows(output, '簇中心'),
    points = rows(output, '数据点与归属');
  let observedSse = 0;
  for (const point of points) {
    const distances = centers.map(
      (center) => (Number(point.x) - Number(center.x)) ** 2 + (Number(point.y) - Number(center.y)) ** 2,
    );
    const chosen = centers.findIndex((center) => center.cluster === point.cluster);
    assert.ok(chosen >= 0);
    assert.equal(distances[chosen], Math.min(...distances));
    observedSse += distances[chosen];
  }
  close(metric(output, '平方误差'), observedSse);
  for (const center of centers)
    assert.equal(center.count, points.filter((point) => point.cluster === center.cluster).length);
  const constant = evaluate('data-science', { points: '[[2,2],[2,2]]', clusters: 1, normalize: true });
  assert.equal(metric(constant, '平方误差'), 0);
  assert.deepEqual(
    rows(constant, '簇中心').map((row) => [row.x, row.y]),
    [[0, 0]],
  );
  rejected('data-science', { points: '[[2,2],[2,2]]', clusters: 2 });
  rejected('data-science', { points: '[[1,2,3]]' });
});

test('series circuit conserves voltage and power, RC at one time constant is 1-e^-1 of supply', () => {
  const output = evaluate('circuit-lab');
  assert.equal(metric(output, '等效电阻'), 600);
  close(metric(output, '总电流'), 0.02);
  close(metric(output, '总功率'), 0.24);
  close(metric(output, 'RC时间常数'), 0.06);
  close(metric(output, '给定时刻电容电压'), 12 * (1 - 1 / Math.E));
  const branches = rows(output, '各电阻');
  close(
    branches.reduce((sum, row) => sum + Number(row.voltage), 0),
    12,
  );
  close(
    branches.reduce((sum, row) => sum + Number(row.power), 0),
    0.24,
  );
  assert.ok(branches.every((row) => row.current === 0.02));
  const parallel = evaluate('circuit-lab', {
    topology: 'parallel',
    resistances: '[100,100]',
    capacitanceMicro: 0,
  });
  assert.equal(metric(parallel, '等效电阻'), 50);
  close(metric(parallel, '总电流'), 0.24);
  assert.ok(rows(parallel, '各电阻').every((row) => row.voltage === 12));
  assert.equal(
    parallel.metrics.some((item) => item.label === 'RC时间常数'),
    false,
  );
  rejected('circuit-lab', { resistances: '[0,100]' });
  rejected('circuit-lab', { time: -1 });
});

test('Boolean truth tables match all assignments and precedence; malformed code is rejected', () => {
  const output = evaluate('digital-logic');
  const truth = rows(output, '真值表');
  assert.equal(truth.length, 8);
  assert.equal(metric(output, '真值行数'), 7);
  assert.ok(
    truth.every((row) => row.output === Number(!(Boolean(row.A) && Boolean(row.B)) || Boolean(row.C))),
  );
  const precedence = rows(evaluate('digital-logic', { expression: 'A || B && C' }), '真值表');
  assert.ok(
    precedence.every((row) => row.output === Number(Boolean(row.A) || (Boolean(row.B) && Boolean(row.C)))),
  );
  assert.deepEqual(
    rows(evaluate('digital-logic', { expression: 'A ^ A' }), '真值表').map((row) => row.output),
    [0, 0],
  );
  rejected('digital-logic', { expression: 'globalThis.process.exit()' });
  rejected('digital-logic', { expression: '(A && B' });
  rejected('digital-logic', { expression: '!'.repeat(25) + 'A' });
});

test('gear reduction conserves input power times efficiency and handles zero input without division failure', () => {
  const output = evaluate('mechanics-lab');
  assert.equal(metric(output, '传动比'), 3);
  assert.equal(metric(output, '输出转速大小'), 400);
  assert.equal(metric(output, '输出扭矩'), 27);
  close(metric(output, '输入功率'), 400 * Math.PI);
  close(metric(output, '输出功率'), 360 * Math.PI);
  const still = evaluate('mechanics-lab', { rpm: 0, efficiency: 0 });
  assert.equal(metric(still, '输出功率'), 0);
  rejected('mechanics-lab', { driverTeeth: 0 });
  rejected('mechanics-lab', { efficiency: 1.01 });
});

test('simply supported beam satisfies reaction equilibrium and the uniform-load qL²/8 oracle', () => {
  const defaults = evaluate('civil-beam');
  assert.equal(metric(defaults, '左支座反力'), 11);
  assert.equal(metric(defaults, '右支座反力'), 11);
  assert.equal(metric(defaults, '最大弯矩'), 24);
  assert.equal(metric(defaults, '最大弯矩位置'), 3);
  const uniform = evaluate('civil-beam', { length: 8, uniform: 3, point: 0, position: 0 });
  assert.equal(metric(uniform, '最大弯矩'), (3 * 8 ** 2) / 8);
  assert.equal(metric(uniform, '最大弯矩位置'), 4);
  const endLoad = evaluate('civil-beam', { uniform: 0, point: 10, position: 0 });
  assert.equal(metric(endLoad, '左支座反力'), 10);
  assert.equal(metric(endLoad, '右支座反力'), 0);
  assert.equal(metric(endLoad, '最大弯矩'), 0);
  rejected('civil-beam', { position: 7 });
  rejected('civil-beam', { length: 0 });
});

test('drawing scale uses a squared area ratio, not the linear length ratio', () => {
  const output = evaluate('scale-lab');
  assert.equal(metric(output, '图上长度'), 12);
  assert.equal(metric(output, '图上面积'), 144);
  const half = evaluate('scale-lab', { scale: 200 });
  assert.equal(metric(half, '图上长度'), 6);
  assert.equal(metric(half, '图上面积'), 36);
  assert.equal(metric(evaluate('scale-lab', { length: 0, area: 0 }), '图上面积'), 0);
  rejected('scale-lab', { scale: 0 });
  rejected('scale-lab', { area: -1 });
});

test('WCAG contrast is symmetric, black/white is 21:1, and identical colors are 1:1', () => {
  const normal = evaluate('design-contrast');
  assert.ok(metric(normal, '对比度') > 1 && metric(normal, '对比度') <= 21);
  const inverse = evaluate('design-contrast', { foreground: '#fff', background: '#1d4ed8' });
  assert.equal(metric(normal, '对比度'), metric(inverse, '对比度'));
  const maximum = evaluate('design-contrast', { foreground: '#000', background: '#ffffff' });
  assert.equal(metric(maximum, '对比度'), 21);
  assert.ok(rows(maximum, '文本阈值').every((row) => row.pass === true));
  const same = evaluate('design-contrast', { foreground: '#777', background: '#777777' });
  assert.equal(metric(same, '对比度'), 1);
  assert.ok(rows(same, '文本阈值').every((row) => row.pass === false));
  rejected('design-contrast', { foreground: 'rgb(0,0,0)' });
  rejected('design-contrast', { background: '#ggg' });
});

test('MIDI A4 is 440Hz and each octave doubles or halves frequency', () => {
  assert.equal(metric(evaluate('music-lab'), '基础频率'), 440);
  const octave = evaluate('music-lab', { semitones: 12 });
  assert.equal(metric(octave, '目标频率'), 880);
  assert.equal(metric(octave, '频率比'), 2);
  assert.equal(metric(evaluate('music-lab', { semitones: -12 }), '目标频率'), 220);
  const scale = rows(octave, '以基础音为主音的大调音阶');
  assert.equal(scale.length, 8);
  assert.equal(Number(scale[7].frequency), Number(scale[0].frequency) * 2);
  close(metric(evaluate('music-lab', { midi: 0 }), '基础频率'), 8.1757989156);
  rejected('music-lab', { midi: 69.5 });
  rejected('music-lab', { midi: 128 });
});

test('pace and speed use reciprocal units, with optional splits handled separately', () => {
  const output = evaluate('sports-analysis');
  assert.equal(metric(output, '平均配速'), 6);
  assert.equal(metric(output, '平均速度'), 10);
  assert.equal(metric(output, '等配速目标时间'), 60);
  close(metric(output, '分段标准差'), Math.sqrt(0.02));
  const noSplits = evaluate('sports-analysis', { splits: '' });
  assert.equal(metric(noSplits, '平均配速'), 6);
  assert.equal(noSplits.tables.length, 0);
  rejected('sports-analysis', { distance: 0 });
  rejected('sports-analysis', { splits: '[6,0,5]' });
});

test('fictional classroom mass units cancel to volume and equivalent units produce the same answer', () => {
  const base = evaluate('pharmacology-units');
  assert.equal(metric(base, '统一质量'), 500);
  assert.equal(metric(base, '按给定浓度换算体积'), 2);
  for (const input of [
    { amount: 0.5, unit: 'g' },
    { amount: 500_000, unit: 'mcg' },
  ]) {
    const output = evaluate('pharmacology-units', input);
    assert.equal(metric(output, '统一质量'), 500);
    assert.equal(metric(output, '按给定浓度换算体积'), 2);
  }
  assert.equal(metric(evaluate('pharmacology-units', { amount: 0 }), '按给定浓度换算体积'), 0);
  rejected('pharmacology-units', { concentration: 0 });
  rejected('pharmacology-units', { unit: 'kg' });
});
