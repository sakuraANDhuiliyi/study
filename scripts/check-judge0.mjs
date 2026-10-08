#!/usr/bin/env node
import { tsImport } from 'tsx/esm/api';
const args = process.argv.slice(2);
if (args.length > 1 || args.some((arg) => arg !== '--smoke')) {
  console.error('用法: node scripts/check-judge0.mjs [--smoke]');
  process.exitCode = 2;
} else {
  try {
    const module = await tsImport('../apps/api/src/algorithms/judge.diagnostics.ts', import.meta.url);
    const { diagnoseJudge0 } = module.default ?? module;
    console.log(
      args.includes('--smoke')
        ? '检查服务安全配置，然后在远端运行四个固定程序。'
        : '只读检查Judge0配置、连接、版本、语言与执行器。',
    );
    const checks = await diagnoseJudge0({ smoke: args.includes('--smoke') });
    for (const check of checks) console.log(`${check.ok ? 'PASS' : 'FAIL'} ${check.name}: ${check.detail}`);
    console.log('诊断输出不包含服务地址、认证头、令牌或上游原始日志。');
    process.exitCode = checks.every((check) => check.ok) ? 0 : 1;
  } catch {
    console.error('诊断无法完成，请确认Node.js版本、npm依赖及服务器配置。');
    process.exitCode = 1;
  }
}
