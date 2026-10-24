/** Dedicated destructive-to-preview-app-only Android acceptance. Requires an explicitly selected emulator. */
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync, existsSync, readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { createServer, type Server } from 'node:http';
import { resolve } from 'node:path';
import { chromium, expect } from '@playwright/test';
import { prepareMobileHierarchy } from './mobile-hierarchy';
import { createLiveFixture, liveWait, runFixtureJobs } from '../tests/live.fixture';
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
const displayHeight = Number(run('shell', 'wm', 'size').match(/\d+x(\d+)/)?.[1]);
assert.ok(displayHeight > 600, 'Cannot determine owned emulator viewport');
function contentVisible(n: Record<string, string>, bottomMargin: number) {
  const b = n.bounds?.match(/\d+/g)?.map(Number);
  if (!b || b.length !== 4 || b[2] <= b[0] || b[3] <= b[1]) return false;
  const center = (b[1] + b[3]) / 2;
  return center > 75 && center < displayHeight - bottomMargin;
}
assert.match(run('shell', 'getprop', 'ro.kernel.qemu'), /1/, 'Only disposable Android emulator accepted');
const hierarchyJar = prepareMobileHierarchy(
  resolve(process.env.ANDROID_HOME || process.env.ANDROID_SDK_ROOT || ''),
  output,
);
const hierarchyHash = createHash('sha256').update(readFileSync(hierarchyJar)).digest('hex');
const deviceJar = '/data/local/tmp/zhixue-verification-hierarchy.jar';
const deviceXml = '/data/local/tmp/zhixue-review.xml';
run('push', hierarchyJar, deviceJar);
const info = run('shell', 'dumpsys', 'package', pkg);
if (info.includes('Package [')) assert.ok(info.includes(pkg));
function decode(s: string) {
  const named: Record<string, string> = { quot: '"', apos: "'", amp: '&', lt: '<', gt: '>' };
  // Decode XML attributes in one pass: a literal &amp;#10; must remain &#10;.
  return s.replace(/&(#(?:[xX][0-9a-fA-F]+|[0-9]+)|quot|apos|amp|lt|gt);/g, (raw, entity: string) => {
    if (!entity.startsWith('#')) return named[entity];
    const hex = /^#[xX]/.test(entity);
    const point = Number.parseInt(entity.slice(hex ? 2 : 1), hex ? 16 : 10);
    return Number.isInteger(point) && point >= 0 && point <= 0x10ffff ? String.fromCodePoint(point) : raw;
  });
}

function nodes(scrollAction?: 'forward' | 'backward') {
  run('shell', 'rm', '-f', deviceXml);
  const dumped = run(
    'shell',
    'env',
    'CLASSPATH=/system/framework/android.test.runner.jar:/system/framework/android.test.base.jar:/system/framework/uiautomator.jar:' +
      deviceJar,
    'app_process',
    '/system/bin',
    'com.android.commands.uiautomator.Launcher',
    'runtest',
    '-c',
    'cn.huiliyi.verification.HierarchyDump',
    '-e',
    'jars',
    deviceJar,
    ...(scrollAction ? ['-e', 'scroll', scrollAction] : []),
  );
  if (
    !dumped.includes('OK (1 test)') ||
    /shortMsg=|aborted|NoClassDefFoundError|NO_ACTIVE_WINDOW/.test(dumped)
  )
    return [];
  const xml = run('shell', 'cat', deviceXml);
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
async function dismissKeyboard() {
  if (/\bmInputShown=true\b/.test(run('shell', 'dumpsys', 'input_method'))) {
    // A visible keyboard consumes Back; the App must not navigate or open an unsaved-leave dialog.
    run('shell', 'input', 'keyevent', '4');
    await poll(
      () => run('shell', 'dumpsys', 'input_method'),
      (value) => !/\bmInputShown=true\b/.test(value),
      'Android keyboard did not dismiss',
      5000,
    );
    await liveWait(300);
  }
}
async function click(label: string) {
  await dismissKeyboard();
  tap(await find(label));
  await liveWait(400);
}
async function type(label: string, value: string) {
  assert.match(value, /^[A-Za-z0-9_!.:-]+$/);
  for (let attempt = 0; attempt < 3; attempt++) {
    const field = await find(label);
    assert.match(field.class, /EditText$/);
    tap(field);
    await liveWait(600);
    if (field.text) {
      run('shell', 'input', 'keyevent', '123', ...Array(Math.min(256, field.text.length)).fill('67'));
      await liveWait(300);
    }
    for (const chunk of value.match(attempt ? /./g : /.{1,4}/g) || []) {
      run('shell', 'input', 'text', chunk);
      await liveWait(150);
    }
    await liveWait(300);
    const actual = await find(label);
    const correct = actual.password === 'true' ? actual.text.length === value.length : actual.text === value;
    if (!correct) continue;
    // Dismiss the verified IME without dispatching application navigation.
    await dismissKeyboard();
    await liveWait(400);
    return;
  }
  throw new Error('Android input could not be verified: ' + label);
}

function screenshot(name: string) {
  const data = execFileSync(adb, ['-s', serial, 'exec-out', 'screencap', '-p'], { timeout: 15000 });
  writeFileSync(resolve(output, name + '.png'), data);
}
async function scroll(label: string, completedLabel?: string, attempts = 8) {
  // A restored focused field can reopen the IME; page controls must be unobscured.
  await dismissKeyboard();
  for (const direction of ['down', 'up'])
    for (let i = 0; i < attempts; i++) {
      const current = nodes();
      if (completedLabel && current.some((n) => match(n, completedLabel))) return;
      const hasTabs = current.some((n) => match(n, '首页')) && current.some((n) => match(n, '直播'));
      const n = current.find(
        (n) => match(n, label) && n.enabled !== 'false' && contentVisible(n, hasTabs ? 300 : 120),
      );
      if (n) {
        // Server refreshes and scroll momentum can move a visible control between snapshots.
        // Wait for its real bounds to settle before issuing a single action.
        await liveWait(300);
        const stable = nodes().find(
          (next) =>
            match(next, label) &&
            next.enabled !== 'false' &&
            contentVisible(next, hasTabs ? 300 : 120) &&
            next.bounds === n.bounds,
        );
        if (!stable) continue;
        tap(stable);
        await liveWait(400);
        return;
      }
      // Scroll the real native container without a touch overscroll that could trigger refresh
      // and erase a transient conflict message while the test is trying to inspect it.
      nodes(direction === 'down' ? 'forward' : 'backward');
      await liveWait(300);
    }
  throw new Error('Android scroll target missing: ' + label);
}

async function main() {
  const f = await createLiveFixture();
  const reverse: string[] = [];
  let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined;
  let discussionProxy: Server | undefined;
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
    const uploadCourse = async (name: string, bytes: Uint8Array, mime: string) => {
      const form = new FormData();
      form.append('courseId', f.course.id);
      form.append('file', new Blob([new Uint8Array(bytes)], { type: mime }), name);
      const response = await fetch(f.origin + '/api/attachments', {
        method: 'POST',
        headers: {
          cookie: f.clients.teacher.cookie,
          'x-csrf-token': f.clients.teacher.csrf,
          origin: f.origin,
        },
        body: form,
      });
      assert.equal(response.status, 201);
      return response.json();
    };
    const videoFile = await uploadCourse(
      'mobile-course.mp4',
      readFileSync('tests/fixtures/mobile-course.mp4'),
      'video/mp4',
    );
    const material = await uploadCourse(
      'native-course-notes.txt',
      new TextEncoder().encode('Native course material fixture'),
      'text/plain',
    );
    const videoLesson = await f.db.lesson.create({
      data: {
        courseId: f.course.id,
        chapterId: chapter.id,
        title: 'Android-native-video',
        type: 'VIDEO',
        attachmentId: videoFile.id,
        attachmentIds: [material.id],
        sortOrder: 1,
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
    run('shell', 'input', 'keyevent', '224');
    run('shell', 'wm', 'dismiss-keyguard');
    run('shell', 'cmd', 'statusbar', 'collapse');
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
    await scroll(videoLesson.title);
    await scroll('加载课程视频');
    await scroll('播放视频');
    await liveWait(5500);
    await scroll('暂停视频');
    const watched = await poll(
      () =>
        f.db.learningProgress.findUnique({
          where: { userId_lessonId: { userId: f.users.student.id, lessonId: videoLesson.id } },
        }),
      (p) => !!p && p.positionSeconds >= 4,
      'Video pause did not persist actual playback',
    );
    assert.equal(watched!.completed, false);
    screenshot('android-course-video');
    passed('private H264 course video decodes natively and pause persists the real playback position');
    let moved = false;
    for (let attempt = 0; attempt < 3 && !moved; attempt++) {
      const latest = await f.db.learningProgress.findUniqueOrThrow({
        where: { userId_lessonId: { userId: f.users.student.id, lessonId: videoLesson.id } },
      });
      const result = await f.call(
        f.clients.student,
        '/lessons/' + videoLesson.id + '/progress',
        'PUT',
        {
          completed: false,
          positionSeconds: 30,
          expectedUpdatedAt: latest.updatedAt.toISOString(),
        },
        [200, 409],
      );
      moved = result.status === 200;
    }
    assert.ok(moved, 'Website fixture could not establish the new resume position');
    // A scheduled native save may detect the conflict before the explicit button tap.
    await scroll('保存当前学习位置', '学习进度已在其他设备更新，请重新加载后继续。');
    await find('学习进度已在其他设备更新，请重新加载后继续。');
    await scroll('重新加载课时');
    await scroll('加载课程视频');
    await find('播放位置：30 秒');
    passed(
      'cross-device video conflict cannot overwrite a newer web position and reload resumes at 30 seconds',
    );
    await scroll('播放视频');
    run('shell', 'input', 'keyevent', '3');
    await liveWait(1800);
    run('shell', 'am', 'start', '-n', pkg + '/.MainActivity');
    await find('播放视频');
    passed('backgrounding pauses native playback without automatically restarting audio');
    await scroll('下载资料：native-course-notes.txt');
    await poll(
      nodes,
      (ns) =>
        ns.some(
          (n) =>
            n.text === '打开或保存课程资料' ||
            n.text === 'Bluetooth' ||
            n['resource-id'] === 'android:id/chooser_header',
        ),
      'Native course material chooser missing',
    );
    run('shell', 'input', 'keyevent', '4');
    passed('authorized course materials use the explicit Android file chooser');
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

    await click('计划');
    await find('学习任务中心');
    await click('新增个人计划');
    await type('计划标题', 'Android-plan-one');
    await type('计划说明', 'Cross-device-plan');
    await scroll('保存个人计划');
    let plan = await poll(
      () => f.db.personalTask.findFirst({ where: { userId: f.users.student.id, title: 'Android-plan-one' } }),
      (p) => !!p,
      'Native plan was not created',
    );
    assert.equal(plan!.description, 'Cross-device-plan');
    assert.ok((await f.call(f.clients.student, '/planner/tasks/' + plan!.id)).body);
    passed('native personal plan creation is synchronized with website');
    await click('月度日程');
    await scroll('查看日程：Android-plan-one');
    await type('计划标题', 'Android-unsaved-change');
    plan = (
      await f.call(f.clients.student, '/planner/tasks/' + plan!.id, 'PATCH', {
        revision: plan!.revision,
        title: 'Website-latest-plan',
      })
    ).body;
    await scroll('保存个人计划');
    await find('待办已在其他页面修改，请刷新后再保存');
    assert.equal(
      (await f.db.personalTask.findUniqueOrThrow({ where: { id: plan!.id } })).title,
      'Website-latest-plan',
    );
    await scroll('重新加载最新版本');
    await click('加载最新内容');
    await poll(
      nodes,
      (ns) => ns.some((n) => n['content-desc'] === '计划标题' && n.text === 'Website-latest-plan'),
      'Conflict reload did not fetch latest task',
    );
    await type('计划标题', 'Android-final-plan');
    await scroll('保存个人计划');
    await poll(
      () => f.db.personalTask.findUnique({ where: { id: plan!.id } }),
      (p) => p?.title === 'Android-final-plan',
      'Native plan edit missing',
    );
    passed('website/native revision conflict preserves latest data and explicitly reloads');
    await scroll('查看日程：Android-final-plan');
    await scroll('标记计划完成');
    await poll(
      () => f.db.personalTask.findUnique({ where: { id: plan!.id } }),
      (p) => !!p?.completedAt,
      'Native completion missing',
    );
    await scroll('查看日程：Android-final-plan');
    await scroll('恢复为未完成');
    await poll(
      () => f.db.personalTask.findUnique({ where: { id: plan!.id } }),
      (p) => !!p && p.completedAt === null,
      'Native reopen missing',
    );
    passed('native completion and reopen persist on both devices');
    await scroll('查看日程：Android-final-plan');
    await scroll('删除个人计划');
    await click('确认删除');
    await poll(
      () => f.db.personalTask.count({ where: { id: plan!.id } }),
      (n) => n === 0,
      'Native deletion missing',
    );
    passed('native confirmed deletion removes website task');
    await click('新增个人计划');
    await type('计划标题', 'Android-discard-plan');
    await scroll('关闭计划编辑');
    await click('继续编辑');
    await find('计划标题');
    await scroll('关闭计划编辑');
    await click('放弃修改');
    assert.equal(
      await f.db.personalTask.count({ where: { userId: f.users.student.id, title: 'Android-discard-plan' } }),
      0,
    );
    passed('native unsaved plan discard confirmation preserves editing and never submits silently');
    const overduePlan = await f.db.personalTask.create({
      data: {
        userId: f.users.student.id,
        organizationId: f.organization.id,
        title: 'Android-overdue-plan',
        dueAt: new Date(Date.now() - 60000),
      },
    });
    await click('待完成行动');
    const overdueControl = (
      await poll(
        nodes,
        (ns) => ns.some((n) => /^已逾期 \d+$/.test(n['content-desc'] || '')),
        'Missing overdue bucket',
      )
    ).find((n) => /^已逾期 \d+$/.test(n['content-desc'] || ''))!;
    tap(overdueControl);
    await scroll('完成计划：Android-overdue-plan');
    await poll(
      () => f.db.personalTask.findUnique({ where: { id: overduePlan.id } }),
      (p) => !!p?.completedAt,
      'Overdue action completion missing',
    );
    passed('native overdue action completes with server revision and disappears from pending list');
    await scroll('筛选课程：全部课程');
    await find('选择课程：' + f.course.title);
    await click('选择课程：' + f.course.title);
    await find('筛选课程：' + f.course.title);
    await click('个人计划');
    await find('筛选课程：全部课程');
    assert.equal((await find('筛选课程：全部课程')).enabled, 'false');
    passed('native course picker and personal source filter cannot combine incompatible filters');
    screenshot('android-planner-actions');
    await click('首页');

    const questionIds: string[] = [];
    for (const [i, typeName] of ['single', 'multiple', 'boolean', 'blank', 'short', 'composite'].entries()) {
      const question = (
        await f.call(f.clients.teacher, '/questions', 'POST', {
          courseId: f.course.id,
          type: typeName,
          stem: '<p>Android-device-question-' + i + '</p>',
          scoreCents: 100,
          options: ['single', 'multiple'].includes(typeName)
            ? [
                { id: 'A', text: 'Alpha' },
                { id: 'B', text: 'Beta' },
              ]
            : [],
          answer:
            typeName === 'multiple'
              ? ['A', 'B']
              : typeName === 'boolean'
                ? false
                : typeName === 'blank'
                  ? [['one']]
                  : typeName === 'composite'
                    ? {}
                    : 'A',
          children:
            typeName === 'composite'
              ? [
                  {
                    id: 'child',
                    type: 'short',
                    stem: '<p>Android-child</p>',
                    answer: 'reference',
                    scoreCents: 100,
                  },
                ]
              : [],
          explanation: 'Android-released-explanation',
        })
      ).body;
      questionIds.push(question.versions[0].id);
    }
    const assignment = (
      await f.call(f.clients.teacher, '/assignments', 'POST', {
        courseId: f.course.id,
        title: 'Android-native-assignment',
        opensAt: new Date(Date.now() - 60000).toISOString(),
        dueAt: new Date(Date.now() + 3600000).toISOString(),
        maxAttempts: 2,
        questionVersionIds: questionIds,
        audienceIds: [f.users.student.id],
      })
    ).body;
    await f.call(f.clients.teacher, '/assignments/' + assignment.id + '/publish', 'POST');
    await scroll('我的作业');
    await scroll('打开作业：' + assignment.title);
    await scroll('第1题：Alpha');
    await scroll('第2题：Alpha');
    await scroll('第2题：Beta');
    await scroll('第3题：错误');
    await scroll('第4题答案');
    await type('第4题答案', 'one');
    await scroll('第5题答案');
    await type('第5题答案', 'Android-short-answer');
    await scroll('第6题-子题1答案');
    await type('第6题-子题1答案', 'Android-composite-answer');
    await click('首页');
    await find('离开作业？');
    await click('继续作答');
    passed('native six question controls preserve unsaved answers behind a leave confirmation');
    await scroll('保存作业草稿');
    let draft = await poll(
      () =>
        f.db.assignmentDraft.findUnique({
          where: { assignmentId_userId: { assignmentId: assignment.id, userId: f.users.student.id } },
        }),
      (p) => !!p,
      'Native assignment draft missing',
    );
    const answerValues = (draft!.answers as any[]).map((x) => x.value);
    assert.deepEqual(answerValues, [
      'A',
      ['A', 'B'],
      false,
      ['one'],
      'Android-short-answer',
      { child: 'Android-composite-answer' },
    ]);
    const webDraft = (await f.call(f.clients.student, '/assignments/' + assignment.id)).body.draft;
    assert.deepEqual(webDraft.answers, draft!.answers);
    passed('native all-type draft is persisted and readable on website');
    const payloadText = 'Android-private-file';
    const fixtureFile = resolve(output, 'zhixue-native-assignment.txt');
    writeFileSync(fixtureFile, payloadText);
    run('push', fixtureFile, '/sdcard/Download/zhixue-native-assignment.txt');
    try {
      await scroll('选择并上传作业附件');
      // Android's system picker is the only authority granted to read this fixture.
      const picker = await poll(
        nodes,
        (ns) =>
          ns.some(
            (n) =>
              n['resource-id'] === 'com.google.android.documentsui:id/roots_toolbar' ||
              n['content-desc'] === 'Show roots' ||
              n.text === 'Downloads' ||
              n.text === '下载',
          ),
        'System document picker missing',
      );
      if (!picker.some((n) => n.text === 'zhixue-native-assignment.txt')) {
        const roots = picker.find(
          (n) => n['content-desc'] === 'Show roots' || n['content-desc'] === '显示根目录',
        );
        if (roots) tap(roots);
        const downloads = (
          await poll(
            nodes,
            (ns) => ns.some((n) => n.text === 'Downloads' || n.text === '下载'),
            'Downloads location missing',
          )
        ).find((n) => n.text === 'Downloads' || n.text === '下载')!;
        tap(downloads);
      }
      await click('zhixue-native-assignment.txt');
      await scroll('下载附件：zhixue-native-assignment.txt');
      await poll(
        nodes,
        (ns) =>
          ns.some(
            (n) =>
              n.text === '打开或保存作业附件' ||
              n.text === 'Bluetooth' ||
              n.text === '蓝牙' ||
              n['resource-id'] === 'android:id/chooser_header',
          ),
        'Private attachment share chooser missing',
      );
      run('shell', 'input', 'keyevent', '4');
      await scroll('保存作业草稿');
      draft = await poll(
        () =>
          f.db.assignmentDraft.findUnique({
            where: { assignmentId_userId: { assignmentId: assignment.id, userId: f.users.student.id } },
          }),
        (p) => !!p?.attachmentIds.length,
        'Native attachment not saved',
      );
      const attachment = await f.db.attachment.findUniqueOrThrow({ where: { id: draft!.attachmentIds[0] } });
      assert.equal(attachment.size, Buffer.byteLength(payloadText));
      assert.equal(attachment.assignmentId, assignment.id);
      passed('Android system picker uploads a scoped private attachment and download opens the OS chooser');
    } finally {
      run('shell', 'rm', '-f', '/sdcard/Download/zhixue-native-assignment.txt');
    }
    const changed = (
      await f.call(f.clients.student, '/assignments/' + assignment.id + '/draft', 'PUT', {
        revision: draft!.revision,
        answers: draft!.answers,
        attachmentIds: draft!.attachmentIds,
      })
    ).body;
    await scroll('保存作业草稿');
    await scroll('另一页面已保存新草稿，请刷新后继续');
    assert.equal(
      (await f.db.assignmentDraft.findUniqueOrThrow({ where: { id: draft!.id } })).revision,
      changed.revision,
    );
    await scroll('刷新作业与最新草稿');
    // A saved, stale editor has no unsaved changes; no discard confirmation is needed.
    await scroll('提交作业');
    await click('正式提交');
    const submission = await poll(
      () =>
        f.db.assignmentSubmission.findFirst({
          where: { assignmentId: assignment.id, userId: f.users.student.id, version: 1 },
        }),
      (p) => !!p,
      'Native formal submission missing',
    );
    assert.equal(
      await f.db.assignmentSubmission.count({
        where: { assignmentId: assignment.id, userId: f.users.student.id },
      }),
      1,
    );
    passed('cross-device revision conflict reload and explicit native formal submission');
    await f.call(f.clients.teacher, '/submissions/' + submission!.id + '/grade', 'PUT', {
      revision: 0,
      items: questionIds.map((questionVersionId) => ({
        questionVersionId,
        scoreCents: 80,
        comment: 'Android-item-feedback',
      })),
      comment: 'Android-published-feedback',
    });
    await scroll('刷新作业与最新草稿');
    await scroll('查看第1次提交与反馈');
    await find('教师尚未发布成绩与反馈。');
    assert.equal(
      nodes().some((n) => n.text === 'Android-published-feedback'),
      false,
    );
    await scroll('关闭提交反馈');
    await f.call(f.clients.teacher, '/assignments/' + assignment.id + '/release', 'POST');
    await scroll('刷新作业与最新草稿');
    await scroll('查看第1次提交与反馈');
    await scroll('Android-published-feedback');
    screenshot('android-assignment-feedback');
    passed('unpublished grading stays hidden and released feedback appears in native history');
    await scroll('使用本次答案重新作答');
    await click('复制到当前作答');
    await scroll('提交作业');
    await click('正式提交');
    await poll(
      () =>
        f.db.assignmentSubmission.count({
          where: { assignmentId: assignment.id, userId: f.users.student.id },
        }),
      (n) => n === 2,
      'Native resubmission missing',
    );
    await scroll('已达提交次数上限，可向教师申请重交。');
    passed('native history reuse creates a controlled immutable second version and enforces attempt limit');
    await click('首页');

    const examQuestionIds: string[] = [];
    for (const [i, typeName] of ['single', 'multiple', 'boolean', 'blank', 'short', 'composite'].entries()) {
      const question = (
        await f.call(f.clients.teacher, '/questions', 'POST', {
          courseId: f.course.id,
          type: typeName,
          stem: '<p>Android-exam-question-' + i + '</p>',
          scoreCents: 100,
          options: ['single', 'multiple'].includes(typeName)
            ? [
                { id: 'A', text: 'Alpha' },
                { id: 'B', text: 'Beta' },
              ]
            : [],
          answer:
            typeName === 'multiple'
              ? ['A', 'B']
              : typeName === 'boolean'
                ? false
                : typeName === 'blank'
                  ? [['one']]
                  : typeName === 'composite'
                    ? {}
                    : 'A',
          children:
            typeName === 'composite'
              ? [
                  {
                    id: 'child',
                    type: 'short',
                    stem: '<p>Android-child</p>',
                    answer: 'reference',
                    scoreCents: 100,
                  },
                ]
              : [],
          explanation: 'Android-released-explanation',
        })
      ).body;
      examQuestionIds.push(question.versions[0].id);
    }

    const exam = (
      await f.call(f.clients.teacher, '/exams', 'POST', {
        courseId: f.course.id,
        title: 'Android-native-exam',
        startsAt: new Date(Date.now() - 60000).toISOString(),
        endsAt: new Date(Date.now() + 3600000).toISOString(),
        entryClosesAt: new Date(Date.now() + 1800000).toISOString(),
        durationMinutes: 20,
        passCents: 100,
        maxAttempts: 1,
        graderIds: [f.users.teacher.id],
        questionVersionIds: examQuestionIds,
        audienceIds: [f.users.student.id],
      })
    ).body;
    await f.call(f.clients.teacher, '/exams/' + exam.id + '/publish', 'POST');
    await scroll('我的考试');
    await scroll('打开考试：' + exam.title);
    await scroll('开始考试');
    await click('开始作答');
    await scroll('考试第1题：Alpha');
    await scroll('标记本题');
    await scroll('下一题');
    await scroll('考试第2题：Alpha');
    await scroll('考试第2题：Beta');
    await scroll('下一题');
    await scroll('考试第3题：错误');
    await scroll('下一题');
    await scroll('考试第4题答案');
    await type('考试第4题答案', 'one');
    await scroll('下一题');
    await scroll('考试第5题答案');
    await type('考试第5题答案', 'Android-exam-essay');
    await scroll('下一题');
    await scroll('考试第6题-子题1答案');
    await type('考试第6题-子题1答案', 'Android-exam-child');
    await scroll('保存考试答案');
    let attempt = await poll(
      () =>
        f.db.examAttempt.findFirst({
          where: { examId: exam.id, userId: f.users.student.id },
          include: { answers: true },
        }),
      (p) => !!p && p.answers.length === 6,
      'Native exam six answers missing',
    );
    const actual = Object.fromEntries(attempt!.answers.map((x) => [x.questionVersionId, x.value]));
    assert.deepEqual(
      examQuestionIds.map((id) => actual[id]),
      ['A', ['A', 'B'], false, ['one'], 'Android-exam-essay', { child: 'Android-exam-child' }],
    );
    assert.deepEqual(attempt!.flags, [examQuestionIds[0]]);
    passed(
      'native exam starts one server-timed attempt and autosaves all six answer types, flags and position',
    );
    await click('首页');
    await find('离开考试？');
    await click('继续作答');
    passed('native in-progress exam exit explains continuing timer and protects unsynced work');
    run('shell', 'am', 'force-stop', pkg);
    run('shell', 'am', 'start', '-n', pkg + '/.MainActivity');
    await find('学习工作台');
    await scroll('我的考试');
    await scroll('打开考试：' + exam.title);
    await scroll('继续本次考试');
    await scroll('考试第6题-子题1答案');
    assert.equal((await find('考试第6题-子题1答案')).text, 'Android-exam-child');
    assert.equal(await f.db.examAttempt.count({ where: { examId: exam.id, userId: f.users.student.id } }), 1);
    await click('计划');
    await click('保存后离开');
    await scroll('课程考试');
    await scroll('继续答卷');
    await scroll('考试第6题-子题1答案');
    assert.equal((await find('考试第6题-子题1答案')).text, 'Android-exam-child');
    passed('native exam restart and planner link resume saved answers and position without another attempt');
    run('shell', 'input', 'keyevent', '3');
    await liveWait(700);
    attempt = await f.db.examAttempt.findUniqueOrThrow({
      where: { id: attempt!.id },
      include: { answers: true },
    });
    await f.call(f.clients.student, '/attempts/' + attempt.id + '/answers', 'PUT', {
      revision: attempt.revision,
      answers: [{ questionVersionId: examQuestionIds[5], value: { child: 'Website-new-answer' } }],
    });
    run('shell', 'am', 'start', '-n', pkg + '/.MainActivity');
    await scroll('答卷已在其他设备更新，请核对并重新加载服务器答卷。');
    await scroll('重新加载服务器答卷');
    await click('以服务器为准');
    await scroll('考试第6题-子题1答案');
    assert.equal((await find('考试第6题-子题1答案')).text, 'Website-new-answer');
    passed(
      'native exam foreground rechecks server revision and requires explicit reload after website edits',
    );
    await scroll('交卷');
    await click('确认交卷');
    await scroll('服务器已接收答卷');
    assert.equal(
      (await f.db.examAttempt.findUniqueOrThrow({ where: { id: attempt.id } })).status,
      'submitted',
    );
    assert.equal(await f.db.auditLog.count({ where: { action: 'exam.submit', resourceId: attempt.id } }), 1);
    assert.equal(
      nodes().some((n) => n.text === 'Android-released-explanation'),
      false,
    );
    passed(
      'native exam submission displays server receipt while unpublished grading and answer keys remain hidden',
    );
    await f.db.exam.update({
      where: { id: exam.id },
      data: {
        endsAt: new Date(Date.now() - 1000),
        entryClosesAt: new Date(Date.now() - 2000),
        scoreReleaseAt: new Date(Date.now() - 1000),
        answerReleaseAt: new Date(Date.now() - 1000),
        explanationReleaseAt: new Date(Date.now() - 1000),
      },
    });
    await f.db.examAttempt.update({
      where: { id: attempt.id },
      data: { scoreCents: 500, gradingStatus: 'graded', feedback: 'Android-exam-feedback' },
    });
    await f.call(f.clients.teacher, '/exams/' + exam.id + '/release', 'POST');
    await scroll('核对服务器回执');
    await scroll('考试得分：5');
    screenshot('android-exam-result');
    await scroll('Android-released-explanation');
    passed('native released exam score, feedback and reference review follow teacher publication');
    await scroll('成绩复核与变更记录');
    await scroll('成绩复核理由');
    await type('成绩复核理由', 'Android-review-reason');
    await click('首页');
    await find('离开成绩复核？');
    await click('继续填写');
    await scroll('提交成绩复核');
    await click('继续检查');
    assert.equal(await f.db.gradeAppeal.count({ where: { attemptId: attempt.id } }), 0);
    passed('native review protects unsent reason and explicit confirmation never submits on cancel');
    await scroll('提交成绩复核');
    await click('确认提交复核');
    await scroll('复核申请已受理');
    const appeal = await f.db.gradeAppeal.findUniqueOrThrow({
      where: { attemptId_userId: { attemptId: attempt.id, userId: f.users.student.id } },
    });
    assert.equal(appeal.reason, 'Android-review-reason');
    assert.equal(await f.db.auditLog.count({ where: { action: 'grade.appeal', resourceId: appeal.id } }), 1);
    passed('native review submits one first-reason application and shows the server receipt');
    await click('首页');
    await scroll('成绩复核');
    await scroll('待处理复核');
    await scroll('查看复核：' + exam.title);
    await scroll('复核申请已受理');
    passed('native review list filters pending applications and links the exact own attempt');
    await f.db.sensitiveGrant.create({
      data: {
        organizationId: f.organization.id,
        userId: f.users.teacher.id,
        permissionId: 'grade.revise',
        grantedBy: f.users.admin.id,
        reason: 'isolated Android review acceptance',
        expiresAt: new Date(Date.now() + 3600000),
      },
    });
    await f.call(f.clients.teacher, '/appeals/' + appeal.id + '/resolve', 'POST', {
      resolution: 'Android-review-resolution',
      scoreCents: 550,
    });
    await scroll('核对复核回执与处理进度');
    await scroll('当前有效成绩：5.50');
    await scroll('Android-review-resolution');
    await scroll('5 → 5.50 分');
    screenshot('android-review-result');
    assert.equal(
      await f.db.gradeRevision.count({ where: { attemptId: attempt.id, appealId: appeal.id } }),
      1,
    );
    passed(
      'website teacher processing updates native public resolution, effective score and immutable grade history',
    );
    run('shell', 'am', 'force-stop', pkg);
    run('shell', 'am', 'start', '-n', pkg + '/.MainActivity');
    await find('学习工作台');
    await scroll('成绩复核');
    await scroll('已处理复核');
    await scroll('查看复核：' + exam.title);
    await scroll('复核已处理');
    await f.db.exam.update({ where: { id: exam.id }, data: { appealDeadline: new Date(Date.now() - 1000) } });
    const repeated = (
      await f.call(f.clients.student, '/attempts/' + attempt.id + '/appeals', 'POST', {
        reason: 'Do-not-overwrite-first-reason',
      })
    ).body;
    assert.equal(repeated.id, appeal.id);
    assert.equal(repeated.reason, 'Android-review-reason');
    assert.equal(await f.db.gradeAppeal.count({ where: { attemptId: attempt.id } }), 1);
    passed(
      'native resolved review survives restart and response recovery after deadline cannot overwrite the reason',
    );
    await f.db.examAttempt.update({ where: { id: attempt.id }, data: { releaseStatus: 'pending' } });
    await scroll('核对复核回执与处理进度');
    await scroll('当前有效成绩：待发布');
    assert.equal(
      nodes().some((n) => n.text === 'Android-review-resolution'),
      false,
    );
    await scroll('当前没有可公开的成绩变更记录。');
    passed('native review hides effective score, resolution and grade changes when publication is withdrawn');
    await f.db.examAttempt.update({ where: { id: attempt.id }, data: { releaseStatus: 'released' } });

    const inboxScroll = (label: string) => scroll(label, undefined, 20);
    // App inbox uses real persisted notices; sensitive historical text must never reach native presentation.
    await f.db.notification.deleteMany({ where: { userId: f.users.student.id } });
    const inboxNotes: { id: string }[] = [];
    const inboxTime = Date.now();
    for (let i = 0; i < 12; i++)
      inboxNotes.push(
        await f.db.notification.create({
          data: {
            organizationId: f.organization.id,
            userId: f.users.student.id,
            type: i === 0 ? 'grade' : i === 1 ? 'assignment' : i === 2 ? 'MEMBERSHIP' : 'exam',
            title: 'INBOX-PRIVATE-SCORE-999999',
            body: 'INBOX-PRIVATE-RESOLUTION',
            link:
              i === 0
                ? '/attempts/' + attempt.id
                : i === 1
                  ? '/assignments/' + assignment.id
                  : i === 2
                    ? '/courses/' + f.course.id
                    : '/exams/' + exam.id,
            eventKey: 'device-inbox-' + i,
            createdAt: new Date(inboxTime - i * 1000),
          },
        }),
      );
    await f.db.notification.create({
      data: {
        organizationId: f.organization.id,
        userId: f.users.student2.id,
        type: 'exam',
        title: 'OTHER-STUDENT-NOTICE',
        body: '',
        link: '/exams/' + exam.id,
        eventKey: 'other-device-inbox',
      },
    });
    await click('首页');
    await inboxScroll('学习通知');
    await find('我的学习通知');
    await find('未读 12 条通知');
    assert.ok(!nodes().some((n) => /INBOX-PRIVATE|OTHER-STUDENT-NOTICE/.test(n.text || '')));
    screenshot('android-inbox');
    passed(
      'native inbox shows own safe summaries and unread count without stored private bodies or grade snapshots',
    );
    await inboxScroll('查看第 1 条通知内容');
    await find('复核已处理');
    assert.equal(
      (await f.db.notification.findUniqueOrThrow({ where: { id: inboxNotes[0].id } })).readAt,
      null,
    );
    await click('首页');
    await inboxScroll('学习通知');
    await inboxScroll('标记第 1 条为已读');
    await poll(
      () => f.db.notification.findUniqueOrThrow({ where: { id: inboxNotes[0].id } }),
      (n) => !!n.readAt,
      'Native single read was not persisted',
    );
    const webNotices = (await f.call(f.clients.student, '/notifications?pageSize=20')).body;
    assert.ok(webNotices.items.find((n: any) => n.id === inboxNotes[0].id).readAt);
    passed(
      'native notification opens exact authorized review without silent read and explicit read synchronizes with website',
    );
    await inboxScroll('仅未读通知');
    await find('未读 11 条通知');
    await inboxScroll('本页未读标记已读');
    await click('取消');
    assert.equal(await f.db.notification.count({ where: { userId: f.users.student.id, readAt: null } }), 11);
    await inboxScroll('本页未读标记已读');
    await find('确认本页已读');
    const newestNotice = await f.db.notification.create({
      data: {
        organizationId: f.organization.id,
        userId: f.users.student.id,
        type: 'exam',
        title: 'New-after-confirmation-opened',
        body: '',
        link: '/exams/' + exam.id,
        eventKey: 'device-new-arrival',
      },
    });
    await click('确认本页已读');
    await find('未读 2 条通知');
    assert.equal(
      (await f.db.notification.findUniqueOrThrow({ where: { id: newestNotice.id } })).readAt,
      null,
    );
    passed(
      'native visible-page read confirmation preserves cancellation and new notifications received after the snapshot',
    );
    run('shell', 'am', 'force-stop', pkg);
    run('shell', 'am', 'start', '-n', pkg + '/.MainActivity');
    await find('学习工作台');
    await inboxScroll('学习通知');
    await find('未读 2 条通知');
    await inboxScroll('下一页通知');
    await inboxScroll('第 2 页通知');
    await inboxScroll('上一页通知');
    await inboxScroll('成绩提醒');
    await find('共 1 条通知');
    passed(
      'native inbox read receipts survive process restart and type filtering and pagination stay on server data',
    );
    await inboxScroll('课程提醒');
    await find('共 1 条通知');
    await f.db.enrollment.update({
      where: { courseId_userId: { courseId: f.course.id, userId: f.users.student.id } },
      data: { active: false },
    });
    await inboxScroll('查看第 1 条通知内容');
    await inboxScroll('当前没有此课程的访问资格。请刷新核对后重试。');
    assert.equal(
      (await f.db.notification.findUniqueOrThrow({ where: { id: inboxNotes[2].id } })).readAt === null,
      false,
    );
    await f.db.enrollment.update({
      where: { courseId_userId: { courseId: f.course.id, userId: f.users.student.id } },
      data: { active: true },
    });
    await inboxScroll('查看第 1 条通知内容');
    await find(f.course.title);
    passed(
      'native notification target rechecks revoked enrollment and only navigates after restored authorization',
    );
    await click('首页');
    await inboxScroll('学习通知');
    await inboxScroll('作业提醒');
    await find('共 1 条通知');
    await inboxScroll('查看第 1 条通知内容');
    await find(assignment.title);
    await click('首页');
    await inboxScroll('学习通知');
    await inboxScroll('考试提醒');
    await inboxScroll('查看第 1 条通知内容');
    await find(exam.title);
    passed('native learning reminders open real assignment and exam pages through typed internal navigation');

    await click('首页');
    const announcementScroll = (label: string) => scroll(label, undefined, 20);
    const announcementRows: any[] = [];
    for (let i = 0; i < 12; i++)
      announcementRows.push(
        (
          await f.call(f.clients.teacher, '/announcements', 'POST', {
            courseId: f.course.id,
            title: 'NativeBulletin-' + i,
            content: '<p>Native-course-body-' + i + '</p>',
          })
        ).body,
      );
    const orgAnnouncement = (
      await f.call(f.clients.admin, '/announcements', 'POST', {
        title: 'NativeOrgAnnouncement',
        content: '<p>Native-institution-body</p>',
      })
    ).body;
    runFixtureJobs(f.env);
    await announcementScroll('教学公告');
    await announcementScroll('共 13 条公告，第 1 页');
    await announcementScroll('机构公告');
    await announcementScroll('共 1 条公告，第 1 页');
    await announcementScroll('查看第 1 条公告');
    await find('公告详情');
    await find('Native-institution-body');
    const orgNotice = await f.db.notification.findFirstOrThrow({
      where: { userId: f.users.student.id, eventKey: 'announcement:' + orgAnnouncement.id },
    });
    assert.equal(orgNotice.readAt, null);
    screenshot('android-announcement');
    passed(
      'native announcements show institution content from shared records without implicitly reading a notification',
    );
    await click('首页');
    await click('课程');
    await scroll(f.course.title);
    await announcementScroll('查看课程公告');
    await announcementScroll('共 12 条公告，第 1 页');
    await type('搜索公告标题', 'NativeBulletin-0');
    await announcementScroll('搜索公告');
    await announcementScroll('共 1 条公告，第 1 页');
    await announcementScroll('查看第 1 条公告');
    await find('Native-course-body-0');
    await f.db.enrollment.update({
      where: { courseId_userId: { courseId: f.course.id, userId: f.users.student.id } },
      data: { active: false },
    });
    await announcementScroll('刷新公告详情');
    await find('当前没有此课程的访问资格');
    assert.ok(!nodes().some((n) => (n.text || '').includes('Native-course-body-0')));
    await f.db.enrollment.update({
      where: { courseId_userId: { courseId: f.course.id, userId: f.users.student.id } },
      data: { active: true },
    });
    await announcementScroll('刷新公告详情');
    await find('Native-course-body-0');
    passed(
      'native course announcement title search and refreshed authorization hide withdrawn membership content',
    );
    await click('首页');
    await announcementScroll('教学公告');
    await announcementScroll('下一页公告');
    await announcementScroll('共 13 条公告，第 2 页');
    await announcementScroll('上一页公告');
    await announcementScroll('共 13 条公告，第 1 页');
    run('shell', 'am', 'force-stop', pkg);
    run('shell', 'am', 'start', '-n', pkg + '/.MainActivity');
    await find('学习工作台');
    await announcementScroll('教学公告');
    await announcementScroll('课程公告');
    await announcementScroll('共 12 条公告，第 1 页');
    passed(
      'native announcement list paginates and remains available after process restart with current server records',
    );
    await click('首页');
    await inboxScroll('学习通知');
    await inboxScroll('课程提醒');
    await inboxScroll('查看第 1 条通知内容');
    await find('公告详情');
    await find('NativeOrgAnnouncement');
    assert.equal((await f.db.notification.findUniqueOrThrow({ where: { id: orgNotice.id } })).readAt, null);
    await f.db.announcement.delete({ where: { id: orgAnnouncement.id } });
    await announcementScroll('刷新公告详情');
    await find('公告不存在或已撤回');
    assert.ok(!nodes().some((n) => (n.text || '').includes('Native-institution-body')));
    passed(
      'native announcement notification opens its exact current record and deletion hides stale content without silent read',
    );

    await click('首页');
    const discussionScroll = (label: string) => scroll(label, undefined, 24);
    const topicRows: any[] = [];
    for (let i = 0; i < 12; i++)
      topicRows.push(
        (
          await f.call(f.clients.teacher, '/communication/posts', 'POST', {
            courseId: f.course.id,
            title: i === 0 ? 'NativeForumRoot' : 'NativeForum-' + i,
            body: 'Forum-body-' + i,
          })
        ).body,
      );
    const forum = topicRows[0];
    await f.call(f.clients.teacher, '/communication/posts/' + forum.id, 'PATCH', {
      pinned: true,
      featured: true,
    });
    const webReply = (
      await f.call(f.clients.teacher, '/communication/posts/' + forum.id + '/replies', 'POST', {
        body: 'Teacher-forum-answer',
      })
    ).body;
    await click('课程');
    await scroll(f.course.title);
    await discussionScroll('查看课程讨论');
    await discussionScroll('共 12 个话题，第 1 页');
    await type('搜索讨论标题', 'NativeForumRoot');
    await discussionScroll('搜索讨论');
    await discussionScroll('共 1 个话题，第 1 页');
    await discussionScroll('打开第 1 个话题');
    await discussionScroll('Forum-body-0');
    await discussionScroll('讨论回复正文');
    await type('讨论回复正文', 'Native-forum-unsent');
    await click('首页');
    await find('离开讨论编辑？');
    await click('继续编辑');
    assert.equal(
      await f.db.discussionReply.count({ where: { authorId: f.users.student.id, postId: forum.id } }),
      0,
    );
    await discussionScroll('发布讨论回复');
    await find('确认发布回复？');
    await click('继续编辑');
    assert.equal(
      await f.db.discussionReply.count({ where: { authorId: f.users.student.id, postId: forum.id } }),
      0,
    );
    passed(
      'native course discussion search opens shared records and unsent/cancelled reply confirmations never publish',
    );
    await discussionScroll('引用第 1 条回复');
    await discussionScroll('发布讨论回复');
    await click('确认发布');
    await discussionScroll('回复已发布，网站和手机使用同一条记录。');
    const ownForumReply = await f.db.discussionReply.findFirstOrThrow({
      where: { postId: forum.id, authorId: f.users.student.id },
    });
    assert.equal(ownForumReply.body, 'Native-forum-unsent');
    assert.equal(ownForumReply.quoteReplyId, webReply.id);
    assert.equal(
      await f.db.discussionReply.count({ where: { postId: forum.id, authorId: f.users.student.id } }),
      1,
    );
    await discussionScroll('刷新讨论详情');
    await discussionScroll('Native-forum-unsent');
    assert.equal(
      (await f.call(f.clients.teacher, '/communication/posts/' + forum.id)).body.replies.filter(
        (r: any) => r.id === ownForumReply.id,
      ).length,
      1,
    );
    screenshot('android-discussion');
    passed(
      'native quoted reply creates one real website reply with server receipt and current visible quote',
    );

    // Lose actual HTTP responses only after the fixture commits. Never mock API data or native state.
    let dropForumWrites = true;
    discussionProxy = createServer(async (request, response) => {
      try {
        const path = request.url || '';
        if (!path.startsWith('/api/') || path.includes('://')) {
          response.writeHead(404);
          response.end();
          return;
        }
        const chunks: Buffer[] = [];
        let size = 0;
        for await (const chunk of request) {
          const b = Buffer.from(chunk);
          size += b.length;
          if (size > 65536) throw new Error('Fixture body bound');
          chunks.push(b);
        }
        const upstream = await fetch(f.origin + path, {
          method: request.method,
          redirect: 'error',
          headers: {
            ...(request.headers.authorization ? { authorization: request.headers.authorization } : {}),
            'content-type': 'application/json',
            accept: 'application/json',
          },
          ...(chunks.length ? { body: Buffer.concat(chunks).toString('utf8') } : {}),
          signal: AbortSignal.timeout(20000),
        });
        const bytes = Buffer.from(await upstream.arrayBuffer());
        if (
          dropForumWrites &&
          request.method === 'POST' &&
          path === '/api/mobile/discussions/' + forum.id + '/replies'
        ) {
          response.destroy();
          return;
        }
        response.writeHead(upstream.status, {
          'content-type': upstream.headers.get('content-type') || 'application/json',
          'cache-control': 'no-store',
        });
        response.end(bytes);
      } catch {
        response.destroy();
      }
    });
    await new Promise<void>((done) => discussionProxy!.listen(0, '127.0.0.1', done));
    const proxyPort = (discussionProxy.address() as { port: number }).port;
    run('shell', 'am', 'force-stop', pkg);
    run('reverse', 'tcp:3030', 'tcp:' + proxyPort);
    run('shell', 'am', 'start', '-n', pkg + '/.MainActivity');
    await find('学习工作台');
    await discussionScroll('课程讨论');
    await discussionScroll('打开第 1 个话题');
    await discussionScroll('讨论回复正文');
    await type('讨论回复正文', 'Native-forum-lost-response');
    await discussionScroll('发布讨论回复');
    await click('确认发布');
    // Observe the uncertain state before explicitly tapping the receipt action.
    await scroll('核对本次发布结果', '核对本次发布结果', 24);
    assert.equal(
      await f.db.discussionReply.count({
        where: { postId: forum.id, authorId: f.users.student.id, body: 'Native-forum-lost-response' },
      }),
      1,
    );
    dropForumWrites = false;
    await discussionScroll('核对本次发布结果');
    await discussionScroll('回复已发布，网站和手机使用同一条记录。');
    assert.equal(
      await f.db.discussionReply.count({
        where: { postId: forum.id, authorId: f.users.student.id, body: 'Native-forum-lost-response' },
      }),
      1,
    );
    passed(
      'native lost-response state freezes a real committed reply and read-only receipt recovery never creates another record',
    );
    run('shell', 'am', 'force-stop', pkg);
    run('reverse', 'tcp:3030', 'tcp:' + new URL(f.origin).port);
    discussionProxy.closeAllConnections();
    await new Promise<void>((done) => discussionProxy!.close(() => done()));
    discussionProxy = undefined;
    run('shell', 'am', 'start', '-n', pkg + '/.MainActivity');
    await find('学习工作台');

    await discussionScroll('课程讨论');
    await discussionScroll('下一页话题');
    await discussionScroll('共 12 个话题，第 2 页');
    await discussionScroll('上一页话题');
    await discussionScroll('仅看精华讨论');
    await discussionScroll('共 1 个话题，第 1 页');
    await discussionScroll('打开第 1 个话题');
    await f.call(f.clients.teacher, '/communication/posts/' + forum.id, 'PATCH', { closed: true });
    await discussionScroll('刷新讨论详情');
    await discussionScroll('讨论已关闭');
    await scroll('发布讨论回复', '发布讨论回复', 24);
    assert.equal((await find('发布讨论回复')).enabled, 'false');
    await f.call(f.clients.teacher, '/communication/posts/' + forum.id, 'PATCH', { closed: false });
    await f.db.enrollment.update({
      where: { courseId_userId: { courseId: f.course.id, userId: f.users.student.id } },
      data: { active: false },
    });
    await discussionScroll('刷新讨论详情');
    await find('当前没有此课程的访问资格');
    assert.ok(!nodes().some((n) => (n.text || '').includes('Forum-body-0')));
    await f.db.enrollment.update({
      where: { courseId_userId: { courseId: f.course.id, userId: f.users.student.id } },
      data: { active: true },
    });
    await discussionScroll('刷新讨论详情');
    await discussionScroll('Forum-body-0');
    passed(
      'native discussion paging/filter survive restart and current closure or course revocation prevents replies and hides stale content',
    );

    await click('首页');
    const globalDiscussionEntry = process.env.MOBILE_TEST_DISCUSSION_GLOBAL_ENTRY === 'true';
    if (globalDiscussionEntry) await discussionScroll('课程讨论');
    else {
      await click('课程');
      await scroll(f.course.title);
      await discussionScroll('查看课程讨论');
    }
    await discussionScroll('发布文字话题');
    await find('发布课程话题');
    if (globalDiscussionEntry) {
      await discussionScroll('选择课程：' + f.course.title);
      await find('已选课程：' + f.course.title);
    }
    await discussionScroll('话题标题');
    await type('话题标题', 'NativeStudentTopic');
    await discussionScroll('话题正文');
    await type('话题正文', 'Native-student-topic-body');
    await click('首页');
    await find('离开讨论编辑？');
    await click('继续编辑');
    await discussionScroll('提交新话题');
    await find('确认发布话题？');
    await click('继续编辑');
    assert.equal(
      await f.db.discussionPost.count({
        where: { title: 'NativeStudentTopic', authorId: f.users.student.id },
      }),
      0,
    );
    await discussionScroll('提交新话题');
    await click('确认发布');
    await discussionScroll('NativeStudentTopic');
    await discussionScroll('Native-student-topic-body');
    assert.equal(
      await f.db.discussionPost.count({
        where: { title: 'NativeStudentTopic', authorId: f.users.student.id },
      }),
      1,
    );
    passed(
      'native confirmed course topic publishing creates exactly one shared record and navigates without discarding a successful receipt',
    );
    await click('首页');
    // Native algorithm learning and review. No judge or AI endpoint is called.
    const algorithmScroll = (label: string) => scroll(label, undefined, 28);
    const algorithmObserve = async (label: string) => {
      await dismissKeyboard();
      for (const direction of ['forward', 'backward'] as const)
        for (let i = 0; i < 28; i++) {
          if (nodes().some((n) => match(n, label) && contentVisible(n, 300))) return;
          nodes(direction);
          await liveWait(300);
        }
      throw new Error('Android observation missing: ' + label);
    };

    const algorithmProblem = 'sum-of-two';
    const algorithmBase = '/algorithms/problems/' + algorithmProblem;
    await click('首页');
    await algorithmScroll('算法学习');
    await find('算法学习与复习');
    const algorithmTotal = (await f.call(f.clients.student, '/algorithms/problems')).body.total;
    await algorithmScroll(`共 ${algorithmTotal} 道算法题，第 1 页`);
    await algorithmScroll('下一页算法题');
    await algorithmScroll(`共 ${algorithmTotal} 道算法题，第 2 页`);
    await algorithmScroll('搜索算法题');
    await type('搜索算法题', '1');
    await algorithmScroll('搜索算法题库');
    await algorithmScroll('打开第 1 道算法题');
    await find('算法题目与学习记录');
    await algorithmScroll('数据范围');
    passed(
      'native algorithm catalog searches, paginates and opens actual shared public statements without executing code',
    );
    await algorithmScroll('阅读算法题解');
    await find('算法题解与复盘');
    await algorithmScroll('阅读指引');
    await algorithmScroll('解题提示');
    await algorithmScroll('样例推演');
    await algorithmScroll('边界条件与常见错误');
    const algorithmEditorial = (await f.call(f.clients.student, algorithmBase + '/editorial')).body.editorial;
    for (const [language, label] of [
      ['cpp', 'C++'],
      ['python', 'Python'],
      ['javascript', 'JavaScript'],
      ['java', 'Java'],
    ]) {
      await algorithmScroll('查看' + label + '参考代码');
      await algorithmScroll('算法参考代码');
      assert.equal((await find('算法参考代码')).text, algorithmEditorial.referenceCode[language]);
    }
    await algorithmScroll('返回算法题目');
    await algorithmScroll('算法私人笔记');
    await type('算法私人笔记', 'Native-algorithm-first');
    await click('首页');
    await find('离开算法学习？');
    await click('继续编辑');
    assert.equal((await find('算法私人笔记')).text, 'Native-algorithm-first');
    assert.equal(
      await f.db.algorithmLearningState.count({
        where: { userId: f.users.student.id, problemId: algorithmProblem },
      }),
      0,
    );
    await algorithmScroll('收藏算法题');
    await algorithmScroll('标记待复习');
    await algorithmScroll('保存算法学习记录');
    await find('保存算法学习记录？');
    await click('继续编辑');
    assert.equal(
      await f.db.algorithmLearningState.count({
        where: { userId: f.users.student.id, problemId: algorithmProblem },
      }),
      0,
    );
    passed(
      'native algorithm editorials render all four real reference programs and unsaved or cancelled learning changes never write',
    );
    await algorithmScroll('保存算法学习记录');
    await click('确认保存学习记录');
    await algorithmScroll('算法学习记录已保存');
    let algorithmState = (await f.call(f.clients.student, algorithmBase + '/learning')).body;
    assert.equal(algorithmState.note, 'Native-algorithm-first');
    assert.equal(algorithmState.favorite, true);
    assert.equal(algorithmState.reviewStatus, 'review');
    assert.equal(algorithmState.revision, 1);
    screenshot('android-algorithm-learning');
    passed(
      'native confirmed algorithm favorite, review status and private note synchronize one website record',
    );
    await algorithmScroll('算法私人笔记');
    await type('算法私人笔记', 'Native-algorithm-unsaved');
    await f.call(f.clients.student, algorithmBase + '/learning', 'PATCH', {
      revision: algorithmState.revision,
      note: 'Website-algorithm-new',
      favorite: false,
      reviewStatus: 'none',
    });
    await algorithmScroll('刷新算法题目');
    await algorithmScroll('加载服务器学习记录');
    await find('加载服务器学习记录？');
    await click('继续编辑');
    await algorithmObserve('算法私人笔记');
    assert.equal((await find('算法私人笔记')).text, 'Native-algorithm-unsaved');
    await algorithmScroll('加载服务器学习记录');
    await click('舍弃并加载');
    await algorithmScroll('算法私人笔记');
    assert.equal((await find('算法私人笔记')).text, 'Website-algorithm-new');
    passed(
      'native algorithm cross-device version conflict preserves unsaved notes until explicit server reload',
    );
    let dropAlgorithmWrites = true;
    discussionProxy = createServer(async (request, response) => {
      try {
        const path = request.url || '';
        if (!path.startsWith('/api/') || path.includes('://')) {
          response.writeHead(404);
          response.end();
          return;
        }
        const chunks: Buffer[] = [];
        let size = 0;
        for await (const chunk of request) {
          const b = Buffer.from(chunk);
          size += b.length;
          if (size > 65536) throw new Error('Fixture body bound');
          chunks.push(b);
        }
        const upstream = await fetch(f.origin + path, {
          method: request.method,
          redirect: 'error',
          headers: {
            accept: 'application/json',
            ...(request.headers.authorization ? { authorization: request.headers.authorization } : {}),
            ...(request.headers['content-type'] ? { 'content-type': request.headers['content-type'] } : {}),
          },
          ...(chunks.length ? { body: Buffer.concat(chunks) } : {}),
        });
        const body = Buffer.from(await upstream.arrayBuffer());
        if (
          dropAlgorithmWrites &&
          request.method === 'PATCH' &&
          path === '/api/mobile/algorithms/problems/' + algorithmProblem + '/learning'
        ) {
          request.socket.destroy();
          return;
        }
        response.writeHead(upstream.status, {
          'content-type': upstream.headers.get('content-type') || 'application/json',
        });
        response.end(body);
      } catch {
        if (!response.destroyed) {
          response.writeHead(502);
          response.end();
        }
      }
    });
    await new Promise<void>((done) => discussionProxy!.listen(0, '127.0.0.1', done));
    run('reverse', 'tcp:3030', 'tcp:' + String((discussionProxy.address() as { port: number }).port));
    await algorithmScroll('算法私人笔记');
    await type('算法私人笔记', 'Native-algorithm-recovered');
    await algorithmScroll('收藏算法题');
    await algorithmScroll('标记已掌握');
    algorithmState = (await f.call(f.clients.student, algorithmBase + '/learning')).body;
    await algorithmScroll('保存算法学习记录');
    await click('确认保存学习记录');
    await algorithmScroll('核对算法保存结果');
    dropAlgorithmWrites = false;
    await algorithmScroll('已核对：算法学习记录已保存，没有重复写入。');
    const algorithmRecovered = (await f.call(f.clients.student, algorithmBase + '/learning')).body;
    assert.equal(algorithmRecovered.note, 'Native-algorithm-recovered');
    assert.equal(algorithmRecovered.revision, algorithmState.revision + 1);
    assert.equal(algorithmRecovered.favorite, true);
    assert.equal(algorithmRecovered.reviewStatus, 'mastered');
    passed(
      'native actual lost algorithm save response freezes writes and read-only reconciliation never duplicates a revision',
    );
    run('shell', 'am', 'force-stop', pkg);
    run('reverse', 'tcp:3030', 'tcp:' + new URL(f.origin).port);
    discussionProxy.closeAllConnections();
    await new Promise<void>((done) => discussionProxy!.close(() => done()));
    discussionProxy = undefined;
    run('shell', 'am', 'start', '-n', pkg + '/.MainActivity');
    await find('学习工作台');
    await algorithmScroll('算法学习');
    await algorithmScroll('仅看算法收藏');
    await algorithmScroll('已掌握');
    await algorithmScroll('共 1 道算法题，第 1 页');
    await algorithmScroll('打开第 1 道算法题');
    await algorithmScroll('算法私人笔记');
    assert.equal((await find('算法私人笔记')).text, 'Native-algorithm-recovered');
    await f.db.systemSetting.upsert({
      where: { organizationId_key: { organizationId: f.organization.id, key: 'features' } },
      create: { organizationId: f.organization.id, key: 'features', value: { practice: false } },
      update: { value: { practice: false } },
    });
    await algorithmScroll('刷新算法题目');
    await find('机构已关闭此功能');
    assert.ok(!nodes().some((n) => (n.text || '').includes('Native-algorithm-recovered')));
    await f.db.systemSetting.deleteMany({ where: { organizationId: f.organization.id, key: 'features' } });
    await algorithmScroll('刷新算法题目');
    await algorithmScroll('算法私人笔记');
    assert.equal((await find('算法私人笔记')).text, 'Native-algorithm-recovered');
    passed(
      'native algorithm learning survives process restart and current feature withdrawal hides private state without deleting it',
    );
    await click('首页');
    const notesScroll = (label: string) => scroll(label, undefined, 20);
    await notesScroll('学习笔记');
    await find('我的私人学习笔记');
    await find('共 0 条笔记');
    await click('课程');
    await scroll(f.course.title);
    await scroll(lesson.title);
    await scroll('本课时私人笔记');
    await find('私人课时笔记');
    await scroll('私人笔记内容');
    await type('私人笔记内容', 'Native-note-first');
    await click('首页');
    await find('离开私人笔记？');
    await click('继续编辑');
    assert.equal((await find('私人笔记内容')).text, 'Native-note-first');
    assert.equal(await f.db.lessonNote.count({ where: { userId: f.users.student.id } }), 0);
    passed(
      'native lesson note entry and unsaved leave confirmation preserve private text without silent writes',
    );
    await notesScroll('置顶此笔记');
    await notesScroll('保存私人笔记');
    await notesScroll('私人笔记已保存');
    let note = (await f.call(f.clients.student, '/lessons/' + lesson.id + '/note')).body.note;
    assert.equal(note.body, 'Native-note-first');
    assert.equal(note.pinned, true);
    await notesScroll('笔记内容');
    screenshot('android-notes');
    passed('native private note create and pin persist in the shared website database');
    await type('私人笔记内容', 'Native-unsaved-conflict');
    await f.call(f.clients.student, '/lessons/' + lesson.id + '/note', 'PUT', {
      body: 'Website-note-new',
      pinned: false,
      revision: note.revision,
      noteId: note.id,
    });
    await notesScroll('保存私人笔记');
    await notesScroll('笔记已在其他页面更新，请先载入最新版本；当前输入尚未覆盖');
    await notesScroll('笔记内容');
    assert.equal((await find('私人笔记内容')).text, 'Native-unsaved-conflict');
    assert.equal((await find('私人笔记内容')).enabled, 'false');
    await notesScroll('载入最新笔记');
    await find('用最新笔记替换当前输入？');
    await click('保留输入');
    await notesScroll('笔记内容');
    assert.equal((await find('私人笔记内容')).text, 'Native-unsaved-conflict');
    await notesScroll('载入最新笔记');
    await click('确认载入最新');
    await notesScroll('笔记内容');
    assert.equal((await find('私人笔记内容')).text, 'Website-note-new');
    passed(
      'native note CAS conflict keeps unsaved text and explicit latest-load confirmation controls replacement',
    );
    await type('私人笔记内容', 'Native-note-final');
    await notesScroll('保存私人笔记');
    await notesScroll('私人笔记已保存');
    note = (await f.call(f.clients.student, '/lessons/' + lesson.id + '/note')).body.note;
    assert.equal(note.body, 'Native-note-final');
    assert.equal(note.revision, 3);
    await click('首页');
    await notesScroll('学习笔记');
    await type('搜索笔记', 'Native-note-final');
    await notesScroll('搜索学习笔记');
    await find('共 1 条笔记');
    await notesScroll('仅置顶笔记');
    await find('共 0 条笔记');
    await notesScroll('全部笔记');
    await find('共 1 条笔记');
    passed('native note explicit search and pinned filters use current server content and counts');
    run('shell', 'am', 'force-stop', pkg);
    run('shell', 'am', 'start', '-n', pkg + '/.MainActivity');
    await find('你好，学生甲');
    await notesScroll('学习笔记');
    await notesScroll('编辑笔记：' + lesson.title);
    await notesScroll('笔记内容');
    assert.equal((await find('私人笔记内容')).text, 'Native-note-final');
    await notesScroll('删除私人笔记');
    await click('取消');
    assert.ok(await f.db.lessonNote.findUnique({ where: { id: note.id } }));
    await notesScroll('删除私人笔记');
    await click('确认删除笔记');
    await notesScroll('私人笔记已删除');
    assert.equal(await f.db.lessonNote.findUnique({ where: { id: note.id } }), null);
    passed('native notes survive process restart and confirmed deletion is scoped to the owned note');
    await click('首页');
    for (let i = 0; i < 11; i++) {
      const extra = await f.db.lesson.create({
        data: { courseId: f.course.id, chapterId: chapter.id, title: 'Paging-note-' + i, sortOrder: i + 10 },
      });
      await f.call(f.clients.student, '/lessons/' + extra.id + '/note', 'PUT', {
        body: 'Paging-native-' + i,
        pinned: i === 0,
        revision: 0,
      });
    }
    await notesScroll('学习笔记');
    await find('共 11 条笔记');
    await notesScroll('下一页笔记');
    await notesScroll('第 2 页笔记');
    await notesScroll('上一页笔记');
    await notesScroll('仅置顶笔记');
    await find('共 1 条笔记');
    await notesScroll('编辑笔记：Paging-note-0');
    await f.db.enrollment.update({
      where: { courseId_userId: { courseId: f.course.id, userId: f.users.student.id } },
      data: { active: false },
    });
    await notesScroll('核对服务器笔记');
    await notesScroll('当前没有此课程的访问资格');
    assert.equal(
      (
        await f.db.lessonNote.findFirstOrThrow({
          where: { userId: f.users.student.id, body: 'Paging-native-0' },
        })
      ).revision,
      1,
    );
    await f.db.enrollment.update({
      where: { courseId_userId: { courseId: f.course.id, userId: f.users.student.id } },
      data: { active: true },
    });
    await notesScroll('载入最新笔记');
    passed(
      'native note pagination and course revocation recheck server authority without deleting private records',
    );

    await click('首页');
    const practiceScroll = (label: string) => scroll(label, undefined, 24);
    const practiceTypes = ['single', 'multiple', 'boolean', 'blank', 'short', 'composite'];
    for (const typeName of practiceTypes)
      await f.call(f.clients.teacher, '/questions', 'POST', {
        courseId: f.course.id,
        type: typeName,
        stem: '<p>NativePractice-' + typeName + '</p>',
        scoreCents: 100,
        practiceEnabled: true,
        options: ['single', 'multiple'].includes(typeName)
          ? [
              { id: 'A', text: 'Alpha' },
              { id: 'B', text: 'Beta' },
            ]
          : [],
        answer:
          typeName === 'multiple'
            ? ['A', 'B']
            : typeName === 'boolean'
              ? false
              : typeName === 'blank'
                ? [['one']]
                : typeName === 'composite'
                  ? {}
                  : 'A',
        children:
          typeName === 'composite'
            ? [
                {
                  id: 'child',
                  type: 'short',
                  stem: 'Practice-child',
                  answer: 'Practice-child-reference',
                  scoreCents: 100,
                },
              ]
            : [],
        explanation: 'Practice-private-explanation',
      });
    await click('课程');
    await scroll(f.course.title);
    await practiceScroll('课程自主练习');
    await find('自主练习中心');
    await practiceScroll('练习题目数量');
    await type('练习题目数量', '6');
    await practiceScroll('开始本次练习');
    await find('自主练习与复盘');
    let practice = (await f.call(f.clients.student, '/practice?pageSize=1')).body.items[0];
    let practiceDetail = (await f.call(f.clients.student, '/practice/' + practice.id)).body;
    assert.equal(practiceDetail.items.length, 6);
    assert.equal(practiceDetail.answers.length, 0);
    assert.ok(!JSON.stringify(nodes()).includes('Practice-private-explanation'));
    passed(
      'native course practice creates one real six-type snapshot without revealing unsubmitted references',
    );
    const fillPractice = async (index: number) => {
      const item = practiceDetail.items[index],
        label = '练习第' + (index + 1) + '题';
      if (item.type === 'single') await practiceScroll(label + '：Beta');
      if (item.type === 'multiple') {
        await practiceScroll(label + '：Alpha');
        await practiceScroll(label + '：Beta');
      }
      if (item.type === 'boolean') await practiceScroll(label + '：错误');
      if (item.type === 'blank' || item.type === 'short') {
        await practiceScroll(label + '答案');
        await type(label + '答案', item.type === 'blank' ? 'one' : 'My-review');
      }
      if (item.type === 'composite') {
        await practiceScroll(label + '-子题1答案');
        await type(label + '-子题1答案', 'My-child-review');
      }
    };
    await fillPractice(0);
    await click('首页');
    await find('离开自主练习？');
    await click('继续练习');
    assert.equal((await f.call(f.clients.student, '/practice/' + practice.id)).body.answers.length, 0);
    await practiceScroll('提交本题练习');
    await click('继续检查');
    assert.equal((await f.call(f.clients.student, '/practice/' + practice.id)).body.answers.length, 0);
    await practiceScroll('提交本题练习');
    await click('确认提交练习答案');
    await practiceScroll('本题首份答案已记录');
    practiceDetail = (await f.call(f.clients.student, '/practice/' + practice.id)).body;
    assert.equal(practiceDetail.answers.length, 1);
    await practiceScroll('参考答案');
    passed(
      'native practice protects unsent work and confirmation cancellation; first submission alone reveals feedback',
    );
    await practiceScroll('标记本题稍后复习');
    await practiceScroll('练习位置与标记已保存');
    await practiceScroll('下一道练习题');
    await practiceScroll('练习第 2 / 6 题');
    let savedPractice = (await f.call(f.clients.student, '/practice/' + practice.id)).body;
    assert.equal(savedPractice.currentPosition, 1);
    assert.deepEqual(savedPractice.flags, [practiceDetail.items[0].id]);
    run('shell', 'am', 'force-stop', pkg);
    run('shell', 'am', 'start', '-n', pkg + '/.MainActivity');
    await find('你好，学生甲');
    await practiceScroll('自主练习');
    await practiceScroll('未完成练习');
    await practiceScroll('打开第 1 次练习');
    await practiceScroll('练习第 2 / 6 题');
    passed(
      'native practice position, review flag and immutable first answer survive process restart and resume from own history',
    );
    await f.call(f.clients.student, '/practice/' + practice.id + '/progress', 'PUT', {
      revision: savedPractice.revision,
      flags: [],
      currentPosition: 0,
    });
    await practiceScroll('下一道练习题');
    await practiceScroll('练习进度已在其他页面更新，请刷新后继续');
    await practiceScroll('载入服务器练习');
    await click('保留当前输入');
    await practiceScroll('载入服务器练习');
    await click('确认载入练习');
    await practiceScroll('练习第 1 / 6 题');
    passed(
      'native practice progress CAS blocks stale website overwrites and requires explicit server reload',
    );
    for (let i = 1; i < 6; i++) {
      await practiceScroll('下一道练习题');
      await practiceScroll('练习第 ' + (i + 1) + ' / 6 题');
      await fillPractice(i);
      await practiceScroll('提交本题练习');
      await click('确认提交练习答案');
      await practiceScroll('本题首份答案已记录');
    }
    practiceDetail = (await f.call(f.clients.student, '/practice/' + practice.id)).body;
    assert.equal(practiceDetail.status, 'completed');
    assert.equal(practiceDetail.report.answered, 6);
    assert.equal(practiceDetail.report.objectivelyScored, 4);
    assert.equal(practiceDetail.report.correct, 3);
    await practiceScroll('查看本次练习报告');
    await practiceScroll('本次练习报告');
    await practiceScroll('客观题答对 3 / 4');
    screenshot('android-practice');
    passed(
      'native all six practice controls complete the shared session and subjective answers stay outside objective accuracy',
    );
    await click('首页');
    await practiceScroll('自主练习');
    await practiceScroll('已完成练习');
    await practiceScroll('共 1 次练习');
    await practiceScroll('打开第 1 次练习');
    await practiceScroll('载入服务器练习');
    await f.db.systemSetting.upsert({
      where: { organizationId_key: { organizationId: f.organization.id, key: 'features' } },
      create: { organizationId: f.organization.id, key: 'features', value: { practice: false } },
      update: { value: { practice: false } },
    });
    await practiceScroll('载入服务器练习');
    await practiceScroll('机构已关闭此功能');
    await f.db.systemSetting.deleteMany({ where: { organizationId: f.organization.id, key: 'features' } });
    passed(
      'native practice history filters completed sessions and rechecks organization feature withdrawal without altering answers',
    );

    await click('首页');
    await find('离开自主练习？');
    await click('放弃并离开练习');
    await find('你好，学生甲');
    // Dedicated disposable fixture records; never reset a real user's collections.
    await f.db.mistakeRecord.deleteMany({ where: { userId: f.users.student.id } });
    await f.db.questionFavorite.deleteMany({ where: { userId: f.users.student.id } });
    for (let i = 0; i < 12; i++) {
      const q = (
        await f.call(f.clients.teacher, '/questions', 'POST', {
          courseId: f.course.id,
          type: 'single',
          stem: 'NativeCollection-' + i,
          scoreCents: 100,
          practiceEnabled: true,
          options: [
            { id: 'A', text: 'Alpha' },
            { id: 'B', text: 'Beta' },
          ],
          answer: 'A',
          explanation: 'Collection-private-reference',
        })
      ).body;
      await f.db.mistakeRecord.create({
        data: { userId: f.users.student.id, courseId: f.course.id, questionId: q.id },
      });
    }
    await practiceScroll('错题与收藏');
    await find('错题本与收藏管理');
    await practiceScroll('共 12 条记录，第 1 页');
    assert.ok(!JSON.stringify(nodes()).includes('Collection-private-reference'));
    await practiceScroll('标为已掌握');
    await click('取消');
    assert.equal(
      await f.db.mistakeRecord.count({ where: { userId: f.users.student.id, mastered: true } }),
      0,
    );
    await practiceScroll('标为已掌握');
    await click('确认标为已掌握');
    await practiceScroll('已掌握');
    await practiceScroll('共 1 条记录，第 1 页');
    passed('native collections keep references hidden and confirm mastery before sharing the website record');
    const masteredRow = await f.db.mistakeRecord.findFirstOrThrow({
      where: { userId: f.users.student.id, mastered: true },
    });
    await f.db.mistakeRecord.update({
      where: { id: masteredRow.id },
      data: { mastered: false, wrongCount: { increment: 1 }, lastAnsweredAt: new Date() },
    });
    await practiceScroll('重新标为未掌握');
    await click('确认重新标为未掌握');
    await practiceScroll('共 0 条记录，第 1 页');
    assert.equal(
      (await f.db.mistakeRecord.findUniqueOrThrow({ where: { id: masteredRow.id } })).wrongCount,
      2,
    );
    passed('native stale mastery write refreshes after conflict without overwriting newer answer history');
    await practiceScroll('未掌握');
    await practiceScroll('共 12 条记录，第 1 页');
    await practiceScroll('收藏题目');
    await click('确认收藏题目');
    await practiceScroll('我的收藏');
    await practiceScroll('共 1 条记录，第 1 页');
    const favoriteRow = await f.db.questionFavorite.findFirstOrThrow({
      where: { userId: f.users.student.id },
    });
    await f.db.question.update({ where: { id: favoriteRow.questionId }, data: { practiceEnabled: false } });
    await practiceScroll('刷新错题与收藏');
    await practiceScroll('该题已停止开放练习，正文与参考内容不可见。');
    await practiceScroll('取消收藏');
    await click('确认取消收藏');
    await practiceScroll('共 0 条记录，第 1 页');
    passed(
      'native favorites sync personal records and permit removal of a withdrawn question without exposing its stem',
    );
    await practiceScroll('我的错题');
    await practiceScroll('下一页记录');
    await practiceScroll('共 12 条记录，第 2 页');
    screenshot('android-collections');
    await click('首页');
    await find('你好，学生甲');
    passed('native collections paginate personal records and return to the native home');
    const seqIds: string[] = [];
    for (let i = 0; i < 2; i++) {
      const q = (
        await f.call(f.clients.teacher, '/questions', 'POST', {
          courseId: f.course.id,
          type: 'single',
          stem: 'Sequential-native-' + i,
          scoreCents: 100,
          options: [
            { id: 'A', text: 'Alpha' },
            { id: 'B', text: 'Beta' },
          ],
          answer: 'A',
        })
      ).body;
      seqIds.push(q.versions[0].id);
    }
    const seq = (
      await f.call(f.clients.teacher, '/exams', 'POST', {
        courseId: f.course.id,
        title: 'Android-sequential-exam',
        startsAt: new Date(Date.now() - 60000).toISOString(),
        endsAt: new Date(Date.now() + 3600000).toISOString(),
        entryClosesAt: new Date(Date.now() + 1800000).toISOString(),
        durationMinutes: 20,
        passCents: 100,
        allowBacktrack: false,
        questionVersionIds: seqIds,
        audienceIds: [f.users.student.id],
      })
    ).body;
    await f.call(f.clients.teacher, '/exams/' + seq.id + '/publish', 'POST');
    await scroll('我的考试');
    await scroll('打开考试：' + seq.title);
    await scroll('开始考试');
    await click('开始作答');
    await scroll('考试第1题：Alpha');
    await scroll('下一题');
    await click('进入下一题');
    await scroll('考试第2题：Beta');
    assert.equal((await find('上一题')).enabled, 'false');
    const seqAttempt = await f.db.examAttempt.findFirstOrThrow({
      where: { examId: seq.id, userId: f.users.student.id },
    });
    assert.equal(seqAttempt.currentPosition, 1);
    passed('native sequential exams confirm irreversible navigation and disable backtracking');
    await scroll('保存考试答案');
    await poll(
      () => f.db.examAnswer.count({ where: { attemptId: seqAttempt.id } }),
      (n) => n === 2,
      'Sequential exam save missing',
    );
    run('shell', 'input', 'keyevent', '3');
    await liveWait(700);
    await f.db.examAttempt.update({
      where: { id: seqAttempt.id },
      data: { deadlineAt: new Date(Date.now() - 1000) },
    });
    run('shell', 'am', 'start', '-n', pkg + '/.MainActivity');
    await scroll('服务器已到时交卷');
    assert.equal(
      (await f.db.examAttempt.findUniqueOrThrow({ where: { id: seqAttempt.id } })).status,
      'timed_out',
    );
    passed('native exam returning from background observes server deadline and immutable timeout receipt');
    await click('首页');

    await f.call(f.clients.teacher, `/live/classes/${live.id}/start`, 'POST', { revision: live.revision });

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
    await type('课堂发言', 'Android-device-test');
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
    await scroll('已连接');
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
      hierarchyProbeSha256: hierarchyHash,
      hierarchy:
        'Actual Android accessibility hierarchy without waiting for animations; no UI state or server response mocked',
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
    if (discussionProxy) {
      discussionProxy.closeAllConnections();
      await new Promise<void>((done) => discussionProxy!.close(() => done()));
    }
    await browser?.close().catch(() => undefined);
    try {
      run('shell', 'am', 'force-stop', pkg);
    } catch {}
    for (const key of reverse)
      try {
        run('reverse', '--remove', key);
      } catch {}
    try {
      run('shell', 'rm', '-f', deviceJar, deviceXml);
    } catch {}
    await f.cleanup();
  }
}
void main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
