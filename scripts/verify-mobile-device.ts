/** Dedicated destructive-to-preview-app-only Android acceptance. Requires an explicitly selected emulator. */
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync, existsSync, readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { resolve } from 'node:path';
import { chromium, expect } from '@playwright/test';
import { prepareMobileHierarchy } from './mobile-hierarchy';
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
  return s
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>');
}
function nodes() {
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
