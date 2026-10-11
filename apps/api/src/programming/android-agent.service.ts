import {
  Injectable,
  OnModuleInit,
  OnModuleDestroy,
  ForbiddenException,
  UnauthorizedException,
  ServiceUnavailableException,
  BadRequestException,
} from '@nestjs/common';
import { spawn, type ChildProcess } from 'node:child_process';
import { createHash, createHmac, randomBytes } from 'node:crypto';
import { resolve } from 'node:path';
import { readFile } from 'node:fs/promises';
import { AuthService } from '../auth/auth.service';
import type { Actor } from '../auth/auth.guard';

export function androidOwner(actor: Pick<Actor, 'id' | 'organizationId'>) {
  return (
    'lms_' +
    createHash('sha256')
      .update(JSON.stringify([actor.organizationId, actor.id]))
      .digest('hex')
      .slice(0, 48)
  );
}
export function androidBridgePath(path: string) {
  if (
    !/^api\/(?:health|models|projects|jobs|conversations)(?:\/[A-Za-z0-9_.-]+)*$/.test(path) ||
    /(?:^|\/)(?:\.\.?|terminals|mcp|settings|recover|import|git)(?:\/|$)/.test(path)
  )
    throw new BadRequestException('不支持的 Android 工作区请求');
  return '/' + path;
}
@Injectable()
export class AndroidAgentService implements OnModuleInit, OnModuleDestroy {
  private child?: ChildProcess;
  private readonly secret = randomBytes(32).toString('hex');
  private readonly port = 8011;
  private readonly root = resolve(__dirname, '../../../..');
  private available = false;
  constructor(private readonly auth: AuthService) {}
  async onModuleInit() {
    if (process.env.ANDROID_AGENT_ENABLED !== 'true') return;
    const python = process.env.ANDROID_AGENT_PYTHON || resolve(this.root, '.data/android-venv/bin/python');
    this.child = spawn(
      python,
      ['-m', 'uvicorn', 'lms_bridge:app', '--host', '127.0.0.1', '--port', String(this.port)],
      {
        cwd: resolve(this.root, 'services/android-agent'),
        stdio: 'ignore',
        env: {
          ...process.env,
          LMS_ANDROID_BRIDGE_SECRET: this.secret,
          AGENT_GRADLE_CACHE_SEED: resolve(this.root, '.data/android-agent/gradle-seed'),
          AGENT_DATA_DIR: resolve(this.root, '.data/android-agent/data'),
          AGENT_WORKSPACES_DIR: resolve(this.root, '.data/android-agent/workspaces'),
          AGENT_BUILDS_DIR: resolve(this.root, '.data/android-agent/builds'),
          AGENT_CONFIG_PATH: resolve(
            this.root,
            process.env.ANDROID_AGENT_CONFIG || '.data/android-agent/config.yaml',
          ),
        },
      },
    );
    this.child.once('spawn', () => {
      this.available = true;
    });
    this.child.on('error', () => {
      this.available = false;
    });
    this.child.on('exit', () => {
      this.available = false;
    });
  }
  onModuleDestroy() {
    this.available = false;
    this.child?.kill('SIGTERM');
  }
  async access(actor: Actor) {
    const current = actor.sessionId ? await this.auth.resolveSessionId(actor.sessionId) : null;
    if (
      !current ||
      current.id !== actor.id ||
      current.sessionId !== actor.sessionId ||
      current.organizationId !== actor.organizationId ||
      current.role !== actor.role ||
      current.accountMode !== actor.accountMode ||
      current.csrfToken !== actor.csrfToken
    )
      throw new UnauthorizedException('当前身份已变化，请重新登录');
    if (current.role !== 'STUDENT') throw new ForbiddenException('Android 工作室仅供学生使用');
    this.auth.require(current, 'learning.use');
    await this.auth.checkFeature(current, '/api/programming');
  }
  async status(actor: Actor) {
    await this.access(actor);
    let health: { status?: unknown; user_id?: unknown; api_key_configured?: unknown } | undefined;
    if (this.available) {
      try {
        const output = await this.request(actor, 'api/health', 'GET', '', undefined, 2000);
        if (output.status === 200) health = JSON.parse(output.body.toString('utf8'));
      } catch (error) {
        if (!(
          error instanceof ServiceUnavailableException ||
          error instanceof SyntaxError ||
          (error instanceof DOMException && ['AbortError', 'TimeoutError'].includes(error.name))
        ))
          throw error;
      }
    }
    await this.access(actor);
    const ready = this.available && health?.status === 'ok' && health.user_id === androidOwner(actor);
    return {
      available: ready,
      reason: ready
        ? ''
        : this.available
          ? 'Android 工作室暂时无法连接，请稍后重试'
          : 'Android 构建服务尚未启动',
      ...(ready
        ? {
            ai: {
              available: health?.api_key_configured === true,
              reason: health?.api_key_configured === true ? '' : 'AI 生成尚未配置，仍可编辑、构建和下载项目',
            },
          }
        : {}),
      capabilities: ['projects', 'agent', 'files', 'history', 'feedback', 'apk'],
    };
  }
  async asset(actor: Actor, name: string) {
    await this.access(actor);
    if (!['index.html', 'app.js', 'app.css'].includes(name)) throw new BadRequestException('文件不存在');
    const body = await readFile(resolve(this.root, 'services/android-agent/agent/web', name));
    await this.access(actor);
    return {
      body,
      type: name.endsWith('.js') ? 'text/javascript' : name.endsWith('.css') ? 'text/css' : 'text/html',
    };
  }
  async request(
    actor: Actor,
    path: string,
    method: string,
    query: string,
    input: unknown,
    timeoutMs?: number,
  ) {
    await this.access(actor);
    if (!this.available) throw new ServiceUnavailableException('Android 构建服务尚未启动');
    if (!['GET', 'POST', 'PATCH', 'PUT', 'DELETE'].includes(method))
      throw new BadRequestException('请求方法不支持');
    const uri = androidBridgePath(path) + query;
    const body = ['GET', 'HEAD'].includes(method) || input === undefined ? '' : JSON.stringify(input);
    if (Buffer.byteLength(body) > 2 * 1024 * 1024) throw new BadRequestException('请求过大');
    const owner = androidOwner(actor),
      stamp = String(Math.floor(Date.now() / 1000)),
      nonce = randomBytes(16).toString('hex');
    const signature = createHmac('sha256', this.secret)
      .update([method, uri, owner, stamp, nonce, createHash('sha256').update(body).digest('hex')].join('\n'))
      .digest('hex');
    let response: Response;
    try {
      response = await fetch(`http://127.0.0.1:${this.port}${uri}`, {
        method,
        headers: {
          'content-type': 'application/json',
          'x-lms-owner': owner,
          'x-lms-time': stamp,
          'x-lms-nonce': nonce,
          'x-lms-signature': signature,
        },
        ...(body ? { body } : {}),
        signal: AbortSignal.timeout(timeoutMs ?? (path.endsWith('/build') ? 900000 : 60000)),
        redirect: 'error',
      });
    } catch {
      throw new ServiceUnavailableException('Android 服务暂时无法连接');
    }
    const chunks: Uint8Array[] = [];
    let bytes = 0;
    if (response.body)
      for await (const chunk of response.body as unknown as AsyncIterable<Uint8Array>) {
        bytes += chunk.byteLength;
        if (bytes > 80 * 1024 * 1024) throw new ServiceUnavailableException('Android 响应超过下载限制');
        chunks.push(chunk);
      }
    await this.access(actor);
    return {
      status: response.status,
      body: Buffer.concat(chunks),
      type: response.headers.get('content-type') || 'application/json',
      download:
        response.headers.get('content-type')?.includes('application/vnd.android') ||
        uri.split('?')[0].endsWith('/apk') ||
        uri.split('?')[0].endsWith('/source.zip'),
    };
  }
}
