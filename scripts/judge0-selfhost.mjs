#!/usr/bin/env node
// Operations on the dedicated execution VM only; this script never accepts program source.
import { existsSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

const directory = fileURLToPath(new URL('../deploy/judge0/', import.meta.url));
const configFile = resolve(directory, 'judge0.conf');
const args = process.argv.slice(2);
const action = args[0] ?? '--check';
const fail = (message) => {
  console.error(`FAIL ${message}`);
  process.exitCode = 1;
};
const docker = (parameters, timeout = 15_000) => {
  const result = spawnSync('docker', parameters, {
    encoding: 'utf8',
    timeout,
    maxBuffer: 1_048_576,
    cwd: directory,
    windowsHide: true,
  });
  // Raw Docker output can contain environment values. Only internal checks inspect it.
  if (result.status !== 0 || result.error)
    throw new Error('Docker命令失败；请检查守护进程、Compose版本或VM运维日志');
  return result.stdout.trim();
};
function hostCheck() {
  if (process.platform !== 'linux' || process.arch !== 'x64')
    throw new Error('需要专用Linux x86_64虚拟机；本机不启动Judge0执行器');
  if (!existsSync('/sys/fs/cgroup/memory') || existsSync('/sys/fs/cgroup/cgroup.controllers'))
    throw new Error('需要cgroup v1；请按官方部署说明配置VM并重启后再检查');
  if (process.env.DOCKER_HOST && !process.env.DOCKER_HOST.startsWith('unix://'))
    throw new Error('请在专用VM使用本地Docker unix socket，拒绝远程Docker主机');
  const context = JSON.parse(docker(['context', 'inspect']));
  if (
    !Array.isArray(context) ||
    context.length !== 1 ||
    !context[0]?.Endpoints?.docker?.Host?.startsWith('unix://')
  )
    throw new Error('仅允许专用VM的本地Docker上下文');
  const daemon = docker(['info', '--format', '{{.OSType}}|{{.Architecture}}|{{.CgroupVersion}}']);
  if (!/^linux\|(x86_64|amd64)\|1$/.test(daemon))
    throw new Error('Docker守护进程需要Linux x86_64与cgroup v1');
  if (!/^2\./.test(docker(['compose', 'version', '--short']))) throw new Error('需要Docker Compose v2');
  console.log('PASS 专用VM平台、cgroup和本地Docker检查通过');
}
function checkConfig() {
  const stat = statSync(configFile);
  if (!stat.isFile() || stat.size > 16_384 || (stat.mode & 0o077) !== 0)
    throw new Error('judge0.conf必须为权限600的普通文件且不超过16KiB');
  const values = Object.create(null);
  for (const line of readFileSync(configFile, 'utf8').split(/\r?\n/)) {
    if (!line.trim() || line.trim().startsWith('#')) continue;
    const item = /^([A-Z][A-Z0-9_]*)=([A-Za-z0-9_.:-]*)$/.exec(line);
    if (!item || item[1] in values) throw new Error('judge0.conf格式无效或存在重复字段；不要使用shell表达式');
    values[item[1]] = item[2];
  }
  for (const key of ['REDIS_PASSWORD', 'POSTGRES_PASSWORD', 'SECRET_KEY_BASE'])
    if (!/^[a-f0-9]{64,128}$/.test(values[key] ?? '')) throw new Error('请先运行--init生成独立的强凭证');
  if (!/^[a-f0-9]{64,128}$/.test(values.AUTHN_TOKEN ?? ''))
    throw new Error('此部署模板要求强AUTHN_TOKEN，请运行--init生成，或填写64至128位随机十六进制令牌');
  for (const key of [
    'ENABLE_NETWORK',
    'ALLOW_ENABLE_NETWORK',
    'ENABLE_CALLBACKS',
    'ENABLE_ADDITIONAL_FILES',
    'ENABLE_COMPILER_OPTIONS',
    'ENABLE_COMMAND_LINE_ARGUMENTS',
  ])
    if (values[key] !== 'false') throw new Error('judge0.conf必须关闭网络、回调、附加文件和自定义参数');
  const reference = readFileSync(resolve(directory, 'judge0.conf.example'), 'utf8');
  const allowedKeys = new Set([...reference.matchAll(/^([A-Z][A-Z0-9_]*)=/gm)].map((item) => item[1]));
  if (Object.keys(values).some((key) => !allowedKeys.has(key)))
    throw new Error('judge0.conf含未知字段，请使用部署模板中的配置项');
  // Keep this startup path bound to the reviewed resource budget. Advanced changes require review.
  for (const line of reference.split(/\r?\n/)) {
    const item = /^([A-Z][A-Z0-9_]*)=(.+)$/.exec(line);
    if (item && values[item[1]] !== item[2]) throw new Error('资源或服务设置偏离受审查模板，请恢复模板配置');
  }
}
try {
  if (
    !['--check', '--init', '--start'].includes(action) ||
    args.some((arg, index) => index > 0 && (arg !== '--dedicated-vm' || action !== '--start')) ||
    args.length > 2
  ) {
    console.error('用法: node scripts/judge0-selfhost.mjs --check | --init | --start --dedicated-vm');
    process.exitCode = 2;
  } else if (action === '--init') {
    if (existsSync(configFile)) throw new Error('私有配置已存在，未覆盖任何凭证');
    let template = readFileSync(resolve(directory, 'judge0.conf.example'), 'utf8');
    for (const key of [
      'AUTHN_TOKEN',
      'AUTHZ_TOKEN',
      'REDIS_PASSWORD',
      'POSTGRES_PASSWORD',
      'SECRET_KEY_BASE',
    ])
      template = template.replace(new RegExp(`^${key}=$`, 'm'), `${key}=${randomBytes(32).toString('hex')}`);
    writeFileSync(configFile, template, { flag: 'wx', mode: 0o600 });
    console.log(
      'PASS 私有judge0.conf已创建（权限600）；凭证未输出，请通过安全编辑器读取AUTHN_TOKEN并填写应用config.yaml',
    );
  } else {
    hostCheck();
    if (action === '--start') {
      if (!args.includes('--dedicated-vm'))
        throw new Error('启动特权执行器需显式参数--dedicated-vm，确认这是独立的判题VM');
      checkConfig();
      const compose = [
        'compose',
        '--project-name',
        'study-judge0',
        '--file',
        resolve(directory, 'compose.yaml'),
      ];
      docker([...compose, 'config', '--quiet']);
      console.log('正在拉取固定Judge0版本与数据库镜像；不会输出Compose展开配置或认证信息');
      docker([...compose, 'pull'], 600_000);
      console.log('正在启动有资源上限的独立判题服务');
      docker([...compose, 'up', '-d', '--wait', '--wait-timeout', '90'], 120_000);
      console.log(
        'PASS 容器启动完成；请配置VM HTTPS反向代理，然后从应用主机运行check-judge0.mjs --smoke验证实际编译',
      );
    }
  }
} catch (error) {
  // Only static local messages are emitted; unknown fs/JSON errors may embed paths or file contents.
  const message =
    error instanceof Error &&
    /^(需要|请|仅允许|Docker|私有配置|judge0.conf|此部署|资源或服务|启动特权)/.test(error.message)
      ? error.message
      : '操作失败，请检查VM条件和私有配置文件；原始错误已隐藏';
  fail(message);
}
