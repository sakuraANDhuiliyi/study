/**
 * Render covers for the checked-in creative catalog only.
 * Run: node --import tsx scripts/creative-covers.mjs
 * Requires the dev Playwright dependency and Chrome (macOS) / Chromium (Linux).
 * This renderer never imports, executes or accepts user project code in Node.
 * It serves only the fixed catalog files to an opaque browser sandbox.
 */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';
import { creativeItems } from '../apps/api/src/programming/creative.catalog.ts';
import {
  previewContentType,
  programmingPreviewHeaders,
} from '../apps/api/src/programming/programming-preview.service.ts';
import { programmingFilesSchema } from '../apps/api/src/programming/programming.schemas.ts';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const outputDirectory = path.join(repo, 'apps/web/public/creative');
const evidenceDirectory = path.join(repo, '.data');
const items = new Map(creativeItems.map((item) => [item.id, item]));
const args = process.argv.slice(2);
assert.ok(
  args.every((argument) => argument === '--new-only'),
  'Only --new-only can select a fixed edition',
);
const selectedItems = args.includes('--new-only')
  ? creativeItems.filter((item) => item.edition === 2)
  : creativeItems;
let advancedProbes = [];
try {
  const { advancedCreativeProbes } = await import('./creative-probes.mjs');
  advancedProbes = advancedCreativeProbes;
} catch (error) {
  if (selectedItems.some((item) => item.edition === 2)) throw error;
}
for (const item of items.values()) {
  assert.match(item.id, /^[a-z0-9][a-z0-9-]{0,63}$/);
  programmingFilesSchema.parse(item.files);
}
await fs.mkdir(outputDirectory, { recursive: true });
await fs.mkdir(evidenceDirectory, { recursive: true });
let previewOrigin = '';
let appOrigin = '';

function notFound(response) {
  response.writeHead(404, { 'Content-Type': 'text/plain', 'Cache-Control': 'no-store' });
  response.end('Not found');
}

const previewServer = http.createServer(async (request, response) => {
  if (request.method !== 'GET') {
    response.writeHead(405);
    response.end();
    return;
  }
  const url = new URL(request.url, previewOrigin);
  const segments = url.pathname.split('/');
  const item = items.get(segments[2]);
  if (!item) return notFound(response);
  if (segments[1] === 'covers' && segments.length === 4 && segments[3] === 'cover.png') {
    try {
      const png = await fs.readFile(path.join(outputDirectory, `${item.id}.png`));
      response.writeHead(200, {
        'Content-Type': 'image/png',
        'X-Content-Type-Options': 'nosniff',
        'Cache-Control': 'no-store',
      });
      response.end(png);
    } catch {
      notFound(response);
    }
    return;
  }
  if (segments[1] !== 'item') return notFound(response);
  const file = item.files.find((candidate) => candidate.path === segments.slice(3).join('/'));
  if (!file) return notFound(response);
  response.writeHead(200, {
    ...programmingPreviewHeaders({ origin: previewOrigin, appOrigin }),
    'Content-Type': previewContentType(file.path),
  });
  response.end(file.content);
});

const parentServer = http.createServer((request, response) => {
  if (request.method !== 'GET') {
    response.writeHead(405);
    response.end();
    return;
  }
  const id = new URL(request.url, appOrigin).pathname.slice(1);
  if (id === '__contact-sheet') {
    const cards = creativeItems
      .map(
        (item) =>
          `<article><img src="${previewOrigin}/covers/${item.id}/cover.png" alt="${item.title}"><p>${item.title} · ${item.id}</p></article>`,
      )
      .join('');
    response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    response.end(
      `<!doctype html><html lang="zh-CN"><meta charset="utf-8"><style>*{box-sizing:border-box}body{margin:0;padding:18px;background:#edf1f6;font:13px system-ui;color:#35445e}.grid{display:grid;grid-template-columns:repeat(4,1fr);gap:16px}article{margin:0;background:white;border:1px solid #dce2eb;border-radius:10px;overflow:hidden}img{display:block;width:100%;height:200px;object-fit:contain;background:#fff}p{padding:0 10px;line-height:1.5}</style><div class="grid">${cards}</div></html>`,
    );
    return;
  }
  const item = items.get(id);
  if (!item) return notFound(response);
  response.writeHead(200, {
    'Content-Type': 'text/html; charset=utf-8',
    'Content-Security-Policy': `default-src 'none'; style-src 'unsafe-inline'; frame-src ${previewOrigin}`,
    'Cache-Control': 'no-store',
  });
  response.end(
    `<!doctype html><html><body style="margin:0"><iframe title="静态目录封面" src="${previewOrigin}/item/${item.id}/index.html" sandbox="allow-scripts" style="width:100vw;height:100vh;border:0"></iframe></body></html>`,
  );
});

async function listen(server) {
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  return server.address().port;
}

async function setRange(frame, id, value) {
  await frame.locator(`#${id}`).evaluate((element, nextValue) => {
    element.value = String(nextValue);
    element.dispatchEvent(new Event('input', { bubbles: true }));
  }, value);
}

async function captureAction(frame, page, action) {
  const matched = frame.locator(action.selector);
  const target = action.first ? matched.first() : matched;
  if (action.type === 'click') await target.click();
  else if (action.type === 'select') await target.selectOption(String(action.value));
  else if (action.type === 'fill') await target.fill(String(action.value));
  else if (action.type === 'range' || action.type === 'changeRange')
    await target.evaluate(
      (element, { value, change }) => {
        element.value = String(value);
        element.dispatchEvent(new Event('input', { bubbles: true }));
        if (change) element.dispatchEvent(new Event('change', { bubbles: true }));
      },
      { value: action.value, change: action.type === 'changeRange' },
    );
  else if (action.type === 'press') await target.press(action.value);
  else if (action.type === 'drag') {
    const bounds = await target.boundingBox();
    assert.ok(bounds);
    const from = action.from || [0.5, 0.5],
      to = action.to || [0.75, 0.6];
    await page.mouse.move(bounds.x + bounds.width * from[0], bounds.y + bounds.height * from[1]);
    await page.mouse.down();
    await page.mouse.move(bounds.x + bounds.width * to[0], bounds.y + bounds.height * to[1], { steps: 8 });
    await page.mouse.up();
  } else throw new Error(`Unknown trusted capture action: ${action.type}`);
}

async function stopAnimation(frame) {
  await frame.evaluate(() => {
    // All catalog code is trusted browser-only code. This freezes its existing
    // requestAnimationFrame after real rendering; it does not rewrite pixels.
    if (typeof raf !== 'undefined') cancelAnimationFrame(raf);
  });
}

let browser;
const manifest = [];
const externalRequests = [];
const pageErrors = [];
try {
  previewOrigin = `http://127.0.0.1:${await listen(previewServer)}`;
  appOrigin = `http://localhost:${await listen(parentServer)}`;
  browser = await chromium.launch({
    channel: process.platform === 'darwin' ? 'chrome' : undefined,
    headless: true,
  });
  const context = await browser.newContext({
    viewport: { width: 688, height: 1000 },
    deviceScaleFactor: 1,
    reducedMotion: 'reduce',
  });
  const page = await context.newPage();
  page.on('pageerror', (error) => pageErrors.push(error.message));
  page.on('request', (request) => {
    if (!request.url().startsWith(previewOrigin) && !request.url().startsWith(appOrigin)) {
      externalRequests.push(request.url());
    }
  });
  for (const item of selectedItems) {
    const definition = advancedProbes.find((entry) => entry.id === item.id);
    if (definition?.coverViewport) await page.setViewportSize(definition.coverViewport);
    const animationStudy = ['confetti-launch', 'gravity-bowl'].includes(item.id);
    // These two effects are disabled altogether in reduced-motion mode. Briefly
    // render their actual animation in a headless context, pause it, then enable
    // reduced motion for capture. Other covers use reduced motion throughout.
    await page.emulateMedia({ reducedMotion: animationStudy ? 'no-preference' : 'reduce' });
    await page.goto(`${appOrigin}/${item.id}`);
    const frame = page.frames().find((candidate) => candidate.url().startsWith(previewOrigin));
    assert.ok(frame, item.id);
    await frame.locator('h1').first().waitFor();
    assert.equal(await frame.title(), item.title);
    if (item.edition === 2 && !definition?.coverViewport) {
      // Tool layouts reserve different amounts of space for inspector panels.
      // Fit the live stage by changing only the browser viewport, preserving
      // the recipe's actual rendering and responsive layout.
      for (let attempt = 0; attempt < 5; attempt++) {
        const bounds = await frame.locator('.stage').boundingBox();
        assert.ok(bounds);
        if (Math.abs(bounds.width - 640) <= 1) break;
        const viewport = page.viewportSize();
        const nextWidth = Math.round(viewport.width + 640 - bounds.width);
        assert.ok(nextWidth >= 600 && nextWidth <= 2200, `${item.id}: layout does not fit cover`);
        await page.setViewportSize({ width: nextWidth, height: 1000 });
      }
    }
    // A presentation-only cover height gives approximately 640 × 400 PNG files;
    // the catalog files remain unchanged and all graphics render in their DOM.
    await frame.locator('.stage').evaluate((element) => {
      element.style.minHeight = '400px';
    });
    if (item.edition === 2) {
      assert.ok(definition, `Missing capture steps for ${item.id}`);
      for (const action of definition.capture || []) await captureAction(frame, page, action);
    }
    switch (item.id) {
      case 'foil-tilt': {
        const area = await frame.locator('#area').boundingBox();
        await page.mouse.move(area.x + area.width * 0.69, area.y + area.height * 0.58);
        break;
      }
      case 'shape-morph':
        await setRange(frame, 'progress', 83);
        break;
      case 'drag-playlist':
        await frame.locator('#shuffle').click();
        break;
      case 'particle-network':
        await frame.locator('#reseed').click();
        break;
      case 'confetti-launch':
        await frame.locator('#launch').click();
        await page.waitForTimeout(180);
        await stopAnimation(frame);
        break;
      case 'rough-blueprint':
        await frame.locator('#redraw').click();
        break;
      case 'signature-studio': {
        const canvas = await frame.locator('#canvas').boundingBox();
        const stroke = [
          [0.2, 0.67],
          [0.24, 0.45],
          [0.28, 0.69],
          [0.3, 0.62],
          [0.34, 0.57],
          [0.38, 0.68],
          [0.41, 0.5],
          [0.44, 0.69],
          [0.51, 0.58],
          [0.55, 0.68],
          [0.62, 0.55],
          [0.67, 0.7],
          [0.73, 0.58],
        ];
        await page.mouse.move(
          canvas.x + canvas.width * stroke[0][0],
          canvas.y + canvas.height * stroke[0][1],
        );
        await page.mouse.down();
        for (const [x, y] of stroke.slice(1)) {
          await page.mouse.move(canvas.x + canvas.width * x, canvas.y + canvas.height * y, { steps: 4 });
        }
        await page.mouse.up();
        break;
      }
      case 'line-reveal':
        await frame.locator('#play').click();
        break;
      case 'rolling-meter':
        await frame.locator('#value').fill('02846');
        await frame.locator('#update').click();
        break;
      case 'typing-terminal':
        await frame.locator('#sentence').fill('把好奇心写成代码，把代码变成作品。');
        await frame.locator('#replay').click();
        break;
      case 'range-window':
        await setRange(frame, 'start', 7);
        break;
      case 'bezier-timing':
        await frame.locator('#play').click();
        break;
      case 'color-atlas':
        await setRange(frame, 'hue', 210);
        break;
      case 'poster-transform':
        await frame.locator('#center').click();
        break;
      case 'snap-gallery':
        await frame.locator('#next').click();
        await frame.locator('#index').getByText('2 / 3', { exact: true }).waitFor();
        break;
      case 'donut-observatory':
        await frame.locator('#random').click();
        break;
      case 'gravity-bowl':
        for (let index = 0; index < 5; index++) {
          await frame.locator('#drop').click();
          await page.waitForTimeout(75);
        }
        await stopAnimation(frame);
        break;
      case 'wireframe-orbit':
        await setRange(frame, 'yaw', 45);
        break;
      case 'depth-picker': {
        await frame.locator('#next').click();
        const centers = await frame.locator('.item').evaluateAll((rows) =>
          rows.slice(4, 9).map((element) => {
            const box = element.getBoundingClientRect();
            return box.top + box.height / 2;
          }),
        );
        for (let index = 1; index < centers.length; index++) {
          assert.ok(centers[index] - centers[index - 1] > 30, 'picker labels overlap');
        }
        break;
      }
      case 'liquid-page':
        await setRange(frame, 'progress', 53);
        break;
    }
    await page.emulateMedia({ reducedMotion: 'reduce' });
    const filename = path.join(outputDirectory, `${item.id}.png`);
    await frame.locator('.stage').screenshot({ path: filename, animations: 'disabled' });
    const png = await fs.readFile(filename);
    const width = png.readUInt32BE(16);
    const height = png.readUInt32BE(20);
    assert.ok(width >= 600 && width <= 1300, `${item.id} width ${width}`);
    assert.ok(height >= 400 && height <= 1000, `${item.id} height ${height}`);
    manifest.push({
      id: item.id,
      path: `apps/web/public/creative/${item.id}.png`,
      width,
      height,
      bytes: png.length,
      sha256: createHash('sha256').update(png).digest('hex'),
      sourceRepository: item.source.repository,
      sourceCommit: item.source.commit,
      capture: animationStudy
        ? 'real animation paused before DOM screenshot'
        : 'reduced-motion DOM screenshot',
    });
    console.log(`Rendered ${item.id}: ${width} × ${height}, ${png.length} bytes`);
    await page.setViewportSize({ width: 688, height: 1000 });
  }
  assert.deepEqual(pageErrors, [], 'catalog page errors');
  assert.deepEqual(externalRequests, [], 'external resources');
  // Preserve existing covers when rendering just the new edition, and include
  // their actual current hashes in the complete notice/manifest.
  for (const item of creativeItems.filter((entry) => !selectedItems.includes(entry))) {
    const png = await fs.readFile(path.join(outputDirectory, `${item.id}.png`));
    manifest.push({
      id: item.id,
      path: `apps/web/public/creative/${item.id}.png`,
      width: png.readUInt32BE(16),
      height: png.readUInt32BE(20),
      bytes: png.length,
      sha256: createHash('sha256').update(png).digest('hex'),
      sourceRepository: item.source.repository,
      sourceCommit: item.source.commit,
      capture: 'existing verified DOM cover preserved',
    });
  }
  const notice =
    'CREATIVE CATALOG COVER IMAGES\n\n' +
    'These PNG files are unedited screenshots of the checked-in, UI-only learning templates.\n' +
    'They contain no third-party photographs, downloaded video frames, external fonts or images.\n' +
    'Captured by scripts/creative-covers.mjs using an opaque browser iframe.\n' +
    'Each template records the exact extracted / independently reimplemented scope below.\n\n' +
    creativeItems
      .map(
        (item) =>
          `=== ${item.id}.png — ${item.title} ===\n\n${item.files.find((file) => file.path === 'NOTICE.txt').content}\n`,
      )
      .join('\n');
  await fs.writeFile(path.join(outputDirectory, 'NOTICE.txt'), notice);
  await fs.writeFile(
    path.join(evidenceDirectory, 'creative-covers-manifest.json'),
    JSON.stringify(
      {
        generatedAt: new Date().toISOString(),
        items: manifest,
        externalRequests,
        pageErrors,
      },
      null,
      2,
    ) + '\n',
  );
  await page.setViewportSize({ width: 1380, height: 900 });
  await page.goto(`${appOrigin}/__contact-sheet`);
  await page.locator('img').last().waitFor();
  await page.evaluate(async () => Promise.all([...document.images].map((image) => image.decode())));
  await page.screenshot({
    path: path.join(evidenceDirectory, 'creative-covers-contact.png'),
    fullPage: true,
  });
} finally {
  if (browser) await browser.close();
  await Promise.all(
    [previewServer, parentServer].map(
      (server) =>
        new Promise((resolve) => {
          if (!server.listening) return resolve();
          server.close(resolve);
        }),
    ),
  );
}
