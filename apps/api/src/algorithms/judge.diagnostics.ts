import { z } from 'zod';
import { JudgeConfigurationError, readJudgeConfiguration } from './judge.config';
import { JudgeGateway, judgeLanguages, probeJudgeMetadata, type JudgeLanguage } from './judge.gateway';

export interface JudgeDiagnostic {
  name: string;
  ok: boolean;
  detail: string;
}
const integer = z.number().int().nonnegative().max(1_000_000_000);
const metadataSchema = z.object({
  about: z.object({ version: z.string().regex(/^\d{1,3}\.\d{1,3}\.\d{1,3}$/) }),
  languages: z.array(z.object({ id: integer, name: z.string().min(1).max(200) })).max(1000),
  limits: z.object({
    enable_network: z.boolean(),
    allow_enable_network: z.boolean(),
    enable_callbacks: z.boolean(),
    enable_additional_files: z.boolean(),
    enable_compiler_options: z.boolean(),
    enable_command_line_arguments: z.boolean(),
    enable_per_process_and_thread_memory_limit: z.boolean(),
    enable_per_process_and_thread_time_limit: z.boolean(),
    max_cpu_time_limit: z.number().finite(),
    max_wall_time_limit: z.number().finite(),
    max_memory_limit: integer,
    max_stack_limit: integer,
    max_max_processes_and_or_threads: integer,
    max_max_file_size: integer,
    max_number_of_runs: integer,
    max_queue_size: integer,
  }),
  workers: z
    .array(
      z.object({
        queue: z.string().max(100),
        available: integer,
        paused: integer,
        idle: integer,
        working: integer,
        size: integer,
      }),
    )
    .max(100),
});
// Deliberately fixed programs; no CLI argument, HTTP input or file can replace this source.
const smokeCode: Record<JudgeLanguage, string> = {
  cpp: '#include <iostream>\nint main(){long long a,b;std::cin>>a>>b;std::cout<<a+b<<"\\n";}\n',
  python: 'import sys\na,b=map(int,sys.stdin.read().split())\nprint(a+b)\n',
  javascript:
    "const fs=require('fs');const [a,b]=fs.readFileSync(0,'utf8').trim().split(/\\s+/).map(Number);console.log(a+b);\n",
  java: 'import java.util.Scanner;\npublic class Main {public static void main(String[] args){Scanner s=new Scanner(System.in);long a=s.nextLong(),b=s.nextLong();System.out.println(a+b);}}\n',
};

/** Operator-only diagnostics. Never exposes endpoints, headers, upstream text or program output. */
export async function diagnoseJudge0(options: { smoke?: boolean } = {}): Promise<JudgeDiagnostic[]> {
  const checks: JudgeDiagnostic[] = [];
  const add = (name: string, ok: boolean, detail: string) => checks.push({ name, ok, detail });
  let config;
  try {
    config = readJudgeConfiguration();
  } catch (error) {
    add('配置', false, error instanceof JudgeConfigurationError ? error.message : '无法读取判题配置');
    return checks;
  }
  add(
    '配置',
    true,
    config.token ? '配置有效，已设置认证令牌' : '配置有效，未设置认证令牌；仅用于受控内网实例',
  );
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), Math.min(config.timeoutMs, 10_000));
  try {
    const parsed = metadataSchema.safeParse(await probeJudgeMetadata(config, controller.signal));
    if (!parsed.success) {
      add('服务响应', false, '元数据缺失或格式无效，请检查Judge0 CE版本与代理配置');
      return checks;
    }
    add('连接与认证', true, '四个只读端点正常响应');
    const data = parsed.data;
    const [major, minor, patch] = data.about.version.split('.').map(Number);
    const patched = major > 1 || (major === 1 && (minor > 13 || (minor === 13 && patch >= 1)));
    add(
      '版本',
      patched,
      patched ? '服务报告版本不低于1.13.1；仍需维护镜像和宿主补丁' : '拒绝旧版；需要1.13.1或更新安全版本',
    );
    const family: Record<JudgeLanguage, RegExp> = {
      cpp: /^C\+\+/,
      python: /^Python(?:\s+3\b|\s*\(3\.)/,
      javascript: /^JavaScript/,
      java: /^Java\s/,
    };
    for (const language of judgeLanguages) {
      const installed = data.languages.find((item) => item.id === config.languageIds[language.id]);
      add(
        `${language.label}语言`,
        !!installed && family[language.id].test(installed.name),
        installed && family[language.id].test(installed.name)
          ? '配置的语言ID与工具链匹配'
          : '请按服务languages列表修正languageIds',
      );
    }
    const limits = data.limits;
    const networkDisabled = !limits.enable_network && !limits.allow_enable_network;
    add(
      '程序网络',
      networkDisabled,
      networkDisabled
        ? '服务声明禁止网络且禁止提交覆盖；需要另外验证VM防火墙'
        : '必须同时关闭ENABLE_NETWORK和ALLOW_ENABLE_NETWORK',
    );
    const optionsDisabled =
      !limits.enable_callbacks &&
      !limits.enable_additional_files &&
      !limits.enable_compiler_options &&
      !limits.enable_command_line_arguments;
    add(
      '危险扩展',
      optionsDisabled,
      optionsDisabled
        ? '回调、附加文件、编译与命令行参数均关闭'
        : '请使用仓库部署模板关闭回调、附加文件和自定义参数',
    );
    const limitsCompatible =
      limits.max_cpu_time_limit >= 10 &&
      limits.max_cpu_time_limit <= 30 &&
      limits.max_wall_time_limit >= 20 &&
      limits.max_wall_time_limit <= 60 &&
      limits.max_memory_limit >= 524288 &&
      limits.max_memory_limit <= 1048576 &&
      limits.max_stack_limit >= 64000 &&
      limits.max_stack_limit <= 524288 &&
      limits.max_max_processes_and_or_threads >= 60 &&
      limits.max_max_processes_and_or_threads <= 120 &&
      limits.max_max_file_size >= 1024 &&
      limits.max_max_file_size <= 4096 &&
      limits.max_number_of_runs === 1 &&
      limits.max_queue_size > 0 &&
      limits.max_queue_size <= 100 &&
      !limits.enable_per_process_and_thread_memory_limit &&
      !limits.enable_per_process_and_thread_time_limit;
    add(
      '资源与队列',
      limitsCompatible,
      limitsCompatible
        ? '资源上限兼容本项目，使用整组CPU与内存限制'
        : '资源配置不足或过宽，请对照仓库judge0.conf.example',
    );
    const workers = data.workers.find((item) => item.queue === 'default');
    const ready = !!workers && workers.available > workers.paused && workers.idle + workers.working > 0;
    add(
      '执行器',
      ready,
      ready ? '存在可工作的default队列执行器' : 'default队列没有可工作执行器，请检查VM和worker',
    );
  } catch {
    add(
      '连接与认证',
      false,
      controller.signal.aborted
        ? '探测超时，请检查服务与防火墙'
        : '探测失败，请检查服务地址、TLS、认证令牌与服务状态',
    );
    return checks;
  } finally {
    clearTimeout(timer);
    controller.abort();
  }
  if (options.smoke && checks.every((check) => check.ok)) {
    const gateway = new JudgeGateway();
    for (const language of judgeLanguages) {
      // Avoid reporting a new endpoint as verified after a mid-diagnostic config edit.
      try {
        if (JSON.stringify(readJudgeConfiguration()) !== JSON.stringify(config)) throw new Error();
      } catch {
        add('配置更新', false, '诊断期间配置改变，请重新执行诊断');
        break;
      }
      const result = await gateway.execute({
        language: language.id,
        code: smokeCode[language.id],
        cases: [{ input: '2000000000 2000000000\n', output: '4000000000\n', hidden: true }],
        timeLimitMs: 2000,
        memoryLimitMb: 256,
      });
      add(
        `${language.label}烟测`,
        result.status === 'accepted' && result.passed === 1,
        result.status === 'accepted' && result.passed === 1
          ? '固定64位加法程序编译与运行通过'
          : `固定程序未通过（${result.status}），请检查工具链与资源限制`,
      );
    }
  } else if (options.smoke) {
    add('四语言烟测', false, '前置检查失败，未创建任何执行作业');
  }
  return checks;
}
