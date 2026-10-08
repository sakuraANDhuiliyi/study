import { Injectable } from '@nestjs/common';
import { setTimeout as delay } from 'node:timers/promises';
import { z } from 'zod';
import { readJudgeConfiguration, JudgeConfigurationError, type JudgeConnectionConfig } from './judge.config';

export const judgeLanguages = [
  { id: 'cpp', label: 'C++' },
  { id: 'python', label: 'Python 3' },
  { id: 'javascript', label: 'JavaScript' },
  { id: 'java', label: 'Java' },
] as const;
export type JudgeLanguage = (typeof judgeLanguages)[number]['id'];
export type JudgeStatus =
  | 'accepted'
  | 'wrong_answer'
  | 'compile_error'
  | 'runtime_error'
  | 'time_limit'
  | 'memory_limit'
  | 'system_error';
export interface JudgeExecutionRequest {
  language: JudgeLanguage;
  code: string;
  cases: { input: string; output?: string; hidden: boolean }[];
  timeLimitMs: number;
  memoryLimitMb: number;
}
export interface JudgeCaseResult {
  index: number;
  status: JudgeStatus;
  hidden: boolean;
  input?: string;
  expectedOutput?: string;
  stdout?: string;
  stderr?: string;
  runtimeMs?: number;
  memoryKb?: number;
}
export interface JudgeExecutionResult {
  status: JudgeStatus;
  passed: number;
  total: number;
  runtimeMs: number;
  memoryKb: number;
  compileOutput: string;
  error: string;
  results: JudgeCaseResult[];
}

const MAX_CODE_BYTES = 65_536;
const MAX_INPUT_BYTES = 4 * 1_048_576;
const MAX_OUTPUT_BYTES = 1_048_576;
const MAX_DIAGNOSTIC_BYTES = 65_536;
const MAX_RESPONSE_BYTES = 2 * 1_048_576;
const MAX_POLLS = 180;
const textInput = (max: number) => z.string().refine((value) => Buffer.byteLength(value) <= max);
const requestSchema = z
  .object({
    language: z.enum(['cpp', 'python', 'javascript', 'java']),
    code: textInput(MAX_CODE_BYTES).refine((value) => value.trim().length > 0 && !value.includes('\0')),
    cases: z
      .array(
        z
          .object({
            input: textInput(MAX_INPUT_BYTES),
            output: textInput(MAX_OUTPUT_BYTES).optional(),
            hidden: z.boolean(),
          })
          .strict(),
      )
      .min(1)
      .max(30),
    timeLimitMs: z.number().int().min(100).max(10_000),
    memoryLimitMb: z.number().int().min(16).max(512),
  })
  .strict()
  .refine((value) => Buffer.byteLength(JSON.stringify(value)) <= 16 * 1_048_576);
type JudgeConfig = JudgeConnectionConfig;

class JudgeFailure extends Error {}
const invalidConfiguration = '判题服务配置无效，请联系管理员检查配置';
const invalidResponse = () => new JudgeFailure('判题服务返回了无效或过大的结果，请稍后重试');
const timeoutFailure = () => new JudgeFailure('判题服务等待超时，请稍后重试；本次不计为通过');
function readConfiguration(): JudgeConfig {
  try {
    return readJudgeConfiguration();
  } catch (error) {
    throw new JudgeFailure(error instanceof JudgeConfigurationError ? error.message : invalidConfiguration);
  }
}

const encodedText = (maxBytes: number) =>
  z
    .string()
    .max(Math.ceil(maxBytes * 1.5))
    .nullable()
    .optional();
const resultSchema = z
  .object({
    status: z
      .object({ id: z.number().int().min(1).max(14), description: z.string().max(200).optional() })
      .strict(),
    stdout: encodedText(MAX_OUTPUT_BYTES),
    stderr: encodedText(MAX_DIAGNOSTIC_BYTES),
    compile_output: encodedText(MAX_DIAGNOSTIC_BYTES),
    time: z
      .union([
        z
          .string()
          .regex(/^\d+(?:\.\d+)?$/)
          .max(20),
        z.number().finite().nonnegative(),
      ])
      .nullable()
      .optional(),
    memory: z.number().finite().nonnegative().max(1_073_741_824).nullable().optional(),
    exit_code: z.number().int().min(-255).max(255).nullable().optional(),
    exit_signal: z.number().int().min(0).max(255).nullable().optional(),
  })
  .strict();

function decode(value: string | null | undefined, maxBytes = MAX_DIAGNOSTIC_BYTES): string {
  if (!value) return '';
  // Judge0 may insert line breaks in Base64 output. No other non-alphabet data is accepted.
  const compact = value.replace(/[\r\n]/g, '');
  if (compact.length % 4 !== 0 || !/^[A-Za-z0-9+/]*={0,2}$/.test(compact)) throw invalidResponse();
  const bytes = Buffer.from(compact, 'base64');
  if (bytes.length > maxBytes || bytes.toString('base64') !== compact) throw invalidResponse();
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    throw invalidResponse();
  }
}

/** Preserve leading/interior whitespace; normalize line endings and ignore trailing spaces/blank lines. */
export function normalizeJudgeOutput(value: string): string {
  return value
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .map((line) => line.replace(/[\t ]+$/, ''))
    .join('\n')
    .replace(/\n+$/, '');
}

function redact(value: string, config: JudgeConfig): string {
  // Canonicalize first so control characters cannot split a secret past redaction.
  let safe = value.replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, '').replace(/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/g, '');
  for (const secret of [config.token, config.url, new URL(config.url).host].filter(Boolean))
    safe = safe.split(secret).join('[已隐藏]');
  return safe;
}

async function judgeJson(
  config: JudgeConfig,
  path: string,
  signal: AbortSignal,
  body?: unknown,
): Promise<unknown> {
  let response: Response | undefined;
  try {
    response = await fetch(`${config.url}/${path}`, {
      method: body === undefined ? 'GET' : 'POST',
      headers: {
        accept: 'application/json',
        ...(body === undefined ? {} : { 'content-type': 'application/json' }),
        ...(config.token ? { 'X-Auth-Token': config.token } : {}),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      signal,
      redirect: 'error',
    });
    if (!response.ok) {
      if ([401, 403].includes(response.status)) throw new JudgeFailure('判题服务认证失败，请联系管理员');
      if ([429, 503].includes(response.status)) throw new JudgeFailure('判题服务繁忙，请稍后重试');
      throw new JudgeFailure('判题服务请求失败，请联系管理员检查语言与运行限制配置');
    }
    if (Number(response.headers.get('content-length') || 0) > MAX_RESPONSE_BYTES || !response.body)
      throw invalidResponse();
    const reader = response.body.getReader();
    const chunks: Uint8Array[] = [];
    let size = 0;
    try {
      while (true) {
        const part = await reader.read();
        if (part.done) break;
        size += part.value.byteLength;
        if (size > MAX_RESPONSE_BYTES) {
          await reader.cancel();
          throw invalidResponse();
        }
        chunks.push(part.value);
      }
    } finally {
      reader.releaseLock();
    }
    try {
      return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks)));
    } catch {
      throw invalidResponse();
    }
  } finally {
    if (response?.body && !response.body.locked) await response.body.cancel().catch(() => undefined);
  }
}

/** Fixed, read-only operator probes reuse the submission transport's bounds and header handling. */
export async function probeJudgeMetadata(config: JudgeConnectionConfig, signal: AbortSignal) {
  const [about, languages, limits, workers] = await Promise.all(
    ['about', 'languages', 'config_info', 'workers'].map((path) => judgeJson(config, path, signal)),
  );
  return { about, languages, limits, workers };
}

@Injectable()
export class JudgeGateway {
  private activeExecutions = 0;

  status(): { available: boolean; reason: string; languages: { id: JudgeLanguage; label: string }[] } {
    try {
      readConfiguration();
      return { available: true, reason: '', languages: judgeLanguages.map((language) => ({ ...language })) };
    } catch (error) {
      return {
        available: false,
        reason: error instanceof JudgeFailure ? error.message : invalidConfiguration,
        languages: judgeLanguages.map((language) => ({ ...language })),
      };
    }
  }

  async execute(request: JudgeExecutionRequest): Promise<JudgeExecutionResult> {
    const parsed = requestSchema.safeParse(request);
    const empty = (error: string, total = 0): JudgeExecutionResult => ({
      status: 'system_error',
      passed: 0,
      total,
      runtimeMs: 0,
      memoryKb: 0,
      compileOutput: '',
      error,
      results: [],
    });
    if (!parsed.success) return empty('代码、测试用例或运行限制无效');
    const input = parsed.data;
    let config: JudgeConfig;
    try {
      config = readConfiguration();
    } catch (error) {
      return empty(error instanceof JudgeFailure ? error.message : invalidConfiguration, input.cases.length);
    }
    if (this.activeExecutions >= 4) return empty('判题请求过多，请稍后重试', input.cases.length);
    this.activeExecutions++;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), config.timeoutMs);
    const results: JudgeCaseResult[] = [];
    let compileOutput = '';
    let cursor = 0;
    let failure = '';
    let compilationFailed = false;
    const worker = async () => {
      try {
        while (cursor < input.cases.length && !controller.signal.aborted) {
          const index = cursor++;
          const item = input.cases[index];
          const created = await judgeJson(
            config,
            'submissions?base64_encoded=true&wait=false',
            controller.signal,
            {
              source_code: Buffer.from(input.code).toString('base64'),
              language_id: config.languageIds[input.language],
              stdin: Buffer.from(item.input).toString('base64'),
              // Compare locally so expected answers never leave the learning platform.
              cpu_time_limit: input.timeLimitMs / 1000,
              cpu_extra_time: 0,
              wall_time_limit: Math.min(20, Math.max(3, (input.timeLimitMs / 1000) * 3)),
              memory_limit: input.memoryLimitMb * 1024,
              stack_limit: Math.min(64_000, input.memoryLimitMb * 1024),
              // Keep Judge0's standard thread allowance for JVM/Node startup.
              max_processes_and_or_threads: 60,
              enable_per_process_and_thread_time_limit: false,
              enable_per_process_and_thread_memory_limit: false,
              max_file_size: MAX_OUTPUT_BYTES / 1024,
              enable_network: false,
              redirect_stderr_to_stdout: false,
              number_of_runs: 1,
            },
          );
          const token = z.object({ token: z.string().uuid() }).strict().safeParse(created);
          if (!token.success) throw invalidResponse();
          let completed = false;
          for (let attempt = 0; attempt < MAX_POLLS; attempt++) {
            if (attempt) await delay(config.pollMs, undefined, { signal: controller.signal });
            const raw = await judgeJson(
              config,
              `submissions/${token.data.token}?base64_encoded=true&fields=status,stdout,stderr,compile_output,time,memory,exit_code,exit_signal`,
              controller.signal,
            );
            const response = resultSchema.safeParse(raw);
            if (!response.success) throw invalidResponse();
            const data = response.data;
            if (data.status.id <= 2) continue;
            const stdout = decode(data.stdout, MAX_OUTPUT_BYTES);
            const stderr = decode(data.stderr);
            const diagnostics = decode(data.compile_output);
            const runtimeMs = data.time == null ? 0 : Math.round(Number(data.time) * 1000);
            const memoryKb = data.memory ?? 0;
            if (!Number.isSafeInteger(runtimeMs) || runtimeMs > 86_400_000) throw invalidResponse();
            let status: JudgeStatus;
            if (data.status.id === 3) {
              if (data.exit_code !== 0 || (data.exit_signal != null && data.exit_signal !== 0))
                throw invalidResponse();
              status =
                item.output === undefined ||
                normalizeJudgeOutput(stdout) === normalizeJudgeOutput(item.output)
                  ? 'accepted'
                  : 'wrong_answer';
              if (runtimeMs > input.timeLimitMs) status = 'time_limit';
              if (memoryKb > input.memoryLimitMb * 1024) status = 'memory_limit';
            } else if (data.status.id === 4) status = 'wrong_answer';
            else if (data.status.id === 5) status = 'time_limit';
            else if (data.status.id === 6) status = 'compile_error';
            else if (data.status.id >= 7 && data.status.id <= 12)
              status = memoryKb >= input.memoryLimitMb * 1024 ? 'memory_limit' : 'runtime_error';
            else throw new JudgeFailure('判题环境执行失败，请稍后重试；本次不计为通过');
            const result: JudgeCaseResult = {
              index: index + 1,
              status,
              hidden: item.hidden,
              runtimeMs,
              memoryKb,
            };
            if (!item.hidden) {
              result.input = item.input;
              if (item.output !== undefined) result.expectedOutput = item.output;
              result.stdout = redact(stdout, config);
              result.stderr = redact(stderr, config).slice(0, 16_384);
              if (diagnostics && !input.cases.some((testCase) => testCase.hidden))
                compileOutput = redact(diagnostics, config).slice(0, 16_384);
            }
            results[index] = result;
            completed = true;
            if (status === 'compile_error') {
              // Identical source/language fails before stdin is consumed for every case.
              // Stop creating work and stop waiting for the other in-flight case.
              compilationFailed = true;
              controller.abort();
            }
            break;
          }
          if (!completed) throw timeoutFailure();
        }
      } catch (error) {
        if (compilationFailed) return;
        if (!failure)
          failure =
            error instanceof JudgeFailure
              ? error.message
              : controller.signal.aborted
                ? timeoutFailure().message
                : '无法连接判题服务，请稍后重试或联系管理员';
        controller.abort();
      }
    };
    try {
      await Promise.all(Array.from({ length: Math.min(2, input.cases.length) }, worker));
      if (!failure && controller.signal.aborted && !compilationFailed) failure = timeoutFailure().message;
      if (failure) {
        // A partial evaluation cannot be reused to mark an exercise completed.
        return empty(failure, input.cases.length);
      }
      if (compilationFailed) {
        return {
          status: 'compile_error',
          passed: 0,
          total: input.cases.length,
          runtimeMs: 0,
          memoryKb: 0,
          compileOutput,
          error: input.cases.some((item) => item.hidden)
            ? '代码编译失败，请运行样例查看编译信息'
            : '代码编译失败，请查看编译信息',
          results: input.cases.map((item, index) => ({
            index: index + 1,
            status: 'compile_error',
            hidden: item.hidden,
            ...(!item.hidden ? { input: item.input, expectedOutput: item.output } : {}),
          })),
        };
      }
      const passed = results.filter((result) => result.status === 'accepted').length;
      return {
        status: results.find((result) => result.status !== 'accepted')?.status ?? 'accepted',
        passed,
        total: input.cases.length,
        runtimeMs: Math.max(...results.map((result) => result.runtimeMs ?? 0)),
        memoryKb: Math.max(...results.map((result) => result.memoryKb ?? 0)),
        compileOutput,
        error: '',
        results,
      };
    } finally {
      clearTimeout(timer);
      controller.abort();
      this.activeExecutions--;
    }
  }
}

export { JudgeGateway as AlgorithmJudgeGateway };
