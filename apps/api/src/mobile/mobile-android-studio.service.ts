import { ForbiddenException, HttpException, Injectable, ServiceUnavailableException } from '@nestjs/common';
import type { Actor } from '../auth/auth.guard';
import { AndroidAgentService, androidOwner } from '../programming/android-agent.service';
type Build = {
  status: 'running' | 'cancel_requested' | 'succeeded' | 'failed';
  startedAt: string;
  completedAt: string | null;
  message: string;
};
const bounded = (value: unknown, max = 20000) => (typeof value === 'string' ? value.slice(0, max) : '');
@Injectable()
export class MobileAndroidStudioService {
  private builds = new Map<string, Build>();
  constructor(private readonly agent: AndroidAgentService) {}
  async access(actor: Actor) {
    if (actor.clientType !== 'MOBILE') throw new ForbiddenException('请使用学生手机会话');
    await this.agent.access(actor);
  }
  async json(actor: Actor, path: string, method = 'GET', input?: unknown, query = '') {
    await this.access(actor);
    const out = await this.agent.request(actor, path, method, query, input);
    let value: Record<string, unknown>;
    try {
      value = JSON.parse(out.body.toString('utf8')) as Record<string, unknown>;
    } catch {
      throw new ServiceUnavailableException('Android 服务返回格式无效');
    }
    if (out.status < 200 || out.status >= 300)
      throw new HttpException(
        bounded(value.detail, 500) || 'Android 工作区操作失败',
        out.status >= 400 && out.status < 600 ? out.status : 502,
      );
    return value;
  }
  async status(actor: Actor) {
    await this.access(actor);
    return this.agent.status(actor);
  }
  async templates(actor: Actor) {
    await this.access(actor);
    return {
      items: [
        {
          id: 'kotlin-basic',
          title: 'Kotlin 基础应用',
          description: '来自当前构建器的原生 Android 基础模板，可修改界面与资源后构建调试 APK。',
        },
      ],
    };
  }
  async projects(actor: Actor) {
    const data = await this.json(actor, 'api/projects');
    return {
      items: (Array.isArray(data.projects) ? data.projects : []).map((value) =>
        this.project(value as Record<string, unknown>),
      ),
    };
  }
  project(value: Record<string, unknown>) {
    return {
      id: bounded(value.id, 100),
      name: bounded(value.name, 200),
      package: bounded(value.package, 255),
      hasApk: value.has_apk === true,
      createdAt:
        typeof value.created_at === 'number' ? new Date(value.created_at * 1000).toISOString() : null,
      latestStatus: bounded(value.latest_status, 100),
      buildLogs: (Array.isArray(value.build_logs) ? value.build_logs : []).map((log) => ({
        id: bounded((log as Record<string, unknown>).id, 100),
      })),
    };
  }
  async detail(actor: Actor, id: string) {
    return this.project(await this.json(actor, `api/projects/${id}`));
  }
  async create(actor: Actor, input: { name: string; package?: string }) {
    return this.project(await this.json(actor, 'api/projects', 'POST', input));
  }
  async files(actor: Actor, id: string, path: string) {
    const data = await this.json(
      actor,
      `api/projects/${id}/files`,
      'GET',
      undefined,
      '?path=' + encodeURIComponent(path),
    );
    return {
      path,
      entries: (Array.isArray(data.entries) ? data.entries : []).slice(0, 500).map((entry) => {
        const v = entry as Record<string, unknown>;
        return {
          name: bounded(v.name, 500),
          path: bounded(v.path, 500),
          type: v.type === 'dir' ? 'dir' : 'file',
        };
      }),
    };
  }
  async file(actor: Actor, id: string, path: string) {
    const data = await this.json(
      actor,
      `api/projects/${id}/files/content`,
      'GET',
      undefined,
      '?path=' + encodeURIComponent(path),
    );
    const content = bounded(data.content, 200000),
      truncated =
        data.truncated === true ||
        content.length !== (typeof data.content === 'string' ? data.content.length : 0) ||
        Buffer.byteLength(content) > 600000;
    return {
      path,
      content,
      revision: bounded(data.revision, 64),
      writable: data.writable === true && path.startsWith('app/src/') && !truncated,
      truncated,
    };
  }
  async save(actor: Actor, id: string, input: { path: string; content: string; revision: string }) {
    await this.json(actor, `api/projects/${id}/files/content`, 'PUT', {
      path: input.path,
      content: input.content,
      expected_revision: input.revision,
    });
    return this.file(actor, id, input.path);
  }
  job(value: Record<string, unknown>) {
    return {
      id: bounded(value.id, 100),
      projectId: bounded(value.project_id, 100),
      status: bounded(value.status, 100),
      prompt: bounded(value.prompt),
      result: bounded(value.result),
      error: bounded(value.error),
      hasApk: value.has_apk === true,
      runMode: bounded(value.run_mode, 100),
    };
  }
  async jobs(actor: Actor, id: string) {
    await this.detail(actor, id);
    const data = await this.json(
      actor,
      'api/jobs',
      'GET',
      undefined,
      '?project_id=' + encodeURIComponent(id),
    );
    return {
      items: (Array.isArray(data.jobs) ? data.jobs : [])
        .slice(0, 100)
        .map((j) => this.job(j as Record<string, unknown>)),
    };
  }
  async generate(actor: Actor, id: string, input: { prompt: string; mode: string }) {
    const data = await this.json(actor, `api/projects/${id}/ask`, 'POST', {
      prompt: input.prompt,
      run_mode: input.mode,
      auto_fallback: false,
    });
    return this.job(data.job as Record<string, unknown>);
  }
  async task(actor: Actor, id: string, cancel = false) {
    const data = await this.json(
      actor,
      `api/jobs/${id}${cancel ? '/cancel' : ''}`,
      cancel ? 'POST' : 'GET',
      cancel ? {} : undefined,
    );
    return this.job(data.job as Record<string, unknown>);
  }
  async approvals(actor: Actor, id: string) {
    return this.json(actor, `api/jobs/${id}/approvals`);
  }
  async approve(actor: Actor, id: string, approvalId: string, approved: boolean) {
    return this.json(actor, `api/jobs/${id}/approvals/${approvalId}`, 'POST', { approved });
  }
  async log(actor: Actor, id: string, logId: string) {
    const data = await this.json(actor, `api/projects/${id}/builds/${logId}`);
    return { content: bounded(data.content, 100000) };
  }
  private key(actor: Actor, id: string) {
    return androidOwner(actor) + ':' + id;
  }
  async buildStatus(actor: Actor, id: string) {
    await this.detail(actor, id);
    return { build: this.builds.get(this.key(actor, id)) || null };
  }
  async build(actor: Actor, id: string) {
    await this.detail(actor, id);
    const key = this.key(actor, id),
      existing = this.builds.get(key);
    if (existing && ['running', 'cancel_requested'].includes(existing.status)) return { build: existing };
    for (const [k, row] of this.builds)
      if (row.completedAt && Date.now() - Date.parse(row.completedAt) > 3600000) this.builds.delete(k);
    if ([...this.builds.values()].filter((b) => !b.completedAt).length >= 2 || this.builds.size >= 128)
      throw new HttpException('构建资源繁忙，请稍后重试', 429);
    const row: Build = {
      status: 'running',
      startedAt: new Date().toISOString(),
      completedAt: null,
      message: '已提交构建，请等待实际结果',
    };
    this.builds.set(key, row);
    void this.json(actor, `api/projects/${id}/build`, 'POST', {})
      .then(
        (out) => {
          row.status = out.ok === true ? 'succeeded' : 'failed';
          row.message = bounded(out.message, 100000) || '构建已结束';
        },
        () => {
          row.status = 'failed';
          row.message = '构建响应未能确认，请刷新项目并查看实际构建日志。';
        },
      )
      .finally(() => {
        row.completedAt = new Date().toISOString();
      });
    return { build: row };
  }
  async cancelBuild(actor: Actor, id: string) {
    await this.json(actor, `api/projects/${id}/build/cancel`, 'POST', {});
    const row = this.builds.get(this.key(actor, id));
    if (row && !row.completedAt) row.status = 'cancel_requested';
    return { build: row || null };
  }
  async download(actor: Actor, id: string, source: boolean) {
    await this.access(actor);
    const out = await this.agent.request(
      actor,
      `api/projects/${id}/${source ? 'source.zip' : 'apk'}`,
      'GET',
      '',
      undefined,
    );
    if (out.status !== 200)
      throw new HttpException(
        out.status === 404 ? '尚无可下载构建文件' : '文件暂时无法下载',
        out.status >= 400 && out.status < 600 ? out.status : 502,
      );
    if (out.body.length > 50 * 1024 * 1024) throw new HttpException('文件超过手机 50 MiB 下载上限', 413);
    return {
      body: out.body,
      type: source ? 'application/zip' : 'application/vnd.android.package-archive',
      filename: source ? 'android-source.zip' : 'android-app.apk',
    };
  }
}
