import { BadRequestException } from '@nestjs/common';
export type Inputs = Record<string, unknown>;
export function fail(message: string): never {
  throw new BadRequestException(message);
}
export function num(values: Inputs, key: string, min = -1e9, max = 1e9, integer = false): number {
  const value = values[key];
  if (
    typeof value !== 'number' ||
    !Number.isFinite(value) ||
    value < min ||
    value > max ||
    (integer && !Number.isInteger(value))
  )
    fail(`${key}必须是${integer ? '整数' : '有限数值'}，范围${min}至${max}`);
  return value;
}
export function str(values: Inputs, key: string, max = 12000, required = true): string {
  const value = values[key];
  if (value === undefined && !required) return '';
  if (typeof value !== 'string' || value.length > max || /\0/.test(value) || (required && !value.trim()))
    fail(`${key}必须是${required ? '非空' : ''}文本，最多${max}字符`);
  return value.trim();
}
export function choice(values: Inputs, key: string, allowed: string[]): string {
  const value = str(values, key, 100);
  if (!allowed.includes(value)) fail(`${key}选项无效`);
  return value;
}
export function parsed(values: Inputs, key: string): unknown {
  const value = values[key];
  if (typeof value !== 'string') return value;
  if (value.length > 32000) fail(`${key}内容过长`);
  try {
    return JSON.parse(value);
  } catch {
    fail(`${key}需要合法JSON`);
  }
}
export function list(values: Inputs, key: string, max = 500, min = 1): number[] {
  let value: unknown = values[key];
  if (typeof value === 'string') {
    if (value.length > 32000) fail(`${key}内容过长`);
    const source = value;
    try {
      value = JSON.parse(source);
    } catch {
      value = source
        .trim()
        .split(/[\s,]+/)
        .filter(Boolean)
        .map(Number);
    }
  }
  if (
    !Array.isArray(value) ||
    value.length < min ||
    value.length > max ||
    !value.every((v) => typeof v === 'number' && Number.isFinite(v) && Math.abs(v) <= 1e9)
  )
    fail(`${key}需要${min}至${max}个有限数值`);
  return value as number[];
}
export function matrix(values: Inputs, key: string, max = 10): number[][] {
  const value = parsed(values, key);
  if (
    !Array.isArray(value) ||
    !value.length ||
    value.length > max ||
    !value.every(
      (row) =>
        Array.isArray(row) &&
        row.length > 0 &&
        row.length <= max &&
        row.every((v) => typeof v === 'number' && Number.isFinite(v) && Math.abs(v) <= 1e9),
    ) ||
    !value.every((row) => row.length === value[0].length)
  )
    fail(`${key}需要规则二维数值矩阵，每维最多${max}`);
  return value as number[][];
}
export function rounded(value: number, precision = 6): number {
  if (!Number.isFinite(value) || Math.abs(value) > 1e100) fail('结果超出可计算范围，请缩小参数');
  return Number.isSafeInteger(value) ? value : Number(value.toPrecision(precision + 1));
}
export const metric = (label: string, value: number | string, unit?: string) => ({
  label,
  value: typeof value === 'number' ? rounded(value) : value,
  ...(unit ? { unit } : {}),
});
export function ensureJson(value: unknown, max = 65536) {
  let serialized: string;
  try {
    serialized = JSON.stringify(value);
  } catch {
    fail('输入必须是可序列化JSON');
  }
  if (!serialized! || Buffer.byteLength(serialized!) > max) fail('内容过长');
}
