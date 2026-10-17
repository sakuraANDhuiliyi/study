/** Dedicated destructive-to-preview-app-only Android acceptance. Requires an explicitly selected emulator. */
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync, existsSync, readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { resolve } from 'node:path';
import { chromium, expect } from '@playwright/test';
import { createLiveFixture, liveWait } from '../tests/live.fixture';
import { attachLogin, installMedia, inbound } from '../tests/live-browser.fixture';
const serial = process.env.MOBILE_TEST_SERIAL || '';
assert.ok(
  serial && /^emulator-\d+$/.test(serial),
  'Explicit emulator MOBILE_TEST_SERIAL required; physical devices are never reset',
);
const apk = resolve(process.env.MOBILE_TEST_APK || 'apps/mobile/.data/apk/zhixue-local-preview-arm64.apk');
assert.ok(existsSync(apk), 'Build the local preview APK first');
const apkSha256 = createHash('sha256').update(readFileSync(apk)).digest('hex');
const adb = resolve(process.env.ANDROID_HOME || process.env.ANDROID_SDK_ROOT || '', 'platform-tools/adb');
const pkg = 'cn.huiliyi.study.preview';
const output = resolve('.data/mobile-device-verification');
mkdirSync(output, { recursive: true });
const run = (...args: string[]) =>
  execFileSync(adb, ['-s', serial, ...args], {
    encoding: 'utf8',
    timeout: 45000,
    maxBuffer: 4 * 1024 * 1024,
  });
assert.match(run('shell', 'getprop', 'ro.kernel.qemu'), /1/, 'Only disposable Android emulator accepted');
const info = run('shell', 'dumpsys', 'package', pkg);
if (info.includes('Package [')) assert.ok(info.includes(pkg));
function decode(s: string) {
  return s
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>');
}
function nodes() {
  run('shell', 'uiautomator', 'dump', '/sdcard/zhixue-review.xml');
  const xml = run('shell', 'cat', '/sdcard/zhixue-review.xml');
  return [...xml.matchAll(/<node\b([^>]+)>?/g)].map((m) =>
    Object.fromEntries([...m[1].matchAll(/([\w-]+)="([^"]*)"/g)].map((a) => [a[1], decode(a[2])])),
  );
}
async function poll<T>(
  get: () => T | Promise<T>,
  ok: (v: T) => boolean,
  description: string,
  timeout = 30000,
) {
  const end = Date.now() + timeout;
  while (Date.now() < end) {
    const v = await get();
    if (ok(v)) return v;
    await liveWait(600);
  }
  throw new Error(description);
}
const match = (n: Record<string, string>, label: string) => n['content-desc'] === label || n.text === label;
async function find(label: string, timeout = 30000) {
  return (
    await poll(nodes, (ns) => ns.some((n) => match(n, label)), 'Missing Android control: ' + label, timeout)
  )
    .filter((n) => match(n, label))
    .sort((a, b) => Number(b['content-desc'] === label) - Number(a['content-desc'] === label))[0]!;
}
function tap(n: Record<string, string>) {
  const b = n.bounds.match(/\d+/g)?.map(Number);
  assert.ok(b?.length === 4);
  run('shell', 'input', 'tap', String(Math.floor((b[0] + b[2]) / 2)), String(Math.floor((b[1] + b[3]) / 2)));
}
async function click(label: string) {
  tap(await find(label));
  await liveWait(400);
}
async function type(label: string, value: string) {
  assert.match(value, /^[A-Za-z0-9_!.-]+$/);
  const field = await find(label);
  assert.match(field.class, /EditText$/);
  tap(field);
  if (field.text)
    run('shell', 'input', 'keyevent', '123', ...Array(Math.min(256, field.text.length)).fill('67'));
  run('shell', 'input', 'text', value);
  run('shell', 'input', 'keyevent', '4');
}
function screenshot(name: string) {
  const data = execFileSync(adb, ['-s', serial, 'exec-out', 'screencap', '-p'], { timeout: 15000 });
  writeFileSync(resolve(output, name + '.png'), data);
}
async function scroll(label: string) {
  for (const direction of ['down', 'up'])
    for (let i = 0; i < 8; i++) {
      const n = nodes().find((n) => match(n, label) && n.enabled !== 'false');
      if (n) {
        tap(n);
        await liveWait(400);
        return;
      }
      run(
        'shell',
        'input',
        'swipe',
        '500',
        direction === 'down' ? '1800' : '650',
        '500',
        direction === 'down' ? '650' : '1800',
        '400',
      );
      await liveWait(300);
    }
  throw new Error('Android scroll target missing: ' + label);
}

async function main() {
  const f = await createLiveFixture();
  const reverse: string[] = [];
  let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined;
  const checks: string[] = [];
  const passed = (name: string) => {
    checks.push(name);
    console.log('PASS Android ' + name);
  };
  try {
    const chapter = await f.db.chapter.create({ data: { courseId: f.course.id, title: '手机学习章节' } });
    const lesson = await f.db.lesson.create({
      data: {
        courseId: f.course.id,
        chapterId: chapter.id,
        title: '手机学习验收课时',
        content: '<p>手机学习与网站同步。</p>',
      },
    });
    const live = (
      await f.call(f.clients.teacher, '/live/classes', 'POST', {
        courseId: f.course.id,
        title: 'Android 互动验收',
        scheduledAt: new Date(Date.now() + 60000).toISOString(),
        maxParticipants: 10,
      })
    ).body;
    await f.call(f.clients.teacher, `/live/classes/${live.id}/start`, 'POST', { revision: live.revision });
    const otherCourse = await f.db.course.create({
      data: {
        organizationId: f.organization.id,
        teacherId: f.users.teacher.id,
        title: '另一门手机课程',
        status: 'PUBLISHED',
      },
    });
    await f.db.teachingAssignment.create({ data: { courseId: otherCourse.id, userId: f.users.teacher.id } });
    await f.db.enrollment.create({ data: { courseId: otherCourse.id, userId: f.users.student.id } });
    await f.call(f.clients.teacher, '/live/classes', 'POST', {
      courseId: otherCourse.id,
      title: '其他课程的直播',
      scheduledAt: new Date(Date.now() + 60000).toISOString(),
      maxParticipants: 10,
    });

    for (const [device, host] of [
      [3030, Number(new URL(f.origin).port)],
      [f.rtcTcp, f.rtcTcp],
    ]) {
      const key = 'tcp:' + device;
      assert.ok(
        !run('reverse', '--list')
          .split('\n')
          .some((line) => line.split(/\s+/)[1] === key),
        'Android acceptance requires a free reverse port: ' + key,
      );
      run('reverse', key, 'tcp:' + host);
      reverse.push(key);
    }
    const badging = execFileSync(
      resolve(process.env.ANDROID_HOME || '', 'build-tools/36.0.0/aapt'),
      ['dump', 'badging', apk],
      { encoding: 'utf8' },
    );
    assert.ok(
      badging.includes("package: name='" + pkg + "'"),
      'Refuse to install/reset a non-preview package',
    );
    run('install', '-r', apk);
    run('shell', 'pm', 'clear', pkg);
    run('shell', 'am', 'start', '-n', pkg + '/.MainActivity');
    await type('账号', f.users.student.username);
    await type('密码', f.password);
    await click('登录学习平台');
    await find('你好，学生甲');
    screenshot('android-home');
    passed('install, native login and learning home');
    await click('课程');
    await click(f.course.title);
    await scroll(lesson.title);
    await scroll('我已完成学习');
    await poll(
      () =>
        f.db.learningProgress.findUnique({
          where: { userId_lessonId: { userId: f.users.student.id, lessonId: lesson.id } },
        }),
      (p) => !!p?.completed,
      'Native progress was not persisted',
    );
    passed('course content and real cross-device progress');
    await scroll('查看课程直播');
    await find('Android 互动验收');
    assert.equal(
      nodes().some((n) => match(n, '其他课程的直播')),
      false,
    );
    passed('course-to-live navigation decodes and preserves the course filter');

    run('shell', 'am', 'force-stop', pkg);
    run('shell', 'am', 'start', '-n', pkg + '/.MainActivity');
    await find('你好，学生甲');
    passed('secure session survives process restart');
    browser = await chromium.launch({
      headless: true,
      ...(process.platform === 'darwin' ? { channel: 'chrome' } : {}),
      args: ['--autoplay-policy=no-user-gesture-required'],
    });
    const context = await browser.newContext();
    await attachLogin(context, f.clients.teacher, f.origin);
    await installMedia(context);
    const page = await context.newPage();
    await page.goto(f.origin + '/live/' + live.id);
    await page.getByRole('button', { name: '进入课堂', exact: true }).click();
    await expect(page.locator('.live-stage-status').getByRole('status')).toHaveText('已连接', {
      timeout: 20000,
    });
    await page.getByRole('button', { name: '开启摄像头', exact: true }).click();
    await page.getByRole('button', { name: '开启麦克风', exact: true }).click();
    await click('直播');
    await click('Android 互动验收');
    await click('进入课堂');
    await find('已连接', 40000);
    await poll(
      nodes,
      (ns) => ns.some((n) => /audio=[1-9]\d* frames=[1-9]\d*/.test(n.text)),
      'Native device did not decode teacher video and receive audio',
      45000,
    );
    screenshot('android-live-viewing');
    passed('native WebRTC receives real audio and decodes video');
    await scroll('课堂发言');
    run('shell', 'input', 'text', 'Android-device-test');
    run('shell', 'input', 'keyevent', '4');
    await scroll('发送消息');
    await poll(
      () =>
        f.db.liveMessage.count({
          where: { liveClassId: live.id, userId: f.users.student.id, text: 'Android-device-test' },
        }),
      (n) => n === 1,
      'Native classroom message missing',
    );
    passed('native classroom chat persisted');

    await scroll('举手申请连麦');
    const member = await poll(
      () => f.db.liveMember.findFirst({ where: { liveClassId: live.id, userId: f.users.student.id } }),
      (m) => !!m?.handRaised,
      'Native hand raise missing',
    );
    await f.call(f.clients.teacher, `/live/classes/${live.id}/members/${member!.id}`, 'POST', {
      action: 'approve',
      revision: member!.revision,
    });
    const permission = async (allow: boolean) => {
      const end = allow ? 'permission_allow_foreground_only_button' : 'permission_deny_button';
      const ns = await poll(
        nodes,
        (rows) => rows.some((n) => n['resource-id']?.endsWith(end)),
        'Android OS permission dialog missing',
      );
      tap(ns.find((n) => n['resource-id']?.endsWith(end))!);
      await liveWait(500);
    };
    await scroll('开启摄像头');
    await permission(false);
    await find('设备未授权');
    const alert = nodes().find((n) => n['resource-id'] === 'android:id/button1');
    assert.ok(alert);
    tap(alert);
    await find('已连接');
    passed('OS camera permission denial preserves classroom viewing');
    await scroll('开启摄像头');
    await permission(true);
    await scroll('开启麦克风');
    await permission(true);
    await expect.poll(() => inbound(page, 'video'), { timeout: 40000 }).toBeGreaterThan(0);
    await expect.poll(() => inbound(page, 'audio'), { timeout: 40000 }).toBeGreaterThan(0);
    await expect
      .poll(() => page.getByLabel('学生甲的摄像头').evaluate((el: HTMLVideoElement) => el.videoWidth), {
        timeout: 30000,
      })
      .toBeGreaterThan(0);
    await poll(
      () =>
        f.db.liveClass
          .findUniqueOrThrow({ where: { id: live.id } })
          .then((room) => f.mediaClient.listParticipants(room.roomName)),
      (participants) => {
        const member = participants.find((p) => p.name === '学生甲');
        return (
          !!member &&
          member.tracks.some((t) => Number(t.type) === 0) &&
          member.tracks.some((t) => Number(t.type) === 1)
        );
      },
      'Native camera and microphone must publish simultaneously',
    );
    screenshot('android-live-publishing');
    passed('teacher approval and native camera/microphone publish real RTP');
    const current = await f.db.liveMember.findUniqueOrThrow({ where: { id: member!.id } });
    await f.call(f.clients.teacher, `/live/classes/${live.id}/members/${current.id}`, 'POST', {
      action: 'revoke',
      revision: current.revision,
    });
    await poll(
      () =>
        f.db.liveClass
          .findUniqueOrThrow({ where: { id: live.id } })
          .then((room) => f.mediaClient.listParticipants(room.roomName)),
      (ps) => ps.filter((p) => !p.permission?.canPublish).length > 0,
      'Publish revocation missing',
    );
    passed('teacher revocation enforces server media permissions');
    run('shell', 'input', 'keyevent', '3');
    await poll(
      () => f.db.liveMember.findUnique({ where: { id: member!.id } }),
      (m) => m?.state === 'LEFT',
      'Background did not leave classroom',
    );
    passed('background stops capture and releases classroom');
    run('shell', 'am', 'start', '-n', pkg + '/.MainActivity');
    await click('我的');
    await scroll('退出登录');
    await find('登录学习平台');
    assert.equal(
      await f.db.session.count({ where: { userId: f.users.student.id, clientType: 'MOBILE' } }),
      0,
    );
    passed('logout revokes device session');
    await type('账号', f.users.student.username);
    await type('密码', f.password);
    await click('登录学习平台');
    await find('你好，学生甲');
    passed('relogin after native logout');
    await click('我的');
    await scroll('退出登录');
    await find('登录学习平台');
    await browser.close();
    browser = undefined;
    const teacherClass = (
      await f.call(f.clients.teacher, '/live/classes', 'POST', {
        courseId: f.course.id,
        title: 'Android 教师管理验收',
        scheduledAt: new Date(Date.now() + 60000).toISOString(),
        maxParticipants: 10,
      })
    ).body;
    await type('账号', f.users.teacher.username);
    await type('密码', f.password);
    await click('登录学习平台');
    await find('你好，教师甲');
    await click('直播');
    await click('Android 教师管理验收');
    await scroll('开始直播');
    await find('本课程已有正在进行的直播');
    const overlapAlert = nodes().find((n) => n['resource-id'] === 'android:id/button1');
    assert.ok(overlapAlert);
    tap(overlapAlert);
    assert.equal(
      (await f.db.liveClass.findUniqueOrThrow({ where: { id: teacherClass.id } })).status,
      'SCHEDULED',
    );
    passed('native scheduling prevents overlapping course broadcasts');
    const original = (await f.call(f.clients.teacher, `/live/classes/${live.id}`)).body;
    await f.call(f.clients.teacher, `/live/classes/${live.id}/end`, 'POST', { revision: original.revision });
    await scroll('开始直播');
    await poll(
      () => f.db.liveClass.findUnique({ where: { id: teacherClass.id } }),
      (c) => c?.status === 'LIVE',
      'Native teacher did not start class',
    );
    passed('native teacher starts scheduled class');
    await scroll('进入课堂');
    await find('已连接');
    passed('native teacher enters hosted classroom');
    await scroll('结束课堂');
    await click('确认结束');
    await poll(
      () => f.db.liveClass.findUnique({ where: { id: teacherClass.id } }),
      (c) => c?.status === 'ENDED',
      'Native teacher did not end class',
    );
    passed('native teacher ends class and releases media');
    await click('我的');
    await scroll('退出登录');
    await find('登录学习平台');
    assert.equal(
      await f.db.session.count({ where: { userId: f.users.teacher.id, clientType: 'MOBILE' } }),
      0,
    );
    await f.call(f.clients.teacher, '/auth/me');
    passed('native teacher logout preserves website session');

    const report = {
      apkSha256,
      passed: checks.length,
      failed: 0,
      skipped: 0,
      checks,
      apiAndMedia: 'isolated real PostgreSQL and LiveKit',
      device: 'Android 12 arm64 emulator; synthetic cameras, host microphone disabled',
    };
    writeFileSync(resolve(output, 'report.json'), JSON.stringify(report, null, 2));
    console.log(JSON.stringify(report));
  } catch (error) {
    screenshot('android-failure');
    writeFileSync(
      resolve(output, 'report.json'),
      JSON.stringify({ passed: checks.length, failed: 1, skipped: 0, checks }),
    );
    throw new Error(f.safe((error as Error).message));
  } finally {
    await browser?.close().catch(() => undefined);
    try {
      run('shell', 'am', 'force-stop', pkg);
    } catch {}
    for (const key of reverse)
      try {
        run('reverse', '--remove', key);
      } catch {}
    await f.cleanup();
  }
}
void main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
