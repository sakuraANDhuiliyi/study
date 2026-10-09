import {
  Injectable,
  OnModuleDestroy,
  OnModuleInit,
  ServiceUnavailableException,
  HttpException,
} from '@nestjs/common';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { randomBytes } from 'node:crypto';
import { AuthService } from '../auth/auth.service';
import type { Actor } from '../auth/auth.guard';
import { PrismaService } from '../common/prisma.service';
import { programmingFilePath, programmingFilesSchema, type ProgrammingFile } from './programming.schemas';
import { creativeItems } from './creative.catalog';

const lifetimeMs = 10 * 60 * 1000;
const readWindowMs = 60_000;
// A maximum-size page can request all 24 files together; one owner still leaves
// eight of the 32 validation slots available for other students.
const maxReadBuckets = 1024;
type ReadBucket = { startedAt: number; count: number };
export function readProgrammingPreviewReadLimits(
  environment: Record<string, string | undefined> = process.env,
) {
  const bounded = (name: string, fallback: number, minimum: number, maximum: number) => {
    const raw = environment[name];
    const value = raw && /^\d+$/.test(raw) ? Number(raw) : NaN;
    return Number.isInteger(value) && value >= minimum && value <= maximum ? value : fallback;
  };
  return {
    userConcurrency: bounded('PROGRAMMING_PREVIEW_USER_CONCURRENCY', 24, 1, 24),
    userReads: bounded('PROGRAMMING_PREVIEW_USER_READS_PER_MINUTE', 480, 48, 9600),
    tokenReads: bounded('PROGRAMMING_PREVIEW_TOKEN_READS_PER_MINUTE', 240, 24, 4800),
    ipReads: bounded('PROGRAMMING_PREVIEW_IP_READS_PER_MINUTE', 9600, 240, 100000),
  };
}
type PreviewConfiguration = {
  enabled: boolean;
  port: number;
  bindHost: string;
  origin: string;
  appOrigin: string;
  reason: string;
};

export function readProgrammingPreviewConfiguration(
  environment: Record<string, string | undefined> = process.env,
): PreviewConfiguration {
  const empty = { enabled: false, port: 4173, bindHost: '127.0.0.1', origin: '', appOrigin: '', reason: '' };
  if (environment.PROGRAMMING_PREVIEW_ENABLED === 'false') return { ...empty, reason: '本地预览已关闭' };
  if (environment.NODE_ENV === 'production' && !environment.PROGRAMMING_PREVIEW_ORIGIN)
    return { ...empty, reason: '独立预览地址尚未配置' };
  try {
    if (environment.PROGRAMMING_PREVIEW_ENABLED && environment.PROGRAMMING_PREVIEW_ENABLED !== 'true')
      throw new Error();
    const port = Number(environment.PROGRAMMING_PREVIEW_PORT || 4173);
    if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error();
    const bindHost = environment.PROGRAMMING_PREVIEW_BIND_HOST || environment.BIND_HOST || '127.0.0.1';
    if (!['127.0.0.1', 'localhost', '0.0.0.0', '::1', '::'].includes(bindHost)) throw new Error();
    const origin = new URL(environment.PROGRAMMING_PREVIEW_ORIGIN || `http://127.0.0.1:${port}`);
    const app = new URL(environment.APP_ORIGIN || 'http://localhost:5173');
    for (const value of [origin, app])
      if (
        !['http:', 'https:'].includes(value.protocol) ||
        value.username ||
        value.password ||
        value.search ||
        value.hash ||
        value.pathname !== '/'
      )
        throw new Error();
    // Cookies are host-scoped, not port-scoped: require a distinct hostname as well as origin.
    if (origin.origin === app.origin || origin.hostname === app.hostname) throw new Error();
    if (environment.NODE_ENV === 'production') {
      if (origin.protocol !== 'https:' || app.protocol !== 'https:') throw new Error();
    } else if (origin.protocol === 'http:' && !['localhost', '127.0.0.1', '[::1]'].includes(origin.hostname))
      throw new Error();
    return { enabled: true, port, bindHost, origin: origin.origin, appOrigin: app.origin, reason: '' };
  } catch {
    return { ...empty, reason: '预览地址配置无效，请使用与学习平台不同的主机名' };
  }
}

export function previewContentType(path: string) {
  const types: Record<string, string> = {
    html: 'text/html; charset=utf-8',
    css: 'text/css; charset=utf-8',
    js: 'text/javascript; charset=utf-8',
    json: 'application/json; charset=utf-8',
    md: 'text/plain; charset=utf-8',
    txt: 'text/plain; charset=utf-8',
    svg: 'image/svg+xml',
  };
  return types[path.split('.').at(-1) || ''] || 'text/plain; charset=utf-8';
}

export function programmingPreviewHeaders(input: {
  origin: string;
  appOrigin: string;
}): Record<string, string> {
  return {
    'Content-Security-Policy': [
      "default-src 'none'",
      `script-src 'unsafe-inline' ${input.origin}`,
      `style-src 'unsafe-inline' ${input.origin}`,
      `img-src ${input.origin} data:`,
      "connect-src 'none'",
      "font-src 'none'",
      "media-src 'none'",
      "frame-src 'none'",
      "object-src 'none'",
      "base-uri 'none'",
      "form-action 'none'",
      `frame-ancestors ${input.appOrigin}`,
      'sandbox allow-scripts',
    ].join('; '),
    'X-Content-Type-Options': 'nosniff',
    'Cache-Control': 'no-store',
    'Referrer-Policy': 'no-referrer',
    'Access-Control-Allow-Origin': '*',
    'Cross-Origin-Resource-Policy': 'cross-origin',
    'Cross-Origin-Opener-Policy': 'same-origin',
    'Origin-Agent-Cluster': '?1',
    'Permissions-Policy':
      'camera=(), microphone=(), geolocation=(), payment=(), usb=(), clipboard-read=(), clipboard-write=()',
  };
}

export function buildProgrammingPreviewHtml(html: string, input: { nonce: string; appOrigin: string }) {
  // Escape even though normal callers supply a random hex nonce and a validated origin.
  const data = JSON.stringify(input)
    .replaceAll('<', '\\u003c')
    .replaceAll('>', '\\u003e')
    .replaceAll('&', '\\u0026');
  const hook = `<script>(function(){"use strict";const settings=${data};let emitted=0;const send=(level,values)=>{if(emitted++>=200)return;let text;try{text=values.map(value=>typeof value==="string"?value:JSON.stringify(value)).join(" ")}catch{text="[无法显示的日志]"}window.parent.postMessage({type:"programming-preview-log",nonce:settings.nonce,level,text:String(text||"").slice(0,2000)},settings.appOrigin)};for(const level of ["log","info","warn","error","debug"]){const original=console[level].bind(console);console[level]=(...values)=>{send(level,values.slice(0,8));original(...values)}}window.addEventListener("error",event=>send("error",[event.message]));window.addEventListener("unhandledrejection",event=>send("error",[String(event.reason)]))})();</script>`;
  const head = /<head\b[^>]*>/i.exec(html);
  if (!head) return hook + html;
  const position = head.index + head[0].length;
  return html.slice(0, position) + hook + html.slice(position);
}

type Snapshot = {
  projectId: string | null;
  creativeId?: string;
  organizationId: string;
  userId: string;
  sessionId: string;
  createdAt: number;
  expiresAt: number;
  nonce: string;
  files: ProgrammingFile[];
};
@Injectable()
export class ProgrammingPreviewService implements OnModuleInit, OnModuleDestroy {
  private readonly configuration = readProgrammingPreviewConfiguration();
  private readonly readLimits = readProgrammingPreviewReadLimits();
  private readonly snapshots = new Map<string, Snapshot>();
  private readonly requests = new Map<string, number[]>();
  private readonly readRequests = new Map<string, ReadBucket>();
  private readonly activeUsers = new Map<string, number>();
  private cleanupTimer?: ReturnType<typeof setInterval>;
  private server?: Server;
  private ready = false;
  private active = 0;
  constructor(
    private readonly auth: AuthService,
    private readonly db: PrismaService,
  ) {}

  async onModuleInit() {
    if (!this.configuration.enabled) return;
    this.cleanupTimer = setInterval(() => this.cleanup(), readWindowMs);
    this.cleanupTimer.unref();
    this.server = createServer((request, response) => {
      void this.serve(request, response);
    });
    this.server.headersTimeout = 10000;
    this.server.requestTimeout = 10000;
    this.server.maxConnections = 64;
    await new Promise<void>((resolve) => {
      this.server!.once('error', () => {
        this.ready = false;
        resolve();
      });
      this.server!.listen(this.configuration.port, this.configuration.bindHost, () => {
        this.ready = true;
        resolve();
      });
    });
  }
  async onModuleDestroy() {
    this.ready = false;
    this.snapshots.clear();
    this.requests.clear();
    this.readRequests.clear();
    if (this.cleanupTimer) clearInterval(this.cleanupTimer);
    if (!this.server?.listening) return;
    await new Promise<void>((resolve) => {
      this.server!.close(() => resolve());
      this.server!.closeAllConnections();
    });
  }
  status() {
    return {
      available: this.ready,
      origin: this.configuration.origin,
      reason: this.ready ? '' : this.configuration.reason || '预览服务未启动，请检查独立预览端口是否被占用',
    };
  }
  private cleanup() {
    const now = Date.now();
    for (const [token, snapshot] of this.snapshots)
      if (snapshot.expiresAt <= now) this.snapshots.delete(token);
    for (const [key, stamps] of this.requests) {
      const recent = stamps.filter((stamp) => now - stamp < 60000);
      if (recent.length) this.requests.set(key, recent);
      else this.requests.delete(key);
    }
    for (const [key, bucket] of this.readRequests)
      if (now - bucket.startedAt >= readWindowMs) this.readRequests.delete(key);
  }
  private admitRead(token: string, userId: string, ip: string) {
    const now = Date.now();
    const limits = [
      { key: `user:${userId}`, limit: this.readLimits.userReads },
      { key: `token:${token}`, limit: this.readLimits.tokenReads },
      // The socket peer may be a school NAT or proxy. Forwarded headers are
      // untrusted on this listener; keep the peer limit generous for shared IPs.
      { key: `ip:${ip}`, limit: this.readLimits.ipReads },
    ];
    for (const { key, limit } of limits) {
      const bucket = this.readRequests.get(key);
      if (bucket && bucket.count >= limit)
        return {
          status: 429,
          retryAfter: Math.max(1, Math.ceil((bucket.startedAt + readWindowMs - now) / 1000)),
        };
    }
    const additional = limits.filter(({ key }) => !this.readRequests.has(key)).length;
    if (this.readRequests.size + additional > maxReadBuckets) return { status: 503, retryAfter: 1 };
    for (const { key } of limits) {
      const bucket = this.readRequests.get(key) || { startedAt: now, count: 0 };
      bucket.count++;
      this.readRequests.set(key, bucket);
    }
    return null;
  }
  revokeProject(projectId: string) {
    for (const [token, snapshot] of this.snapshots)
      if (snapshot.projectId === projectId) this.snapshots.delete(token);
  }
  async issue(
    actor: Actor,
    project: { id: string; organizationId: string; userId: string },
    files: ProgrammingFile[],
  ) {
    return this.issueSnapshot(actor, { ...project, creativeId: undefined }, files);
  }
  async issueCreative(actor: Actor, creativeId: string, files: ProgrammingFile[]) {
    if (!creativeItems.some((item) => item.id === creativeId))
      throw new ServiceUnavailableException('创意作品已不可用');
    return this.issueSnapshot(
      actor,
      { id: null, organizationId: actor.organizationId, userId: actor.id, creativeId },
      files,
    );
  }
  private async issueSnapshot(
    actor: Actor,
    project: { id: string | null; organizationId: string; userId: string; creativeId?: string },
    files: ProgrammingFile[],
  ) {
    if (!this.ready) throw new ServiceUnavailableException(this.status().reason);
    const checked = programmingFilesSchema.parse(files);
    const fresh = actor.sessionId ? await this.auth.resolveSessionId(actor.sessionId) : null;
    if (
      !fresh ||
      fresh.id !== actor.id ||
      fresh.organizationId !== actor.organizationId ||
      fresh.role !== 'STUDENT' ||
      !fresh.permissions.includes('learning.use')
    )
      throw new ServiceUnavailableException('当前编程会话已失效，请重新登录');
    await this.auth.checkFeature(fresh, '/api/programming');
    if (project.organizationId !== fresh.organizationId || project.userId !== fresh.id)
      throw new ServiceUnavailableException('项目访问资格已变化');
    this.cleanup();
    const key = `${fresh.organizationId}:${fresh.id}`;
    const stamps = this.requests.get(key) || [];
    if (stamps.length >= 20) throw new HttpException('预览运行过于频繁，请稍后重试', 429);
    if (!this.requests.has(key) && this.requests.size >= 256)
      throw new ServiceUnavailableException('预览服务繁忙，请稍后重试');
    stamps.push(Date.now());
    this.requests.set(key, stamps);
    const own = [...this.snapshots.entries()].filter(
      ([, item]) => item.userId === fresh.id && item.organizationId === fresh.organizationId,
    );
    while (own.length >= 3) this.snapshots.delete(own.shift()![0]);
    if (this.snapshots.size >= 128)
      throw new ServiceUnavailableException('预览服务已达到容量上限，请稍后重试');
    const token = randomBytes(32).toString('hex'),
      nonce = randomBytes(16).toString('hex');
    const expiresAt = Date.now() + lifetimeMs;
    this.snapshots.set(token, {
      projectId: project.id,
      creativeId: project.creativeId,
      organizationId: fresh.organizationId,
      userId: fresh.id,
      sessionId: fresh.sessionId!,
      files: checked.map((file) => ({ ...file })),
      createdAt: Date.now(),
      expiresAt,
      nonce,
    });
    return {
      url: `${this.configuration.origin}/preview/${token}/index.html`,
      nonce,
      expiresAt: new Date(expiresAt).toISOString(),
    };
  }
  private finish(
    response: ServerResponse,
    status: number,
    content: string,
    type = 'text/plain; charset=utf-8',
    head = false,
    retryAfter?: number,
  ) {
    response.writeHead(status, {
      ...programmingPreviewHeaders(this.configuration),
      'Content-Type': type,
      ...(retryAfter ? { 'Retry-After': String(retryAfter) } : {}),
    });
    response.end(head ? undefined : content);
  }
  private async serve(request: IncomingMessage, response: ServerResponse) {
    let userId: string | undefined;
    try {
      if (!['GET', 'HEAD'].includes(request.method || ''))
        return this.finish(response, 405, '仅支持只读预览');
      if (request.headers.host?.toLowerCase() !== new URL(this.configuration.origin).host.toLowerCase())
        return this.finish(response, 404, '预览地址不可用');
      const match = /^\/preview\/([a-f0-9]{64})\/([^?#]+)(?:\?[^#]*)?$/.exec(request.url || '');
      if (!match) return this.finish(response, 404, '预览不存在或已经过期');
      let path: string;
      try {
        path = decodeURIComponent(match[2]);
      } catch {
        return this.finish(response, 404, '文件不存在');
      }
      if (!programmingFilePath.safeParse(path).success) return this.finish(response, 404, '文件不存在');
      this.cleanup();
      const snapshot = this.snapshots.get(match[1]);
      if (!snapshot) return this.finish(response, 404, '预览不存在或已经过期，请重新运行');
      // Acquire all quotas synchronously before session/database work. Multiple
      // tokens and organizations belonging to one user share the same allowance.
      const activeUser = this.activeUsers.get(snapshot.userId) || 0;
      if (activeUser >= this.readLimits.userConcurrency)
        return this.finish(
          response,
          429,
          '当前用户的预览读取过多，请稍后重试',
          undefined,
          request.method === 'HEAD',
          1,
        );
      if (this.active >= 32)
        return this.finish(
          response,
          503,
          '预览服务繁忙，请稍后重试',
          undefined,
          request.method === 'HEAD',
          1,
        );
      const limited = this.admitRead(match[1], snapshot.userId, request.socket.remoteAddress || 'unknown');
      if (limited)
        return this.finish(
          response,
          limited.status,
          '预览读取过于频繁，请稍后重试',
          undefined,
          request.method === 'HEAD',
          limited.retryAfter,
        );
      userId = snapshot.userId;
      this.active++;
      this.activeUsers.set(userId, activeUser + 1);
      const actor = await this.auth.resolveSessionId(snapshot.sessionId);
      if (
        !actor ||
        actor.id !== snapshot.userId ||
        actor.organizationId !== snapshot.organizationId ||
        actor.role !== 'STUDENT' ||
        !actor.permissions.includes('learning.use')
      ) {
        this.snapshots.delete(match[1]);
        return this.finish(response, 404, '预览访问资格已经失效');
      }
      await this.auth.checkFeature(actor, '/api/programming');
      if (
        snapshot.projectId &&
        !(await this.db.programmingProject.findFirst({
          where: { id: snapshot.projectId, organizationId: actor.organizationId, userId: actor.id },
          select: { id: true },
        }))
      ) {
        this.snapshots.delete(match[1]);
        return this.finish(response, 404, '项目已不可用');
      }
      if (
        !snapshot.projectId &&
        (!snapshot.creativeId || !creativeItems.some((item) => item.id === snapshot.creativeId))
      ) {
        this.snapshots.delete(match[1]);
        return this.finish(response, 404, '创意作品已不可用');
      }
      const file = snapshot.files.find((item) => item.path === path);
      if (!file) return this.finish(response, 404, '文件不存在');
      const content = path.endsWith('.html')
        ? buildProgrammingPreviewHtml(file.content, {
            nonce: snapshot.nonce,
            appOrigin: this.configuration.appOrigin,
          })
        : file.content;
      this.finish(response, 200, content, previewContentType(path), request.method === 'HEAD');
    } catch {
      // Never expose request tokens, database details or upstream exception messages.
      if (!response.headersSent) this.finish(response, 404, '预览暂时不可用，请重新运行');
      else response.end();
    } finally {
      if (userId) {
        this.active--;
        const remaining = (this.activeUsers.get(userId) || 1) - 1;
        if (remaining) this.activeUsers.set(userId, remaining);
        else this.activeUsers.delete(userId);
      }
    }
  }
}
