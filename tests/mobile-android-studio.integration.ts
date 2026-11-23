import 'reflect-metadata';
import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:net';
import { createLiveFixture } from './live.fixture';
import { MobileClient, MobileApiError } from '../apps/mobile/src/client';
import { type Project } from '../apps/mobile/src/programming-model';
import { AuthService } from '../apps/api/src/auth/auth.service';
import { PrismaService } from '../apps/api/src/common/prisma.service';
import { ProgrammingPreviewService } from '../apps/api/src/programming/programming-preview.service';
test(
  'native Android workspace scope and real credential-bound isolated website preview',
  { timeout: 180000 },
  async (t) => {
    const f = await createLiveFixture();
    let preview: ProgrammingPreviewService | undefined;
    const login = async (username: string) => {
      let raw: string | null = null;
      const c = new MobileClient(
        f.origin,
        {
          get: async () => raw,
          set: async (v) => {
            raw = v;
          },
          remove: async () => {
            raw = null;
          },
        },
        () => {},
      );
      await c.login(username, f.password);
      return c;
    };
    const denied = (p: Promise<unknown>, status: number) =>
      assert.rejects(p, (e) => e instanceof MobileApiError && e.status === status);
    try {
      const student = await login(f.users.student.username),
        peer = await login(f.users.student2.username),
        teacher = await login(f.users.teacher.username);
      let project: Project;
      await t.test(
        'disabled local Android agent stays honest and exposes no generic bridge to mobile',
        async () => {
          const out = await student.request<{ available: boolean; reason: string }>(
            '/mobile/android-studio/status',
          );
          assert.equal(out.available, false);
          assert.match(out.reason, /尚未启动/);
          const templates = await student.request<{ items: { id: string }[] }>(
            '/mobile/android-studio/templates',
          );
          assert.deepEqual(
            templates.items.map((x) => x.id),
            ['kotlin-basic'],
          );
          await denied(student.request('/mobile/android-studio/projects'), 503);
          await denied(teacher.request('/mobile/android-studio/status'), 403);
          await f.call(f.clients.student, '/mobile/android-studio/status', 'GET', undefined, 403);
          await denied(student.request('/programming/android/bridge/api/projects'), 403);
          await denied(student.request('/mobile/android-studio/projects/p/file?path=..%2Fprivate'), 400);
          await denied(
            student.request('/mobile/android-studio/projects', { name: 'x', owner: 'peer' }, 'POST'),
            400,
          );
          await denied(
            student.request(
              '/mobile/android-studio/projects/p/file',
              { path: 'app/src/main/a.kt', content: 'x' },
              'PUT',
            ),
            400,
          );
        },
      );
      await t.test(
        'native preview controller uses a saved private revision and enforces ownership before disabled status',
        async () => {
          project = await student.request<Project>(
            '/mobile/programming/projects',
            { title: '原生隔离预览', templateId: 'counter' },
            'POST',
          );
          const status = await student.request<{ available: boolean }>('/mobile/programming-preview/status');
          assert.equal(status.available, false);
          const path = '/mobile/programming-preview/projects/' + project.id;
          await denied(peer.request(path, { revision: project.revision }, 'POST'), 404);
          await denied(teacher.request(path, { revision: project.revision }, 'POST'), 403);
          await denied(student.request(path, { revision: project.revision + 1 }, 'POST'), 409);
          await denied(
            student.request(path, { revision: project.revision, files: project.files }, 'POST'),
            400,
          );
          await denied(student.request(path, { revision: project.revision }, 'POST'), 503);
        },
      );
      await t.test(
        'actual isolated origin serves only the permitted snapshot with sandbox and no learning credentials',
        async () => {
          const socket = createServer();
          await new Promise<void>((resolve) => socket.listen(0, '127.0.0.1', resolve));
          const port = (socket.address() as { port: number }).port;
          await new Promise<void>((resolve) => socket.close(() => resolve()));
          const names = [
              'NODE_ENV',
              'PROGRAMMING_PREVIEW_ENABLED',
              'PROGRAMMING_PREVIEW_PORT',
              'PROGRAMMING_PREVIEW_ORIGIN',
              'PROGRAMMING_PREVIEW_BIND_HOST',
              'APP_ORIGIN',
            ],
            before = Object.fromEntries(names.map((name) => [name, process.env[name]]));
          const auth = new AuthService(f.db as unknown as PrismaService);
          try {
            Object.assign(process.env, {
              NODE_ENV: 'test',
              PROGRAMMING_PREVIEW_ENABLED: 'true',
              PROGRAMMING_PREVIEW_PORT: String(port),
              PROGRAMMING_PREVIEW_ORIGIN: 'http://127.0.0.1:' + port,
              PROGRAMMING_PREVIEW_BIND_HOST: '127.0.0.1',
              APP_ORIGIN: 'http://localhost:5173',
            });
            preview = new ProgrammingPreviewService(auth, f.db as unknown as PrismaService);
          } finally {
            for (const key of names) {
              if (before[key] === undefined) delete process.env[key];
              else process.env[key] = before[key];
            }
          }
          await preview.onModuleInit();
          assert.equal(preview.status().available, true);
          const session = await f.db.session.findFirstOrThrow({
              where: { userId: f.users.student.id, clientType: 'MOBILE' },
              orderBy: { createdAt: 'desc' },
            }),
            actor = await auth.resolveMobileSessionId(session.id);
          assert.ok(actor);
          const stored = await f.db.programmingProject.findUniqueOrThrow({ where: { id: project.id } });
          const snapshot = await preview.issue(actor, stored, [
            {
              path: 'index.html',
              content: '<!doctype html><h1>原生私有预览</h1><script>console.log("preview")</script>',
            },
          ]);
          const response = await fetch(snapshot.url);
          assert.equal(response.status, 200);
          const body = await response.text();
          assert.ok(body.includes('原生私有预览'));
          assert.ok(!body.includes(actor.csrfToken || 'UNLIKELY'));
          assert.equal(response.headers.get('set-cookie'), null);
          assert.equal(response.headers.get('referrer-policy'), 'no-referrer');
          assert.match(response.headers.get('content-security-policy') || '', /sandbox allow-scripts/);
          assert.match(response.headers.get('content-security-policy') || '', /connect-src 'none'/);
          assert.equal(response.headers.get('cache-control'), 'no-store');
          const forbidden = await fetch(snapshot.url.replace('/index.html', '/missing.js'));
          assert.equal(forbidden.status, 404);
          await f.db.mobileCredential.delete({ where: { sessionId: session.id } });
          assert.ok(
            await f.db.session.findUnique({ where: { id: session.id } }),
            'underlying Session deliberately survives',
          );
          assert.equal(
            (await fetch(snapshot.url)).status,
            404,
            'removing mobile credential invalidates issued preview immediately',
          );
          await assert.rejects(preview.issue(actor, stored, [{ path: 'index.html', content: 'denied' }]));
        },
      );
    } finally {
      await preview?.onModuleDestroy();
      await f.cleanup();
    }
  },
);
