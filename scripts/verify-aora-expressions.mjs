/** Verify only the checked-in Aora creative recipe inside the real preview sandbox. */
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import http from 'node:http';
import { chromium } from '@playwright/test';
import { creativeItems } from '../apps/api/src/programming/creative.catalog.ts';
import {
  previewContentType,
  programmingPreviewHeaders,
} from '../apps/api/src/programming/programming-preview.service.ts';

const item = creativeItems.find((item) => item.id === 'aora-expression-lab');
assert.ok(item);
let previewOrigin = '',
  appOrigin = '';
const previewServer = http.createServer((request, response) => {
  const path = new URL(request.url, previewOrigin).pathname.slice(1);
  const file = item.files.find((file) => file.path === path);
  if (request.method !== 'GET' || !file) return response.writeHead(404).end();
  response
    .writeHead(200, {
      ...programmingPreviewHeaders({ origin: previewOrigin, appOrigin }),
      'Content-Type': previewContentType(path),
    })
    .end(file.content);
});
const parentServer = http.createServer((_request, response) => {
  response
    .writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' })
    .end(
      `<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><style>html,body{margin:0;height:100%}iframe{display:block;width:100%;height:100%;border:0}</style><iframe title="表情实验室" sandbox="allow-scripts" src="${previewOrigin}/index.html"></iframe>`,
    );
});
async function listen(server) {
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  return server.address().port;
}
let browser;
const errors = [],
  externalRequests = [];
const results = [];
async function snapshot(frame) {
  return frame.locator('#ball-host').innerHTML();
}
async function frozen(frame) {
  const before = await snapshot(frame);
  await new Promise((resolve) => setTimeout(resolve, 150));
  assert.ok((await snapshot(frame)) === before, 'paused SVG must stay unchanged');
}
try {
  previewOrigin = `http://127.0.0.1:${await listen(previewServer)}`;
  appOrigin = `http://127.0.0.1:${await listen(parentServer)}`;
  browser = await chromium.launch({ channel: process.platform === 'darwin' ? 'chrome' : undefined });
  const page = await browser.newPage({ viewport: { width: 1280, height: 1000 }, reducedMotion: 'reduce' });
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('request', (request) => {
    if (![previewOrigin, appOrigin].some((origin) => request.url().startsWith(`${origin}/`)))
      externalRequests.push(request.url());
  });
  await page.goto(appOrigin);
  const frame = page.frames().find((frame) => frame.url().startsWith(previewOrigin));
  assert.ok(frame);
  await frame.locator('#emotion-list [data-emotion-id]').last().waitFor();
  assert.equal(await frame.locator('#emotion-list [data-emotion-id]').count(), 32);
  const ids = await frame
    .locator('#emotion-list [data-emotion-id]')
    .evaluateAll((nodes) => nodes.map((node) => node.dataset.emotionId));
  for (const id of ids) {
    await frame.locator(`#emotion-list [data-emotion-id="${id}"]`).click();
    assert.ok((await frame.locator('#current-id').innerText()).includes(id), id);
    assert.equal(await frame.locator('#ball-host svg').count(), 1);
    assert.ok((await frame.locator('#ball-host svg path[d]').count()) >= 3, 'body and both eye outlines');
    assert.equal(JSON.parse(await frame.locator('#message-json').inputValue()).emotionId, id);
  }
  results.push('all 32 real SVG expressions and their local emotionId messages');
  for (const [group, count] of [
    ['life', 8],
    ['emotion', 12],
    ['agent', 12],
  ]) {
    await frame.locator(`#group-tabs [data-group="${group}"]`).click();
    assert.equal(await frame.locator('#emotion-list [data-emotion-id]:visible').count(), count, group);
  }
  await frame.locator('#group-tabs [data-group="all"]').click();
  await frame.locator('#emotion-search').fill('没有这种表情');
  assert.equal(await frame.locator('#emotion-list [data-emotion-id]:visible').count(), 0);
  assert.ok(await frame.locator('#no-results').isVisible());
  await frame.locator('#emotion-search').fill('');
  results.push('group filters, search and empty state');
  for (const shape of ['wedge', 'gem', 'blob']) {
    await frame.locator('#shape-select').selectOption(shape);
    assert.equal(await frame.locator('#ball-host svg').count(), 1);
  }
  const beforeSketch = await snapshot(frame);
  await frame.locator('#sketch-toggle').click();
  assert.notEqual(await snapshot(frame), beforeSketch);
  await frame.locator('#sketch-toggle').click();
  await frozen(frame);
  assert.ok(await frame.locator('#tour-toggle').isDisabled());
  results.push('three body shapes, sketch rendering and reduced motion');
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await frame.locator('#emotion-list [data-emotion-id="02"]').click();
  await frame.locator('#play-toggle').click();
  const moving = await snapshot(frame);
  await frame.waitForFunction(
    (previous) => document.querySelector('#ball-host').innerHTML !== previous,
    moving,
  );
  await frame.locator('#emotion-list [data-emotion-id="01"]').click();
  await frame.waitForFunction(() => document.querySelector('#current-id').textContent === '02');
  assert.equal(JSON.parse(await frame.locator('#message-json').inputValue()).emotionId, '02');
  assert.equal(
    await frame.locator('#emotion-list [data-emotion-id="02"]').getAttribute('aria-pressed'),
    'true',
  );
  results.push('sequence completion synchronizes automatic fallback, selection and message JSON');
  await frame.locator('#play-toggle').click();
  await frozen(frame);
  await frame.locator('#tour-toggle').click();
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await frame.waitForFunction(
    () =>
      document.querySelector('#tour-toggle').disabled &&
      document.querySelector('#expression-stage').dataset.playing === 'false',
  );
  await frozen(frame);
  assert.ok(await frame.locator('#tour-toggle').isDisabled());
  results.push('play, pause and media preference changes stop animation and tours');
  for (const id of ['31', '30', '39', '33', '34', '41']) {
    await frame.locator(`#agent-demo [data-agent-id="${id}"]`).click();
    assert.equal(JSON.parse(await frame.locator('#message-json').inputValue()).emotionId, id);
  }
  await frame.locator('#copy-json').click();
  assert.ok((await frame.locator('#interaction-status').innerText()).length);
  results.push('local agent state examples and sandbox-compatible JSON selection');
  await page.setViewportSize({ width: 390, height: 844 });
  assert.ok(await frame.evaluate(() => document.documentElement.scrollWidth <= innerWidth), '390px overflow');
  await frame.evaluate(() => window.scrollTo(0, 0));
  await fs.mkdir('.data/aora-verification', { recursive: true });
  await page.screenshot({
    path: '.data/aora-verification/mobile.png',
    fullPage: true,
    animations: 'disabled',
  });
  results.push('390px responsive layout');
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await frame.waitForFunction(() => !document.querySelector('#play-toggle').disabled);
  assert.equal(await frame.locator('#expression-stage').getAttribute('data-touring'), 'false');
  await frame.locator('#group-tabs [data-group="agent"]').click();
  await frame.locator('#play-toggle').click();
  await frame.locator('#tour-toggle').click();
  const firstTourId = await frame.locator('#current-id').innerText();
  await frame.waitForFunction(
    (first) => document.querySelector('#current-id').textContent !== first,
    firstTourId,
  );
  const currentTourId = await frame.locator('#current-id').innerText();
  await frame.locator('#shape-select').selectOption('wedge');
  assert.equal(await frame.locator('#current-id').innerText(), currentTourId);
  assert.equal(await frame.locator('#expression-stage').getAttribute('data-touring'), 'true');
  results.push('changing body shape during a tour preserves its current expression');
  await frame.evaluate(() => {
    Object.defineProperty(document, 'hidden', { configurable: true, get: () => true });
    document.dispatchEvent(new Event('visibilitychange'));
  });
  await frozen(frame);
  assert.equal(await frame.locator('#expression-stage').getAttribute('data-touring'), 'false');
  await frame.evaluate(() => {
    Object.defineProperty(document, 'hidden', { configurable: true, get: () => false });
    document.dispatchEvent(new Event('visibilitychange'));
  });
  assert.equal(await frame.locator('#expression-stage').getAttribute('data-playing'), 'false');
  await frozen(frame);
  await frame.locator('#play-toggle').click();
  await frame.evaluate(() => window.dispatchEvent(new PageTransitionEvent('pagehide', { persisted: true })));
  assert.equal(await frame.locator('#ball-host svg').count(), 1);
  await frozen(frame);
  await frame.locator('#next-emotion').click();
  assert.notEqual(await frame.locator('#current-id').innerText(), currentTourId);
  await frame.locator('#play-toggle').click();
  const resumed = await snapshot(frame);
  await frame.waitForFunction(
    (previous) => document.querySelector('#ball-host').innerHTML !== previous,
    resumed,
  );
  results.push('BFCache pagehide retains the stage, controls and manual playback');
  await frame.evaluate(() => window.dispatchEvent(new Event('pagehide')));
  assert.equal(await frame.locator('#ball-host svg').count(), 0);
  results.push('hidden document pause and pagehide disposal');
  assert.deepEqual(errors, []);
  assert.deepEqual(externalRequests, []);
  await fs.writeFile(
    '.data/aora-verification/browser.json',
    JSON.stringify(
      { date: new Date().toISOString(), results, errors, externalRequests, sourceCommit: item.source.commit },
      null,
      2,
    ) + '\n',
  );
  console.log(
    `Aora sandbox browser: ${results.length} checks passed; all 32 expressions; no external requests or page errors.`,
  );
  console.log(
    JSON.stringify({
      checksPassed: results.length,
      expressionsPassed: ids.length,
      externalRequests: externalRequests.length,
      pageErrors: errors.length,
    }),
  );
} finally {
  if (browser) await browser.close();
  await Promise.all(
    [previewServer, parentServer].map((server) => new Promise((resolve) => server.close(resolve))),
  );
}
