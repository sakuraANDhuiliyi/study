import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { chromium, firefox, webkit, expect, type Page } from '@playwright/test';
import { createLiveFixture } from './live.fixture';
import { installMedia, attachLogin, inbound } from './live-browser.fixture';

test('直播课堂浏览器：Chromium、Firefox、WebKit真实双向媒体及课堂管理', { timeout: 480_000 }, async (t) => {
  const f = await createLiveFixture();
  try {
    await mkdir('.data/live-verification', { recursive: true });
    for (const [name, engine] of Object.entries({ chromium, firefox, webkit })) {
      await t.test(`${name}：音视频、共享、审批、消息、手机布局及结束`, { timeout: 140_000 }, async () => {
        const browser = await engine.launch({
          headless: true,
          ...(name === 'firefox'
            ? {
                firefoxUserPrefs: {
                  // A receive-only loopback page has no native capture permission. Firefox
                  // otherwise restricts ICE to the default (possibly VPN) interface.
                  'permissions.default.camera': 1,
                  'permissions.default.microphone': 1,
                  'media.peerconnection.ice.default_address_only': false,
                  'media.peerconnection.ice.no_host': false,
                  'media.peerconnection.ice.force_interface': process.platform === 'darwin' ? 'lo0' : 'lo',
                  'media.peerconnection.ice.loopback': true,
                  'media.peerconnection.ice.obfuscate_host_addresses': false,
                  'media.autoplay.default': 0,
                  'media.autoplay.block-webaudio': false,
                },
              }
            : {}),
          ...(name === 'chromium'
            ? {
                ...(process.platform === 'darwin' ? { channel: 'chrome' } : {}),
                args: ['--autoplay-policy=no-user-gesture-required'],
              }
            : {}),
        });
        const teacherContext = await browser.newContext({
          viewport: { width: 1440, height: 1000 },
          reducedMotion: 'reduce',
        });
        const studentContext = await browser.newContext({
          viewport: { width: 1440, height: 1000 },
          reducedMotion: 'reduce',
        });
        const errors: string[] = [];
        let teacherPage: Page | undefined;
        let studentPage: Page | undefined;
        let liveId = '';
        try {
          await installMedia(teacherContext);
          await installMedia(studentContext);
          await attachLogin(teacherContext, f.clients.teacher, f.origin);
          await attachLogin(studentContext, f.clients.student, f.origin);
          teacherPage = await teacherContext.newPage();
          studentPage = await studentContext.newPage();
          for (const page of [teacherPage, studentPage]) page.on('pageerror', (e) => errors.push(e.name));
          await teacherPage.goto(`${f.origin}/live?courseId=${f.course.id}`);
          await teacherPage.getByRole('button', { name: '预约直播', exact: true }).click();
          const dialog = teacherPage.getByRole('dialog');
          await dialog.getByLabel('直播主题', { exact: true }).fill(`${name} 互动课堂`);
          await dialog
            .getByLabel('预约时间（北京时间）', { exact: true })
            .fill(new Date(Date.now() + 8 * 3600_000).toISOString().slice(0, 16));
          await dialog.getByLabel('课堂人数上限（含教师）', { exact: true }).fill('10');
          await dialog.getByRole('button', { name: '保存预约', exact: true }).click();
          await teacherPage.waitForURL(/\/live\/[^/?]+$/);
          liveId = new URL(teacherPage.url()).pathname.split('/').at(-1)!;
          await expect(teacherPage.getByRole('heading', { name: `${name} 互动课堂` })).toBeVisible();
          await teacherPage.getByRole('button', { name: '开始直播', exact: true }).click();
          await expect(teacherPage.getByRole('button', { name: '进入课堂', exact: true })).toBeEnabled();
          await teacherPage.getByRole('button', { name: '进入课堂', exact: true }).click();
          await expect(teacherPage.locator('.live-stage-status').getByRole('status')).toHaveText('已连接', {
            timeout: 20000,
          });
          await studentPage.goto(`${f.origin}/live/${liveId}`);
          await studentPage.getByRole('button', { name: '进入课堂', exact: true }).click();
          await expect(studentPage.locator('.live-stage-status').getByRole('status')).toHaveText('已连接', {
            timeout: 20000,
          });
          await expect(studentPage.getByRole('button', { name: '开启麦克风', exact: true })).toBeDisabled();
          await expect(studentPage.getByRole('button', { name: '开启摄像头', exact: true })).toBeDisabled();

          await teacherPage.evaluate(`window.__allowedUserMedia = navigator.mediaDevices.getUserMedia;
            Object.defineProperty(Object.getPrototypeOf(navigator.mediaDevices), 'getUserMedia', {
              configurable: true, value: async function () { throw new DOMException('Denied by test', 'NotAllowedError'); }
            });`);
          await teacherPage.getByRole('button', { name: '开启摄像头', exact: true }).click();
          await expect(
            teacherPage.getByText('无法开启设备或共享，请检查浏览器授权、设备占用及系统权限。', {
              exact: true,
            }),
          ).toBeVisible();
          await expect(teacherPage.locator('.live-stage-status').getByRole('status')).toHaveText('已连接');
          await teacherPage.evaluate(`Object.defineProperty(Object.getPrototypeOf(navigator.mediaDevices),
            'getUserMedia', { configurable: true, value: window.__allowedUserMedia });`);
          await teacherPage.getByRole('button', { name: '开启摄像头', exact: true }).click();
          await teacherPage.getByRole('button', { name: '开启麦克风', exact: true }).click();
          await expect.poll(() => inbound(studentPage!, 'video'), { timeout: 20000 }).toBeGreaterThan(0);
          await expect.poll(() => inbound(studentPage!, 'audio'), { timeout: 20000 }).toBeGreaterThan(0);
          await expect
            .poll(
              () =>
                studentPage!.getByLabel('教师甲的摄像头').evaluate((el: HTMLVideoElement) => el.videoWidth),
              { timeout: 15000 },
            )
            .toBeGreaterThan(0);

          await studentPage.getByRole('button', { name: '举手申请连麦', exact: true }).click();
          const memberRow = teacherPage.locator('.live-member').filter({ hasText: '学生甲' });
          await expect(memberRow.getByText('举手中', { exact: true })).toBeVisible({ timeout: 10000 });
          await memberRow.getByRole('button', { name: '允许连麦', exact: true }).click();
          await expect(studentPage.getByRole('button', { name: '开启麦克风', exact: true })).toBeEnabled({
            timeout: 10000,
          });
          await studentPage.getByRole('button', { name: '开启麦克风', exact: true }).click();
          await studentPage.getByRole('button', { name: '开启摄像头', exact: true }).click();
          await expect.poll(() => inbound(teacherPage!, 'audio'), { timeout: 20000 }).toBeGreaterThan(0);
          await expect.poll(() => inbound(teacherPage!, 'video'), { timeout: 20000 }).toBeGreaterThan(0);

          await teacherPage.getByRole('button', { name: '共享屏幕', exact: true }).click();
          await expect
            .poll(
              () =>
                studentPage!.getByLabel('教师甲的共享屏幕').evaluate((el: HTMLVideoElement) => el.videoWidth),
              { timeout: 15000 },
            )
            .toBeGreaterThan(0);
          await studentPage
            .getByLabel('课堂发言', { exact: true })
            .fill('<img src=x onerror=alert(1)> 课堂提问');
          await studentPage.getByRole('button', { name: '发送消息', exact: true }).click();
          await expect(
            teacherPage.getByRole('log').getByText('<img src=x onerror=alert(1)> 课堂提问', { exact: true }),
          ).toBeVisible({ timeout: 10000 });
          assert.equal(await teacherPage.locator('.live-chat img').count(), 0);
          await teacherPage.screenshot({
            path: `.data/live-verification/${name}-desktop.png`,
            fullPage: true,
          });
          await studentPage.setViewportSize({ width: 390, height: 844 });
          assert.ok(
            await studentPage.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1),
            'Mobile classroom has horizontal overflow',
          );
          await studentPage.screenshot({
            path: `.data/live-verification/${name}-mobile.png`,
            fullPage: true,
          });

          await memberRow.getByRole('button', { name: '收回连麦', exact: true }).click();
          await expect(studentPage.getByRole('button', { name: '开启麦克风', exact: true })).toBeDisabled({
            timeout: 10000,
          });
          await expect(studentPage.getByRole('button', { name: '开启摄像头', exact: true })).toBeDisabled();
          const mediaRoom = await f.db.liveClass.findUniqueOrThrow({ where: { id: liveId } });
          await expect
            .poll(
              async () => {
                const members = await f.mediaClient.listParticipants(mediaRoom.roomName);
                return members.find((m) => m.name === '学生甲')?.tracks.length;
              },
              { timeout: 10000 },
            )
            .toBe(0);
          await memberRow.getByRole('button', { name: '禁言', exact: true }).click();
          await expect(studentPage.getByLabel('课堂发言', { exact: true })).toBeDisabled({ timeout: 10000 });
          await memberRow.getByRole('button', { name: '解除禁言', exact: true }).click();
          await expect(studentPage.getByLabel('课堂发言', { exact: true })).toBeEnabled({ timeout: 10000 });
          await teacherPage.getByRole('button', { name: '结束课堂', exact: true }).click();
          await teacherPage.getByRole('button', { name: '确认结束', exact: true }).click();
          await expect(studentPage.getByRole('heading', { name: '本场课堂已结束', exact: true })).toBeVisible(
            { timeout: 10000 },
          );
          await expect(studentPage.getByRole('button', { name: '进入课堂', exact: true })).toBeDisabled();
          assert.deepEqual(errors, [], 'Browser page errors occurred');
        } finally {
          await browser.close();
          if (liveId) {
            const row = await f.db.liveClass.findUnique({ where: { id: liveId } });
            if (row && row.status !== 'ENDED')
              await f.call(f.clients.teacher, `/live/classes/${liveId}/end`, 'POST', {
                revision: row.revision,
              });
          }
        }
      });
    }
  } finally {
    await f.cleanup();
  }
});
