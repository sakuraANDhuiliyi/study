import test from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { request } from 'node:http';
import type { Duplex } from 'node:stream';
import { AccessToken, TokenVerifier, TrackSource } from 'livekit-server-sdk';
import { createLiveFixture, liveWait, type LiveTestClient } from './live.fixture';

test('直播课堂：真实数据库、真实LiveKit、权限隔离、并发与凭证撤销', { timeout: 240_000 }, async (t) => {
  const f = await createLiveFixture();
  const { teacher, student, student2, outsider, otherTeacher, admin } = f.clients;
  const base = '/live/classes';
  const create = async (maxParticipants = 2) =>
    (
      await f.call(teacher, base, 'POST', {
        courseId: f.course.id,
        title: '实时课堂测试',
        scheduledAt: new Date().toISOString(),
        maxParticipants,
      })
    ).body;
  const verify = (token: string) =>
    new TokenVerifier(f.env.LIVEKIT_API_KEY, f.env.LIVEKIT_API_SECRET).verify(token, 0);
  async function validation(client: LiveTestClient | null, token: string, origin = f.origin) {
    try {
      const r = await fetch(
        f.origin + '/api/live/media/rtc/validate?access_token=' + encodeURIComponent(token),
        {
          headers: { origin, ...(client ? { cookie: client.cookie } : {}) },
          signal: AbortSignal.timeout(10000),
        },
      );
      await r.body?.cancel();
      return r.status;
    } catch {
      throw new Error('Media validation transport failed');
    }
  }
  async function signal(client: LiveTestClient, token: string, path = '/api/live/media/rtc') {
    return new Promise<{ socket: Duplex; closed: Promise<void> }>((resolve, reject) => {
      const target = new URL(path, f.origin);
      target.search = new URLSearchParams({
        access_token: token,
        sdk: 'js',
        version: '2.23.0',
        protocol: '15',
        auto_subscribe: '1',
      }).toString();
      const req = request(target, {
        headers: {
          origin: f.origin,
          cookie: client.cookie,
          connection: 'Upgrade',
          upgrade: 'websocket',
          'sec-websocket-key': randomBytes(16).toString('base64'),
          'sec-websocket-version': '13',
        },
      });
      req.setTimeout(10000, () => {
        req.destroy();
        reject(new Error('Signal handshake timed out'));
      });
      req.once('error', () => reject(new Error('Signal handshake failed')));
      req.once('response', (res) => {
        res.resume();
        reject(new Error(`Signal handshake rejected: HTTP ${res.statusCode}`));
      });
      req.once('upgrade', (_res, socket) => {
        req.setTimeout(0);
        socket.on('error', () => undefined);
        socket.resume();
        resolve({ socket, closed: new Promise<void>((done) => socket.once('close', () => done())) });
      });
      req.end();
    });
  }
  let room: { id: string; revision: number };
  let studentJoin: any, teacherJoin: any;
  try {
    await t.test('认证、CSRF、来源、角色、课程与机构边界', async () => {
      const started = Date.now();
      await assert.rejects(() => signal(student, 'invalid', '/unknown-upgrade'));
      assert.ok(Date.now() - started < 2000, 'Unknown websocket route retained an unowned connection');
      await f.call(null, base, 'GET', undefined, 401);
      const body = { courseId: f.course.id, title: '边界测试直播', scheduledAt: new Date().toISOString() };
      await f.call(student, base, 'POST', body, 403);
      await f.call(otherTeacher, base, 'POST', body, 403);
      await f.call(outsider, base, 'POST', body, 404);
      await f.call(teacher, base, 'POST', body, 403, false);
      await f.call(teacher, base, 'POST', body, 403, true, 'https://untrusted.example');
      await f.call(teacher, base, 'POST', { ...body, maxParticipants: 101 }, 400);
      await f.call(teacher, base, 'POST', { ...body, canManage: true }, 400);
    });
    room = await create();
    await t.test('预约可见范围、分页与未开始课堂禁止加入', async () => {
      const list = (await f.call(student, base)).body;
      assert.equal(list.total, 1);
      assert.equal(list.items[0].id, room.id);
      assert.equal((await f.call(outsider, base)).body.total, 0);
      await f.call(outsider, `${base}/${room.id}`, 'GET', undefined, 404);
      await f.call(otherTeacher, `${base}/${room.id}`, 'GET', undefined, 403);
      await f.call(student, `${base}/${room.id}/join`, 'POST', {}, 409);
      await f.call(teacher, base + '?pageSize=0', 'GET', undefined, 400);
      assert.ok(!('roomName' in list.items[0]));
      assert.ok((await f.call(admin, `${base}/${room.id}`)).body.canManage);
    });
    await t.test('同一课堂并发开播仅成功一次，版本冲突不创建第二个房间', async () => {
      const results = await Promise.all(
        [1, 2].map(() => f.call(teacher, `${base}/${room.id}/start`, 'POST', { revision: 0 }, [201, 409])),
      );
      assert.deepEqual(results.map((r) => r.status).sort(), [201, 409]);
      assert.equal((await f.mediaClient.listRooms()).length, 1);
      const another = await create();
      await f.call(teacher, `${base}/${another.id}/start`, 'POST', { revision: 0 }, 409);
      await f.call(teacher, `${base}/${another.id}/end`, 'POST', { revision: 0 });
      await f.call(teacher, `${base}/${another.id}/start`, 'POST', { revision: 1 }, 409);
    });
    teacherJoin = (await f.call(teacher, `${base}/${room.id}/join`, 'POST', {})).body;
    await t.test('并发进入遵守课堂人数上限', async () => {
      const results = await Promise.all(
        [student, student2].map((client) =>
          f.call(client, `${base}/${room.id}/join`, 'POST', {}, [201, 409]),
        ),
      );
      assert.deepEqual(results.map((r) => r.status).sort(), [201, 409]);
      const winner = results[0].status === 201 ? student : student2;
      if (winner === student2) {
        await f.call(student2, `${base}/${room.id}/leave`, 'POST', {
          connectionId: results[1].body.connectionId,
        });
        studentJoin = (await f.call(student, `${base}/${room.id}/join`, 'POST', {})).body;
      } else studentJoin = results[0].body;
      assert.equal(await f.db.liveMember.count({ where: { liveClassId: room.id, state: 'ACTIVE' } }), 2);
    });
    await t.test('观众仅可订阅，媒体凭证必须绑定当前网站会话', async () => {
      const claims = await verify(studentJoin.token);
      assert.equal(claims.video?.canPublish, false);
      assert.equal(claims.video?.canPublishData, false);
      assert.equal(claims.exp! - claims.nbf!, 60);
      assert.equal(await validation(student, studentJoin.token), 200);
      assert.equal(await validation(null, studentJoin.token), 403);
      assert.equal(await validation(student2, studentJoin.token), 403);
      assert.equal(await validation(student, studentJoin.token, 'https://untrusted.example'), 403);
      assert.equal(await validation(student, studentJoin.token.slice(0, -4) + 'abcd'), 403);
      const privateFields = (await f.call(student, `${base}/${room.id}`)).body;
      assert.ok(!JSON.stringify(privateFields).includes(f.env.LIVEKIT_API_SECRET));
      for (const m of privateFields.members) assert.ok(!('sessionId' in m) && !('connectionId' in m));
      const denied = await fetch(f.origin + '/api/live/media/twirp/livekit.RoomService/ListRooms');
      assert.equal(denied.status, 403);
    });
    await t.test('同账号并发进入仅保留最新连接资格', async () => {
      const joined = await Promise.all(
        [1, 2].map(() => f.call(student, `${base}/${room.id}/join`, 'POST', {}, [201, 409])),
      );
      const latest = await f.db.liveMember.findUniqueOrThrow({ where: { id: studentJoin.identity } });
      const valid = joined.filter((r) => r.status === 201 && r.body.connectionId === latest.connectionId);
      assert.equal(valid.length, 1);
      for (const r of joined.filter((r) => r.status === 201))
        assert.equal(
          await validation(student, r.body.token),
          r.body.connectionId === latest.connectionId ? 200 : 403,
        );
      studentJoin = valid[0].body;
    });
    await t.test('真实信令通道可连接，旧标签页不能退出新连接', async () => {
      const old = studentJoin;
      const ws = await signal(student, old.token);
      studentJoin = (await f.call(student, `${base}/${room.id}/join`, 'POST', {})).body;
      await Promise.race([
        ws.closed,
        liveWait(8000).then(() => {
          throw new Error('Old signaling connection was not closed');
        }),
      ]);
      await f.call(student, `${base}/${room.id}/heartbeat`, 'POST', { connectionId: old.connectionId }, 403);
      await f.call(student, `${base}/${room.id}/leave`, 'POST', { connectionId: old.connectionId }, 403);
      assert.equal(await validation(student, old.token), 403);
      assert.equal(await validation(student, studentJoin.token), 200);
    });
    await t.test('举手、授权、撤销与并发审批使用真实数据库版本', async () => {
      await f.call(student, `${base}/${room.id}/hand`, 'POST', {
        connectionId: studentJoin.connectionId,
        raised: true,
      });
      let member = await f.db.liveMember.findUniqueOrThrow({ where: { id: studentJoin.identity } });
      assert.equal(member.handRaised, true);
      await f.call(
        student,
        `${base}/${room.id}/members/${member.id}`,
        'POST',
        { revision: member.revision, action: 'approve' },
        403,
      );
      await f.call(
        otherTeacher,
        `${base}/${room.id}/members/${member.id}`,
        'POST',
        { revision: member.revision, action: 'approve' },
        403,
      );
      const results = await Promise.all(
        [1, 2].map(() =>
          f.call(
            teacher,
            `${base}/${room.id}/members/${member.id}`,
            'POST',
            { revision: member.revision, action: 'approve' },
            [201, 409],
          ),
        ),
      );
      assert.deepEqual(results.map((r) => r.status).sort(), [201, 409]);
      assert.equal(await validation(student, studentJoin.token), 403);
      studentJoin = (await f.call(student, `${base}/${room.id}/join`, 'POST', {})).body;
      const claims = await verify(studentJoin.token);
      assert.equal(claims.video?.canPublish, true);
      assert.deepEqual(claims.video?.canPublishSources, ['camera', 'microphone']);
      assert.equal(await validation(student, studentJoin.token), 200);
      member = await f.db.liveMember.findUniqueOrThrow({ where: { id: studentJoin.identity } });
      await f.call(teacher, `${base}/${room.id}/members/${member.id}`, 'POST', {
        revision: member.revision,
        action: 'revoke',
      });
      assert.equal(await validation(student, studentJoin.token), 403);
      await f.call(
        teacher,
        `${base}/${room.id}/members/${teacherJoin.identity}`,
        'POST',
        { revision: 0, action: 'remove' },
        403,
      );
    });
    await t.test('即使签名合法，越权媒体管理及来源授权也被网关拒绝', async () => {
      studentJoin = (await f.call(student, `${base}/${room.id}/join`, 'POST', {})).body;
      const row = await f.db.liveClass.findUniqueOrThrow({ where: { id: room.id } });
      for (const extra of [{ roomAdmin: true }, { canPublishSources: [TrackSource.CAMERA] }]) {
        const token = new AccessToken(f.env.LIVEKIT_API_KEY, f.env.LIVEKIT_API_SECRET, {
          identity: studentJoin.identity,
          ttl: 60,
          metadata: JSON.stringify({ connectionId: studentJoin.connectionId }),
        });
        token.addGrant({
          roomJoin: true,
          room: row.roomName,
          canPublish: false,
          canSubscribe: true,
          canPublishData: false,
          ...extra,
        });
        assert.equal(await validation(student, await token.toJwt()), 403);
      }
    });
    await t.test('课堂聊天纯文本、幂等去重、限频和禁言', async () => {
      const body = {
        text: '<img src=x onerror=alert(1)> 课堂问题',
        clientId: randomUUID(),
        connectionId: studentJoin.connectionId,
      };
      const results = await Promise.all(
        [1, 2, 3].map(() => f.call(student, `${base}/${room.id}/messages`, 'POST', body)),
      );
      assert.equal(new Set(results.map((r) => r.body.id)).size, 1);
      assert.equal(await f.db.liveMessage.count({ where: { liveClassId: room.id } }), 1);
      let m = await f.db.liveMember.findUniqueOrThrow({ where: { id: studentJoin.identity } });
      await f.call(teacher, `${base}/${room.id}/members/${m.id}`, 'POST', {
        revision: m.revision,
        action: 'mute-chat',
      });
      await f.call(student, `${base}/${room.id}/messages`, 'POST', { ...body, clientId: randomUUID() }, 403);
      m = await f.db.liveMember.findUniqueOrThrow({ where: { id: m.id } });
      await f.call(teacher, `${base}/${room.id}/members/${m.id}`, 'POST', {
        revision: m.revision,
        action: 'unmute-chat',
      });
      const attempts = await Promise.all(
        Array.from({ length: 8 }, () =>
          f.call(
            student,
            `${base}/${room.id}/messages`,
            'POST',
            { ...body, clientId: randomUUID() },
            [201, 409],
          ),
        ),
      );
      assert.ok(attempts.filter((r) => r.status === 201).length <= 4);
      assert.ok(attempts.some((r) => r.status === 409));
      await f.db.systemSetting.create({
        data: {
          organizationId: f.organization.id,
          key: 'features',
          value: { practice: true, communication: false, live: true },
        },
      });
      await f.call(student, `${base}/${room.id}/messages`, 'POST', { ...body, clientId: randomUUID() }, 403);
      const view = (await f.call(student, `${base}/${room.id}`)).body;
      assert.equal(view.canChat, false);
      assert.deepEqual(view.messages, []);
      await f.db.systemSetting.delete({
        where: { organizationId_key: { organizationId: f.organization.id, key: 'features' } },
      });
    });
    await t.test('全员下麦保留教师权限并拒绝学生调用', async () => {
      let m = await f.db.liveMember.findUniqueOrThrow({ where: { id: studentJoin.identity } });
      await f.call(teacher, `${base}/${room.id}/members/${m.id}`, 'POST', {
        revision: m.revision,
        action: 'approve',
      });
      await f.call(student, `${base}/${room.id}/revoke-all`, 'POST', {}, 403);
      const result = (await f.call(teacher, `${base}/${room.id}/revoke-all`, 'POST', {})).body;
      assert.equal(result.updated, 1);
      assert.equal(result.cleanupPending, false);
      m = await f.db.liveMember.findUniqueOrThrow({ where: { id: m.id } });
      assert.equal(m.approved, false);
      assert.equal(
        (await f.db.liveMember.findUniqueOrThrow({ where: { id: teacherJoin.identity } })).approved,
        true,
      );
    });
    await t.test('移出成员立即断开且旧凭证、重新加入均受阻', async () => {
      const ws = await signal(student, studentJoin.token);
      const m = await f.db.liveMember.findUniqueOrThrow({ where: { id: studentJoin.identity } });
      await f.call(teacher, `${base}/${room.id}/members/${m.id}`, 'POST', {
        revision: m.revision,
        action: 'remove',
      });
      await Promise.race([
        ws.closed,
        liveWait(8000).then(() => {
          throw new Error('Removed signaling connection remained open');
        }),
      ]);
      assert.equal(await validation(student, studentJoin.token), 403);
      await f.call(student, `${base}/${room.id}/join`, 'POST', {}, 403);
    });
    await t.test('会话撤销、选课撤销和机构功能开关均阻断媒体连接', async () => {
      let lease = (await f.call(student2, `${base}/${room.id}/join`, 'POST', {})).body;
      const ws = await signal(student2, lease.token);
      await f.db.session.deleteMany({ where: { userId: student2.user.id } });
      await Promise.race([
        ws.closed,
        liveWait(9000).then(() => {
          throw new Error('Revoked login session retained media connection');
        }),
      ]);
      assert.equal(await validation(student2, lease.token), 403);
      const refreshed = await f.login(f.users.student2.username);
      lease = (await f.call(refreshed, `${base}/${room.id}/join`, 'POST', {})).body;
      await f.db.enrollment.update({
        where: { courseId_userId: { courseId: f.course.id, userId: refreshed.user.id } },
        data: { active: false },
      });
      assert.equal(await validation(refreshed, lease.token), 403);
      await f.db.enrollment.update({
        where: { courseId_userId: { courseId: f.course.id, userId: refreshed.user.id } },
        data: { active: true },
      });
      await f.db.systemSetting.create({
        data: {
          organizationId: f.organization.id,
          key: 'features',
          value: { practice: true, communication: true, live: false },
        },
      });
      await f.call(teacher, base, 'GET', undefined, 403);
      assert.equal(await validation(teacher, teacherJoin.token), 403);
      await f.db.systemSetting.delete({
        where: { organizationId_key: { organizationId: f.organization.id, key: 'features' } },
      });
    });
    await t.test('空媒体房间过期后晚到成员可恢复同一课堂', async () => {
      const row = await f.db.liveClass.findUniqueOrThrow({ where: { id: room.id } });
      await f.mediaClient.deleteRoom(row.roomName);
      teacherJoin = (await f.call(teacher, `${base}/${room.id}/join`, 'POST', {})).body;
      assert.equal(await validation(teacher, teacherJoin.token), 200);
      assert.equal((await f.mediaClient.listRooms())[0].name, row.roomName);
    });
    await t.test('媒体故障时撤销权限先落库，恢复后可重试同步', async () => {
      const client = await f.login(f.users.student2.username);
      const lease = (await f.call(client, `${base}/${room.id}/join`, 'POST', {})).body;
      let m = await f.db.liveMember.findUniqueOrThrow({ where: { id: lease.identity } });
      await f.call(teacher, `${base}/${room.id}/members/${m.id}`, 'POST', {
        revision: m.revision,
        action: 'approve',
      });
      m = await f.db.liveMember.findUniqueOrThrow({ where: { id: m.id } });
      await f.stopMedia();
      await f.call(
        teacher,
        `${base}/${room.id}/members/${m.id}`,
        'POST',
        {
          revision: m.revision,
          action: 'revoke',
        },
        503,
      );
      m = await f.db.liveMember.findUniqueOrThrow({ where: { id: m.id } });
      assert.equal(m.approved, false);
      assert.equal(m.syncPending, true);
      assert.equal(await validation(client, lease.token), 403);
      await f.restartMedia();
      await f.call(teacher, `${base}/${room.id}/members/${m.id}`, 'POST', {
        revision: m.revision,
        action: 'revoke',
      });
      assert.equal((await f.db.liveMember.findUniqueOrThrow({ where: { id: m.id } })).syncPending, false);
    });
    await t.test('媒体服务故障时结束状态持久化，清理可重试且凭证不泄露', async () => {
      await f.stopMedia();
      await f.call(teacher, `${base}/${room.id}/end`, 'POST', { revision: 1 }, 503);
      const ended = await f.db.liveClass.findUniqueOrThrow({ where: { id: room.id } });
      assert.equal(ended.status, 'ENDED');
      assert.equal(ended.cleanupPending, true);
      assert.equal(await validation(teacher, teacherJoin.token), 403);
      await f.restartMedia();
      await f.call(teacher, `${base}/${room.id}/end`, 'POST', { revision: ended.revision });
      assert.equal(
        (await f.db.liveClass.findUniqueOrThrow({ where: { id: room.id } })).cleanupPending,
        false,
      );
      const audit = await f.db.auditLog.findMany({ where: { resourceId: room.id } });
      assert.ok(audit.some((r) => r.action === 'live.start') && audit.some((r) => r.action === 'live.end'));
      assert.ok(!JSON.stringify(audit).includes(f.env.LIVEKIT_API_SECRET));
      assert.ok(!JSON.stringify(audit).includes(studentJoin.token));
    });
    await t.test('不同课堂并发开播仍遵守同课程单场约束，开播与取消竞争保持终态', async () => {
      const a = await create(),
        b = await create();
      const results = await Promise.all(
        [a, b].map((r) => f.call(teacher, `${base}/${r.id}/start`, 'POST', { revision: 0 }, [201, 409])),
      );
      assert.deepEqual(results.map((r) => r.status).sort(), [201, 409]);
      for (const r of [a, b]) {
        const row = await f.db.liveClass.findUniqueOrThrow({ where: { id: r.id } });
        await f.call(teacher, `${base}/${r.id}/end`, 'POST', { revision: row.revision });
      }
      const c = await create();
      const raced = await Promise.all(
        ['start', 'end'].map((path) =>
          f.call(teacher, `${base}/${c.id}/${path}`, 'POST', { revision: 0 }, [201, 409]),
        ),
      );
      assert.deepEqual(raced.map((r) => r.status).sort(), [201, 409]);
      let row = await f.db.liveClass.findUniqueOrThrow({ where: { id: c.id } });
      if (row.status === 'LIVE')
        await f.call(teacher, `${base}/${c.id}/end`, 'POST', { revision: row.revision });
      row = await f.db.liveClass.findUniqueOrThrow({ where: { id: c.id } });
      assert.equal(row.status, 'ENDED');
      assert.equal((await f.mediaClient.listRooms()).length, 0);
    });
  } finally {
    await f.cleanup();
  }
});
