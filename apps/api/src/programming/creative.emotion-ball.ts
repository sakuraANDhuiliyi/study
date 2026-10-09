import type { CreativeItem } from './creative.catalog';
import { makeCreativeRecipe } from './creative.recipe';
import upstream from './creative.emotion-ball.vendor.json';

const repository = 'https://github.com/sam70361/aora-bot';
const commit = 'e3b6148c818da4a8e1966f2bc89cdb3cee473b73';
const usageNotice =
  '仅供个人技术学习、研究与非商业技术交流。球形角色视觉形象禁止任何商业用途，且不提供商业授权；表情引擎与数据的商业使用须另行获得授权。';

const recipe = makeCreativeRecipe({
  id: 'aora-expression-lab',
  edition: 2,
  title: '动态表情实验室',
  category: '图形动画',
  tags: ['SVG', '32 种表情', '弹簧插值', '代理状态', '非商业学习'],
  description:
    '把 aora-bot 的 32 套表情放进可交互的学习工作台。在球形、楔形和菱形之间切换，观察情绪过渡，模拟代理工作状态并复制表情配置。',
  learningGoals: [
    '用固定 emotionId 驱动生命周期、情绪反应与代理工作状态',
    '理解数据、SVG 渲染与弹簧插值状态机的分层接口',
    '管理暂停、巡演、后台页面和减少动态效果的动画生命周期',
    '通过可选择的 JSON 示例理解表情配置与代理消息契约',
  ],
  source: {
    repository,
    commit,
    files: [
      ...upstream.scripts.map((file) => ({
        title: file.sourcePath,
        url: `${repository}/blob/${commit}/${file.sourcePath}`,
      })),
      ...['LICENSE', 'NOTICE.md', 'LICENSE-COMMERCIAL.md'].map((path) => ({
        title: path,
        url: `${repository}/blob/${commit}/${path}`,
      })),
    ],
    license: 'Emotion Ball Community License',
    licenseText: `${upstream.license}\n\n${upstream.notice}\n\n${upstream.commercialLicense}`,
    usageNotice,
    videos: [],
    scope:
      '完整迁入固定版本 js/rings.js、js/emotions.js、js/ball.js、js/engine.js 的原始文本，保留 32 个表情 ID、三种球形角色和 SVG 动画引擎。',
    changes:
      '上游四个脚本保持原文。新增中文筛选、搜索、形态与线稿控制、单实例巡演、只读 JSON、键盘导航和本地代理消息示例；不接入 AI、网络、存储或服务器。暂停、后台页面与减少动态效果时停止巡演并渲染静态帧。',
  },
  html: `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>动态表情实验室</title>
  <link rel="stylesheet" href="style.css">
  <script src="vendor/rings.js" defer></script>
  <script src="vendor/emotions.js" defer></script>
  <script src="vendor/ball.js" defer></script>
  <script src="vendor/engine.js" defer></script>
  <script src="app.js" defer></script>
</head>
<body>
<main>
  <header class="page-header">
    <div>
      <p class="eyebrow">CREATIVE LAB / EMOTION SYSTEMS</p>
      <h1>动态表情实验室<span class="title-dot" aria-hidden="true"></span></h1>
      <p class="intro">让状态被看见。探索 32 套表情，在微小的眼神与动作之间，读懂一个角色的情绪。</p>
    </div>
    <div class="edition"><span>32 EXPRESSIONS</span><strong>02 / INTERACTIVE STUDY</strong></div>
  </header>

  <section class="workbench" aria-label="表情预览与控制">
    <div class="stage" id="expression-stage" data-playing="false" data-touring="false">
      <div class="stage-top"><span>LIVE PORTRAIT / 实时肖像</span><span id="stage-index">09 / 32</span></div>
      <div class="orbit orbit-one" aria-hidden="true"></div>
      <div class="orbit orbit-two" aria-hidden="true"></div>
      <div id="ball-host" tabindex="0" aria-label="表情舞台，左右方向键切换表情"></div>
      <div class="stage-bottom"><span class="stage-light" aria-hidden="true"></span><span id="motion-state">静态预览</span><span class="stage-shape" id="shape-caption">BLOB / 球形</span></div>
    </div>
    <aside class="control-panel" aria-label="当前表情与动画控制">
      <div class="current-heading"><span class="pill" id="current-group">情绪反应</span><span class="id-label">ID <strong id="current-id">10</strong></span></div>
      <h2 id="current-name">开心</h2>
      <p class="current-en" id="current-en">Happy</p>
      <p class="description" id="current-description"></p>
      <div class="navigation"><button type="button" id="previous-emotion" aria-label="上一个表情">← 上一个</button><button type="button" id="next-emotion" aria-label="下一个表情">下一个 →</button></div>
      <div class="control-row"><label for="shape-select">角色形态</label><select id="shape-select"><option value="blob">球形 / blob</option><option value="wedge">楔形 / wedge</option><option value="gem">菱形 / gem</option></select></div>
      <button type="button" class="sketch-control" id="sketch-toggle" aria-pressed="false"><span>线稿模式</span><span class="switch-dot" aria-hidden="true"></span></button>
      <div class="play-controls"><button type="button" class="primary" id="play-toggle" aria-pressed="false">播放动画</button><button type="button" id="tour-toggle" aria-pressed="false">自动巡演</button></div>
      <p class="motion-note" id="motion-note">默认静态。巡演只播放当前筛选中的表情；手动选择会停止巡演。</p>
      <output id="interaction-status" class="status" aria-live="polite">准备就绪 · 所有交互均在当前预览内运行</output>
    </aside>
  </section>

  <section class="library" aria-labelledby="library-title">
    <div class="section-heading"><div><p class="eyebrow">EXPRESSION LIBRARY</p><h2 id="library-title">表情档案 <span id="result-count">32 / 32</span></h2></div><label class="search-label" for="emotion-search"><span>搜索</span><input id="emotion-search" type="search" maxlength="128" placeholder="名称、ID 或动作描述" autocomplete="off"></label></div>
    <div class="group-tabs" id="group-tabs" role="group" aria-label="表情分组"></div>
    <div class="emotion-grid" id="emotion-list"></div>
    <p id="no-results" class="empty-state" hidden>没有匹配的表情。试试表情名称、ID，或清空搜索。</p>
  </section>

  <section class="connection-lab" aria-labelledby="connection-title">
    <div class="connection-copy"><p class="eyebrow">STATE → EXPRESSION</p><h2 id="connection-title">模拟一次代理工作</h2><p>点击状态，将固定的 <code>emotionId</code> 交给表情引擎。这里只模拟消息，不会调用真实 AI 或执行任务。</p><div id="agent-demo" class="agent-buttons" role="group" aria-label="本地代理状态示例"><button type="button" data-agent-id="31">接收任务</button><button type="button" data-agent-id="30">思考中</button><button type="button" data-agent-id="39">输出回复</button><button type="button" data-agent-id="33">任务完成</button><button type="button" data-agent-id="34">出错</button><button type="button" data-agent-id="41">停止终止</button></div></div>
    <div class="json-card"><div class="json-heading"><label for="message-json">代理消息 / JSON</label><button type="button" class="small-button" id="copy-json">复制消息</button></div><textarea id="message-json" readonly spellcheck="false" aria-label="可复制的本地代理消息 JSON"></textarea><p>可选中文本手动复制；<code>tips</code> 是本地模拟提示。</p><details class="config-details"><summary>查看当前表情的完整配置</summary><div class="json-heading"><label for="configuration-json">表情配置 / JSON</label><button type="button" class="small-button" id="copy-config">复制配置</button></div><textarea id="configuration-json" readonly spellcheck="false" aria-label="当前表情的完整 JSON 配置"></textarea></details></div>
  </section>

  <footer><span class="footer-mark">AORA / EXPRESSION STUDY</span><p>基于 sam70361 / aora-bot 的固定版本，四个引擎脚本保持原文。仅供个人学习、研究与非商业技术交流；球形角色视觉形象禁止任何商业用途。完整许可与原始声明随源码保存在 NOTICE.txt、NOTICE.md 与 LICENSE.txt。</p></footer>
</main>
</body>
</html>`,
  css: `:root {
  color-scheme: light;
  --paper: #f6f5f1;
  --ink: #242d2b;
  --muted: #64716c;
  --line: #d9ded8;
  --accent: #276b58;
  --sketch-ink: #263d34;
}
* { box-sizing: border-box; }
body { margin: 0; min-width: 280px; background: var(--paper); color: var(--ink); font-family: ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }
main { width: min(1120px, 100%); margin: 0 auto; padding: 38px 28px 28px; }
button, input, select, textarea { font: inherit; }
button { cursor: pointer; color: var(--ink); background: #fff; border: 1px solid var(--line); border-radius: 9px; padding: 10px 13px; font-size: 12px; line-height: 1.4; }
button:hover { border-color: #8fa59a; background: #f0f5ee; }
button:disabled { cursor: default; opacity: .6; }
button:focus-visible, input:focus-visible, select:focus-visible, textarea:focus-visible, summary:focus-visible, #ball-host:focus-visible { outline: 3px solid #469a7d; outline-offset: 3px; }
button[aria-pressed="true"] { background: #dcecdf; border-color: #77a189; color: #234c3b; }
.page-header { display: flex; justify-content: space-between; align-items: flex-start; gap: 24px; }
.eyebrow { font-size: 10px; line-height: 1.6; letter-spacing: .16em; color: var(--accent); font-weight: 700; margin: 0 0 9px; }
h1 { font-size: clamp(28px, 4.5vw, 43px); font-weight: 600; letter-spacing: -.055em; line-height: 1.25; margin: 0 0 13px; }
.title-dot { display: inline-block; width: 9px; height: 9px; margin-left: 11px; border-radius: 50%; background: #d7a657; vertical-align: baseline; }
.intro { color: var(--muted); font-size: 13px; line-height: 1.85; max-width: 570px; margin: 0; }
.edition { display: flex; flex-direction: column; align-items: flex-end; gap: 7px; padding-top: 8px; white-space: nowrap; font-size: 10px; letter-spacing: .1em; color: var(--muted); }
.edition span { border: 1px solid var(--line); border-radius: 24px; padding: 8px 12px; background: #ffffff80; color: #43584b; }
.edition strong { font-size: 9px; font-weight: 500; }
.workbench { display: grid; grid-template-columns: minmax(0, 1.65fr) minmax(280px, 1fr); gap: 18px; margin: 26px 0 33px; }
.stage { position: relative; display: grid; place-items: center; min-height: 432px; border-radius: 20px; border: 1px solid #dde4d8; overflow: hidden; isolation: isolate; background: radial-gradient(circle at 48% 40%, #f5f3e9 0%, #e7ecdc 70%, #dbe7d8 100%); }
.stage::after { content: ""; position: absolute; inset: 0; z-index: -1; opacity: .2; background-image: radial-gradient(#638273 1px, transparent 1px); background-size: 22px 22px; }
.stage-top, .stage-bottom { position: absolute; left: 20px; right: 20px; display: flex; align-items: center; gap: 8px; color: #5b7265; font-size: 10px; letter-spacing: .07em; z-index: 1; pointer-events: none; }
.stage-top { top: 20px; justify-content: space-between; }
.stage-bottom { bottom: 19px; }
.stage-shape { margin-left: auto; }
.stage-light { width: 6px; height: 6px; border-radius: 50%; background: #829887; }
.stage[data-playing="true"] .stage-light { background: #357955; box-shadow: 0 0 0 3px #35795515; }
.orbit { position: absolute; width: 310px; height: 310px; border: 1px solid #9cb39a50; border-radius: 50%; z-index: -1; }
.orbit-one { transform: rotate(-20deg) scaleX(1.48) scaleY(.71); }
.orbit-two { transform: rotate(45deg) scaleX(.75) scaleY(1.23); }
#ball-host { width: min(340px, 78%); aspect-ratio: 1; position: relative; z-index: 1; border-radius: 50%; filter: drop-shadow(0 21px 16px #6c866f15); }
#ball-host svg { max-width: 100%; }
.control-panel { display: flex; flex-direction: column; min-width: 0; padding: 23px; background: #fffdfa; border: 1px solid #e1e2da; border-radius: 20px; }
.current-heading { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
.pill { font-size: 10px; border-radius: 22px; padding: 5px 9px; color: #3a6e56; background: #e8f0e7; }
.id-label { font-size: 10px; color: var(--muted); letter-spacing: .07em; }
.id-label strong { margin-left: 3px; font-size: 15px; color: #33443b; font-variant-numeric: tabular-nums; }
.control-panel h2 { font-size: 31px; font-weight: 550; letter-spacing: -.04em; margin: 15px 0 4px; }
.current-en { color: #88928a; margin: 0; font-size: 11px; letter-spacing: .08em; }
.description { font-size: 12px; line-height: 1.85; color: var(--muted); min-height: 46px; margin: 12px 0 17px; }
.navigation { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; padding-bottom: 15px; border-bottom: 1px solid #e5e7df; }
.control-row { display: flex; align-items: center; justify-content: space-between; gap: 12px; margin-top: 16px; }
.control-row label, .sketch-control { font-size: 12px; }
select { width: 158px; max-width: 62%; min-width: 0; background: #f5f6f1; color: var(--ink); border: 1px solid var(--line); border-radius: 8px; padding: 8px 9px; font-size: 12px; }
.sketch-control { display: flex; align-items: center; justify-content: space-between; margin-top: 9px; background: transparent; padding: 8px 0; border: 0; border-radius: 3px; }
.sketch-control:hover, .sketch-control[aria-pressed="true"] { background: transparent; }
.switch-dot { width: 31px; height: 18px; border-radius: 15px; background: #dce3dc; position: relative; }
.switch-dot::after { content: ""; width: 12px; height: 12px; position: absolute; top: 3px; left: 3px; border-radius: 50%; background: white; box-shadow: 0 1px 2px #0002; }
[aria-pressed="true"] .switch-dot { background: #3b7b5f; }
[aria-pressed="true"] .switch-dot::after { left: 16px; }
.play-controls { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; margin-top: 12px; }
button.primary, button.primary[aria-pressed="true"] { color: #fff; background: #2f6f56; border-color: #2f6f56; }
button.primary:hover { background: #235b44; }
.motion-note { margin: 10px 0 0; color: #738073; font-size: 10px; line-height: 1.75; }
.status { display: block; font-size: 11px; line-height: 1.7; color: var(--accent); min-height: 19px; margin-top: 12px; overflow-wrap: anywhere; }
.section-heading { display: flex; align-items: center; justify-content: space-between; gap: 18px; }
.section-heading h2, .connection-lab h2 { font-size: 23px; font-weight: 550; letter-spacing: -.035em; margin: 0; }
.section-heading h2 span { font-size: 11px; margin-left: 10px; font-weight: 400; color: var(--muted); letter-spacing: .04em; font-variant-numeric: tabular-nums; }
.section-heading .eyebrow, .connection-lab .eyebrow { font-size: 9px; margin-bottom: 5px; }
.search-label { display: flex; align-items: center; gap: 10px; color: var(--muted); font-size: 11px; min-width: 0; }
.search-label input { width: 224px; min-width: 0; padding: 11px 12px; background: #fff; border: 1px solid var(--line); border-radius: 9px; color: var(--ink); font-size: 12px; }
.group-tabs { display: flex; flex-wrap: wrap; gap: 7px; margin: 18px 0 14px; }
.group-tabs button { font-size: 11px; border-radius: 25px; padding: 8px 13px; background: transparent; }
.group-tabs button[aria-pressed="true"] { background: #253c31; color: #f4f8f1; border-color: #253c31; }
.group-tabs .count { opacity: .65; margin-left: 6px; font-size: 10px; }
.emotion-grid { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 9px; }
.emotion-card { text-align: left; display: flex; flex-direction: column; gap: 7px; min-width: 0; padding: 15px; border: 1px solid #e0e3db; border-radius: 11px; background: #fffdfa; }
.emotion-card[aria-pressed="true"] { border-color: #78947c; background: #e5eddd; }
.card-top { display: flex; align-items: center; gap: 10px; width: 100%; }
.card-id { font-size: 10px; color: #72907a; letter-spacing: .03em; border: 1px solid #cddbc9; border-radius: 5px; padding: 4px 5px; font-variant-numeric: tabular-nums; flex-shrink: 0; }
.card-name { font-size: 12px; font-weight: 600; overflow-wrap: anywhere; }
.card-en { font-size: 10px; color: #829081; overflow-wrap: anywhere; }
.card-description { color: #6f7c6d; font-size: 10px; line-height: 1.7; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; height: 34px; }
.empty-state { font-size: 12px; line-height: 1.8; text-align: center; padding: 28px; background: #fff; border: 1px dashed var(--line); border-radius: 12px; color: var(--muted); }
.connection-lab { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); gap: 30px; padding: 26px; margin: 29px 0 24px; border: 1px solid #dce2d9; background: #ebefe6; border-radius: 17px; }
.connection-copy p:not(.eyebrow) { font-size: 12px; color: var(--muted); line-height: 1.9; margin: 13px 0 17px; }
.agent-buttons { display: flex; flex-wrap: wrap; gap: 7px; }
.agent-buttons button { background: #f9faf5; font-size: 11px; }
.agent-buttons button[aria-pressed="true"] { background: #dae8d4; border-color: #73966f; }
.json-card { min-width: 0; border: 1px solid #d8dfd4; border-radius: 11px; background: #f8faf4; padding: 15px; }
.json-heading { display: flex; align-items: center; justify-content: space-between; gap: 10px; font-size: 10px; color: #587054; }
.small-button { padding: 5px 8px; border-color: #cbd8c8; border-radius: 5px; font-size: 10px; background: #eef5e8; flex-shrink: 0; }
textarea { width: 100%; resize: vertical; display: block; min-height: 96px; margin-top: 11px; border: 1px solid #dee5d9; border-radius: 7px; padding: 11px; background: #fff; color: #425b3c; font-size: 11px; font-family: ui-monospace, SFMono-Regular, Consolas, monospace; line-height: 1.65; }
.json-card p { color: #70856c; font-size: 10px; line-height: 1.7; margin: 8px 0 0; }
code { font-family: ui-monospace, SFMono-Regular, Consolas, monospace; font-size: .95em; }
.config-details { margin-top: 13px; padding-top: 12px; border-top: 1px solid #dbe3d4; }
.config-details summary { cursor: pointer; font-size: 11px; line-height: 1.6; color: #486041; }
.config-details[open] .json-heading { margin-top: 13px; }
#configuration-json { min-height: 200px; }
footer { border-top: 1px solid var(--line); padding-top: 17px; display: flex; align-items: flex-start; gap: 22px; }
.footer-mark { font-size: 9px; letter-spacing: .1em; line-height: 1.7; white-space: nowrap; color: #55705b; padding-top: 2px; }
footer p { font-size: 10px; color: #7a8274; line-height: 1.8; margin: 0; }
[hidden] { display: none !important; }
@media (max-width: 850px) {
  main { padding: 28px 20px; }
  .workbench { grid-template-columns: minmax(0, 1.3fr) minmax(265px, 1fr); gap: 12px; }
  .control-panel { padding: 18px; }
  .emotion-grid { grid-template-columns: repeat(3, minmax(0, 1fr)); }
  .connection-lab { gap: 20px; padding: 20px; }
  .edition { font-size: 9px; }
}
@media (max-width: 630px) {
  main { padding: 25px 15px 22px; }
  .page-header { display: block; }
  .intro { font-size: 12px; }
  .edition { flex-direction: row; justify-content: space-between; align-items: center; gap: 8px; padding-top: 15px; }
  .edition strong { font-size: 8px; letter-spacing: .04em; }
  .workbench { grid-template-columns: 1fr; margin-top: 20px; gap: 12px; }
  .stage { min-height: 330px; }
  #ball-host { width: 260px; max-width: 77%; }
  .orbit { width: 240px; height: 240px; }
  .stage-top, .stage-bottom { left: 16px; right: 16px; font-size: 8px; }
  .control-panel { padding: 19px; }
  .control-panel h2 { font-size: 29px; margin-top: 11px; }
  .description { min-height: 0; margin-bottom: 13px; }
  .section-heading { align-items: flex-start; flex-direction: column; gap: 14px; }
  .search-label { width: 100%; }
  .search-label input { width: 100%; }
  .emotion-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 8px; }
  .emotion-card { padding: 12px; }
  .group-tabs { gap: 6px; margin-top: 15px; }
  .group-tabs button { padding: 8px 11px; }
  .connection-lab { grid-template-columns: 1fr; padding: 19px; gap: 19px; }
  footer { flex-direction: column; gap: 7px; }
}
@media (prefers-reduced-motion: reduce) {
  *, *::before, *::after { animation: none !important; transition: none !important; scroll-behavior: auto !important; }
}`,
  js: `'use strict';
(function () {
  const $ = (selector) => document.querySelector(selector);
  const sdk = window.EmotionBall;
  const stage = $('#expression-stage');
  const host = $('#ball-host');
  const media = matchMedia('(prefers-reduced-motion: reduce)');
  const controls = {
    play: $('#play-toggle'),
    tour: $('#tour-toggle'),
    previous: $('#previous-emotion'),
    next: $('#next-emotion'),
    sketch: $('#sketch-toggle'),
    shape: $('#shape-select'),
    search: $('#emotion-search')
  };
  const state = {
    engine: null,
    group: 'all',
    search: '',
    shape: 'blob',
    sketch: false,
    playing: false,
    touring: false,
    currentId: '10',
    reduced: media.matches,
    destroyed: false
  };
  const shapeNames = { blob: 'BLOB / 球形', wedge: 'WEDGE / 楔形', gem: 'GEM / 菱形' };
  const all = sdk.config.list();
  const groups = sdk.config.groups().filter((group) => all.some((item) => item.group === group.key));
  const groupNames = new Map(groups.map((group) => [group.key, group.name]));
  const cards = new Map();
  const listeners = [];

  function listen(node, type, handler) {
    node.addEventListener(type, handler);
    listeners.push(() => node.removeEventListener(type, handler));
  }

  function element(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  }

  function announce(text) {
    if (!state.destroyed) $('#interaction-status').textContent = text;
  }

  function filtered() {
    const query = state.search.trim().toLocaleLowerCase();
    return all.filter((item) => {
      const inGroup = state.group === 'all' || item.group === state.group;
      const text = [item.id, item.name, item.desc, item.en && item.en.name, item.en && item.en.desc].join(' ').toLocaleLowerCase();
      return inGroup && (!query || text.includes(query));
    });
  }

  function renderControls() {
    stage.dataset.playing = String(state.playing);
    stage.dataset.touring = String(state.touring);
    stage.dataset.shape = state.shape;
    controls.play.setAttribute('aria-pressed', String(state.playing));
    controls.play.textContent = state.playing ? '暂停动画' : '播放动画';
    controls.tour.setAttribute('aria-pressed', String(state.touring));
    controls.tour.textContent = state.touring ? '停止巡演' : '自动巡演';
    controls.play.disabled = state.reduced || document.hidden;
    controls.tour.disabled = state.reduced || document.hidden || !filtered().length;
    controls.sketch.setAttribute('aria-pressed', String(state.sketch));
    $('#motion-state').textContent = state.touring ? '自动巡演' : state.playing ? '动画播放中' : '静态预览';
    $('#shape-caption').textContent = shapeNames[state.shape];
    $('#motion-note').textContent = state.reduced
      ? '系统已启用减少动态效果：使用静态预览，动画与自动巡演已停用。'
      : '默认静态。巡演只播放当前筛选中的表情；手动选择会停止巡演。';
  }

  function stopTour() {
    if (state.engine) state.engine.stopTour();
    state.touring = false;
    renderControls();
  }

  function pause(message) {
    if (state.engine) {
      state.engine.stopTour();
      state.engine.setActive(false);
      state.engine.renderStatic();
    }
    state.touring = false;
    state.playing = false;
    renderControls();
    if (message) announce(message);
  }

  function renderCurrent(id) {
    const item = sdk.config.get(id);
    if (!item || state.destroyed) return;
    state.currentId = item.id;
    stage.dataset.emotionId = item.id;
    $('#current-id').textContent = item.id;
    $('#current-name').textContent = item.name;
    $('#current-description').textContent = item.desc;
    $('#current-en').textContent = item.en ? item.en.name : '';
    $('#current-group').textContent = groupNames.get(item.group) || item.group;
    $('#stage-index').textContent = String(all.findIndex((entry) => entry.id === item.id) + 1).padStart(2, '0') + ' / ' + all.length;
    $('#message-json').value = JSON.stringify({ emotionId: item.id, tips: '本地模拟：' + item.name }, null, 2);
    $('#configuration-json').value = JSON.stringify(item.raw, null, 2);
    host.querySelector('svg').setAttribute('aria-label', item.name + '，' + shapeNames[state.shape] + '，' + item.desc);
    cards.forEach((card, cardId) => card.setAttribute('aria-pressed', String(cardId === item.id)));
    $('#agent-demo').querySelectorAll('[data-agent-id]').forEach((button) => {
      button.setAttribute('aria-pressed', String(button.dataset.agentId === item.id));
    });
  }

  function mountBall() {
    const tourIds = state.touring ? filtered().map((item) => item.id) : [];
    const currentTourIndex = tourIds.indexOf(state.currentId);
    const orderedTourIds = currentTourIndex < 0
      ? tourIds
      : tourIds.slice(currentTourIndex).concat(tourIds.slice(0, currentTourIndex));
    if (state.engine) {
      state.engine.destroy();
      state.engine = null;
    }
    host.replaceChildren();
    state.engine = sdk.create(host, {
      emotion: state.currentId,
      shape: state.shape,
      autostart: false,
      lite: false,
      idle: false,
      label: '动态表情学习预览'
    });
    state.engine.on('change', (event) => renderCurrent(event.id));
    state.engine.on('tips', (event) => announce('本地模拟 · ' + event.text));
    state.engine.on('error', (event) => announce(event.message));
    state.engine.setStyle({ sketch: state.sketch ? 1 : 0 });
    renderCurrent(state.currentId);
    if (state.playing && !state.reduced && !document.hidden) {
      state.engine.setActive(true);
      if (orderedTourIds.length) state.engine.startTour(orderedTourIds, 3000);
    } else {
      pause();
    }
    renderControls();
  }

  function selectEmotion(id) {
    if (state.destroyed) return;
    stopTour();
    state.engine.setEmotion(id);
    if (!state.playing) state.engine.renderStatic();
    const item = sdk.config.get(state.engine.emotionId);
    announce('已选择 ' + item.id + ' · ' + item.name + (state.playing ? ' · 动画播放中' : ' · 静态预览'));
  }

  function step(direction) {
    const items = filtered();
    if (!items.length) return;
    const current = items.findIndex((item) => item.id === state.currentId);
    const index = current < 0 ? (direction > 0 ? 0 : items.length - 1) : (current + direction + items.length) % items.length;
    selectEmotion(items[index].id);
  }

  function applyFilter() {
    stopTour();
    const matches = filtered();
    const visible = new Set(matches.map((item) => item.id));
    cards.forEach((card, id) => { card.hidden = !visible.has(id); });
    $('#result-count').textContent = matches.length + ' / ' + all.length;
    $('#no-results').hidden = matches.length > 0;
    controls.previous.disabled = !matches.length;
    controls.next.disabled = !matches.length;
    $('#group-tabs').querySelectorAll('[data-group]').forEach((button) => {
      button.setAttribute('aria-pressed', String(button.dataset.group === state.group));
    });
    renderControls();
    announce('筛选结果 ' + matches.length + ' 个表情 · 当前舞台保持原表情');
  }

  function buildLibrary() {
    const options = [{ key: 'all', name: '全部表情' }].concat(groups);
    options.forEach((group) => {
      const button = element('button', '', group.name);
      button.type = 'button';
      button.dataset.group = group.key;
      button.setAttribute('aria-pressed', String(group.key === 'all'));
      const count = group.key === 'all' ? all.length : all.filter((item) => item.group === group.key).length;
      button.appendChild(element('span', 'count', String(count)));
      listen(button, 'click', () => {
        state.group = group.key;
        applyFilter();
      });
      $('#group-tabs').appendChild(button);
    });
    all.forEach((item) => {
      const card = element('button', 'emotion-card');
      card.type = 'button';
      card.dataset.emotionId = item.id;
      card.setAttribute('aria-pressed', 'false');
      card.setAttribute('aria-label', item.id + ' ' + item.name);
      const top = element('span', 'card-top');
      top.appendChild(element('span', 'card-id', item.id));
      top.appendChild(element('span', 'card-name', item.name));
      card.appendChild(top);
      card.appendChild(element('span', 'card-en', item.en ? item.en.name : groupNames.get(item.group)));
      card.appendChild(element('span', 'card-description', item.desc));
      listen(card, 'click', () => selectEmotion(item.id));
      $('#emotion-list').appendChild(card);
      cards.set(item.id, card);
    });
  }

  async function copyText(selector, name) {
    const field = $(selector);
    if (navigator.clipboard && navigator.clipboard.writeText) {
      try {
        await navigator.clipboard.writeText(field.value);
        announce(name + '已复制');
        return;
      } catch (_) {
        // The isolated preview may not grant clipboard access; selection works everywhere.
      }
    }
    if (state.destroyed) return;
    field.focus();
    field.select();
    announce('已选中' + name + '，请按 Ctrl+C 或 ⌘C 复制');
  }

  buildLibrary();
  mountBall();

  listen(controls.search, 'input', () => {
    state.search = controls.search.value;
    applyFilter();
  });
  listen(controls.previous, 'click', () => step(-1));
  listen(controls.next, 'click', () => step(1));
  listen(controls.shape, 'change', () => {
    state.shape = controls.shape.value;
    mountBall();
    announce('形态已切换为 ' + shapeNames[state.shape] + ' · 原表情与线稿设置已保留');
  });
  listen(controls.sketch, 'click', () => {
    state.sketch = !state.sketch;
    state.engine.setStyle({ sketch: state.sketch ? 1 : 0 });
    renderControls();
    announce(state.sketch ? '线稿模式已开启' : '线稿模式已关闭');
  });
  listen(controls.play, 'click', () => {
    if (state.reduced || document.hidden) return;
    if (state.playing) {
      pause('动画与巡演已暂停 · 静态预览');
    } else {
      state.playing = true;
      state.engine.setActive(true);
      state.engine.replay();
      renderControls();
      announce('动画播放中 · 同时只运行一个主舞台动画');
    }
  });
  listen(controls.tour, 'click', () => {
    if (state.reduced || document.hidden) return;
    if (state.touring) {
      stopTour();
      announce('巡演已停止 · 保留当前表情动画');
    } else {
      const ids = filtered().map((item) => item.id);
      if (!ids.length) return;
      state.playing = true;
      state.touring = true;
      state.engine.setActive(true);
      state.engine.startTour(ids, 3000);
      renderControls();
      announce('开始巡演 ' + ids.length + ' 个表情 · 每 3 秒切换');
    }
  });
  $('#agent-demo').querySelectorAll('[data-agent-id]').forEach((button) => {
    listen(button, 'click', () => {
      stopTour();
      const item = sdk.config.get(button.dataset.agentId);
      state.engine.handleAIMessage({ emotionId: item.id, tips: '本地模拟：' + item.name });
      if (!state.playing) state.engine.renderStatic();
    });
  });
  listen($('#copy-json'), 'click', () => { void copyText('#message-json', '代理消息 JSON'); });
  listen($('#copy-config'), 'click', () => { void copyText('#configuration-json', '表情配置 JSON'); });
  listen(host, 'keydown', (event) => {
    if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
    event.preventDefault();
    step(event.key === 'ArrowRight' ? 1 : -1);
  });
  listen(host, 'pointermove', (event) => {
    if (!state.playing || state.reduced) return;
    const bounds = host.getBoundingClientRect();
    state.engine.setGaze((event.clientX - bounds.left) / bounds.width * 2 - 1, (event.clientY - bounds.top) / bounds.height * 2 - 1);
  });
  listen(host, 'pointerleave', () => state.engine.clearGaze());
  listen(document, 'visibilitychange', () => {
    if (document.hidden) pause('页面已进入后台 · 动画与巡演已停止');
    else renderControls();
  });
  listen(media, 'change', () => {
    state.reduced = media.matches;
    if (state.reduced) pause('系统减少动态效果已启用 · 切换为静态预览');
    else renderControls();
  });
  listen(window, 'pagehide', (event) => {
    if (state.destroyed) return;
    pause();
    // BFCache keeps the DOM: return to a valid static stage with working controls.
    if (event.persisted) return;
    state.destroyed = true;
    if (state.engine) state.engine.destroy();
    state.engine = null;
    listeners.splice(0).forEach((remove) => remove());
  });
  announce(state.reduced ? '减少动态效果已启用 · 32 套表情可静态选择' : '准备就绪 · 默认静态预览，点击播放可观察表情过渡');
})();`,
  steps: [
    '运行预览，在生命周期、情绪反应、代理工作状态之间筛选，搜索名称或固定 ID。',
    '切换球形、楔形与菱形，在静态预览中对照眼环与线稿，再按下播放观察弹簧插值。',
    '筛选后开始自动巡演；手动选择、暂停、隐藏页面和系统减少动态效果会停止巡演。',
    '点击本地代理状态按钮，对照可复制的 emotionId 消息与当前表情的完整 JSON 配置。',
    '阅读 vendor 四个分层脚本，修改本地 UI 时保留原始版权、社区许可与使用声明。',
    'AI 改写只处理界面文件，服务端逐字保留当前 vendor 引擎与许可；引擎实验可在源码编辑器中手动修改。',
  ],
});

export const emotionBallCreativeItem: CreativeItem = {
  ...recipe,
  files: [
    ...recipe.files.map((file) =>
      file.path === 'README.md'
        ? {
            ...file,
            content:
              file.content +
              '\n\n## 引擎范围与使用限制\n\n本作品只迁入 aora-bot 的 emotion-ball 球形角色引擎及 32 套表情，不包含 mood-mates 目录中云宝 Nimbo、亮亮 Twinkle 的另一套角色与渲染器。三个形态 blob、wedge、gem 共用一个主舞台实例；没有缩略图动画或真实 AI 连接。\n\n' +
              usageNotice +
              '\n原始 LICENSE、NOTICE.md 与商业条款分别完整保存在 LICENSE.txt、NOTICE.md 与 LICENSE-COMMERCIAL.md，NOTICE.txt 也汇总了完整许可与归属。商业条款文件本身不构成任何商业授权。\n\n在舞台上用左右方向键切换表情；“复制消息”导出 emotionId/tips 的本地模拟接口消息，“复制配置”导出当前表情的完整配置。隔离预览可能禁止剪贴板访问，此时按钮会选中文本以便手动复制。\n',
          }
        : file,
    ),
    ...upstream.scripts.map(({ path, content }) => ({ path, content })),
    { path: 'LICENSE.txt', content: upstream.license },
    { path: 'NOTICE.md', content: upstream.notice },
    { path: 'LICENSE-COMMERCIAL.md', content: upstream.commercialLicense },
  ],
};
