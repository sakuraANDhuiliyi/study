import { readFileSync, statSync } from 'node:fs';
import { aiConfigPath, parseAiConfiguration } from '../ai-study/ai.config';
import { judgeConfigurationSchema, judgeLanguageIdsSchema } from './judge.config.schema';

export interface JudgeConnectionConfig {
  url: string;
  token: string;
  timeoutMs: number;
  pollMs: number;
  languageIds: { cpp: number; python: number; javascript: number; java: number };
}
export class JudgeConfigurationError extends Error {}

const invalid = '判题服务配置无效，请管理员检查config.yaml中的judge0字段与格式';
const integer = (value: string | undefined, fallback: number) => {
  if (value === undefined) return fallback;
  if (!/^\d+$/.test(value)) throw new JudgeConfigurationError(invalid);
  return Number(value);
};

/** Read afresh for every operation. Parser details, source lines and credentials never leave this boundary. */
export function readJudgeConfiguration(): JudgeConnectionConfig {
  let raw: string;
  try {
    const path = aiConfigPath();
    const stat = statSync(path);
    if (!stat.isFile() || stat.size > 65_536) throw new Error();
    raw = readFileSync(path, 'utf8');
  } catch (error) {
    // Keep old environment-only deployments working when the YAML file does not exist.
    // A present but unreadable/invalid file is never silently ignored.
    if ((error as NodeJS.ErrnoException).code === 'ENOENT' && process.env.ALGORITHM_JUDGE_URL !== undefined)
      raw = '{}';
    else throw new JudgeConfigurationError(invalid);
  }
  let config;
  try {
    const yaml = parseAiConfiguration(raw).judge0;
    const envEnabled = process.env.ALGORITHM_JUDGE_ENABLED;
    if (envEnabled !== undefined && !['true', 'false'].includes(envEnabled)) throw new Error();
    const envLanguages = process.env.ALGORITHM_JUDGE_LANGUAGE_IDS;
    if (envLanguages && envLanguages.length > 1024) throw new Error();
    const languageOverrides =
      envLanguages === undefined ? {} : judgeLanguageIdsSchema.partial().parse(JSON.parse(envLanguages));
    config = judgeConfigurationSchema.parse({
      ...yaml,
      enabled: envEnabled === undefined ? yaml.enabled : envEnabled === 'true',
      baseUrl: process.env.ALGORITHM_JUDGE_URL ?? yaml.baseUrl,
      apiKey: process.env.ALGORITHM_JUDGE_TOKEN ?? yaml.apiKey,
      timeoutMs: integer(process.env.ALGORITHM_JUDGE_TIMEOUT_MS, yaml.timeoutMs),
      pollMs: integer(process.env.ALGORITHM_JUDGE_POLL_MS, yaml.pollMs),
      languageIds: { ...yaml.languageIds, ...languageOverrides },
    });
  } catch {
    throw new JudgeConfigurationError(invalid);
  }
  if (!config.enabled) throw new JudgeConfigurationError('判题服务已由管理员关闭');
  if (!config.baseUrl)
    throw new JudgeConfigurationError('判题服务尚未配置，请管理员填写config.yaml中的judge0.baseUrl');
  return {
    url: config.baseUrl.replace(/\/+$/, ''),
    token: config.apiKey,
    timeoutMs: config.timeoutMs,
    pollMs: config.pollMs,
    languageIds: config.languageIds,
  };
}
