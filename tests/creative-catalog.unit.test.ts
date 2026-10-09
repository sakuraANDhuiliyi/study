import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import { Script } from 'node:vm';
import { creativeItems } from '../apps/api/src/programming/creative.catalog';
import { programmingFilesSchema } from '../apps/api/src/programming/programming.schemas';

test('creative catalog preserves forty studies and adds the Aora expression laboratory', () => {
  assert.equal(creativeItems.length, 41);
  assert.equal(creativeItems.filter((item) => item.edition === 2).length, 21);
  assert.equal(creativeItems.filter((item) => item.edition !== 2).length, 20);
  assert.equal(new Set(creativeItems.map((item) => item.id)).size, creativeItems.length);
  assert.equal(new Set(creativeItems.map((item) => item.source.repository)).size, creativeItems.length);
  assert.ok(new Set(creativeItems.map((item) => item.category)).size >= 6);
  for (const item of creativeItems) {
    assert.match(item.id, /^[a-z0-9][a-z0-9-]{0,63}$/);
    assert.ok(Buffer.byteLength(`creative:${item.id}`) <= 100);
    assert.ok(item.title && item.description && item.learningGoals.length >= 3);
    assert.ok(item.tags.length >= 3);
  }
});

test('each source has a pinned revision, original notice and truthful adaptation scope', () => {
  for (const item of creativeItems) {
    const { source } = item;
    assert.match(source.repository, /^https:\/\/github\.com\/[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/);
    assert.match(source.commit, /^[a-f0-9]{40}$/);
    if (item.id === 'aora-expression-lab') {
      assert.equal(source.license, 'Emotion Ball Community License');
      assert.match(source.usageNotice || '', /非商业/);
      assert.match(source.licenseText, /NON-COMMERCIAL USE/);
      assert.match(source.licenseText, /VISUAL DESIGNS NEVER COMMERCIAL/);
    } else assert.ok(['MIT', 'ISC'].includes(source.license));
    assert.match(source.licenseText, /Copyright|copyright/);
    assert.match(source.licenseText, /PERMISSION|Permission|permitted/);
    assert.match(source.licenseText, /AS IS/);
    assert.ok(source.files.length >= 2);
    for (const file of source.files) {
      assert.ok(file.title);
      assert.ok(file.url.startsWith(`${source.repository}/blob/${source.commit}/`));
    }
    assert.ok(source.scope && source.changes);
    const notice = item.files.find((file) => file.path === 'NOTICE.txt')?.content;
    assert.ok(notice);
    assert.ok(notice.includes(source.licenseText));
    assert.ok(notice.includes(source.repository));
    assert.ok(notice.includes(source.commit));
    assert.ok(notice.includes(source.scope));
    assert.ok(notice.includes(source.changes));
    for (const video of source.videos) {
      const url = new URL(video.url);
      assert.equal(url.protocol, 'https:');
      if (video.platform === 'YouTube') {
        assert.equal(url.hostname, 'www.youtube.com');
        assert.match(url.searchParams.get('v') || '', /^[A-Za-z0-9_-]{11}$/);
      } else if (video.platform === 'Bilibili') {
        assert.equal(url.hostname, 'www.bilibili.com');
        assert.match(url.pathname, /^\/video\/BV[0-9A-Za-z]+\/?$/);
      } else if (video.platform === '抖音') {
        assert.equal(url.hostname, 'www.douyin.com');
        assert.match(url.pathname, /^\/video\/\d+\/?$/);
      } else assert.fail(`Unverified video platform: ${video.platform}`);
      assert.ok(video.title);
      if (video.repository) {
        assert.match(video.repository, /^https:\/\/github\.com\/[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/);
        assert.ok(['source', 'inspiration'].includes(video.relation || ''));
      }
    }
  }
});

test('every recipe meets workspace limits and has valid self-contained browser JavaScript', () => {
  for (const item of creativeItems) {
    assert.ok(programmingFilesSchema.safeParse(item.files).success, item.id);
    const standardPaths = ['README.md', 'NOTICE.txt', 'app.js', 'index.html', 'style.css'];
    if (item.id === 'aora-expression-lab') {
      standardPaths.push(
        'vendor/rings.js',
        'vendor/emotions.js',
        'vendor/ball.js',
        'vendor/engine.js',
        'NOTICE.md',
        'LICENSE.txt',
        'LICENSE-COMMERCIAL.md',
      );
    }
    assert.deepEqual(item.files.map((file) => file.path).sort(), standardPaths.sort());
    const html = item.files.find((file) => file.path === 'index.html')!.content;
    const css = item.files.find((file) => file.path === 'style.css')!.content;
    const js = item.files.find((file) => file.path === 'app.js')!.content;
    const readme = item.files.find((file) => file.path === 'README.md')!.content;
    assert.match(html, /<meta name="viewport" content="width=device-width,initial-scale=1">/);
    assert.match(html, /href="style.css"/);
    assert.match(html, /src="app.js" defer/);
    assert.doesNotMatch(html, /(?:src|href)=["'](?:https?:|\/\/|data:)/i);
    assert.doesNotMatch(html, /<iframe|<object|<embed|<form|<base/i);
    assert.doesNotMatch(css, /@import|url\(/i);
    assert.match(css, /prefers-reduced-motion:\s*reduce/);
    assert.match(css, item.id === 'aora-expression-lab' ? /max-width:\s*630px/ : /max-width:520px/);
    assert.doesNotMatch(
      js,
      /\bfetch\s*\(|\bXMLHttpRequest\b|\bWebSocket\b|\blocalStorage\b|\bdocument\.cookie\b|\bserviceWorker\b|\beval\s*\(|\binnerHTML\s*=/,
    );
    for (const file of item.files.filter((file) => file.path.endsWith('.js'))) {
      assert.doesNotThrow(() => new Script(file.content, { filename: `${item.id}/${file.path}` }), item.id);
    }
    assert.match(readme, /## 学习步骤/);
    assert.ok(readme.includes(item.source.commit));
    assert.match(readme, /NOTICE\.txt/);
  }
});

test('the original video evidence and historical MIT typing implementation remain intact', () => {
  assert.deepEqual(
    creativeItems.filter((item) => item.edition !== 2 && item.source.videos.length).map((item) => item.id),
    ['shape-morph', 'liquid-page'],
  );
  const typing = creativeItems.find((item) => item.id === 'typing-terminal')!;
  assert.equal(typing.source.commit, '337109d9ac6558475eea301693e64071dafc9961');
  assert.match(typing.source.changes, /v2\.0\.12/);
  assert.match(typing.source.licenseText, /2018 Matt Boldt/);
});

test('every catalog entry has a real PNG cover and the public cover notices retain all licenses', () => {
  const notice = readFileSync(new URL('../apps/web/public/creative/NOTICE.txt', import.meta.url), 'utf8');
  for (const item of creativeItems) {
    const png = readFileSync(new URL(`../apps/web/public/creative/${item.id}.png`, import.meta.url));
    assert.equal(png.subarray(0, 8).toString('hex'), '89504e470d0a1a0a');
    assert.ok(png.readUInt32BE(16) >= 320);
    assert.ok(png.readUInt32BE(20) >= 200);
    assert.ok(png.length > 2000);
    assert.ok(notice.includes(`${item.id}.png`));
    assert.ok(notice.includes(item.source.repository));
    assert.ok(notice.includes(item.source.commit));
    assert.ok(notice.includes(item.source.licenseText));
  }
});
