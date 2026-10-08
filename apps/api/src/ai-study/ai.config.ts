import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import { readFileSync, statSync } from 'node:fs';
import { resolve, isAbsolute } from 'node:path';
import { parseDocument } from 'yaml';
import { z } from 'zod';
import type { AiStudyStatus } from './ai-study.schemas';
import { judgeConfigurationSchema } from '../algorithms/judge.config.schema';

const apiUrl = z
  .string()
  .url()
  .max(1000)
  .refine((value) => {
    const u = new URL(value);
    return (
      !u.username &&
      !u.password &&
      !u.search &&
      !u.hash &&
      (u.protocol === 'https:' ||
        (process.env.NODE_ENV !== 'production' &&
          u.protocol === 'http:' &&
          ['localhost', '127.0.0.1', '[::1]'].includes(u.hostname)))
    );
  }, '服务地址必须使用HTTPS；仅开发环境允许本机HTTP');
const secret = z
  .string()
  .max(4096)
  .refine((v) => !/[\r\n\0]/.test(v))
  .default('');
const model = z
  .string()
  .trim()
  .min(1)
  .max(120)
  .regex(/^[a-zA-Z0-9._:/-]+$/);
const configSchema = z
  .object({
    judge0: judgeConfigurationSchema.default({}),
    ai: z
      .object({
        enabled: z.boolean().default(true),
        apiStyle: z.enum(['deepseek', 'responses', 'chat_completions']).default('deepseek'),
        structuredOutput: z.enum(['json_schema', 'json_object']).default('json_object'),
        baseUrl: apiUrl.default('https://api.deepseek.com'),
        apiKey: secret,
        model: model.default('deepseek-flash'),
        timeoutMs: z.number().int().min(1000).max(180000).default(60000),
        maxOutputTokens: z.number().int().min(512).max(24000).default(6000),
      })
      .strict()
      .default({}),
    webSearch: z
      .object({
        enabled: z.boolean().default(true),
        provider: z.enum(['openai', 'tavily']).default('tavily'),
        model: model.default('gpt-4.1-mini'),
        maxResults: z.number().int().min(1).max(10).default(6),
        allowedDomains: z
          .array(
            z
              .string()
              .trim()
              .toLowerCase()
              .max(253)
              .regex(/^(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,63}$/),
          )
          .max(20)
          .default([]),
        tavily: z
          .object({ baseUrl: apiUrl.default('https://api.tavily.com'), apiKey: secret })
          .strict()
          .default({}),
      })
      .strict()
      .default({}),
    limits: z
      .object({
        dailyRequests: z.number().int().min(1).max(200).default(20),
        maxDownloadMb: z.number().int().min(1).max(20).default(10),
        downloadTimeoutMs: z.number().int().min(1000).max(60000).default(15000),
      })
      .strict()
      .default({}),
  })
  .strict()
  .superRefine((config, context) => {
    if (config.ai.apiStyle === 'deepseek' && config.ai.structuredOutput !== 'json_object')
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['ai', 'structuredOutput'],
        message: 'DeepSeek需要json_object输出格式',
      });
  });
export type AiConfig = z.infer<typeof configSchema>;
export const aiWorkspaceRoot = resolve(__dirname, '../../../..');
export function aiConfigPath() {
  const value = process.env.AI_CONFIG_PATH || 'config.yaml';
  return isAbsolute(value) ? value : resolve(aiWorkspaceRoot, value);
}
export function parseAiConfiguration(content: string): AiConfig {
  if (Buffer.byteLength(content) > 65536) throw new Error('Invalid configuration');
  const doc = parseDocument(content, {
    uniqueKeys: true,
    prettyErrors: false,
    strict: true,
    schema: 'core',
    resolveKnownTags: false,
  });
  if (doc.errors.length || doc.warnings.length) throw new Error('Invalid configuration');
  return configSchema.parse(doc.toJS({ maxAliasCount: 0 }));
}
const hasKey = (value: string) =>
  !!value.trim() && !/^(?:your[-_ ]|replace|填|请填|sk-\.\.\.)/i.test(value.trim());

@Injectable()
export class AiConfiguration {
  read(): AiConfig {
    try {
      const path = aiConfigPath();
      if (!statSync(path).isFile() || statSync(path).size > 65536) throw new Error('Invalid configuration');
      return parseAiConfiguration(readFileSync(path, 'utf8'));
    } catch {
      // Parser errors can include secret-bearing YAML source lines. Never forward or log them.
      throw new ServiceUnavailableException('AI配置不可用，请管理员检查服务器config.yaml的字段与格式');
    }
  }
  status(): AiStudyStatus {
    try {
      const c = this.read();
      const available = c.ai.enabled && hasKey(c.ai.apiKey);
      const search =
        c.webSearch.enabled &&
        (c.webSearch.provider === 'tavily' ? hasKey(c.webSearch.tavily.apiKey) : available);
      return {
        analysis: {
          available,
          reason: available
            ? ''
            : !c.ai.enabled
              ? 'AI分析已由管理员关闭'
              : '请管理员填写服务器config.yaml中的ai.apiKey',
        },
        search: {
          available: search,
          reason: search
            ? ''
            : !c.webSearch.enabled
              ? '联网搜索已由管理员关闭'
              : c.webSearch.provider === 'tavily'
                ? '请管理员填写config.yaml中的webSearch.tavily.apiKey'
                : '联网搜索需要配置可使用web_search的AI服务',
        },
        model: c.ai.model,
        searchProvider: c.webSearch.provider,
        limits: {
          maxMistakes: 10,
          dailyRequests: c.limits.dailyRequests,
          maxDownloadMb: c.limits.maxDownloadMb,
        },
      };
    } catch {
      return {
        analysis: { available: false, reason: 'AI配置不可用，请管理员检查服务器config.yaml' },
        search: { available: false, reason: '搜索配置不可用，请管理员检查服务器config.yaml' },
        model: '',
        searchProvider: '',
        limits: { maxMistakes: 10, dailyRequests: 20, maxDownloadMb: 10 },
      };
    }
  }
}
