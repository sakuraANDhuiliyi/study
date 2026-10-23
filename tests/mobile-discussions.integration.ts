import 'reflect-metadata';
import test from 'node:test';
import assert from 'node:assert/strict';
import { createLiveFixture, runFixtureJobs, liveWait } from './live.fixture';
import { MobileClient } from '../apps/mobile/src/client';
import { discussionsApi, type DiscussionWrite } from '../apps/mobile/src/discussions-model';
test(
  'native course discussions: shared records, moderation, private receipts and serialized writes',
  { timeout: 240000 },
  async (t) => {
    const f = await createLiveFixture();
    const mobile = async (username: string, fetcher: typeof fetch = fetch) => {
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
        fetcher,
      );
      await c.login(username, f.password);
      return c;
    };
    const denied = (p: Promise<unknown>, status: number) =>
      assert.rejects(p, (e) => (e as { status: number }).status === status);
    const enroll = (active: boolean) =>
      f.db.enrollment.update({
        where: { courseId_userId: { courseId: f.course.id, userId: f.users.student.id } },
        data: { active },
      });
    try {
      const student = await mobile(f.users.student.username),
        teacher = await mobile(f.users.teacher.username),
        outsider = await mobile(f.users.outsider.username);
      const topics: any[] = [];
      for (let i = 0; i < 12; i++)
        topics.push(
          (
            await f.call(f.clients.teacher, '/communication/posts', 'POST', {
              courseId: f.course.id,
              title: 'Native-topic-' + i,
              body: 'Shared body ' + i,
            })
          ).body,
        );
      const post = topics[0];
      await f.call(f.clients.teacher, '/communication/posts/' + post.id, 'PATCH', {
        pinned: true,
        featured: true,
      });
      const list = (q = '') => student.request<any>('/mobile/discussions' + q);
      const read = (id = post.id, q = '') => student.request<any>('/mobile/discussions/' + id + q);
      const reply = (key: string, body = 'Native reply', quoteReplyId?: string): DiscussionWrite => ({
        kind: 'reply',
        postId: post.id,
        input: { key, body, ...(quoteReplyId ? { quoteReplyId } : {}) },
      });
      const topic: DiscussionWrite = {
        kind: 'post',
        input: {
          courseId: f.course.id,
          title: 'Literal 100%_\\ title',
          body: 'Native topic body',
          key: 'new-topic-key',
        },
      };
      await t.test('only student device sessions can use strict bounded native routes', async () => {
        assert.equal((await fetch(f.origin + '/api/mobile/discussions')).status, 401);
        await f.call(f.clients.student, '/mobile/discussions', 'GET', undefined, 403);
        await denied(teacher.request('/mobile/discussions'), 403);
        await denied(student.request('/communication/posts'), 403);
        for (const q of [
          '?page=0',
          '?pageSize=21',
          '?authorId=x',
          '?search=' + 'x'.repeat(101),
          '?featured=yes',
        ])
          await denied(list(q), 400);
        await denied(student.request('/mobile/discussions', { ...topic.input, hidden: true }, 'POST'), 400);
        await denied(
          student.request(
            '/mobile/discussions/' + post.id + '/replies',
            { ...reply('bad-body-key').input, authorId: f.users.teacher.id },
            'POST',
          ),
          400,
        );
      });
      await t.test('stable pinned-first paging and explicit safe summaries match website scope', async () => {
        const a = await list(),
          b = await list('?page=2');
        assert.equal(a.total, 12);
        assert.equal(a.items.length, 10);
        assert.equal(b.items.length, 2);
        assert.equal(a.items[0].id, post.id);
        assert.equal(new Set([...a.items, ...b.items].map((r) => r.id)).size, 12);
        assert.equal((await list('?featured=true')).total, 1);
        assert.equal((await list('?search=NATIVE-TOPIC-')).total, 12);
        const wire = JSON.stringify(a);
        for (const key of [
          'authorId',
          'organizationId',
          'mobileCreateKey',
          'mobileCreateHash',
          'Shared body',
        ])
          assert.ok(!wire.includes(key));
        await denied(outsider.request('/mobile/discussions/' + post.id), 404);
        await denied(outsider.request('/mobile/discussions?courseId=' + f.course.id), 404);
      });
      await t.test(
        'parallel repeated topic creation produces one shared website record and hidden request identities',
        async () => {
          const results = await Promise.all(
            Array.from({ length: 5 }, () => discussionsApi.publish(student, topic)),
          );
          assert.equal(new Set(results.map((r) => r.id)).size, 1);
          assert.equal(
            await f.db.discussionPost.count({
              where: { authorId: f.users.student.id, mobileCreateKey: topic.input.key },
            }),
            1,
          );
          assert.equal((await list('?search=' + encodeURIComponent('100%_\\'))).total, 1);
          const web = (await f.call(f.clients.student, '/communication/posts/' + results[0].id)).body;
          assert.equal(web.body, 'Native topic body');
          assert.ok(!JSON.stringify(web).includes('mobileCreate'));
          assert.ok(
            !JSON.stringify((await f.call(f.clients.student, '/communication/posts')).body).includes(
              'mobileCreate',
            ),
          );
          await denied(
            discussionsApi.publish(student, { kind: 'post', input: { ...topic.input, body: 'Changed' } }),
            409,
          );
          const empty = await discussionsApi.receipt(outsider, topic);
          assert.deepEqual(empty, { found: false });
        },
      );
      let firstReply = '';
      await t.test(
        'parallel reply retries create one reply and one durable author notification',
        async () => {
          const r = reply('same-reply-key');
          const results = await Promise.all(
            Array.from({ length: 5 }, () => discussionsApi.publish(student, r)),
          );
          firstReply = results[0].id;
          assert.equal(new Set(results.map((x) => x.id)).size, 1);
          assert.equal(await f.db.discussionReply.count({ where: { postId: post.id } }), 1);
          assert.equal(
            await f.db.backgroundJob.count({ where: { eventKey: 'notify:reply:' + firstReply } }),
            1,
          );
          runFixtureJobs(f.env);
          assert.equal(
            await f.db.notification.count({
              where: { userId: f.users.teacher.id, eventKey: 'reply:' + firstReply },
            }),
            1,
          );
          assert.equal((await read()).replies[0].body, 'Native reply');
          await denied(discussionsApi.publish(student, reply('same-reply-key', 'Other content')), 409);
          const web = (await f.call(f.clients.teacher, '/communication/posts/' + post.id)).body;
          assert.ok(!JSON.stringify(web).includes('mobileCreate'));
        },
      );
      await t.test(
        'actual dropped HTTP response recovers read-only receipt and cannot create another reply',
        async () => {
          let drop = true;
          const c = await mobile(f.users.student.username, async (url, init) => {
            const r = await fetch(url, init);
            if (drop && init?.method === 'POST' && String(url).endsWith('/replies')) {
              drop = false;
              await r.arrayBuffer();
              throw new Error('Simulated response loss after real commit');
            }
            return r;
          });
          const p = reply('lost-response-key');
          await denied(discussionsApi.publish(c, p), 0);
          const receipt = await discussionsApi.receipt(c, p);
          assert.ok(receipt.found);
          assert.equal((await discussionsApi.publish(c, p)).id, receipt.found ? receipt.id : '');
          assert.equal(
            await f.db.discussionReply.count({
              where: { authorId: f.users.student.id, mobileCreateKey: p.input.key },
            }),
            1,
          );
          assert.deepEqual(await discussionsApi.receipt(c, reply('never-published-key')), { found: false });
        },
      );
      await t.test(
        'visible same-thread quotes are supported; hidden/foreign quotes cannot leak text',
        async () => {
          await discussionsApi.publish(student, reply('quoted-reply-key', 'Quoted response', firstReply));
          const details = await read();
          assert.equal(details.replies.at(-1).quote.id, firstReply);
          await f.db.discussionReply.update({ where: { id: firstReply }, data: { hidden: true } });
          assert.equal((await read()).replies.at(-1).quote, null);
          await denied(discussionsApi.publish(student, reply('hidden-quote-key', 'Nope', firstReply)), 404);
          await f.db.discussionReply.update({ where: { id: firstReply }, data: { hidden: false } });
          const other = (
            await f.call(f.clients.teacher, '/communication/posts/' + topics[1].id + '/replies', 'POST', {
              body: 'Other thread',
            })
          ).body;
          await denied(discussionsApi.publish(student, reply('foreign-quote-key', 'Nope', other.id)), 404);
          const wire = JSON.stringify(await read());
          for (const key of [
            'authorId',
            'organizationId',
            'mobileCreateKey',
            'mobileCreateHash',
            'linkId',
            'attachmentIds',
          ])
            assert.ok(!wire.includes(key));
        },
      );
      await t.test(
        'reply pagination and legacy plain content never expose executable markup or private resource references',
        async () => {
          for (let i = 0; i < 9; i++)
            await f.call(f.clients.teacher, '/communication/posts/' + post.id + '/replies', 'POST', {
              body: 'Web reply ' + i,
            });
          const a = await read(),
            b = await read(post.id, '?page=2');
          assert.equal(a.replies.length, 10);
          assert.equal(b.replies.length, 2);
          assert.equal(new Set([...a.replies, ...b.replies].map((r) => r.id)).size, 12);
          await f.db.discussionPost.update({
            where: { id: post.id },
            data: { body: '<script>secret-script</script><img src="https://track.invalid/pixel">Safe text' },
          });
          assert.equal((await read()).body, 'Safe text');
        },
      );
      await t.test(
        'closed threads and archived courses remain readable but only existing receipts recover',
        async () => {
          await f.call(f.clients.teacher, '/communication/posts/' + post.id, 'PATCH', { closed: true });
          assert.equal((await read()).canReply, false);
          await denied(discussionsApi.publish(student, reply('closed-reply-key')), 409);
          assert.equal((await discussionsApi.publish(student, reply('same-reply-key'))).id, firstReply);
          await f.call(f.clients.teacher, '/communication/posts/' + post.id, 'PATCH', { closed: false });
          await f.db.course.update({ where: { id: f.course.id }, data: { status: 'ARCHIVED' } });
          assert.equal((await read()).canReply, false);
          await denied(discussionsApi.publish(student, reply('archived-reply-key')), 403);
          await denied(
            discussionsApi.publish(student, {
              kind: 'post',
              input: { ...topic.input, key: 'archived-post-key' },
            }),
            403,
          );
          await f.db.course.update({ where: { id: f.course.id }, data: { status: 'PUBLISHED' } });
        },
      );
      await t.test(
        'institution and course mutes block writing while read/receipt recovery remain available',
        async () => {
          for (const courseId of [null, f.course.id]) {
            const mute = await f.db.communicationMute.create({
              data: {
                organizationId: f.organization.id,
                userId: f.users.student.id,
                courseId,
                expiresAt: new Date(Date.now() + 60000),
                reason: 'Test mute',
                createdBy: f.users.teacher.id,
              },
            });
            try {
              assert.equal((await read()).canReply, false);
              await denied(discussionsApi.publish(student, reply('muted-reply-key')), 403);
              assert.ok((await discussionsApi.receipt(student, reply('same-reply-key'))).found);
            } finally {
              await f.db.communicationMute.delete({ where: { id: mute.id } });
            }
          }
        },
      );
      await t.test(
        'withdrawn enrollment, hidden threads and feature shutdown deny list/detail/receipts',
        async () => {
          await enroll(false);
          assert.equal((await list()).total, 0);
          await denied(read(), 403);
          await denied(discussionsApi.receipt(student, reply('same-reply-key')), 403);
          await enroll(true);
          await f.db.discussionPost.update({ where: { id: post.id }, data: { hidden: true } });
          await denied(read(), 404);
          await denied(discussionsApi.receipt(student, reply('same-reply-key')), 404);
          await f.db.discussionPost.update({ where: { id: post.id }, data: { hidden: false } });
          await f.db.systemSetting.upsert({
            where: { organizationId_key: { organizationId: f.organization.id, key: 'features' } },
            create: { organizationId: f.organization.id, key: 'features', value: { communication: false } },
            update: { value: { communication: false } },
          });
          await denied(list(), 403);
          await denied(read(), 403);
          await denied(discussionsApi.publish(student, reply('disabled-reply-key')), 403);
          await f.db.systemSetting.deleteMany({
            where: { organizationId: f.organization.id, key: 'features' },
          });
        },
      );
      await t.test(
        'waiting on website post lock rechecks closure, enrollment, account and device session',
        async () => {
          for (const kind of ['closed', 'enrollment', 'account', 'session']) {
            const c = await mobile(f.users.student.username);
            let release!: () => void, ready!: () => void;
            const gate = new Promise<void>((r) => {
                release = r;
              }),
              acquired = new Promise<void>((r) => {
                ready = r;
              });
            const hold = f.db.$transaction(
              async (tx) => {
                await tx.$queryRaw`SELECT "id" FROM "DiscussionPost" WHERE "id"=${post.id} FOR UPDATE`;
                ready();
                await gate;
                if (kind === 'closed')
                  await tx.discussionPost.update({ where: { id: post.id }, data: { closed: true } });
              },
              { timeout: 20000 },
            );
            await acquired;
            const p = reply('queued-' + kind + '-key');
            const pending = denied(
              discussionsApi.publish(c, p),
              kind === 'closed' ? 409 : kind === 'enrollment' ? 403 : 401,
            );
            try {
              let waited = false;
              for (let i = 0; i < 120; i++) {
                const r = await f.db.$queryRaw<
                  { n: bigint }[]
                >`SELECT count(*) AS n FROM pg_stat_activity WHERE datname=current_database() AND pid<>pg_backend_pid() AND wait_event_type='Lock' AND query LIKE '%DiscussionPost%'`;
                if (Number(r[0].n)) {
                  waited = true;
                  break;
                }
                await liveWait(25);
              }
              assert.ok(waited, 'Actual HTTP transaction must wait for website row lock');
              if (kind === 'enrollment') await enroll(false);
              else if (kind === 'account')
                await f.db.user.update({ where: { id: f.users.student.id }, data: { active: false } });
              else if (kind === 'session')
                await f.db.session.deleteMany({
                  where: { userId: f.users.student.id, clientType: 'MOBILE' },
                });
            } finally {
              release();
              await hold;
            }
            await pending;
            if (kind === 'closed')
              await f.db.discussionPost.update({ where: { id: post.id }, data: { closed: false } });
            if (kind === 'enrollment') await enroll(true);
            if (kind === 'account')
              await f.db.user.update({ where: { id: f.users.student.id }, data: { active: true } });
            assert.equal(
              await f.db.discussionReply.count({
                where: { authorId: f.users.student.id, mobileCreateKey: p.input.key },
              }),
              0,
            );
          }
        },
      );
    } finally {
      await f.cleanup();
    }
  },
);
