import type { ProgrammingFile } from './programming.schemas';
import { visualCreativeItems } from './creative.advanced-visual';
import { productCreativeItems } from './creative.advanced-product';
import { narrativeCreativeItems } from './creative.advanced-narrative';

export type CreativeItem = {
  id: string;
  edition?: 1 | 2;
  title: string;
  category: string;
  tags: string[];
  description: string;
  learningGoals: string[];
  source: {
    repository: string;
    commit: string;
    files: { title: string; url: string }[];
    license: string;
    licenseText: string;
    videos: {
      platform: string;
      title: string;
      url: string;
      repository?: string;
      relation?: 'source' | 'inspiration';
    }[];
    scope: string;
    changes: string;
  };
  files: ProgrammingFile[];
};

// Curated UI-only source studies. Provenance and full notices travel with every project.
const foundationCreativeItems: CreativeItem[] = [
  {
    id: 'foil-tilt',
    title: '折光身份卡',
    category: '空间交互',
    tags: ['CSS 3D', 'Pointer Events', '归一化'],
    description: '移动指针，观察卡片的视差、倾角与柔和反光。',
    learningGoals: [
      '把指针坐标转换为 0～1 的相对坐标',
      '用 rotateX / rotateY 构建透视',
      '分离几何状态与渲染',
    ],
    source: {
      repository: 'https://github.com/micku7zu/vanilla-tilt.js',
      commit: '48f4ee931d4d91dcdd2f91803db67a9f3a16587e',
      license: 'MIT',
      licenseText:
        'MIT License\n\nCopyright (c) 2017 Șandor Sergiu\n\nPermission is hereby granted, free of charge, to any person obtaining a copy\nof this software and associated documentation files (the "Software"), to deal\nin the Software without restriction, including without limitation the rights\nto use, copy, modify, merge, publish, distribute, sublicense, and/or sell\ncopies of the Software, and to permit persons to whom the Software is\nfurnished to do so, subject to the following conditions:\n\nThe above copyright notice and this permission notice shall be included in all\ncopies or substantial portions of the Software.\n\nTHE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR\nIMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,\nFITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE\nAUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER\nLIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,\nOUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE\nSOFTWARE.\n',
      files: [
        {
          title: 'src/vanilla-tilt.js',
          url: 'https://github.com/micku7zu/vanilla-tilt.js/blob/48f4ee931d4d91dcdd2f91803db67a9f3a16587e/src/vanilla-tilt.js',
        },
        {
          title: '完整 MIT 许可',
          url: 'https://github.com/micku7zu/vanilla-tilt.js/blob/48f4ee931d4d91dcdd2f91803db67a9f3a16587e/LICENSE',
        },
      ],
      videos: [],
      scope: '迁入并改写 src/vanilla-tilt.js 的 getValues 坐标归一化、clamp、倾角与 atan2 反光方向公式。',
      changes:
        '以 Pointer Events 和原创 CSS 身份卡替换库的初始化、陀螺仪、全页监听与 DOM glare 构建；不引入上游整库。原库源自 Gijs Rogé 的 Tilt.js。',
    },
    files: [
      {
        path: 'index.html',
        content:
          '<!doctype html>\n<html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>折光身份卡</title><link rel="stylesheet" href="style.css"><script src="app.js" defer></script></head><body><main><header><div><small>CREATIVE LAB / 空间交互</small><h1>折光身份卡</h1><p>移动指针，观察卡片的视差、倾角与柔和反光。</p></div><span class="tag">LOCAL UI STUDY</span></header><section class="stage" id="area"><div class="pass" id="card"><span class="foil"></span><span class="serial">LAB / 028</span><div class="orb"></div><h2>探索者通行证</h2><p>CREATIVE SYSTEMS<br>INTERACTION STUDY</p><span class="barcode">|||| ||||| ||| |||||| ||</span><b>∞</b></div></section><div class="controls"><label>倾斜幅度 <input id="strength" type="range" min="0" max="24" value="14"></label><button id="reset" class="secondary">回到中心</button><output class="readout" id="angles">X 0° · Y 0°</output></div><footer>本地 UI 学习模板 · 无外部资源 · 完整来源与许可见 NOTICE.txt</footer></main></body></html>',
      },
      {
        path: 'style.css',
        content:
          '*{box-sizing:border-box}body{margin:0;font-family:Inter,ui-sans-serif,system-ui,-apple-system,sans-serif;background:var(--bg,#eef3fa);color:var(--ink,#18233a);min-height:100vh}main{width:min(880px,100%);margin:auto;padding:32px 24px 24px}header{display:flex;justify-content:space-between;gap:16px;align-items:start}small{font-size:11px;letter-spacing:.2em;text-transform:uppercase;color:var(--accent,#4866f5);font-weight:800}h1{font-size:clamp(26px,5vw,42px);letter-spacing:-.04em;margin:10px 0}p{line-height:1.65;color:var(--muted,#617087)}.tag{font-size:11px;padding:7px 11px;border:1px solid currentColor;border-radius:30px;white-space:nowrap}.stage{position:relative;min-height:320px;display:grid;place-items:center;overflow:hidden;border-radius:24px;margin:22px 0;background:var(--surface,#fff);border:1px solid #18233a14}.controls{display:flex;gap:12px;flex-wrap:wrap;align-items:center}button,select,input{font:inherit}button{cursor:pointer;border:0;border-radius:10px;padding:11px 18px;background:var(--accent,#4866f5);color:#fff;font-weight:700}button.secondary{color:var(--ink,#18233a);background:#18233a0d}button:focus-visible,input:focus-visible,select:focus-visible{outline:3px solid #8aacf9;outline-offset:3px}label{font-size:13px;display:flex;gap:10px;align-items:center}input[type=range]{accent-color:var(--accent,#4866f5);max-width:100%}.readout{font-variant-numeric:tabular-nums;font-size:13px;color:var(--muted,#617087)}footer{margin-top:24px;font-size:11px;color:var(--muted,#617087)}svg,canvas{display:block;max-width:100%}@media(max-width:520px){main{padding:24px 16px}header{display:block}.tag{display:inline-block;margin-top:8px}.stage{min-height:300px}.controls{gap:10px}}@media(prefers-reduced-motion:reduce){*,*::before,*::after{animation:none!important;transition:none!important;scroll-behavior:auto!important}}\nbody{--bg:#e9eee9;--ink:#1b3030;--muted:#5c7470;--accent:#407b6c}.stage{background:radial-gradient(ellipse,#fff8,#d6e2dc);perspective:1000px}.pass{position:relative;width:290px;height:240px;border-radius:22px;padding:28px;background:linear-gradient(130deg,#e9edbc,#b7d8cb 50%,#bdb6de);box-shadow:0 24px 50px #1b303029;transform-style:preserve-3d;transition:transform .16s ease;overflow:hidden}.serial{font-size:11px;letter-spacing:.3em}.pass h2{font-size:25px;position:relative;margin-top:55px}.pass p{font-size:10px;letter-spacing:.15em;color:#31554e}.pass b{position:absolute;right:25px;bottom:30px;font-size:38px}.orb{position:absolute;width:100px;height:100px;right:26px;top:28px;border:1px solid #294d4344;border-radius:50%;background:repeating-radial-gradient(circle,#fff0 0 7px,#fff8 8px 9px)}.foil{position:absolute;inset:-80%;background:linear-gradient(var(--angle,45deg),transparent 40%,#fff8 50%,transparent 60%);opacity:var(--shine,.35);pointer-events:none}.barcode{position:absolute;bottom:18px;font-size:12px}',
      },
      {
        path: 'app.js',
        content:
          "// UI source study: https://github.com/micku7zu/vanilla-tilt.js @ 48f4ee931d4d91dcdd2f91803db67a9f3a16587e\n// 迁入并改写 src/vanilla-tilt.js 的 getValues 坐标归一化、clamp、倾角与 atan2 反光方向公式。\n// See NOTICE.txt for complete upstream copyright and license.\n'use strict';\nconst reducedMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;\nconst area=document.querySelector('#area'),card=document.querySelector('#card'),strength=document.querySelector('#strength'),angles=document.querySelector('#angles');\n// Adapted from vanilla-tilt getValues: relative coordinates, clamp, axis mapping and glare angle.\nfunction render(event){const rect=card.getBoundingClientRect();const x=Math.min(Math.max((event.clientX-rect.left)/rect.width,0),1),y=Math.min(Math.max((event.clientY-rect.top)/rect.height,0),1);const max=Number(strength.value);const tiltX=max-x*max*2,tiltY=y*max*2-max;const angle=Math.atan2(event.clientX-(rect.left+rect.width/2),-(event.clientY-(rect.top+rect.height/2)))*180/Math.PI;if(!reducedMotion)card.style.transform='rotateX('+tiltY+'deg) rotateY('+tiltX+'deg)';card.style.setProperty('--angle',angle+'deg');card.style.setProperty('--shine',String(.15+y*.45));angles.textContent='X '+tiltX.toFixed(1)+'° · Y '+tiltY.toFixed(1)+'°';}\nfunction reset(){card.style.transform='none';card.style.setProperty('--shine','.35');angles.textContent='X 0° · Y 0°';}area.addEventListener('pointermove',render);area.addEventListener('pointerleave',reset);document.querySelector('#reset').addEventListener('click',reset);",
      },
      {
        path: 'README.md',
        content:
          '# 折光身份卡\n\n移动指针，观察卡片的视差、倾角与柔和反光。\n\n## 学习步骤\n\n1. 把指针坐标转换为 0～1 的相对坐标。\n2. 用 rotateX / rotateY 构建透视。\n3. 分离几何状态与渲染。\n\n## 文件与运行\n\n点击工作区“运行预览”。index.html 是结构，style.css 是布局，app.js 是交互。所有演示数据与图形在浏览器中生成，不请求外网、读取凭证或运行服务器。动画尊重系统的减少动态效果设置。\n\n## 来源与范围\n\nhttps://github.com/micku7zu/vanilla-tilt.js\n\n固定版本：48f4ee931d4d91dcdd2f91803db67a9f3a16587e\n\n迁入并改写 src/vanilla-tilt.js 的 getValues 坐标归一化、clamp、倾角与 atan2 反光方向公式。\n\n以 Pointer Events 和原创 CSS 身份卡替换库的初始化、陀螺仪、全页监听与 DOM glare 构建；不引入上游整库。原库源自 Gijs Rogé 的 Tilt.js。\n\n完整许可与归属见 NOTICE.txt，继续改写请保留该文件。\n',
      },
      {
        path: 'NOTICE.txt',
        content:
          '来源: https://github.com/micku7zu/vanilla-tilt.js\n固定版本: 48f4ee931d4d91dcdd2f91803db67a9f3a16587e\n迁入范围: 迁入并改写 src/vanilla-tilt.js 的 getValues 坐标归一化、clamp、倾角与 atan2 反光方向公式。\n修改说明: 以 Pointer Events 和原创 CSS 身份卡替换库的初始化、陀螺仪、全页监听与 DOM glare 构建；不引入上游整库。原库源自 Gijs Rogé 的 Tilt.js。\n\n完整上游许可:\nMIT License\n\nCopyright (c) 2017 Șandor Sergiu\n\nPermission is hereby granted, free of charge, to any person obtaining a copy\nof this software and associated documentation files (the "Software"), to deal\nin the Software without restriction, including without limitation the rights\nto use, copy, modify, merge, publish, distribute, sublicense, and/or sell\ncopies of the Software, and to permit persons to whom the Software is\nfurnished to do so, subject to the following conditions:\n\nThe above copyright notice and this permission notice shall be included in all\ncopies or substantial portions of the Software.\n\nTHE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR\nIMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,\nFITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE\nAUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER\nLIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,\nOUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE\nSOFTWARE.\n',
      },
    ],
  },
  {
    id: 'shape-morph',
    title: '形态铸造台',
    category: '图形动画',
    tags: ['SVG', '插值', '几何'],
    description: '在圆环、星芒和花瓣之间拖动，探索顶点插值的连续变化。',
    learningGoals: [
      '让轮廓使用相同数量的顶点',
      '理解 pointAlong 与 interpolatePoint 的线性插值',
      '将点列表渲染为 SVG 路径',
    ],
    source: {
      repository: 'https://github.com/veltman/flubber',
      commit: '0cadadf3eb15cd5b2ec7c45c70601ff88b76a6c3',
      license: 'MIT',
      licenseText:
        'MIT License\n\nCopyright (c) 2017 Noah Veltman\n\nPermission is hereby granted, free of charge, to any person obtaining a copy of this software and associated documentation files (the "Software"), to deal in the Software without restriction, including without limitation the rights to use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of the Software, and to permit persons to whom the Software is furnished to do so, subject to the following conditions:\n\nThe above copyright notice and this permission notice shall be included in all copies or substantial portions of the Software.\n\nTHE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.\n',
      files: [
        {
          title: 'src/math.js',
          url: 'https://github.com/veltman/flubber/blob/0cadadf3eb15cd5b2ec7c45c70601ff88b76a6c3/src/math.js',
        },
        {
          title: 'src/rotate.js',
          url: 'https://github.com/veltman/flubber/blob/0cadadf3eb15cd5b2ec7c45c70601ff88b76a6c3/src/rotate.js',
        },
        {
          title: '完整 MIT 许可',
          url: 'https://github.com/veltman/flubber/blob/0cadadf3eb15cd5b2ec7c45c70601ff88b76a6c3/LICENSE',
        },
      ],
      videos: [
        {
          platform: 'YouTube',
          title: 'Noah Veltman · OpenVisConf 2017 形状插值演讲（上游 README 的 Video 链接）',
          url: 'https://www.youtube.com/watch?v=PLc1y-gim_0',
        },
      ],
      scope: '迁入 src/math.js 的 pointAlong 函数；参考 interpolatePoint 的等点数线性插值接口。',
      changes:
        '原创生成 80 个均匀极角顶点、三个目标轮廓和静态 SVG 工作台；不迁入 flubber 的路径解析、轮廓重采样、D3 依赖或多形状匹配。',
    },
    files: [
      {
        path: 'index.html',
        content:
          '<!doctype html>\n<html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>形态铸造台</title><link rel="stylesheet" href="style.css"><script src="app.js" defer></script></head><body><main><header><div><small>CREATIVE LAB / 图形动画</small><h1>形态铸造台</h1><p>在圆环、星芒和花瓣之间拖动，探索顶点插值的连续变化。</p></div><span class="tag">LOCAL UI STUDY</span></header><section class="stage"><svg viewBox="0 0 400 320" width="440" height="320" aria-label="插值图形"><defs><linearGradient id="ink" x2="1" y2="1"><stop stop-color="#ee6540"/><stop offset="1" stop-color="#c33746"/></linearGradient></defs><path id="shape" fill="url(#ink)" stroke="#922e28" stroke-width="2"/><circle cx="200" cy="160" r="8" fill="#fff"/></svg></section><div class="controls"><label>目标形状 <select id="target"><option value="star">星芒</option><option value="flower">花瓣</option><option value="square">圆角方形</option></select></label><label>形态进度 <input id="progress" type="range" min="0" max="100" value="60"></label><output class="readout" id="readout">60%</output></div><footer>本地 UI 学习模板 · 无外部资源 · 完整来源与许可见 NOTICE.txt</footer></main></body></html>',
      },
      {
        path: 'style.css',
        content:
          '*{box-sizing:border-box}body{margin:0;font-family:Inter,ui-sans-serif,system-ui,-apple-system,sans-serif;background:var(--bg,#eef3fa);color:var(--ink,#18233a);min-height:100vh}main{width:min(880px,100%);margin:auto;padding:32px 24px 24px}header{display:flex;justify-content:space-between;gap:16px;align-items:start}small{font-size:11px;letter-spacing:.2em;text-transform:uppercase;color:var(--accent,#4866f5);font-weight:800}h1{font-size:clamp(26px,5vw,42px);letter-spacing:-.04em;margin:10px 0}p{line-height:1.65;color:var(--muted,#617087)}.tag{font-size:11px;padding:7px 11px;border:1px solid currentColor;border-radius:30px;white-space:nowrap}.stage{position:relative;min-height:320px;display:grid;place-items:center;overflow:hidden;border-radius:24px;margin:22px 0;background:var(--surface,#fff);border:1px solid #18233a14}.controls{display:flex;gap:12px;flex-wrap:wrap;align-items:center}button,select,input{font:inherit}button{cursor:pointer;border:0;border-radius:10px;padding:11px 18px;background:var(--accent,#4866f5);color:#fff;font-weight:700}button.secondary{color:var(--ink,#18233a);background:#18233a0d}button:focus-visible,input:focus-visible,select:focus-visible{outline:3px solid #8aacf9;outline-offset:3px}label{font-size:13px;display:flex;gap:10px;align-items:center}input[type=range]{accent-color:var(--accent,#4866f5);max-width:100%}.readout{font-variant-numeric:tabular-nums;font-size:13px;color:var(--muted,#617087)}footer{margin-top:24px;font-size:11px;color:var(--muted,#617087)}svg,canvas{display:block;max-width:100%}@media(max-width:520px){main{padding:24px 16px}header{display:block}.tag{display:inline-block;margin-top:8px}.stage{min-height:300px}.controls{gap:10px}}@media(prefers-reduced-motion:reduce){*,*::before,*::after{animation:none!important;transition:none!important;scroll-behavior:auto!important}}\nbody{--bg:#f8f0e3;--ink:#27374e;--muted:#816c57;--accent:#d65137}.stage{background:radial-gradient(circle,#fff9,#eadccb);background-size:auto}.stage svg{filter:drop-shadow(0 16px 18px #b64d3a38)}select{padding:8px;border:1px solid #cebba5;border-radius:8px;background:#fff}',
      },
      {
        path: 'app.js',
        content:
          "// UI source study: https://github.com/veltman/flubber @ 0cadadf3eb15cd5b2ec7c45c70601ff88b76a6c3\n// 迁入 src/math.js 的 pointAlong 函数；参考 interpolatePoint 的等点数线性插值接口。\n// See NOTICE.txt for complete upstream copyright and license.\n'use strict';\nconst reducedMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;\nconst shape=document.querySelector('#shape'),progress=document.querySelector('#progress'),target=document.querySelector('#target');const n=80;const circle=Array.from({length:n},(_,i)=>{const a=i/n*Math.PI*2;return[200+105*Math.cos(a),160+105*Math.sin(a)];});\n// pointAlong is retained from flubber src/math.js; SVG path conversion is locally implemented.\nfunction pointAlong(a,b,pct){return[a[0]+(b[0]-a[0])*pct,a[1]+(b[1]-a[1])*pct];}\nfunction draw(){const t=Number(progress.value)/100;const points=circle.map((p,i)=>{const a=i/n*Math.PI*2;let r=target.value==='star'?80+35*Math.cos(a*5):target.value==='flower'?95+20*Math.cos(a*7):100/Math.max(Math.abs(Math.cos(a)),Math.abs(Math.sin(a)));return pointAlong(p,[200+r*Math.cos(a),160+r*Math.sin(a)],t);});shape.setAttribute('d',points.map((p,i)=>(i?'L':'M')+p.join(',')).join('')+'Z');document.querySelector('#readout').textContent=Math.round(t*100)+'%';}progress.addEventListener('input',draw);target.addEventListener('change',draw);draw();",
      },
      {
        path: 'README.md',
        content:
          '# 形态铸造台\n\n在圆环、星芒和花瓣之间拖动，探索顶点插值的连续变化。\n\n## 学习步骤\n\n1. 让轮廓使用相同数量的顶点。\n2. 理解 pointAlong 与 interpolatePoint 的线性插值。\n3. 将点列表渲染为 SVG 路径。\n\n## 文件与运行\n\n点击工作区“运行预览”。index.html 是结构，style.css 是布局，app.js 是交互。所有演示数据与图形在浏览器中生成，不请求外网、读取凭证或运行服务器。动画尊重系统的减少动态效果设置。\n\n## 来源与范围\n\nhttps://github.com/veltman/flubber\n\n固定版本：0cadadf3eb15cd5b2ec7c45c70601ff88b76a6c3\n\n迁入 src/math.js 的 pointAlong 函数；参考 interpolatePoint 的等点数线性插值接口。\n\n原创生成 80 个均匀极角顶点、三个目标轮廓和静态 SVG 工作台；不迁入 flubber 的路径解析、轮廓重采样、D3 依赖或多形状匹配。\n\n完整许可与归属见 NOTICE.txt，继续改写请保留该文件。\n',
      },
      {
        path: 'NOTICE.txt',
        content:
          '来源: https://github.com/veltman/flubber\n固定版本: 0cadadf3eb15cd5b2ec7c45c70601ff88b76a6c3\n迁入范围: 迁入 src/math.js 的 pointAlong 函数；参考 interpolatePoint 的等点数线性插值接口。\n修改说明: 原创生成 80 个均匀极角顶点、三个目标轮廓和静态 SVG 工作台；不迁入 flubber 的路径解析、轮廓重采样、D3 依赖或多形状匹配。\n\n完整上游许可:\nMIT License\n\nCopyright (c) 2017 Noah Veltman\n\nPermission is hereby granted, free of charge, to any person obtaining a copy of this software and associated documentation files (the "Software"), to deal in the Software without restriction, including without limitation the rights to use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of the Software, and to permit persons to whom the Software is furnished to do so, subject to the following conditions:\n\nThe above copyright notice and this permission notice shall be included in all copies or substantial portions of the Software.\n\nTHE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.\n',
      },
    ],
  },
  {
    id: 'drag-playlist',
    title: '可拖拽灵感清单',
    category: '交互组件',
    tags: ['排序', 'Pointer Events', '键盘操作'],
    description: '抓住拖动柄重新排序，也可以用上下按钮完成同样的操作。',
    learningGoals: [
      '将 UI 顺序与数组顺序保持同步',
      '使用 Pointer Capture 支持鼠标和触摸',
      '为拖动交互提供键盘替代',
    ],
    source: {
      repository: 'https://github.com/SortableJS/Sortable',
      commit: '48b626bbc61afbb0f179730c1dd3cca3dcc8b788',
      license: 'MIT',
      licenseText:
        'MIT License\n\nCopyright (c) 2019 All contributors to Sortable\n\nPermission is hereby granted, free of charge, to any person obtaining a copy\nof this software and associated documentation files (the "Software"), to deal\nin the Software without restriction, including without limitation the rights\nto use, copy, modify, merge, publish, distribute, sublicense, and/or sell\ncopies of the Software, and to permit persons to whom the Software is\nfurnished to do so, subject to the following conditions:\n\nThe above copyright notice and this permission notice shall be included in all\ncopies or substantial portions of the Software.\n\nTHE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR\nIMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,\nFITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE\nAUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER\nLIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,\nOUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE\nSOFTWARE.\n',
      files: [
        {
          title: 'src/utils.js',
          url: 'https://github.com/SortableJS/Sortable/blob/48b626bbc61afbb0f179730c1dd3cca3dcc8b788/src/utils.js',
        },
        {
          title: '完整 MIT 许可',
          url: 'https://github.com/SortableJS/Sortable/blob/48b626bbc61afbb0f179730c1dd3cca3dcc8b788/LICENSE',
        },
      ],
      videos: [],
      scope:
        '参考 SortableJS README 的 drag handle、重排与触摸交互模式；本模板排序与 Pointer Capture 代码为独立实现，没有复制 SortableJS 库。',
      changes:
        '只保留四项单列表视觉交互；去除多列表、插件、自动滚动、持久化与外部依赖，新增明确的上下按钮替代拖拽。',
    },
    files: [
      {
        path: 'index.html',
        content:
          '<!doctype html>\n<html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>可拖拽灵感清单</title><link rel="stylesheet" href="style.css"><script src="app.js" defer></script></head><body><main><header><div><small>CREATIVE LAB / 交互组件</small><h1>可拖拽灵感清单</h1><p>抓住拖动柄重新排序，也可以用上下按钮完成同样的操作。</p></div><span class="tag">LOCAL UI STUDY</span></header><section class="stage"><ol id="list" aria-label="灵感清单"></ol></section><div class="controls"><button id="shuffle">打乱顺序</button><output id="order" class="readout" aria-live="polite"></output></div><footer>本地 UI 学习模板 · 无外部资源 · 完整来源与许可见 NOTICE.txt</footer></main></body></html>',
      },
      {
        path: 'style.css',
        content:
          '*{box-sizing:border-box}body{margin:0;font-family:Inter,ui-sans-serif,system-ui,-apple-system,sans-serif;background:var(--bg,#eef3fa);color:var(--ink,#18233a);min-height:100vh}main{width:min(880px,100%);margin:auto;padding:32px 24px 24px}header{display:flex;justify-content:space-between;gap:16px;align-items:start}small{font-size:11px;letter-spacing:.2em;text-transform:uppercase;color:var(--accent,#4866f5);font-weight:800}h1{font-size:clamp(26px,5vw,42px);letter-spacing:-.04em;margin:10px 0}p{line-height:1.65;color:var(--muted,#617087)}.tag{font-size:11px;padding:7px 11px;border:1px solid currentColor;border-radius:30px;white-space:nowrap}.stage{position:relative;min-height:320px;display:grid;place-items:center;overflow:hidden;border-radius:24px;margin:22px 0;background:var(--surface,#fff);border:1px solid #18233a14}.controls{display:flex;gap:12px;flex-wrap:wrap;align-items:center}button,select,input{font:inherit}button{cursor:pointer;border:0;border-radius:10px;padding:11px 18px;background:var(--accent,#4866f5);color:#fff;font-weight:700}button.secondary{color:var(--ink,#18233a);background:#18233a0d}button:focus-visible,input:focus-visible,select:focus-visible{outline:3px solid #8aacf9;outline-offset:3px}label{font-size:13px;display:flex;gap:10px;align-items:center}input[type=range]{accent-color:var(--accent,#4866f5);max-width:100%}.readout{font-variant-numeric:tabular-nums;font-size:13px;color:var(--muted,#617087)}footer{margin-top:24px;font-size:11px;color:var(--muted,#617087)}svg,canvas{display:block;max-width:100%}@media(max-width:520px){main{padding:24px 16px}header{display:block}.tag{display:inline-block;margin-top:8px}.stage{min-height:300px}.controls{gap:10px}}@media(prefers-reduced-motion:reduce){*,*::before,*::after{animation:none!important;transition:none!important;scroll-behavior:auto!important}}\nbody{--bg:#f0edf9;--accent:#7359b9;--ink:#392b50}.stage{padding:24px;background:#e6e0f2}ol{list-style:none;padding:0;margin:0;width:min(430px,100%)}li{display:flex;align-items:center;gap:12px;margin:10px 0;padding:16px;background:#fff;border-radius:14px;box-shadow:0 4px 10px #392b5010}li .handle{cursor:grab;touch-action:none;background:none;color:#9f8fba;padding:6px;font-size:22px}li span{flex:1;font-weight:600}li .move{padding:6px 10px;font-size:13px;color:#7359b9;background:#f2eef9}.selected{outline:2px solid #7359b9}',
      },
      {
        path: 'app.js',
        content:
          "// UI source study: https://github.com/SortableJS/Sortable @ 48b626bbc61afbb0f179730c1dd3cca3dcc8b788\n// 参考 SortableJS README 的 drag handle、重排与触摸交互模式；本模板排序与 Pointer Capture 代码为独立实现，没有复制 SortableJS 库。\n// See NOTICE.txt for complete upstream copyright and license.\n'use strict';\nconst reducedMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;\nconst list=document.querySelector('#list');let items=['收集视觉参考','绘制页面草图','实现交互原型','验证移动端布局'];let selected=null;function render(){list.replaceChildren();items.forEach((text,i)=>{const li=document.createElement('li');const h=document.createElement('button');h.className='handle';h.textContent='⠿';h.setAttribute('aria-label','拖动 '+text);const label=document.createElement('span');label.textContent=text;li.append(h,label);for(const [label,delta] of [['↑',-1],['↓',1]]){const b=document.createElement('button');b.className='move';b.textContent=label;b.setAttribute('aria-label',text+(delta<0?'上移':'下移'));b.disabled=i+delta<0||i+delta>=items.length;b.addEventListener('click',()=>move(i,i+delta));li.append(b);}h.addEventListener('pointerdown',e=>{selected=i;li.classList.add('selected');h.setPointerCapture(e.pointerId);});h.addEventListener('pointerup',e=>{if(selected===null)return;const rows=[...list.children];const target=rows.findIndex(row=>{const r=row.getBoundingClientRect();return e.clientY>=r.top&&e.clientY<=r.bottom;});move(selected,target<0?selected:target);selected=null;});h.addEventListener('pointercancel',()=>{selected=null;render();});list.append(li);});document.querySelector('#order').textContent='当前顺序：'+items.map((_,i)=>i+1).join(' → ');}function move(from,to){if(to<0||to>=items.length)return;const [value]=items.splice(from,1);items.splice(to,0,value);render();}document.querySelector('#shuffle').addEventListener('click',()=>{items.reverse();render();});render();",
      },
      {
        path: 'README.md',
        content:
          '# 可拖拽灵感清单\n\n抓住拖动柄重新排序，也可以用上下按钮完成同样的操作。\n\n## 学习步骤\n\n1. 将 UI 顺序与数组顺序保持同步。\n2. 使用 Pointer Capture 支持鼠标和触摸。\n3. 为拖动交互提供键盘替代。\n\n## 文件与运行\n\n点击工作区“运行预览”。index.html 是结构，style.css 是布局，app.js 是交互。所有演示数据与图形在浏览器中生成，不请求外网、读取凭证或运行服务器。动画尊重系统的减少动态效果设置。\n\n## 来源与范围\n\nhttps://github.com/SortableJS/Sortable\n\n固定版本：48b626bbc61afbb0f179730c1dd3cca3dcc8b788\n\n参考 SortableJS README 的 drag handle、重排与触摸交互模式；本模板排序与 Pointer Capture 代码为独立实现，没有复制 SortableJS 库。\n\n只保留四项单列表视觉交互；去除多列表、插件、自动滚动、持久化与外部依赖，新增明确的上下按钮替代拖拽。\n\n完整许可与归属见 NOTICE.txt，继续改写请保留该文件。\n',
      },
      {
        path: 'NOTICE.txt',
        content:
          '来源: https://github.com/SortableJS/Sortable\n固定版本: 48b626bbc61afbb0f179730c1dd3cca3dcc8b788\n迁入范围: 参考 SortableJS README 的 drag handle、重排与触摸交互模式；本模板排序与 Pointer Capture 代码为独立实现，没有复制 SortableJS 库。\n修改说明: 只保留四项单列表视觉交互；去除多列表、插件、自动滚动、持久化与外部依赖，新增明确的上下按钮替代拖拽。\n\n完整上游许可:\nMIT License\n\nCopyright (c) 2019 All contributors to Sortable\n\nPermission is hereby granted, free of charge, to any person obtaining a copy\nof this software and associated documentation files (the "Software"), to deal\nin the Software without restriction, including without limitation the rights\nto use, copy, modify, merge, publish, distribute, sublicense, and/or sell\ncopies of the Software, and to permit persons to whom the Software is\nfurnished to do so, subject to the following conditions:\n\nThe above copyright notice and this permission notice shall be included in all\ncopies or substantial portions of the Software.\n\nTHE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR\nIMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,\nFITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE\nAUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER\nLIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,\nOUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE\nSOFTWARE.\n',
      },
    ],
  },
  {
    id: 'particle-network',
    title: '星点连接场',
    category: 'Canvas 实验',
    tags: ['Canvas', '粒子', '距离阈值'],
    description: '调整连线半径，观察静态点云如何构成动态网络。',
    learningGoals: ['用欧氏距离判断邻近粒子', '将距离映射为连线透明度', '控制粒子数并暂停无用动画'],
    source: {
      repository: 'https://github.com/VincentGarreau/particles.js',
      commit: 'd01286d6dcd61f497d07cc62bd48e692f6508ad5',
      license: 'MIT',
      licenseText:
        'The MIT License (MIT)\n\nCopyright (c) 2015, Vincent Garreau\n\nPermission is hereby granted, free of charge, to any person obtaining a copy\nof this software and associated documentation files (the "Software"), to deal\nin the Software without restriction, including without limitation the rights\nto use, copy, modify, merge, publish, distribute, sublicense, and/or sell\ncopies of the Software, and to permit persons to whom the Software is\nfurnished to do so, subject to the following conditions:\n\nThe above copyright notice and this permission notice shall be included in\nall copies or substantial portions of the Software.\n\nTHE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR\nIMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,\nFITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE\nAUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER\nLIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,\nOUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN\nTHE SOFTWARE.\n',
      files: [
        {
          title: 'particles.js',
          url: 'https://github.com/VincentGarreau/particles.js/blob/d01286d6dcd61f497d07cc62bd48e692f6508ad5/particles.js',
        },
        {
          title: '完整 MIT 许可',
          url: 'https://github.com/VincentGarreau/particles.js/blob/d01286d6dcd61f497d07cc62bd48e692f6508ad5/LICENSE.md',
        },
      ],
      videos: [],
      scope: '迁入并简化 particles.js 中 linkParticles 的 dx/dy 欧氏距离与距离衰减透明度计算。',
      changes:
        '原创固定 48 个粒子及控制面板；不迁入图片加载、配置解析、插件与整库。将持续动画限制为约 40 帧/秒，并在页面不可见时暂停。',
    },
    files: [
      {
        path: 'index.html',
        content:
          '<!doctype html>\n<html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>星点连接场</title><link rel="stylesheet" href="style.css"><script src="app.js" defer></script></head><body><main><header><div><small>CREATIVE LAB / Canvas 实验</small><h1>星点连接场</h1><p>调整连线半径，观察静态点云如何构成动态网络。</p></div><span class="tag">LOCAL UI STUDY</span></header><section class="stage"><canvas id="canvas" width="760" height="340" aria-label="粒子连接网络"></canvas></section><div class="controls"><label>连线半径 <input id="radius" type="range" min="35" max="180" value="105"></label><button id="pause">暂停运动</button><button id="reseed" class="secondary">重新分布</button><output id="status" class="readout">48 个粒子</output></div><footer>本地 UI 学习模板 · 无外部资源 · 完整来源与许可见 NOTICE.txt</footer></main></body></html>',
      },
      {
        path: 'style.css',
        content:
          '*{box-sizing:border-box}body{margin:0;font-family:Inter,ui-sans-serif,system-ui,-apple-system,sans-serif;background:var(--bg,#eef3fa);color:var(--ink,#18233a);min-height:100vh}main{width:min(880px,100%);margin:auto;padding:32px 24px 24px}header{display:flex;justify-content:space-between;gap:16px;align-items:start}small{font-size:11px;letter-spacing:.2em;text-transform:uppercase;color:var(--accent,#4866f5);font-weight:800}h1{font-size:clamp(26px,5vw,42px);letter-spacing:-.04em;margin:10px 0}p{line-height:1.65;color:var(--muted,#617087)}.tag{font-size:11px;padding:7px 11px;border:1px solid currentColor;border-radius:30px;white-space:nowrap}.stage{position:relative;min-height:320px;display:grid;place-items:center;overflow:hidden;border-radius:24px;margin:22px 0;background:var(--surface,#fff);border:1px solid #18233a14}.controls{display:flex;gap:12px;flex-wrap:wrap;align-items:center}button,select,input{font:inherit}button{cursor:pointer;border:0;border-radius:10px;padding:11px 18px;background:var(--accent,#4866f5);color:#fff;font-weight:700}button.secondary{color:var(--ink,#18233a);background:#18233a0d}button:focus-visible,input:focus-visible,select:focus-visible{outline:3px solid #8aacf9;outline-offset:3px}label{font-size:13px;display:flex;gap:10px;align-items:center}input[type=range]{accent-color:var(--accent,#4866f5);max-width:100%}.readout{font-variant-numeric:tabular-nums;font-size:13px;color:var(--muted,#617087)}footer{margin-top:24px;font-size:11px;color:var(--muted,#617087)}svg,canvas{display:block;max-width:100%}@media(max-width:520px){main{padding:24px 16px}header{display:block}.tag{display:inline-block;margin-top:8px}.stage{min-height:300px}.controls{gap:10px}}@media(prefers-reduced-motion:reduce){*,*::before,*::after{animation:none!important;transition:none!important;scroll-behavior:auto!important}}\nbody{--bg:#101b35;--surface:#0b1325;--ink:#f0f5ff;--muted:#9aafd0;--accent:#6488ed}.stage{background:radial-gradient(ellipse at center,#152947,#0b1325)}canvas{width:100%;height:340px}button.secondary{background:#ffffff15;color:#c8daf8}',
      },
      {
        path: 'app.js',
        content:
          "// UI source study: https://github.com/VincentGarreau/particles.js @ d01286d6dcd61f497d07cc62bd48e692f6508ad5\n// 迁入并简化 particles.js 中 linkParticles 的 dx/dy 欧氏距离与距离衰减透明度计算。\n// See NOTICE.txt for complete upstream copyright and license.\n'use strict';\nconst reducedMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;\nconst canvas=document.querySelector('#canvas'),ctx=canvas.getContext('2d'),radius=document.querySelector('#radius');let nodes=[],running=!reducedMotion,raf=0,last=0;function seed(){nodes=Array.from({length:48},()=>({x:Math.random()*760,y:Math.random()*340,vx:(Math.random()-.5)*.5,vy:(Math.random()-.5)*.5}));draw(false);}function draw(update){ctx.clearRect(0,0,760,340);if(update)nodes.forEach(p=>{p.x+=p.vx;p.y+=p.vy;if(p.x<0||p.x>760)p.vx*=-1;if(p.y<0||p.y>340)p.vy*=-1;});for(let i=0;i<nodes.length;i++){const p=nodes[i];for(let j=i+1;j<nodes.length;j++){const q=nodes[j];const dx=p.x-q.x,dy=p.y-q.y,dist=Math.sqrt(dx*dx+dy*dy);const max=Number(radius.value);if(dist<=max){const opacity=.6-(dist/(1/.6))/max;ctx.strokeStyle='rgba(116,173,242,'+opacity+')';ctx.beginPath();ctx.moveTo(p.x,p.y);ctx.lineTo(q.x,q.y);ctx.stroke();}}ctx.fillStyle='#b9d6ff';ctx.beginPath();ctx.arc(p.x,p.y,2.3,0,Math.PI*2);ctx.fill();}}function frame(time){if(!running||document.hidden){raf=0;return;}if(time-last>24){draw(true);last=time;}raf=requestAnimationFrame(frame);}function sync(){document.querySelector('#pause').textContent=running?'暂停运动':'继续运动';if(running&&!raf&&!document.hidden)raf=requestAnimationFrame(frame);}radius.addEventListener('input',()=>draw(false));document.querySelector('#pause').addEventListener('click',()=>{if(reducedMotion){document.querySelector('#status').textContent='减少动态效果已启用，保留静态网络';return;}running=!running;sync();});document.querySelector('#reseed').addEventListener('click',seed);document.addEventListener('visibilitychange',sync);seed();sync();",
      },
      {
        path: 'README.md',
        content:
          '# 星点连接场\n\n调整连线半径，观察静态点云如何构成动态网络。\n\n## 学习步骤\n\n1. 用欧氏距离判断邻近粒子。\n2. 将距离映射为连线透明度。\n3. 控制粒子数并暂停无用动画。\n\n## 文件与运行\n\n点击工作区“运行预览”。index.html 是结构，style.css 是布局，app.js 是交互。所有演示数据与图形在浏览器中生成，不请求外网、读取凭证或运行服务器。动画尊重系统的减少动态效果设置。\n\n## 来源与范围\n\nhttps://github.com/VincentGarreau/particles.js\n\n固定版本：d01286d6dcd61f497d07cc62bd48e692f6508ad5\n\n迁入并简化 particles.js 中 linkParticles 的 dx/dy 欧氏距离与距离衰减透明度计算。\n\n原创固定 48 个粒子及控制面板；不迁入图片加载、配置解析、插件与整库。将持续动画限制为约 40 帧/秒，并在页面不可见时暂停。\n\n完整许可与归属见 NOTICE.txt，继续改写请保留该文件。\n',
      },
      {
        path: 'NOTICE.txt',
        content:
          '来源: https://github.com/VincentGarreau/particles.js\n固定版本: d01286d6dcd61f497d07cc62bd48e692f6508ad5\n迁入范围: 迁入并简化 particles.js 中 linkParticles 的 dx/dy 欧氏距离与距离衰减透明度计算。\n修改说明: 原创固定 48 个粒子及控制面板；不迁入图片加载、配置解析、插件与整库。将持续动画限制为约 40 帧/秒，并在页面不可见时暂停。\n\n完整上游许可:\nThe MIT License (MIT)\n\nCopyright (c) 2015, Vincent Garreau\n\nPermission is hereby granted, free of charge, to any person obtaining a copy\nof this software and associated documentation files (the "Software"), to deal\nin the Software without restriction, including without limitation the rights\nto use, copy, modify, merge, publish, distribute, sublicense, and/or sell\ncopies of the Software, and to permit persons to whom the Software is\nfurnished to do so, subject to the following conditions:\n\nThe above copyright notice and this permission notice shall be included in\nall copies or substantial portions of the Software.\n\nTHE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR\nIMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,\nFITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE\nAUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER\nLIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,\nOUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN\nTHE SOFTWARE.\n',
      },
    ],
  },
  {
    id: 'confetti-launch',
    title: '纸屑发射台',
    category: 'Canvas 实验',
    tags: ['粒子运动', '衰减', '动画生命周期'],
    description: '点击发射，从初始角度、速度衰减和重力理解粒子动画。',
    learningGoals: [
      '用角度与速度分解水平和垂直位移',
      '用 decay 模拟空气阻力',
      '在粒子结束后停止 requestAnimationFrame',
    ],
    source: {
      repository: 'https://github.com/catdad/canvas-confetti',
      commit: '20eebad51dde793070c373d594099a7ed8d96e22',
      license: 'ISC',
      licenseText:
        'ISC License\n\nCopyright (c) 2020, Kiril Vatev\n\nPermission to use, copy, modify, and/or distribute this software for any\npurpose with or without fee is hereby granted, provided that the above\ncopyright notice and this permission notice appear in all copies.\n\nTHE SOFTWARE IS PROVIDED "AS IS" AND THE AUTHOR DISCLAIMS ALL WARRANTIES\nWITH REGARD TO THIS SOFTWARE INCLUDING ALL IMPLIED WARRANTIES OF\nMERCHANTABILITY AND FITNESS. IN NO EVENT SHALL THE AUTHOR BE LIABLE FOR\nANY SPECIAL, DIRECT, INDIRECT, OR CONSEQUENTIAL DAMAGES OR ANY DAMAGES\nWHATSOEVER RESULTING FROM LOSS OF USE, DATA OR PROFITS, WHETHER IN AN\nACTION OF CONTRACT, NEGLIGENCE OR OTHER TORTIOUS ACTION, ARISING OUT OF\nOR IN CONNECTION WITH THE USE OR PERFORMANCE OF THIS SOFTWARE.\n',
      files: [
        {
          title: 'src/confetti.js',
          url: 'https://github.com/catdad/canvas-confetti/blob/20eebad51dde793070c373d594099a7ed8d96e22/src/confetti.js',
        },
        {
          title: '完整 ISC 许可',
          url: 'https://github.com/catdad/canvas-confetti/blob/20eebad51dde793070c373d594099a7ed8d96e22/LICENSE',
        },
      ],
      videos: [],
      scope: '迁入并改写 src/confetti.js 的 randomPhysics 角度扩散和 updateFetti 速度分解、decay 更新公式。',
      changes:
        '原创成就卡与 80 个矩形纸屑；去除 worker、Path2D 图形解析、文字/图片栅格化与包导出，仅点击后执行一轮有限动画。',
    },
    files: [
      {
        path: 'index.html',
        content:
          '<!doctype html>\n<html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>纸屑发射台</title><link rel="stylesheet" href="style.css"><script src="app.js" defer></script></head><body><main><header><div><small>CREATIVE LAB / Canvas 实验</small><h1>纸屑发射台</h1><p>点击发射，从初始角度、速度衰减和重力理解粒子动画。</p></div><span class="tag">LOCAL UI STUDY</span></header><section class="stage"><div class="achievement"><span>✦</span><h2>一个小小的里程碑</h2><p>完成原型，庆祝探索。</p></div><canvas id="canvas" width="760" height="340" aria-label="纸屑动画"></canvas></section><div class="controls"><button id="launch">发射纸屑</button><label>扩散角度 <input id="spread" type="range" min="20" max="150" value="90"></label><output id="status" class="readout">等待发射</output></div><footer>本地 UI 学习模板 · 无外部资源 · 完整来源与许可见 NOTICE.txt</footer></main></body></html>',
      },
      {
        path: 'style.css',
        content:
          '*{box-sizing:border-box}body{margin:0;font-family:Inter,ui-sans-serif,system-ui,-apple-system,sans-serif;background:var(--bg,#eef3fa);color:var(--ink,#18233a);min-height:100vh}main{width:min(880px,100%);margin:auto;padding:32px 24px 24px}header{display:flex;justify-content:space-between;gap:16px;align-items:start}small{font-size:11px;letter-spacing:.2em;text-transform:uppercase;color:var(--accent,#4866f5);font-weight:800}h1{font-size:clamp(26px,5vw,42px);letter-spacing:-.04em;margin:10px 0}p{line-height:1.65;color:var(--muted,#617087)}.tag{font-size:11px;padding:7px 11px;border:1px solid currentColor;border-radius:30px;white-space:nowrap}.stage{position:relative;min-height:320px;display:grid;place-items:center;overflow:hidden;border-radius:24px;margin:22px 0;background:var(--surface,#fff);border:1px solid #18233a14}.controls{display:flex;gap:12px;flex-wrap:wrap;align-items:center}button,select,input{font:inherit}button{cursor:pointer;border:0;border-radius:10px;padding:11px 18px;background:var(--accent,#4866f5);color:#fff;font-weight:700}button.secondary{color:var(--ink,#18233a);background:#18233a0d}button:focus-visible,input:focus-visible,select:focus-visible{outline:3px solid #8aacf9;outline-offset:3px}label{font-size:13px;display:flex;gap:10px;align-items:center}input[type=range]{accent-color:var(--accent,#4866f5);max-width:100%}.readout{font-variant-numeric:tabular-nums;font-size:13px;color:var(--muted,#617087)}footer{margin-top:24px;font-size:11px;color:var(--muted,#617087)}svg,canvas{display:block;max-width:100%}@media(max-width:520px){main{padding:24px 16px}header{display:block}.tag{display:inline-block;margin-top:8px}.stage{min-height:300px}.controls{gap:10px}}@media(prefers-reduced-motion:reduce){*,*::before,*::after{animation:none!important;transition:none!important;scroll-behavior:auto!important}}\nbody{--bg:#fbf3ea;--accent:#dd7549;--muted:#946c57}.stage{background:#fffaf2}.achievement{text-align:center}.achievement span{font-size:64px;color:#dd7549}.achievement h2{font-size:27px;margin:10px}canvas{position:absolute;inset:0;width:100%;height:100%;pointer-events:none}',
      },
      {
        path: 'app.js',
        content:
          "// UI source study: https://github.com/catdad/canvas-confetti @ 20eebad51dde793070c373d594099a7ed8d96e22\n// 迁入并改写 src/confetti.js 的 randomPhysics 角度扩散和 updateFetti 速度分解、decay 更新公式。\n// See NOTICE.txt for complete upstream copyright and license.\n'use strict';\nconst reducedMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;\nconst c=document.querySelector('#canvas'),ctx=c.getContext('2d');let particles=[],raf=0;const colors=['#ea865a','#e6bd61','#7fb09f','#a88ed1','#75a9cd'];function launch(){if(reducedMotion){document.querySelector('#status').textContent='✦ 已完成！减少动态效果模式';return;}const spread=Number(document.querySelector('#spread').value)*Math.PI/180;particles=Array.from({length:80},()=>({x:380,y:280,angle:-Math.PI/2+(.5*spread-Math.random()*spread),velocity:8+Math.random()*10,gravity:2,decay:.96,tick:0,color:colors[Math.floor(Math.random()*colors.length)],rotation:Math.random()*6}));if(!raf)raf=requestAnimationFrame(frame);}function frame(){ctx.clearRect(0,0,760,340);particles=particles.filter(p=>p.tick<150);particles.forEach(p=>{p.x+=Math.cos(p.angle)*p.velocity;p.y+=Math.sin(p.angle)*p.velocity+p.gravity;p.velocity*=p.decay;p.tick++;p.rotation+=.11;ctx.save();ctx.translate(p.x,p.y);ctx.rotate(p.rotation);ctx.globalAlpha=1-p.tick/150;ctx.fillStyle=p.color;ctx.fillRect(-4,-2,8,4);ctx.restore();});document.querySelector('#status').textContent=particles.length?'80 个粒子正在飞行':'发射完成';raf=particles.length?requestAnimationFrame(frame):0;}document.querySelector('#launch').addEventListener('click',launch);",
      },
      {
        path: 'README.md',
        content:
          '# 纸屑发射台\n\n点击发射，从初始角度、速度衰减和重力理解粒子动画。\n\n## 学习步骤\n\n1. 用角度与速度分解水平和垂直位移。\n2. 用 decay 模拟空气阻力。\n3. 在粒子结束后停止 requestAnimationFrame。\n\n## 文件与运行\n\n点击工作区“运行预览”。index.html 是结构，style.css 是布局，app.js 是交互。所有演示数据与图形在浏览器中生成，不请求外网、读取凭证或运行服务器。动画尊重系统的减少动态效果设置。\n\n## 来源与范围\n\nhttps://github.com/catdad/canvas-confetti\n\n固定版本：20eebad51dde793070c373d594099a7ed8d96e22\n\n迁入并改写 src/confetti.js 的 randomPhysics 角度扩散和 updateFetti 速度分解、decay 更新公式。\n\n原创成就卡与 80 个矩形纸屑；去除 worker、Path2D 图形解析、文字/图片栅格化与包导出，仅点击后执行一轮有限动画。\n\n完整许可与归属见 NOTICE.txt，继续改写请保留该文件。\n',
      },
      {
        path: 'NOTICE.txt',
        content:
          '来源: https://github.com/catdad/canvas-confetti\n固定版本: 20eebad51dde793070c373d594099a7ed8d96e22\n迁入范围: 迁入并改写 src/confetti.js 的 randomPhysics 角度扩散和 updateFetti 速度分解、decay 更新公式。\n修改说明: 原创成就卡与 80 个矩形纸屑；去除 worker、Path2D 图形解析、文字/图片栅格化与包导出，仅点击后执行一轮有限动画。\n\n完整上游许可:\nISC License\n\nCopyright (c) 2020, Kiril Vatev\n\nPermission to use, copy, modify, and/or distribute this software for any\npurpose with or without fee is hereby granted, provided that the above\ncopyright notice and this permission notice appear in all copies.\n\nTHE SOFTWARE IS PROVIDED "AS IS" AND THE AUTHOR DISCLAIMS ALL WARRANTIES\nWITH REGARD TO THIS SOFTWARE INCLUDING ALL IMPLIED WARRANTIES OF\nMERCHANTABILITY AND FITNESS. IN NO EVENT SHALL THE AUTHOR BE LIABLE FOR\nANY SPECIAL, DIRECT, INDIRECT, OR CONSEQUENTIAL DAMAGES OR ANY DAMAGES\nWHATSOEVER RESULTING FROM LOSS OF USE, DATA OR PROFITS, WHETHER IN AN\nACTION OF CONTRACT, NEGLIGENCE OR OTHER TORTIOUS ACTION, ARISING OUT OF\nOR IN CONNECTION WITH THE USE OR PERFORMANCE OF THIS SOFTWARE.\n',
      },
    ],
  },
  {
    id: 'rough-blueprint',
    title: '手绘蓝图工坊',
    category: '绘图工具',
    tags: ['Canvas', '随机扰动', '双描边'],
    description: '给规整几何注入轻微随机偏移，生成有手绘感的蓝图。',
    learningGoals: ['为线段加入有界随机偏移', '用双描边模拟手绘复线', '比较随机种子与不稳定随机数的区别'],
    source: {
      repository: 'https://github.com/rough-stuff/rough',
      commit: '56a2762171b1294d643501e8d14f120db6b27bd7',
      license: 'MIT',
      licenseText:
        'MIT License\n\nCopyright (c) 2019 Preet Shihn\n\nPermission is hereby granted, free of charge, to any person obtaining a copy\nof this software and associated documentation files (the "Software"), to deal\nin the Software without restriction, including without limitation the rights\nto use, copy, modify, merge, publish, distribute, sublicense, and/or sell\ncopies of the Software, and to permit persons to whom the Software is\nfurnished to do so, subject to the following conditions:\n\nThe above copyright notice and this permission notice shall be included in all\ncopies or substantial portions of the Software.\n\nTHE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR\nIMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,\nFITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE\nAUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER\nLIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,\nOUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE\nSOFTWARE.\n',
      files: [
        {
          title: 'src/renderer.ts',
          url: 'https://github.com/rough-stuff/rough/blob/56a2762171b1294d643501e8d14f120db6b27bd7/src/renderer.ts',
        },
        {
          title: '完整 MIT 许可',
          url: 'https://github.com/rough-stuff/rough/blob/56a2762171b1294d643501e8d14f120db6b27bd7/LICENSE',
        },
      ],
      videos: [],
      scope:
        '迁入并改写 RoughJS src/renderer.ts 的 _offset 有界随机扰动公式，参考 _doubleLine 双次描边结构。',
      changes:
        '原创小屋/飞行器顶点与 Bézier 控制点；只绘制两幅有限图形，不迁入 RoughJS 的 SVG 解析、填充算法或随机数实现。',
    },
    files: [
      {
        path: 'index.html',
        content:
          '<!doctype html>\n<html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>手绘蓝图工坊</title><link rel="stylesheet" href="style.css"><script src="app.js" defer></script></head><body><main><header><div><small>CREATIVE LAB / 绘图工具</small><h1>手绘蓝图工坊</h1><p>给规整几何注入轻微随机偏移，生成有手绘感的蓝图。</p></div><span class="tag">LOCAL UI STUDY</span></header><section class="stage"><canvas id="canvas" width="720" height="340" aria-label="手绘蓝图"></canvas></section><div class="controls"><label>线条松弛度 <input id="roughness" type="range" min="0" max="7" value="3"></label><button id="redraw">重画蓝图</button><label>形状 <select id="shape"><option value="house">小屋</option><option value="rocket">飞行器</option></select></label></div><footer>本地 UI 学习模板 · 无外部资源 · 完整来源与许可见 NOTICE.txt</footer></main></body></html>',
      },
      {
        path: 'style.css',
        content:
          '*{box-sizing:border-box}body{margin:0;font-family:Inter,ui-sans-serif,system-ui,-apple-system,sans-serif;background:var(--bg,#eef3fa);color:var(--ink,#18233a);min-height:100vh}main{width:min(880px,100%);margin:auto;padding:32px 24px 24px}header{display:flex;justify-content:space-between;gap:16px;align-items:start}small{font-size:11px;letter-spacing:.2em;text-transform:uppercase;color:var(--accent,#4866f5);font-weight:800}h1{font-size:clamp(26px,5vw,42px);letter-spacing:-.04em;margin:10px 0}p{line-height:1.65;color:var(--muted,#617087)}.tag{font-size:11px;padding:7px 11px;border:1px solid currentColor;border-radius:30px;white-space:nowrap}.stage{position:relative;min-height:320px;display:grid;place-items:center;overflow:hidden;border-radius:24px;margin:22px 0;background:var(--surface,#fff);border:1px solid #18233a14}.controls{display:flex;gap:12px;flex-wrap:wrap;align-items:center}button,select,input{font:inherit}button{cursor:pointer;border:0;border-radius:10px;padding:11px 18px;background:var(--accent,#4866f5);color:#fff;font-weight:700}button.secondary{color:var(--ink,#18233a);background:#18233a0d}button:focus-visible,input:focus-visible,select:focus-visible{outline:3px solid #8aacf9;outline-offset:3px}label{font-size:13px;display:flex;gap:10px;align-items:center}input[type=range]{accent-color:var(--accent,#4866f5);max-width:100%}.readout{font-variant-numeric:tabular-nums;font-size:13px;color:var(--muted,#617087)}footer{margin-top:24px;font-size:11px;color:var(--muted,#617087)}svg,canvas{display:block;max-width:100%}@media(max-width:520px){main{padding:24px 16px}header{display:block}.tag{display:inline-block;margin-top:8px}.stage{min-height:300px}.controls{gap:10px}}@media(prefers-reduced-motion:reduce){*,*::before,*::after{animation:none!important;transition:none!important;scroll-behavior:auto!important}}\nbody{--bg:#e8eff7;--accent:#3167a5;--muted:#5b7693}.stage{background-color:#f4f8fb;background-image:linear-gradient(#a8bfd42b 1px,transparent 1px),linear-gradient(90deg,#a8bfd42b 1px,transparent 1px);background-size:20px 20px}canvas{width:100%;height:340px}select{background:#fff;border:1px solid #acc2d5;padding:6px;border-radius:7px}',
      },
      {
        path: 'app.js',
        content:
          "// UI source study: https://github.com/rough-stuff/rough @ 56a2762171b1294d643501e8d14f120db6b27bd7\n// 迁入并改写 RoughJS src/renderer.ts 的 _offset 有界随机扰动公式，参考 _doubleLine 双次描边结构。\n// See NOTICE.txt for complete upstream copyright and license.\n'use strict';\nconst reducedMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;\nconst c=document.querySelector('#canvas'),ctx=c.getContext('2d'),rough=document.querySelector('#roughness');function offset(min,max){return Number(rough.value)*(Math.random()*(max-min)+min);}function line(a,b){for(let stroke=0;stroke<2;stroke++){ctx.beginPath();ctx.moveTo(a[0]+offset(-1,1),a[1]+offset(-1,1));ctx.bezierCurveTo(a[0]+(b[0]-a[0])*.33+offset(-1,1),a[1]+(b[1]-a[1])*.33+offset(-1,1),a[0]+(b[0]-a[0])*.66+offset(-1,1),a[1]+(b[1]-a[1])*.66+offset(-1,1),b[0]+offset(-1,1),b[1]+offset(-1,1));ctx.stroke();}}function redraw(){ctx.clearRect(0,0,720,340);ctx.strokeStyle='#356797';ctx.lineWidth=1.8;const house=[[[200,160],[360,50]],[[360,50],[520,160]],[[230,140],[230,285]],[[490,140],[490,285]],[[230,285],[490,285]],[[335,285],[335,205]],[[335,205],[385,205]],[[385,205],[385,285]],[[270,185],[310,185]],[[310,185],[310,225]],[[310,225],[270,225]],[[270,225],[270,185]]];const rocket=[[[360,45],[300,125]],[[360,45],[420,125]],[[300,125],[300,245]],[[420,125],[420,245]],[[300,245],[420,245]],[[300,175],[255,245]],[[255,245],[300,245]],[[420,175],[465,245]],[[465,245],[420,245]],[[335,265],[325,310]],[[360,265],[360,320]],[[385,265],[395,310]]];(document.querySelector('#shape').value==='house'?house:rocket).forEach(s=>line(...s));}rough.addEventListener('input',redraw);document.querySelector('#redraw').addEventListener('click',redraw);document.querySelector('#shape').addEventListener('change',redraw);redraw();",
      },
      {
        path: 'README.md',
        content:
          '# 手绘蓝图工坊\n\n给规整几何注入轻微随机偏移，生成有手绘感的蓝图。\n\n## 学习步骤\n\n1. 为线段加入有界随机偏移。\n2. 用双描边模拟手绘复线。\n3. 比较随机种子与不稳定随机数的区别。\n\n## 文件与运行\n\n点击工作区“运行预览”。index.html 是结构，style.css 是布局，app.js 是交互。所有演示数据与图形在浏览器中生成，不请求外网、读取凭证或运行服务器。动画尊重系统的减少动态效果设置。\n\n## 来源与范围\n\nhttps://github.com/rough-stuff/rough\n\n固定版本：56a2762171b1294d643501e8d14f120db6b27bd7\n\n迁入并改写 RoughJS src/renderer.ts 的 _offset 有界随机扰动公式，参考 _doubleLine 双次描边结构。\n\n原创小屋/飞行器顶点与 Bézier 控制点；只绘制两幅有限图形，不迁入 RoughJS 的 SVG 解析、填充算法或随机数实现。\n\n完整许可与归属见 NOTICE.txt，继续改写请保留该文件。\n',
      },
      {
        path: 'NOTICE.txt',
        content:
          '来源: https://github.com/rough-stuff/rough\n固定版本: 56a2762171b1294d643501e8d14f120db6b27bd7\n迁入范围: 迁入并改写 RoughJS src/renderer.ts 的 _offset 有界随机扰动公式，参考 _doubleLine 双次描边结构。\n修改说明: 原创小屋/飞行器顶点与 Bézier 控制点；只绘制两幅有限图形，不迁入 RoughJS 的 SVG 解析、填充算法或随机数实现。\n\n完整上游许可:\nMIT License\n\nCopyright (c) 2019 Preet Shihn\n\nPermission is hereby granted, free of charge, to any person obtaining a copy\nof this software and associated documentation files (the "Software"), to deal\nin the Software without restriction, including without limitation the rights\nto use, copy, modify, merge, publish, distribute, sublicense, and/or sell\ncopies of the Software, and to permit persons to whom the Software is\nfurnished to do so, subject to the following conditions:\n\nThe above copyright notice and this permission notice shall be included in all\ncopies or substantial portions of the Software.\n\nTHE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR\nIMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,\nFITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE\nAUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER\nLIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,\nOUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE\nSOFTWARE.\n',
      },
    ],
  },
  {
    id: 'signature-studio',
    title: '笔迹速度实验',
    category: '绘图工具',
    tags: ['Pointer Events', 'Canvas', '速度映射'],
    description: '在画布上留下笔迹，感受速度变化如何影响线宽。',
    learningGoals: ['采集指针坐标和时间戳', '把距离除以时间得到移动速度', '将平滑速度映射为笔触宽度'],
    source: {
      repository: 'https://github.com/szimek/signature_pad',
      commit: '0a33fd6791e0df151c4e9421193cfc03f18732a7',
      license: 'MIT',
      licenseText:
        'MIT License\n\nCopyright (c) 2018 Szymon Nowak\n\nPermission is hereby granted, free of charge, to any person obtaining a copy\nof this software and associated documentation files (the "Software"), to deal\nin the Software without restriction, including without limitation the rights\nto use, copy, modify, merge, publish, distribute, sublicense, and/or sell\ncopies of the Software, and to permit persons to whom the Software is\nfurnished to do so, subject to the following conditions:\n\nThe above copyright notice and this permission notice shall be included in all\ncopies or substantial portions of the Software.\n\nTHE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR\nIMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,\nFITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE\nAUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER\nLIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,\nOUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE\nSOFTWARE.\n',
      files: [
        {
          title: 'src/point.ts',
          url: 'https://github.com/szimek/signature_pad/blob/0a33fd6791e0df151c4e9421193cfc03f18732a7/src/point.ts',
        },
        {
          title: '完整 MIT 许可',
          url: 'https://github.com/szimek/signature_pad/blob/0a33fd6791e0df151c4e9421193cfc03f18732a7/LICENSE',
        },
      ],
      videos: [],
      scope: '迁入 src/point.ts 的 distanceTo 与 velocityFrom 方法，改写为两个纯函数。',
      changes:
        '原创速度平滑、线宽映射和界面；不迁入签名序列化、SVG 导出、完整 Bézier 笔迹生成或上传逻辑。笔迹仅保留在当前页面内存。',
    },
    files: [
      {
        path: 'index.html',
        content:
          '<!doctype html>\n<html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>笔迹速度实验</title><link rel="stylesheet" href="style.css"><script src="app.js" defer></script></head><body><main><header><div><small>CREATIVE LAB / 绘图工具</small><h1>笔迹速度实验</h1><p>在画布上留下笔迹，感受速度变化如何影响线宽。</p></div><span class="tag">LOCAL UI STUDY</span></header><section class="stage"><canvas id="canvas" width="720" height="340" aria-label="自由笔迹画布"></canvas><span class="hint">在这里写下想法</span></section><div class="controls"><button id="clear">清空画布</button><label>笔色 <input id="color" type="color" value="#284960"></label><output id="speed" class="readout">速度 0.00 px/ms</output></div><footer>本地 UI 学习模板 · 无外部资源 · 完整来源与许可见 NOTICE.txt</footer></main></body></html>',
      },
      {
        path: 'style.css',
        content:
          '*{box-sizing:border-box}body{margin:0;font-family:Inter,ui-sans-serif,system-ui,-apple-system,sans-serif;background:var(--bg,#eef3fa);color:var(--ink,#18233a);min-height:100vh}main{width:min(880px,100%);margin:auto;padding:32px 24px 24px}header{display:flex;justify-content:space-between;gap:16px;align-items:start}small{font-size:11px;letter-spacing:.2em;text-transform:uppercase;color:var(--accent,#4866f5);font-weight:800}h1{font-size:clamp(26px,5vw,42px);letter-spacing:-.04em;margin:10px 0}p{line-height:1.65;color:var(--muted,#617087)}.tag{font-size:11px;padding:7px 11px;border:1px solid currentColor;border-radius:30px;white-space:nowrap}.stage{position:relative;min-height:320px;display:grid;place-items:center;overflow:hidden;border-radius:24px;margin:22px 0;background:var(--surface,#fff);border:1px solid #18233a14}.controls{display:flex;gap:12px;flex-wrap:wrap;align-items:center}button,select,input{font:inherit}button{cursor:pointer;border:0;border-radius:10px;padding:11px 18px;background:var(--accent,#4866f5);color:#fff;font-weight:700}button.secondary{color:var(--ink,#18233a);background:#18233a0d}button:focus-visible,input:focus-visible,select:focus-visible{outline:3px solid #8aacf9;outline-offset:3px}label{font-size:13px;display:flex;gap:10px;align-items:center}input[type=range]{accent-color:var(--accent,#4866f5);max-width:100%}.readout{font-variant-numeric:tabular-nums;font-size:13px;color:var(--muted,#617087)}footer{margin-top:24px;font-size:11px;color:var(--muted,#617087)}svg,canvas{display:block;max-width:100%}@media(max-width:520px){main{padding:24px 16px}header{display:block}.tag{display:inline-block;margin-top:8px}.stage{min-height:300px}.controls{gap:10px}}@media(prefers-reduced-motion:reduce){*,*::before,*::after{animation:none!important;transition:none!important;scroll-behavior:auto!important}}\nbody{--bg:#f2ede4;--accent:#476b71;--muted:#827b6e}.stage{background:#fffaf0}canvas{width:100%;height:340px;touch-action:none;position:relative;z-index:1}.hint{position:absolute;opacity:.35;pointer-events:none;font-size:24px;bottom:70px;border-bottom:1px dashed #827b6e88;padding-bottom:20px}input[type=color]{border:0;background:none;width:42px;height:34px}',
      },
      {
        path: 'app.js',
        content:
          "// UI source study: https://github.com/szimek/signature_pad @ 0a33fd6791e0df151c4e9421193cfc03f18732a7\n// 迁入 src/point.ts 的 distanceTo 与 velocityFrom 方法，改写为两个纯函数。\n// See NOTICE.txt for complete upstream copyright and license.\n'use strict';\nconst reducedMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;\nconst c=document.querySelector('#canvas'),ctx=c.getContext('2d');let previous=null,speed=0;function point(e){const r=c.getBoundingClientRect();return{x:(e.clientX-r.left)*c.width/r.width,y:(e.clientY-r.top)*c.height/r.height,time:e.timeStamp};}function distanceTo(a,b){return Math.sqrt(Math.pow(a.x-b.x,2)+Math.pow(a.y-b.y,2));}function velocityFrom(a,b){return a.time!==b.time?distanceTo(a,b)/(a.time-b.time):0;}c.addEventListener('pointerdown',e=>{previous=point(e);c.setPointerCapture(e.pointerId);ctx.fillStyle=document.querySelector('#color').value;ctx.beginPath();ctx.arc(previous.x,previous.y,2,0,Math.PI*2);ctx.fill();});c.addEventListener('pointermove',e=>{if(!previous)return;const p=point(e);speed=.7*velocityFrom(p,previous)+.3*speed;ctx.strokeStyle=document.querySelector('#color').value;ctx.lineWidth=Math.max(1,6/(1+speed));ctx.lineCap='round';ctx.lineJoin='round';ctx.beginPath();ctx.moveTo(previous.x,previous.y);ctx.lineTo(p.x,p.y);ctx.stroke();previous=p;document.querySelector('#speed').textContent='速度 '+speed.toFixed(2)+' px/ms';});['pointerup','pointercancel'].forEach(name=>c.addEventListener(name,()=>{previous=null;speed=0;}));document.querySelector('#clear').addEventListener('click',()=>ctx.clearRect(0,0,c.width,c.height));ctx.fillStyle='#28496033';ctx.font='italic 38px serif';ctx.fillText('Make something meaningful.',80,120);",
      },
      {
        path: 'README.md',
        content:
          '# 笔迹速度实验\n\n在画布上留下笔迹，感受速度变化如何影响线宽。\n\n## 学习步骤\n\n1. 采集指针坐标和时间戳。\n2. 把距离除以时间得到移动速度。\n3. 将平滑速度映射为笔触宽度。\n\n## 文件与运行\n\n点击工作区“运行预览”。index.html 是结构，style.css 是布局，app.js 是交互。所有演示数据与图形在浏览器中生成，不请求外网、读取凭证或运行服务器。动画尊重系统的减少动态效果设置。\n\n## 来源与范围\n\nhttps://github.com/szimek/signature_pad\n\n固定版本：0a33fd6791e0df151c4e9421193cfc03f18732a7\n\n迁入 src/point.ts 的 distanceTo 与 velocityFrom 方法，改写为两个纯函数。\n\n原创速度平滑、线宽映射和界面；不迁入签名序列化、SVG 导出、完整 Bézier 笔迹生成或上传逻辑。笔迹仅保留在当前页面内存。\n\n完整许可与归属见 NOTICE.txt，继续改写请保留该文件。\n',
      },
      {
        path: 'NOTICE.txt',
        content:
          '来源: https://github.com/szimek/signature_pad\n固定版本: 0a33fd6791e0df151c4e9421193cfc03f18732a7\n迁入范围: 迁入 src/point.ts 的 distanceTo 与 velocityFrom 方法，改写为两个纯函数。\n修改说明: 原创速度平滑、线宽映射和界面；不迁入签名序列化、SVG 导出、完整 Bézier 笔迹生成或上传逻辑。笔迹仅保留在当前页面内存。\n\n完整上游许可:\nMIT License\n\nCopyright (c) 2018 Szymon Nowak\n\nPermission is hereby granted, free of charge, to any person obtaining a copy\nof this software and associated documentation files (the "Software"), to deal\nin the Software without restriction, including without limitation the rights\nto use, copy, modify, merge, publish, distribute, sublicense, and/or sell\ncopies of the Software, and to permit persons to whom the Software is\nfurnished to do so, subject to the following conditions:\n\nThe above copyright notice and this permission notice shall be included in all\ncopies or substantial portions of the Software.\n\nTHE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR\nIMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,\nFITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE\nAUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER\nLIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,\nOUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE\nSOFTWARE.\n',
      },
    ],
  },
  {
    id: 'line-reveal',
    title: '线描航行图',
    category: '图形动画',
    tags: ['SVG', '路径长度', 'stroke-dashoffset'],
    description: '手动描摹一张航行示意图，看看虚线偏移如何让路径出现。',
    learningGoals: [
      '读取 getTotalLength 得到路径长度',
      '用 stroke-dasharray 隐藏整条路径',
      '让 stroke-dashoffset 随进度减少',
    ],
    source: {
      repository: 'https://github.com/maxwellito/vivus',
      commit: '06b7adb5d543b6b1d0d93fa83dea137b1f8644a5',
      license: 'MIT',
      licenseText:
        'The MIT License (MIT)\n\nCopyright (c) maxwellito\n\nPermission is hereby granted, free of charge, to any person obtaining a copy of\nthis software and associated documentation files (the "Software"), to deal in\nthe Software without restriction, including without limitation the rights to\nuse, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of\nthe Software, and to permit persons to whom the Software is furnished to do so,\nsubject to the following conditions:\n\nThe above copyright notice and this permission notice shall be included in all\ncopies or substantial portions of the Software.\n\nTHE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR\nIMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS\nFOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR\nCOPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER\nIN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN\nCONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.\n',
      files: [
        {
          title: 'src/vivus.js',
          url: 'https://github.com/maxwellito/vivus/blob/06b7adb5d543b6b1d0d93fa83dea137b1f8644a5/src/vivus.js',
        },
        {
          title: '完整 MIT 许可',
          url: 'https://github.com/maxwellito/vivus/blob/06b7adb5d543b6b1d0d93fa83dea137b1f8644a5/LICENSE',
        },
      ],
      videos: [],
      scope:
        '迁入并改写 src/vivus.js 的 trace 进度 clamp 以及 length * (1 - progress) 计算；参考路径长度映射。',
      changes:
        '原创船帆/水波 SVG；不迁入外部 SVG 请求、PathFormer、viewport 监听或全局库，保留滑杆与一次性播放。',
    },
    files: [
      {
        path: 'index.html',
        content:
          '<!doctype html>\n<html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>线描航行图</title><link rel="stylesheet" href="style.css"><script src="app.js" defer></script></head><body><main><header><div><small>CREATIVE LAB / 图形动画</small><h1>线描航行图</h1><p>手动描摹一张航行示意图，看看虚线偏移如何让路径出现。</p></div><span class="tag">LOCAL UI STUDY</span></header><section class="stage"><svg viewBox="0 0 620 340" width="620" height="340" aria-label="线描航行图"><g id="drawing" fill="none" stroke="#315d7b" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="M150 232H465L425 280H196Z"/><path d="M300 70V232M294 77L170 210H294ZM308 90L414 210H308Z"/><path d="M110 298Q155 279 200 298T290 298T380 298T470 298T540 298"/><path d="M460 55V82M447 68H473M493 112V129M485 121H501"/><path d="M94 133Q130 113 166 133"/></g></svg></section><div class="controls"><button id="play">描绘航行图</button><label>描绘进度 <input id="progress" type="range" min="0" max="100" value="68"></label><output id="status" class="readout">68%</output></div><footer>本地 UI 学习模板 · 无外部资源 · 完整来源与许可见 NOTICE.txt</footer></main></body></html>',
      },
      {
        path: 'style.css',
        content:
          '*{box-sizing:border-box}body{margin:0;font-family:Inter,ui-sans-serif,system-ui,-apple-system,sans-serif;background:var(--bg,#eef3fa);color:var(--ink,#18233a);min-height:100vh}main{width:min(880px,100%);margin:auto;padding:32px 24px 24px}header{display:flex;justify-content:space-between;gap:16px;align-items:start}small{font-size:11px;letter-spacing:.2em;text-transform:uppercase;color:var(--accent,#4866f5);font-weight:800}h1{font-size:clamp(26px,5vw,42px);letter-spacing:-.04em;margin:10px 0}p{line-height:1.65;color:var(--muted,#617087)}.tag{font-size:11px;padding:7px 11px;border:1px solid currentColor;border-radius:30px;white-space:nowrap}.stage{position:relative;min-height:320px;display:grid;place-items:center;overflow:hidden;border-radius:24px;margin:22px 0;background:var(--surface,#fff);border:1px solid #18233a14}.controls{display:flex;gap:12px;flex-wrap:wrap;align-items:center}button,select,input{font:inherit}button{cursor:pointer;border:0;border-radius:10px;padding:11px 18px;background:var(--accent,#4866f5);color:#fff;font-weight:700}button.secondary{color:var(--ink,#18233a);background:#18233a0d}button:focus-visible,input:focus-visible,select:focus-visible{outline:3px solid #8aacf9;outline-offset:3px}label{font-size:13px;display:flex;gap:10px;align-items:center}input[type=range]{accent-color:var(--accent,#4866f5);max-width:100%}.readout{font-variant-numeric:tabular-nums;font-size:13px;color:var(--muted,#617087)}footer{margin-top:24px;font-size:11px;color:var(--muted,#617087)}svg,canvas{display:block;max-width:100%}@media(max-width:520px){main{padding:24px 16px}header{display:block}.tag{display:inline-block;margin-top:8px}.stage{min-height:300px}.controls{gap:10px}}@media(prefers-reduced-motion:reduce){*,*::before,*::after{animation:none!important;transition:none!important;scroll-behavior:auto!important}}\nbody{--bg:#ebf2f4;--accent:#3b7086;--muted:#617f89}.stage{background:#f9fcfd}svg{filter:drop-shadow(0 10px 10px #315d7b12)}',
      },
      {
        path: 'app.js',
        content:
          "// UI source study: https://github.com/maxwellito/vivus @ 06b7adb5d543b6b1d0d93fa83dea137b1f8644a5\n// 迁入并改写 src/vivus.js 的 trace 进度 clamp 以及 length * (1 - progress) 计算；参考路径长度映射。\n// See NOTICE.txt for complete upstream copyright and license.\n'use strict';\nconst reducedMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;\nconst paths=[...document.querySelectorAll('#drawing path')].map(el=>({el,length:el.getTotalLength()}));const slider=document.querySelector('#progress');let raf=0;paths.forEach(p=>p.el.style.strokeDasharray=p.length+' '+p.length);function draw(t){paths.forEach((path,i)=>{const progress=Math.max(0,Math.min(1,t*1.3-i*.05));path.el.style.strokeDashoffset=Math.floor(path.length*(1-progress));});slider.value=String(Math.round(t*100));document.querySelector('#status').textContent=Math.round(t*100)+'%';}slider.addEventListener('input',()=>{cancelAnimationFrame(raf);draw(Number(slider.value)/100);});document.querySelector('#play').addEventListener('click',()=>{cancelAnimationFrame(raf);if(reducedMotion){draw(1);return;}const start=performance.now();function frame(now){const t=Math.min((now-start)/2200,1);draw(t);if(t<1)raf=requestAnimationFrame(frame);}raf=requestAnimationFrame(frame);});draw(.68);",
      },
      {
        path: 'README.md',
        content:
          '# 线描航行图\n\n手动描摹一张航行示意图，看看虚线偏移如何让路径出现。\n\n## 学习步骤\n\n1. 读取 getTotalLength 得到路径长度。\n2. 用 stroke-dasharray 隐藏整条路径。\n3. 让 stroke-dashoffset 随进度减少。\n\n## 文件与运行\n\n点击工作区“运行预览”。index.html 是结构，style.css 是布局，app.js 是交互。所有演示数据与图形在浏览器中生成，不请求外网、读取凭证或运行服务器。动画尊重系统的减少动态效果设置。\n\n## 来源与范围\n\nhttps://github.com/maxwellito/vivus\n\n固定版本：06b7adb5d543b6b1d0d93fa83dea137b1f8644a5\n\n迁入并改写 src/vivus.js 的 trace 进度 clamp 以及 length * (1 - progress) 计算；参考路径长度映射。\n\n原创船帆/水波 SVG；不迁入外部 SVG 请求、PathFormer、viewport 监听或全局库，保留滑杆与一次性播放。\n\n完整许可与归属见 NOTICE.txt，继续改写请保留该文件。\n',
      },
      {
        path: 'NOTICE.txt',
        content:
          '来源: https://github.com/maxwellito/vivus\n固定版本: 06b7adb5d543b6b1d0d93fa83dea137b1f8644a5\n迁入范围: 迁入并改写 src/vivus.js 的 trace 进度 clamp 以及 length * (1 - progress) 计算；参考路径长度映射。\n修改说明: 原创船帆/水波 SVG；不迁入外部 SVG 请求、PathFormer、viewport 监听或全局库，保留滑杆与一次性播放。\n\n完整上游许可:\nThe MIT License (MIT)\n\nCopyright (c) maxwellito\n\nPermission is hereby granted, free of charge, to any person obtaining a copy of\nthis software and associated documentation files (the "Software"), to deal in\nthe Software without restriction, including without limitation the rights to\nuse, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of\nthe Software, and to permit persons to whom the Software is furnished to do so,\nsubject to the following conditions:\n\nThe above copyright notice and this permission notice shall be included in all\ncopies or substantial portions of the Software.\n\nTHE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR\nIMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS\nFOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR\nCOPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER\nIN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN\nCONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.\n',
      },
    ],
  },
  {
    id: 'rolling-meter',
    title: '滚动数字仪表',
    category: '交互组件',
    tags: ['CSS transform', '数字分位', '状态更新'],
    description: '每个数字都有自己的纵向胶片，修改目标值让它们同步滚动。',
    learningGoals: [
      '把数字拆为固定宽度字符数组',
      '用固定高度窗口裁切数字条',
      '用 transform 更新显示而不改变布局',
    ],
    source: {
      repository: 'https://github.com/HubSpot/odometer',
      commit: '0bc5470eeb822f828d6ac8cca8b87a02413f6260',
      license: 'MIT',
      licenseText:
        'Copyright (c) 2013 HubSpot, Inc.\n\nPermission is hereby granted, free of charge, to any person obtaining a copy of this software and associated documentation files (the "Software"), to deal in the Software without restriction, including without limitation the rights to use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of the Software, and to permit persons to whom the Software is furnished to do so, subject to the following conditions:\n\nThe above copyright notice and this permission notice shall be included in all copies or substantial portions of the Software.\n\nTHE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.\n\n',
      files: [
        {
          title: 'odometer.coffee',
          url: 'https://github.com/HubSpot/odometer/blob/0bc5470eeb822f828d6ac8cca8b87a02413f6260/odometer.coffee',
        },
        {
          title: '完整 MIT 许可',
          url: 'https://github.com/HubSpot/odometer/blob/0bc5470eeb822f828d6ac8cca8b87a02413f6260/LICENSE',
        },
      ],
      videos: [],
      scope:
        '参考 odometer.coffee 的 digit/ribbon 分位滚动结构；DOM 创建、状态更新与 CSS 胶片为独立实现，没有复制 Odometer 整库。',
      changes:
        '只保留五位非负整数仪表；去除格式/小数解析、MutationObserver、全局补丁与自动更新，新增输入和按钮。',
    },
    files: [
      {
        path: 'index.html',
        content:
          '<!doctype html>\n<html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>滚动数字仪表</title><link rel="stylesheet" href="style.css"><script src="app.js" defer></script></head><body><main><header><div><small>CREATIVE LAB / 交互组件</small><h1>滚动数字仪表</h1><p>每个数字都有自己的纵向胶片，修改目标值让它们同步滚动。</p></div><span class="tag">LOCAL UI STUDY</span></header><section class="stage"><div class="meter"><small>IDEAS EXPLORED</small><div id="digits" aria-label="当前计数"></div><p>将想法变成可见的进度</p></div></section><div class="controls"><label>目标值 <input id="value" type="number" min="0" max="99999" value="2846"></label><button id="update">更新仪表</button><button id="random" class="secondary">随机里程碑</button></div><footer>本地 UI 学习模板 · 无外部资源 · 完整来源与许可见 NOTICE.txt</footer></main></body></html>',
      },
      {
        path: 'style.css',
        content:
          "*{box-sizing:border-box}body{margin:0;font-family:Inter,ui-sans-serif,system-ui,-apple-system,sans-serif;background:var(--bg,#eef3fa);color:var(--ink,#18233a);min-height:100vh}main{width:min(880px,100%);margin:auto;padding:32px 24px 24px}header{display:flex;justify-content:space-between;gap:16px;align-items:start}small{font-size:11px;letter-spacing:.2em;text-transform:uppercase;color:var(--accent,#4866f5);font-weight:800}h1{font-size:clamp(26px,5vw,42px);letter-spacing:-.04em;margin:10px 0}p{line-height:1.65;color:var(--muted,#617087)}.tag{font-size:11px;padding:7px 11px;border:1px solid currentColor;border-radius:30px;white-space:nowrap}.stage{position:relative;min-height:320px;display:grid;place-items:center;overflow:hidden;border-radius:24px;margin:22px 0;background:var(--surface,#fff);border:1px solid #18233a14}.controls{display:flex;gap:12px;flex-wrap:wrap;align-items:center}button,select,input{font:inherit}button{cursor:pointer;border:0;border-radius:10px;padding:11px 18px;background:var(--accent,#4866f5);color:#fff;font-weight:700}button.secondary{color:var(--ink,#18233a);background:#18233a0d}button:focus-visible,input:focus-visible,select:focus-visible{outline:3px solid #8aacf9;outline-offset:3px}label{font-size:13px;display:flex;gap:10px;align-items:center}input[type=range]{accent-color:var(--accent,#4866f5);max-width:100%}.readout{font-variant-numeric:tabular-nums;font-size:13px;color:var(--muted,#617087)}footer{margin-top:24px;font-size:11px;color:var(--muted,#617087)}svg,canvas{display:block;max-width:100%}@media(max-width:520px){main{padding:24px 16px}header{display:block}.tag{display:inline-block;margin-top:8px}.stage{min-height:300px}.controls{gap:10px}}@media(prefers-reduced-motion:reduce){*,*::before,*::after{animation:none!important;transition:none!important;scroll-behavior:auto!important}}\nbody{--bg:#f2eae0;--accent:#8d644b;--muted:#8e7868}.stage{background:#e3d6c5}.meter{text-align:center;padding:32px 12px}.meter small{color:#8d644b}#digits{display:flex;gap:7px;margin:26px 0}.digit{height:76px;width:51px;overflow:hidden;background:#322f2c;color:#f4e8d3;border-radius:8px;box-shadow:0 4px 0 #0004;position:relative}.digit:after{content:'';position:absolute;inset:50% 0 0;border-top:1px solid #0008;pointer-events:none}.ribbon{transition:transform .85s cubic-bezier(.22,1,.36,1)}.ribbon span{display:block;height:76px;line-height:76px;font-size:54px;font-variant-numeric:tabular-nums}input[type=number]{max-width:110px;padding:7px;border:1px solid #bea58e;border-radius:8px}@media(max-width:400px){.digit{width:43px}.ribbon span{font-size:46px}}",
      },
      {
        path: 'app.js',
        content:
          "// UI source study: https://github.com/HubSpot/odometer @ 0bc5470eeb822f828d6ac8cca8b87a02413f6260\n// 参考 odometer.coffee 的 digit/ribbon 分位滚动结构；DOM 创建、状态更新与 CSS 胶片为独立实现，没有复制 Odometer 整库。\n// See NOTICE.txt for complete upstream copyright and license.\n'use strict';\nconst reducedMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;\nconst digits=document.querySelector('#digits'),value=document.querySelector('#value');const ribbons=Array.from({length:5},()=>{const d=document.createElement('div');d.className='digit';d.setAttribute('aria-hidden','true');const strip=document.createElement('div');strip.className='ribbon';for(let i=0;i<10;i++){const span=document.createElement('span');span.textContent=String(i);strip.append(span);}d.append(strip);digits.append(d);return strip;});function update(){const n=Math.max(0,Math.min(99999,Math.floor(Number(value.value)||0)));value.value=String(n);digits.setAttribute('aria-label','当前计数 '+n);String(n).padStart(5,'0').split('').forEach((d,i)=>ribbons[i].style.transform='translateY('+(-Number(d)*76)+'px)');}document.querySelector('#update').addEventListener('click',update);document.querySelector('#random').addEventListener('click',()=>{value.value=String(Math.floor(Math.random()*99999));update();});update();",
      },
      {
        path: 'README.md',
        content:
          '# 滚动数字仪表\n\n每个数字都有自己的纵向胶片，修改目标值让它们同步滚动。\n\n## 学习步骤\n\n1. 把数字拆为固定宽度字符数组。\n2. 用固定高度窗口裁切数字条。\n3. 用 transform 更新显示而不改变布局。\n\n## 文件与运行\n\n点击工作区“运行预览”。index.html 是结构，style.css 是布局，app.js 是交互。所有演示数据与图形在浏览器中生成，不请求外网、读取凭证或运行服务器。动画尊重系统的减少动态效果设置。\n\n## 来源与范围\n\nhttps://github.com/HubSpot/odometer\n\n固定版本：0bc5470eeb822f828d6ac8cca8b87a02413f6260\n\n参考 odometer.coffee 的 digit/ribbon 分位滚动结构；DOM 创建、状态更新与 CSS 胶片为独立实现，没有复制 Odometer 整库。\n\n只保留五位非负整数仪表；去除格式/小数解析、MutationObserver、全局补丁与自动更新，新增输入和按钮。\n\n完整许可与归属见 NOTICE.txt，继续改写请保留该文件。\n',
      },
      {
        path: 'NOTICE.txt',
        content:
          '来源: https://github.com/HubSpot/odometer\n固定版本: 0bc5470eeb822f828d6ac8cca8b87a02413f6260\n迁入范围: 参考 odometer.coffee 的 digit/ribbon 分位滚动结构；DOM 创建、状态更新与 CSS 胶片为独立实现，没有复制 Odometer 整库。\n修改说明: 只保留五位非负整数仪表；去除格式/小数解析、MutationObserver、全局补丁与自动更新，新增输入和按钮。\n\n完整上游许可:\nCopyright (c) 2013 HubSpot, Inc.\n\nPermission is hereby granted, free of charge, to any person obtaining a copy of this software and associated documentation files (the "Software"), to deal in the Software without restriction, including without limitation the rights to use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of the Software, and to permit persons to whom the Software is furnished to do so, subject to the following conditions:\n\nThe above copyright notice and this permission notice shall be included in all copies or substantial portions of the Software.\n\nTHE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.\n\n',
      },
    ],
  },
  {
    id: 'typing-terminal',
    title: '逐字探索终端',
    category: '文字交互',
    tags: ['定时器', '文本安全', '状态机'],
    description: '点击重新输入，让一句短文沿着时间轴逐字出现。',
    learningGoals: ['用 textContent 安全呈现用户文本', '用取消定时器避免重入', '用有界随机延迟模拟打字节奏'],
    source: {
      repository: 'https://github.com/mattboldt/typed.js',
      commit: '337109d9ac6558475eea301693e64071dafc9961',
      license: 'MIT',
      licenseText:
        'The MIT License (MIT)\n\nCopyright (c) 2018 Matt Boldt\n\nPermission is hereby granted, free of charge, to any person obtaining a copy\nof this software and associated documentation files (the "Software"), to deal\nin the Software without restriction, including without limitation the rights\nto use, copy, modify, merge, publish, distribute, sublicense, and/or sell\ncopies of the Software, and to permit persons to whom the Software is\nfurnished to do so, subject to the following conditions:\n\nThe above copyright notice and this permission notice shall be included in\nall copies or substantial portions of the Software.\n\nTHE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR\nIMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,\nFITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE\nAUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER\nLIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,\nOUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN\nTHE SOFTWARE.\n',
      files: [
        {
          title: 'src/typed.js',
          url: 'https://github.com/mattboldt/typed.js/blob/337109d9ac6558475eea301693e64071dafc9961/src/typed.js',
        },
        {
          title: '完整 MIT 许可',
          url: 'https://github.com/mattboldt/typed.js/blob/337109d9ac6558475eea301693e64071dafc9961/LICENSE.txt',
        },
      ],
      videos: [],
      scope: '迁入 v2.0.12 src/typed.js 中 humanizer 的有界随机延迟公式；参考 typewrite 的逐步位置状态。',
      changes:
        '仅使用明确 MIT 的历史版本 v2.0.12；原创中文终端、Unicode 字符遍历和取消逻辑。移除 HTML 解析、循环删除、动态资源及整库，不据此宣称当前版本许可相同。',
    },
    files: [
      {
        path: 'index.html',
        content:
          '<!doctype html>\n<html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>逐字探索终端</title><link rel="stylesheet" href="style.css"><script src="app.js" defer></script></head><body><main><header><div><small>CREATIVE LAB / 文字交互</small><h1>逐字探索终端</h1><p>点击重新输入，让一句短文沿着时间轴逐字出现。</p></div><span class="tag">LOCAL UI STUDY</span></header><section class="stage"><div class="terminal"><div class="dots"><i></i><i></i><i></i><span>creative-studio / notes</span></div><div class="terminal-body"><span class="prompt">$ </span><span id="text"></span><b class="cursor">▌</b></div></div></section><div class="controls"><label>一句想法 <input id="sentence" maxlength="100" value="把好奇心写成代码，把代码变成作品。"></label><button id="replay">重新输入</button><button id="show" class="secondary">直接显示</button></div><footer>本地 UI 学习模板 · 无外部资源 · 完整来源与许可见 NOTICE.txt</footer></main></body></html>',
      },
      {
        path: 'style.css',
        content:
          '*{box-sizing:border-box}body{margin:0;font-family:Inter,ui-sans-serif,system-ui,-apple-system,sans-serif;background:var(--bg,#eef3fa);color:var(--ink,#18233a);min-height:100vh}main{width:min(880px,100%);margin:auto;padding:32px 24px 24px}header{display:flex;justify-content:space-between;gap:16px;align-items:start}small{font-size:11px;letter-spacing:.2em;text-transform:uppercase;color:var(--accent,#4866f5);font-weight:800}h1{font-size:clamp(26px,5vw,42px);letter-spacing:-.04em;margin:10px 0}p{line-height:1.65;color:var(--muted,#617087)}.tag{font-size:11px;padding:7px 11px;border:1px solid currentColor;border-radius:30px;white-space:nowrap}.stage{position:relative;min-height:320px;display:grid;place-items:center;overflow:hidden;border-radius:24px;margin:22px 0;background:var(--surface,#fff);border:1px solid #18233a14}.controls{display:flex;gap:12px;flex-wrap:wrap;align-items:center}button,select,input{font:inherit}button{cursor:pointer;border:0;border-radius:10px;padding:11px 18px;background:var(--accent,#4866f5);color:#fff;font-weight:700}button.secondary{color:var(--ink,#18233a);background:#18233a0d}button:focus-visible,input:focus-visible,select:focus-visible{outline:3px solid #8aacf9;outline-offset:3px}label{font-size:13px;display:flex;gap:10px;align-items:center}input[type=range]{accent-color:var(--accent,#4866f5);max-width:100%}.readout{font-variant-numeric:tabular-nums;font-size:13px;color:var(--muted,#617087)}footer{margin-top:24px;font-size:11px;color:var(--muted,#617087)}svg,canvas{display:block;max-width:100%}@media(max-width:520px){main{padding:24px 16px}header{display:block}.tag{display:inline-block;margin-top:8px}.stage{min-height:300px}.controls{gap:10px}}@media(prefers-reduced-motion:reduce){*,*::before,*::after{animation:none!important;transition:none!important;scroll-behavior:auto!important}}\nbody{--bg:#dbe6e1;--accent:#467a60;--muted:#637d70}.stage{background:#c4d7cb}.terminal{width:min(620px,90%);min-height:210px;border-radius:16px;background:#172f29;box-shadow:0 15px 35px #21473622;color:#d8f2df}.dots{display:flex;align-items:center;gap:7px;padding:18px;border-bottom:1px solid #ffffff15}.dots i{width:9px;height:9px;border-radius:50%;background:#8cae97}.dots i:first-child{background:#df8c7f}.dots i:nth-child(2){background:#d9c18c}.dots span{font:11px ui-monospace,monospace;margin-left:auto;color:#9fbdab}.terminal-body{padding:32px 24px;font:19px/1.8 ui-monospace,monospace;overflow-wrap:anywhere}.prompt{color:#96c9a9}.cursor{color:#e7dca5;animation:blink 1s steps(2) infinite}@keyframes blink{to{opacity:0}}input{max-width:260px;min-width:0;padding:8px;border:1px solid #a3c0af;border-radius:8px}@media(max-width:520px){label{width:100%}input{flex:1}.terminal-body{padding:24px 18px;font-size:17px}}',
      },
      {
        path: 'app.js',
        content:
          "// UI source study: https://github.com/mattboldt/typed.js @ 337109d9ac6558475eea301693e64071dafc9961\n// 迁入 v2.0.12 src/typed.js 中 humanizer 的有界随机延迟公式；参考 typewrite 的逐步位置状态。\n// See NOTICE.txt for complete upstream copyright and license.\n'use strict';\nconst reducedMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;\nconst text=document.querySelector('#text'),sentence=document.querySelector('#sentence');let timer=0;function show(){clearTimeout(timer);text.textContent=sentence.value;}function replay(){clearTimeout(timer);const chars=Array.from(sentence.value);if(reducedMotion){show();return;}let pos=0;text.textContent='';function next(){if(pos>=chars.length)return;text.textContent+=chars[pos++];const typeSpeed=48;const humanize=Math.round(Math.random()*typeSpeed/2)+typeSpeed;timer=setTimeout(next,humanize);}next();}document.querySelector('#replay').addEventListener('click',replay);document.querySelector('#show').addEventListener('click',show);show();",
      },
      {
        path: 'README.md',
        content:
          '# 逐字探索终端\n\n点击重新输入，让一句短文沿着时间轴逐字出现。\n\n## 学习步骤\n\n1. 用 textContent 安全呈现用户文本。\n2. 用取消定时器避免重入。\n3. 用有界随机延迟模拟打字节奏。\n\n## 文件与运行\n\n点击工作区“运行预览”。index.html 是结构，style.css 是布局，app.js 是交互。所有演示数据与图形在浏览器中生成，不请求外网、读取凭证或运行服务器。动画尊重系统的减少动态效果设置。\n\n## 来源与范围\n\nhttps://github.com/mattboldt/typed.js\n\n固定版本：337109d9ac6558475eea301693e64071dafc9961\n\n迁入 v2.0.12 src/typed.js 中 humanizer 的有界随机延迟公式；参考 typewrite 的逐步位置状态。\n\n仅使用明确 MIT 的历史版本 v2.0.12；原创中文终端、Unicode 字符遍历和取消逻辑。移除 HTML 解析、循环删除、动态资源及整库，不据此宣称当前版本许可相同。\n\n完整许可与归属见 NOTICE.txt，继续改写请保留该文件。\n',
      },
      {
        path: 'NOTICE.txt',
        content:
          '来源: https://github.com/mattboldt/typed.js\n固定版本: 337109d9ac6558475eea301693e64071dafc9961\n迁入范围: 迁入 v2.0.12 src/typed.js 中 humanizer 的有界随机延迟公式；参考 typewrite 的逐步位置状态。\n修改说明: 仅使用明确 MIT 的历史版本 v2.0.12；原创中文终端、Unicode 字符遍历和取消逻辑。移除 HTML 解析、循环删除、动态资源及整库，不据此宣称当前版本许可相同。\n\n完整上游许可:\nThe MIT License (MIT)\n\nCopyright (c) 2018 Matt Boldt\n\nPermission is hereby granted, free of charge, to any person obtaining a copy\nof this software and associated documentation files (the "Software"), to deal\nin the Software without restriction, including without limitation the rights\nto use, copy, modify, merge, publish, distribute, sublicense, and/or sell\ncopies of the Software, and to permit persons to whom the Software is\nfurnished to do so, subject to the following conditions:\n\nThe above copyright notice and this permission notice shall be included in\nall copies or substantial portions of the Software.\n\nTHE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR\nIMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,\nFITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE\nAUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER\nLIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,\nOUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN\nTHE SOFTWARE.\n',
      },
    ],
  },
  {
    id: 'range-window',
    title: '时间窗口筛选器',
    category: '交互组件',
    tags: ['双滑杆', '区间约束', '数据过滤'],
    description: '拖动起止边界，观察时间窗口与样本柱状图同步变化。',
    learningGoals: ['将连续滑杆映射到离散时间范围', '保证下界不超过上界', '把派生选择状态投射到图表'],
    source: {
      repository: 'https://github.com/leongersen/noUiSlider',
      commit: '57033672d07e8bac527d7147721a4a2e07e0d699',
      license: 'MIT',
      licenseText:
        'MIT License\n\nCopyright (c) 2019 Léon Gersen\n\nPermission is hereby granted, free of charge, to any person obtaining a copy\nof this software and associated documentation files (the "Software"), to deal\nin the Software without restriction, including without limitation the rights\nto use, copy, modify, merge, publish, distribute, sublicense, and/or sell\ncopies of the Software, and to permit persons to whom the Software is\nfurnished to do so, subject to the following conditions:\n\nThe above copyright notice and this permission notice shall be included in all\ncopies or substantial portions of the Software.\n\nTHE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR\nIMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,\nFITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE\nAUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER\nLIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,\nOUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE\nSOFTWARE.\n',
      files: [
        {
          title: 'src/nouislider.ts',
          url: 'https://github.com/leongersen/noUiSlider/blob/57033672d07e8bac527d7147721a4a2e07e0d699/src/nouislider.ts',
        },
        {
          title: '完整 MIT 许可',
          url: 'https://github.com/leongersen/noUiSlider/blob/57033672d07e8bac527d7147721a4a2e07e0d699/LICENSE.md',
        },
      ],
      videos: [],
      scope: '迁入 src/nouislider.ts 的 limit（0～100 百分比 clamp）函数；参考双 handle 的范围约束模式。',
      changes: '以两个原生 range 与原创柱状图替换库的非线性 Spectrum、插件与拖动实现；无表单提交或持久化。',
    },
    files: [
      {
        path: 'index.html',
        content:
          '<!doctype html>\n<html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>时间窗口筛选器</title><link rel="stylesheet" href="style.css"><script src="app.js" defer></script></head><body><main><header><div><small>CREATIVE LAB / 交互组件</small><h1>时间窗口筛选器</h1><p>拖动起止边界，观察时间窗口与样本柱状图同步变化。</p></div><span class="tag">LOCAL UI STUDY</span></header><section class="stage"><div class="filter"><small>FOCUS WINDOW</small><div id="bars"></div><div class="track"><div id="selection"></div></div><div class="labels"><span>00:00</span><b id="window"></b><span>24:00</span></div></div></section><div class="controls"><label>开始时间 <input id="start" type="range" min="0" max="23" value="7"></label><label>结束时间 <input id="end" type="range" min="1" max="24" value="18"></label><button id="all" class="secondary">全部时间</button></div><footer>本地 UI 学习模板 · 无外部资源 · 完整来源与许可见 NOTICE.txt</footer></main></body></html>',
      },
      {
        path: 'style.css',
        content:
          '*{box-sizing:border-box}body{margin:0;font-family:Inter,ui-sans-serif,system-ui,-apple-system,sans-serif;background:var(--bg,#eef3fa);color:var(--ink,#18233a);min-height:100vh}main{width:min(880px,100%);margin:auto;padding:32px 24px 24px}header{display:flex;justify-content:space-between;gap:16px;align-items:start}small{font-size:11px;letter-spacing:.2em;text-transform:uppercase;color:var(--accent,#4866f5);font-weight:800}h1{font-size:clamp(26px,5vw,42px);letter-spacing:-.04em;margin:10px 0}p{line-height:1.65;color:var(--muted,#617087)}.tag{font-size:11px;padding:7px 11px;border:1px solid currentColor;border-radius:30px;white-space:nowrap}.stage{position:relative;min-height:320px;display:grid;place-items:center;overflow:hidden;border-radius:24px;margin:22px 0;background:var(--surface,#fff);border:1px solid #18233a14}.controls{display:flex;gap:12px;flex-wrap:wrap;align-items:center}button,select,input{font:inherit}button{cursor:pointer;border:0;border-radius:10px;padding:11px 18px;background:var(--accent,#4866f5);color:#fff;font-weight:700}button.secondary{color:var(--ink,#18233a);background:#18233a0d}button:focus-visible,input:focus-visible,select:focus-visible{outline:3px solid #8aacf9;outline-offset:3px}label{font-size:13px;display:flex;gap:10px;align-items:center}input[type=range]{accent-color:var(--accent,#4866f5);max-width:100%}.readout{font-variant-numeric:tabular-nums;font-size:13px;color:var(--muted,#617087)}footer{margin-top:24px;font-size:11px;color:var(--muted,#617087)}svg,canvas{display:block;max-width:100%}@media(max-width:520px){main{padding:24px 16px}header{display:block}.tag{display:inline-block;margin-top:8px}.stage{min-height:300px}.controls{gap:10px}}@media(prefers-reduced-motion:reduce){*,*::before,*::after{animation:none!important;transition:none!important;scroll-behavior:auto!important}}\nbody{--bg:#f0f1fb;--accent:#6f67c6;--muted:#817ca6}.filter{width:min(600px,88%);padding:26px 0}.stage{background:#fff}#bars{display:flex;align-items:end;gap:5px;height:160px;margin:25px 0 14px}#bars i{flex:1;background:#dedaf3;border-radius:5px 5px 0 0;transition:background .2s}#bars i.active{background:#8678d4}.track{height:9px;background:#e5e1f3;border-radius:10px;position:relative;overflow:hidden}#selection{height:100%;background:#8678d4;position:absolute;border-radius:10px}.labels{display:flex;justify-content:space-between;gap:8px;margin-top:16px;font-size:12px;color:#817ca6}.labels b{color:#6f67c6}',
      },
      {
        path: 'app.js',
        content:
          "// UI source study: https://github.com/leongersen/noUiSlider @ 57033672d07e8bac527d7147721a4a2e07e0d699\n// 迁入 src/nouislider.ts 的 limit（0～100 百分比 clamp）函数；参考双 handle 的范围约束模式。\n// See NOTICE.txt for complete upstream copyright and license.\n'use strict';\nconst reducedMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;\nconst start=document.querySelector('#start'),end=document.querySelector('#end'),bars=document.querySelector('#bars');const heights=[22,14,12,18,33,44,72,91,65,55,73,94,78,88,100,86,97,68,59,40,35,31,22,18];heights.forEach(h=>{const i=document.createElement('i');i.style.height=h+'%';bars.append(i);});function limit(a){return Math.max(Math.min(a,100),0);}function update(from){let a=Number(start.value),b=Number(end.value);if(a>=b){if(from==='start')b=a+1;else a=b-1;}start.value=String(a);end.value=String(b);[...bars.children].forEach((bar,i)=>bar.classList.toggle('active',i>=a&&i<b));const selection=document.querySelector('#selection');selection.style.left=limit(a/24*100)+'%';selection.style.width=limit((b-a)/24*100)+'%';document.querySelector('#window').textContent=String(a).padStart(2,'0')+':00 — '+String(b).padStart(2,'0')+':00';}start.addEventListener('input',()=>update('start'));end.addEventListener('input',()=>update('end'));document.querySelector('#all').addEventListener('click',()=>{start.value='0';end.value='24';update();});update();",
      },
      {
        path: 'README.md',
        content:
          '# 时间窗口筛选器\n\n拖动起止边界，观察时间窗口与样本柱状图同步变化。\n\n## 学习步骤\n\n1. 将连续滑杆映射到离散时间范围。\n2. 保证下界不超过上界。\n3. 把派生选择状态投射到图表。\n\n## 文件与运行\n\n点击工作区“运行预览”。index.html 是结构，style.css 是布局，app.js 是交互。所有演示数据与图形在浏览器中生成，不请求外网、读取凭证或运行服务器。动画尊重系统的减少动态效果设置。\n\n## 来源与范围\n\nhttps://github.com/leongersen/noUiSlider\n\n固定版本：57033672d07e8bac527d7147721a4a2e07e0d699\n\n迁入 src/nouislider.ts 的 limit（0～100 百分比 clamp）函数；参考双 handle 的范围约束模式。\n\n以两个原生 range 与原创柱状图替换库的非线性 Spectrum、插件与拖动实现；无表单提交或持久化。\n\n完整许可与归属见 NOTICE.txt，继续改写请保留该文件。\n',
      },
      {
        path: 'NOTICE.txt',
        content:
          '来源: https://github.com/leongersen/noUiSlider\n固定版本: 57033672d07e8bac527d7147721a4a2e07e0d699\n迁入范围: 迁入 src/nouislider.ts 的 limit（0～100 百分比 clamp）函数；参考双 handle 的范围约束模式。\n修改说明: 以两个原生 range 与原创柱状图替换库的非线性 Spectrum、插件与拖动实现；无表单提交或持久化。\n\n完整上游许可:\nMIT License\n\nCopyright (c) 2019 Léon Gersen\n\nPermission is hereby granted, free of charge, to any person obtaining a copy\nof this software and associated documentation files (the "Software"), to deal\nin the Software without restriction, including without limitation the rights\nto use, copy, modify, merge, publish, distribute, sublicense, and/or sell\ncopies of the Software, and to permit persons to whom the Software is\nfurnished to do so, subject to the following conditions:\n\nThe above copyright notice and this permission notice shall be included in all\ncopies or substantial portions of the Software.\n\nTHE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR\nIMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,\nFITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE\nAUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER\nLIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,\nOUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE\nSOFTWARE.\n',
      },
    ],
  },
  {
    id: 'bezier-timing',
    title: '缓动曲线试验场',
    category: '动效工具',
    tags: ['三次 Bézier', '二分法', 'CSS timing'],
    description: '调节两个控制点，在曲线与移动小球之间建立直觉。',
    learningGoals: ['用三次多项式计算 Bézier 坐标', '用二分法反求 x 对应的参数 t', '比较线性时间与缓动时间'],
    source: {
      repository: 'https://github.com/gre/bezier-easing',
      commit: 'd3021221b2e50efad768ab88e76ccbf9d4c72498',
      license: 'MIT',
      licenseText:
        'Copyright (c) 2014 Gaëtan Renaudeau\n\nPermission is hereby granted, free of charge, to any person\nobtaining a copy of this software and associated documentation\nfiles (the "Software"), to deal in the Software without\nrestriction, including without limitation the rights to use,\ncopy, modify, merge, publish, distribute, sublicense, and/or sell\ncopies of the Software, and to permit persons to whom the\nSoftware is furnished to do so, subject to the following\nconditions:\n\nThe above copyright notice and this permission notice shall be\nincluded in all copies or substantial portions of the Software.\n\nTHE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND,\nEXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES\nOF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND\nNONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT\nHOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY,\nWHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING\nFROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR\nOTHER DEALINGS IN THE SOFTWARE.\n',
      files: [
        {
          title: 'src/index.js',
          url: 'https://github.com/gre/bezier-easing/blob/d3021221b2e50efad768ab88e76ccbf9d4c72498/src/index.js',
        },
        {
          title: '完整 MIT 许可',
          url: 'https://github.com/gre/bezier-easing/blob/d3021221b2e50efad768ab88e76ccbf9d4c72498/LICENSE',
        },
      ],
      videos: [],
      scope: '迁入 src/index.js 的 Y 三次多项式求值函数；参考 bezier(x1,y1,x2,y2) 的缓动接口。',
      changes:
        '原创 SVG 控制点和 20 次二分反解，未迁入上游代数求根器；所有控制点限定在 0～1，以有限播放替代持续动画。上游注明代数求解贡献来自 Dmitry Baranovskiy，本模板未复制该部分。',
    },
    files: [
      {
        path: 'index.html',
        content:
          '<!doctype html>\n<html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>缓动曲线试验场</title><link rel="stylesheet" href="style.css"><script src="app.js" defer></script></head><body><main><header><div><small>CREATIVE LAB / 动效工具</small><h1>缓动曲线试验场</h1><p>调节两个控制点，在曲线与移动小球之间建立直觉。</p></div><span class="tag">LOCAL UI STUDY</span></header><section class="stage"><div class="lab"><svg id="graph" viewBox="0 0 320 250" width="320" height="250" aria-label="贝塞尔缓动曲线"><path d="M30 20V220H290" fill="none" stroke="#d2c5e8"/><path id="guides" fill="none" stroke="#b39acf" stroke-dasharray="5 5"/><path id="curve" fill="none" stroke="#8054b0" stroke-width="4"/><circle id="p1" r="7" fill="#d193ba"/><circle id="p2" r="7" fill="#8054b0"/></svg><div class="lane"><i id="ball"></i></div></div></section><div class="controls"><label>控制点 1 <input id="x1" type="range" min="0" max="100" value="22"><input id="y1" type="range" min="0" max="100" value="90" aria-label="控制点 1 高度"></label><label>控制点 2 <input id="x2" type="range" min="0" max="100" value="36"><input id="y2" type="range" min="0" max="100" value="100" aria-label="控制点 2 高度"></label><button id="play">播放比较</button><output id="formula" class="readout"></output></div><footer>本地 UI 学习模板 · 无外部资源 · 完整来源与许可见 NOTICE.txt</footer></main></body></html>',
      },
      {
        path: 'style.css',
        content:
          '*{box-sizing:border-box}body{margin:0;font-family:Inter,ui-sans-serif,system-ui,-apple-system,sans-serif;background:var(--bg,#eef3fa);color:var(--ink,#18233a);min-height:100vh}main{width:min(880px,100%);margin:auto;padding:32px 24px 24px}header{display:flex;justify-content:space-between;gap:16px;align-items:start}small{font-size:11px;letter-spacing:.2em;text-transform:uppercase;color:var(--accent,#4866f5);font-weight:800}h1{font-size:clamp(26px,5vw,42px);letter-spacing:-.04em;margin:10px 0}p{line-height:1.65;color:var(--muted,#617087)}.tag{font-size:11px;padding:7px 11px;border:1px solid currentColor;border-radius:30px;white-space:nowrap}.stage{position:relative;min-height:320px;display:grid;place-items:center;overflow:hidden;border-radius:24px;margin:22px 0;background:var(--surface,#fff);border:1px solid #18233a14}.controls{display:flex;gap:12px;flex-wrap:wrap;align-items:center}button,select,input{font:inherit}button{cursor:pointer;border:0;border-radius:10px;padding:11px 18px;background:var(--accent,#4866f5);color:#fff;font-weight:700}button.secondary{color:var(--ink,#18233a);background:#18233a0d}button:focus-visible,input:focus-visible,select:focus-visible{outline:3px solid #8aacf9;outline-offset:3px}label{font-size:13px;display:flex;gap:10px;align-items:center}input[type=range]{accent-color:var(--accent,#4866f5);max-width:100%}.readout{font-variant-numeric:tabular-nums;font-size:13px;color:var(--muted,#617087)}footer{margin-top:24px;font-size:11px;color:var(--muted,#617087)}svg,canvas{display:block;max-width:100%}@media(max-width:520px){main{padding:24px 16px}header{display:block}.tag{display:inline-block;margin-top:8px}.stage{min-height:300px}.controls{gap:10px}}@media(prefers-reduced-motion:reduce){*,*::before,*::after{animation:none!important;transition:none!important;scroll-behavior:auto!important}}\nbody{--bg:#f3edf6;--accent:#8054b0;--muted:#8d769e}.stage{background:#fffafd}.lab{width:min(520px,92%);padding:10px 0 25px}#graph{margin:auto}.lane{height:16px;background:#ede2f3;border-radius:12px;position:relative;margin:6px 22px}.lane i{position:absolute;width:25px;height:25px;border-radius:50%;background:#8054b0;top:-5px;left:0;box-shadow:0 5px 8px #8054b033}label input{width:75px}.controls label{flex-wrap:wrap}',
      },
      {
        path: 'app.js',
        content:
          "// UI source study: https://github.com/gre/bezier-easing @ d3021221b2e50efad768ab88e76ccbf9d4c72498\n// 迁入 src/index.js 的 Y 三次多项式求值函数；参考 bezier(x1,y1,x2,y2) 的缓动接口。\n// See NOTICE.txt for complete upstream copyright and license.\n'use strict';\nconst reducedMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;\nconst inputs=['x1','y1','x2','y2'].map(id=>document.querySelector('#'+id));let raf=0;function params(){return inputs.map(el=>Number(el.value)/100);}const Y=(t,ay,by,cy)=>((ay*t+by)*t+cy)*t;function coordinate(t,a,b){return Y(t,3*a-3*b+1,3*(b-2*a),3*a);}function easing(x,p){let low=0,high=1;for(let i=0;i<20;i++){const t=(low+high)/2;if(coordinate(t,p[0],p[2])<x)low=t;else high=t;}return coordinate((low+high)/2,p[1],p[3]);}function draw(){const p=params();document.querySelector('#curve').setAttribute('d','M30 220C'+(30+p[0]*260)+' '+(220-p[1]*200)+','+(30+p[2]*260)+' '+(220-p[3]*200)+',290 20');document.querySelector('#guides').setAttribute('d','M30 220L'+(30+p[0]*260)+' '+(220-p[1]*200)+'M290 20L'+(30+p[2]*260)+' '+(220-p[3]*200));[document.querySelector('#p1'),document.querySelector('#p2')].forEach((el,i)=>{el.setAttribute('cx',30+p[i*2]*260);el.setAttribute('cy',220-p[i*2+1]*200);});document.querySelector('#formula').textContent='cubic-bezier('+p.join(', ')+')';}inputs.forEach(el=>el.addEventListener('input',draw));document.querySelector('#play').addEventListener('click',()=>{cancelAnimationFrame(raf);const ball=document.querySelector('#ball');const width=ball.parentElement.clientWidth-25;if(reducedMotion){ball.style.transform='translateX('+width+'px)';return;}const p=params(),start=performance.now();function frame(now){const x=Math.min((now-start)/1600,1);ball.style.transform='translateX('+(width*easing(x,p))+'px)';if(x<1)raf=requestAnimationFrame(frame);}raf=requestAnimationFrame(frame);});draw();",
      },
      {
        path: 'README.md',
        content:
          '# 缓动曲线试验场\n\n调节两个控制点，在曲线与移动小球之间建立直觉。\n\n## 学习步骤\n\n1. 用三次多项式计算 Bézier 坐标。\n2. 用二分法反求 x 对应的参数 t。\n3. 比较线性时间与缓动时间。\n\n## 文件与运行\n\n点击工作区“运行预览”。index.html 是结构，style.css 是布局，app.js 是交互。所有演示数据与图形在浏览器中生成，不请求外网、读取凭证或运行服务器。动画尊重系统的减少动态效果设置。\n\n## 来源与范围\n\nhttps://github.com/gre/bezier-easing\n\n固定版本：d3021221b2e50efad768ab88e76ccbf9d4c72498\n\n迁入 src/index.js 的 Y 三次多项式求值函数；参考 bezier(x1,y1,x2,y2) 的缓动接口。\n\n原创 SVG 控制点和 20 次二分反解，未迁入上游代数求根器；所有控制点限定在 0～1，以有限播放替代持续动画。上游注明代数求解贡献来自 Dmitry Baranovskiy，本模板未复制该部分。\n\n完整许可与归属见 NOTICE.txt，继续改写请保留该文件。\n',
      },
      {
        path: 'NOTICE.txt',
        content:
          '来源: https://github.com/gre/bezier-easing\n固定版本: d3021221b2e50efad768ab88e76ccbf9d4c72498\n迁入范围: 迁入 src/index.js 的 Y 三次多项式求值函数；参考 bezier(x1,y1,x2,y2) 的缓动接口。\n修改说明: 原创 SVG 控制点和 20 次二分反解，未迁入上游代数求根器；所有控制点限定在 0～1，以有限播放替代持续动画。上游注明代数求解贡献来自 Dmitry Baranovskiy，本模板未复制该部分。\n\n完整上游许可:\nCopyright (c) 2014 Gaëtan Renaudeau\n\nPermission is hereby granted, free of charge, to any person\nobtaining a copy of this software and associated documentation\nfiles (the "Software"), to deal in the Software without\nrestriction, including without limitation the rights to use,\ncopy, modify, merge, publish, distribute, sublicense, and/or sell\ncopies of the Software, and to permit persons to whom the\nSoftware is furnished to do so, subject to the following\nconditions:\n\nThe above copyright notice and this permission notice shall be\nincluded in all copies or substantial portions of the Software.\n\nTHE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND,\nEXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES\nOF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND\nNONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT\nHOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY,\nWHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING\nFROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR\nOTHER DEALINGS IN THE SOFTWARE.\n',
      },
    ],
  },
  {
    id: 'color-atlas',
    title: 'HSV 配色观测室',
    category: '设计工具',
    tags: ['HSV', 'RGB', '颜色转换'],
    description: '通过色相、饱和度与明度，配出一组可解释的界面颜色。',
    learningGoals: [
      '将 HSV 色相映射到六个 RGB 区间',
      '把 RGB 数字转换为十六进制字符串',
      '以不同明度派生五个色阶',
    ],
    source: {
      repository: 'https://github.com/bgrins/TinyColor',
      commit: 'b49018c9f2dbca313d80d7a4dad25e26143cfe01',
      license: 'MIT',
      licenseText:
        'Copyright (c), Brian Grinstead, http://briangrinstead.com\n\nPermission is hereby granted, free of charge, to any person obtaining\na copy of this software and associated documentation files (the\n"Software"), to deal in the Software without restriction, including\nwithout limitation the rights to use, copy, modify, merge, publish,\ndistribute, sublicense, and/or sell copies of the Software, and to\npermit persons to whom the Software is furnished to do so, subject to\nthe following conditions:\n\nThe above copyright notice and this permission notice shall be\nincluded in all copies or substantial portions of the Software.\n\nTHE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND,\nEXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF\nMERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND\nNONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE\nLIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION\nOF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION\nWITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.',
      files: [
        {
          title: 'tinycolor.js',
          url: 'https://github.com/bgrins/TinyColor/blob/b49018c9f2dbca313d80d7a4dad25e26143cfe01/tinycolor.js',
        },
        {
          title: '完整 MIT 许可',
          url: 'https://github.com/bgrins/TinyColor/blob/b49018c9f2dbca313d80d7a4dad25e26143cfe01/LICENSE',
        },
      ],
      videos: [],
      scope:
        '迁入并改写 tinycolor.js 的 hsvToRgb 六区间转换公式。上游注明该转换参考 Michael Jackson 的颜色模型转换文章。',
      changes:
        '以原生 range 输入和原创五色阶/界面卡代替 TinyColor 字符串解析、全局对象及扩展颜色名称表；仅接受界面提供的数值范围。',
    },
    files: [
      {
        path: 'index.html',
        content:
          '<!doctype html>\n<html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>HSV 配色观测室</title><link rel="stylesheet" href="style.css"><script src="app.js" defer></script></head><body><main><header><div><small>CREATIVE LAB / 设计工具</small><h1>HSV 配色观测室</h1><p>通过色相、饱和度与明度，配出一组可解释的界面颜色。</p></div><span class="tag">LOCAL UI STUDY</span></header><section class="stage"><div class="palette"><div id="swatches"></div><div class="sample"><small>COLOR SYSTEM</small><h2>颜色让结构更清楚</h2><button id="samplebutton">示例按钮</button></div></div></section><div class="controls"><label>色相 H <input id="hue" type="range" min="0" max="359" value="210"></label><label>饱和度 S <input id="sat" type="range" min="0" max="100" value="56"></label><label>明度 V <input id="val" type="range" min="20" max="100" value="78"></label><output id="color" class="readout"></output></div><footer>本地 UI 学习模板 · 无外部资源 · 完整来源与许可见 NOTICE.txt</footer></main></body></html>',
      },
      {
        path: 'style.css',
        content:
          '*{box-sizing:border-box}body{margin:0;font-family:Inter,ui-sans-serif,system-ui,-apple-system,sans-serif;background:var(--bg,#eef3fa);color:var(--ink,#18233a);min-height:100vh}main{width:min(880px,100%);margin:auto;padding:32px 24px 24px}header{display:flex;justify-content:space-between;gap:16px;align-items:start}small{font-size:11px;letter-spacing:.2em;text-transform:uppercase;color:var(--accent,#4866f5);font-weight:800}h1{font-size:clamp(26px,5vw,42px);letter-spacing:-.04em;margin:10px 0}p{line-height:1.65;color:var(--muted,#617087)}.tag{font-size:11px;padding:7px 11px;border:1px solid currentColor;border-radius:30px;white-space:nowrap}.stage{position:relative;min-height:320px;display:grid;place-items:center;overflow:hidden;border-radius:24px;margin:22px 0;background:var(--surface,#fff);border:1px solid #18233a14}.controls{display:flex;gap:12px;flex-wrap:wrap;align-items:center}button,select,input{font:inherit}button{cursor:pointer;border:0;border-radius:10px;padding:11px 18px;background:var(--accent,#4866f5);color:#fff;font-weight:700}button.secondary{color:var(--ink,#18233a);background:#18233a0d}button:focus-visible,input:focus-visible,select:focus-visible{outline:3px solid #8aacf9;outline-offset:3px}label{font-size:13px;display:flex;gap:10px;align-items:center}input[type=range]{accent-color:var(--accent,#4866f5);max-width:100%}.readout{font-variant-numeric:tabular-nums;font-size:13px;color:var(--muted,#617087)}footer{margin-top:24px;font-size:11px;color:var(--muted,#617087)}svg,canvas{display:block;max-width:100%}@media(max-width:520px){main{padding:24px 16px}header{display:block}.tag{display:inline-block;margin-top:8px}.stage{min-height:300px}.controls{gap:10px}}@media(prefers-reduced-motion:reduce){*,*::before,*::after{animation:none!important;transition:none!important;scroll-behavior:auto!important}}\nbody{--bg:#edf1f5;--accent:#517e9e;--muted:#728897}.stage{background:#fff}.palette{width:min(610px,90%);padding:22px 0}#swatches{display:flex;border-radius:14px;overflow:hidden;height:100px}#swatches div{flex:1;display:flex;align-items:end;justify-content:center;font:10px ui-monospace,monospace;padding:12px 1px;color:#fff}.sample{margin-top:24px;border:1px solid #e2e8ed;border-radius:14px;padding:24px}.sample h2{font-size:23px;margin:12px 0 20px}.controls label input{width:95px}@media(max-width:420px){#swatches div{font-size:9px}.sample{padding:18px}}',
      },
      {
        path: 'app.js',
        content:
          "// UI source study: https://github.com/bgrins/TinyColor @ b49018c9f2dbca313d80d7a4dad25e26143cfe01\n// 迁入并改写 tinycolor.js 的 hsvToRgb 六区间转换公式。上游注明该转换参考 Michael Jackson 的颜色模型转换文章。\n// See NOTICE.txt for complete upstream copyright and license.\n'use strict';\nconst reducedMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;\nconst hue=document.querySelector('#hue'),sat=document.querySelector('#sat'),val=document.querySelector('#val');function hsvToRgb(h,s,v){h=h/360*6;s/=100;v/=100;const i=Math.floor(h),f=h-i,p=v*(1-s),q=v*(1-f*s),t=v*(1-(1-f)*s),mod=i%6;return{r:[v,q,p,p,t,v][mod]*255,g:[t,v,v,q,p,p][mod]*255,b:[p,p,t,v,v,q][mod]*255};}function hex(rgb){return '#'+[rgb.r,rgb.g,rgb.b].map(x=>Math.round(x).toString(16).padStart(2,'0')).join('');}function render(){const h=Number(hue.value),s=Number(sat.value),v=Number(val.value);const color=hex(hsvToRgb(h,s,v));document.querySelector('#samplebutton').style.background=color;document.querySelector('#color').textContent=color.toUpperCase();const swatches=document.querySelector('#swatches');swatches.replaceChildren();[35,50,65,80,95].forEach(light=>{const c=hex(hsvToRgb(h,s,light));const div=document.createElement('div');div.style.background=c;div.textContent=c.toUpperCase();if(light>75)div.style.color='#142233';swatches.append(div);});} [hue,sat,val].forEach(el=>el.addEventListener('input',render));document.querySelector('#samplebutton').addEventListener('click',()=>console.log('选中配色',document.querySelector('#color').textContent));render();",
      },
      {
        path: 'README.md',
        content:
          '# HSV 配色观测室\n\n通过色相、饱和度与明度，配出一组可解释的界面颜色。\n\n## 学习步骤\n\n1. 将 HSV 色相映射到六个 RGB 区间。\n2. 把 RGB 数字转换为十六进制字符串。\n3. 以不同明度派生五个色阶。\n\n## 文件与运行\n\n点击工作区“运行预览”。index.html 是结构，style.css 是布局，app.js 是交互。所有演示数据与图形在浏览器中生成，不请求外网、读取凭证或运行服务器。动画尊重系统的减少动态效果设置。\n\n## 来源与范围\n\nhttps://github.com/bgrins/TinyColor\n\n固定版本：b49018c9f2dbca313d80d7a4dad25e26143cfe01\n\n迁入并改写 tinycolor.js 的 hsvToRgb 六区间转换公式。上游注明该转换参考 Michael Jackson 的颜色模型转换文章。\n\n以原生 range 输入和原创五色阶/界面卡代替 TinyColor 字符串解析、全局对象及扩展颜色名称表；仅接受界面提供的数值范围。\n\n完整许可与归属见 NOTICE.txt，继续改写请保留该文件。\n',
      },
      {
        path: 'NOTICE.txt',
        content:
          '来源: https://github.com/bgrins/TinyColor\n固定版本: b49018c9f2dbca313d80d7a4dad25e26143cfe01\n迁入范围: 迁入并改写 tinycolor.js 的 hsvToRgb 六区间转换公式。上游注明该转换参考 Michael Jackson 的颜色模型转换文章。\n修改说明: 以原生 range 输入和原创五色阶/界面卡代替 TinyColor 字符串解析、全局对象及扩展颜色名称表；仅接受界面提供的数值范围。\n\n完整上游许可:\nCopyright (c), Brian Grinstead, http://briangrinstead.com\n\nPermission is hereby granted, free of charge, to any person obtaining\na copy of this software and associated documentation files (the\n"Software"), to deal in the Software without restriction, including\nwithout limitation the rights to use, copy, modify, merge, publish,\ndistribute, sublicense, and/or sell copies of the Software, and to\npermit persons to whom the Software is furnished to do so, subject to\nthe following conditions:\n\nThe above copyright notice and this permission notice shall be\nincluded in all copies or substantial portions of the Software.\n\nTHE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND,\nEXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF\nMERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND\nNONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE\nLIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION\nOF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION\nWITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.',
      },
    ],
  },
  {
    id: 'poster-transform',
    title: '可编辑海报画板',
    category: '设计工具',
    tags: ['拖动', '边界约束', '缩放'],
    description: '拖动海报上的标记，再调整尺寸，体验一个最小视觉编辑器。',
    learningGoals: ['将矩形转换为完整边界坐标', '约束拖动元素不越过画板', '让指针和滑杆共用同一状态'],
    source: {
      repository: 'https://github.com/taye/interact.js',
      commit: 'a993eb8cd5cbc65f3a19e45ee24b7fedc026174f',
      license: 'MIT',
      licenseText:
        'Copyright (c) 2012-present Taye Adeyemi <dev@taye.me>\n\nPermission is hereby granted, free of charge, to any person \nobtaining a copy of this software and associated \ndocumentation files (the "Software"), to deal in the Software \nwithout restriction, including without limitation the rights \nto use, copy, modify, merge, publish, distribute, sublicense, \nand/or sell copies of the Software, and to permit persons to \nwhom the Software is furnished to do so, subject to the \nfollowing conditions:\n\nThe above copyright notice and this permission notice shall \nbe included in all copies or substantial portions of the \nSoftware.\n\nTHE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY \nKIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE \nWARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR \nPURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR \nCOPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER \nLIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR \nOTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE \nSOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.\n',
      files: [
        {
          title: 'packages/@interactjs/utils/rect.ts',
          url: 'https://github.com/taye/interact.js/blob/a993eb8cd5cbc65f3a19e45ee24b7fedc026174f/packages/@interactjs/utils/rect.ts',
        },
        {
          title: '完整 MIT 许可',
          url: 'https://github.com/taye/interact.js/blob/a993eb8cd5cbc65f3a19e45ee24b7fedc026174f/LICENSE',
        },
      ],
      videos: [],
      scope:
        '迁入 packages/@interactjs/utils/rect.ts 的 toFullRect 函数，参考 Interact.js 的拖动/约束交互模式。',
      changes:
        '原创海报、Pointer Capture、键盘移动与尺寸滑杆；不迁入手势框架、插件、惯性、resize 调度或网络资源。',
    },
    files: [
      {
        path: 'index.html',
        content:
          '<!doctype html>\n<html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>可编辑海报画板</title><link rel="stylesheet" href="style.css"><script src="app.js" defer></script></head><body><main><header><div><small>CREATIVE LAB / 设计工具</small><h1>可编辑海报画板</h1><p>拖动海报上的标记，再调整尺寸，体验一个最小视觉编辑器。</p></div><span class="tag">LOCAL UI STUDY</span></header><section class="stage" id="board"><div class="grid"></div><div id="sticker" tabindex="0" role="img" aria-label="可移动的创意标记"><span>MAKE<br>IT<br>MOVE.</span><i>✳</i></div><span class="coordinate" id="position"></span></section><div class="controls"><label>标记宽度 <input id="size" type="range" min="110" max="230" value="170"></label><button id="center" class="secondary">居中标记</button><span class="readout">触摸拖动，或聚焦标记后按方向键</span></div><footer>本地 UI 学习模板 · 无外部资源 · 完整来源与许可见 NOTICE.txt</footer></main></body></html>',
      },
      {
        path: 'style.css',
        content:
          '*{box-sizing:border-box}body{margin:0;font-family:Inter,ui-sans-serif,system-ui,-apple-system,sans-serif;background:var(--bg,#eef3fa);color:var(--ink,#18233a);min-height:100vh}main{width:min(880px,100%);margin:auto;padding:32px 24px 24px}header{display:flex;justify-content:space-between;gap:16px;align-items:start}small{font-size:11px;letter-spacing:.2em;text-transform:uppercase;color:var(--accent,#4866f5);font-weight:800}h1{font-size:clamp(26px,5vw,42px);letter-spacing:-.04em;margin:10px 0}p{line-height:1.65;color:var(--muted,#617087)}.tag{font-size:11px;padding:7px 11px;border:1px solid currentColor;border-radius:30px;white-space:nowrap}.stage{position:relative;min-height:320px;display:grid;place-items:center;overflow:hidden;border-radius:24px;margin:22px 0;background:var(--surface,#fff);border:1px solid #18233a14}.controls{display:flex;gap:12px;flex-wrap:wrap;align-items:center}button,select,input{font:inherit}button{cursor:pointer;border:0;border-radius:10px;padding:11px 18px;background:var(--accent,#4866f5);color:#fff;font-weight:700}button.secondary{color:var(--ink,#18233a);background:#18233a0d}button:focus-visible,input:focus-visible,select:focus-visible{outline:3px solid #8aacf9;outline-offset:3px}label{font-size:13px;display:flex;gap:10px;align-items:center}input[type=range]{accent-color:var(--accent,#4866f5);max-width:100%}.readout{font-variant-numeric:tabular-nums;font-size:13px;color:var(--muted,#617087)}footer{margin-top:24px;font-size:11px;color:var(--muted,#617087)}svg,canvas{display:block;max-width:100%}@media(max-width:520px){main{padding:24px 16px}header{display:block}.tag{display:inline-block;margin-top:8px}.stage{min-height:300px}.controls{gap:10px}}@media(prefers-reduced-motion:reduce){*,*::before,*::after{animation:none!important;transition:none!important;scroll-behavior:auto!important}}\nbody{--bg:#edeee5;--accent:#6a7955;--muted:#849071}.stage{background:#dce2c6;min-height:360px;touch-action:none}.grid{position:absolute;inset:0;background-image:linear-gradient(#68795722 1px,transparent 1px),linear-gradient(90deg,#68795722 1px,transparent 1px);background-size:26px 26px}#sticker{position:absolute;left:0;top:0;width:170px;height:210px;background:#f1ff7c;color:#28321f;box-shadow:7px 10px 0 #55663725;cursor:grab;border:1px solid #68795730;touch-action:none;padding:20px;border-radius:3px}#sticker span{font-size:30px;line-height:1.05;font-weight:900;letter-spacing:-.05em}#sticker i{position:absolute;right:16px;bottom:18px;font-size:50px;font-style:normal}.coordinate{position:absolute;right:18px;bottom:18px;font:11px ui-monospace,monospace;color:#6a7955}',
      },
      {
        path: 'app.js',
        content:
          "// UI source study: https://github.com/taye/interact.js @ a993eb8cd5cbc65f3a19e45ee24b7fedc026174f\n// 迁入 packages/@interactjs/utils/rect.ts 的 toFullRect 函数，参考 Interact.js 的拖动/约束交互模式。\n// See NOTICE.txt for complete upstream copyright and license.\n'use strict';\nconst reducedMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;\nconst board=document.querySelector('#board'),sticker=document.querySelector('#sticker');let x=0,y=0,drag=null;function toFullRect(rect){const{top,left,bottom,right}=rect;const width=rect.width??right-left,height=rect.height??bottom-top;return{top,left,bottom,right,width,height};}function render(){const b=toFullRect(board.getBoundingClientRect());x=Math.max(0,Math.min(x,b.width-sticker.offsetWidth));y=Math.max(0,Math.min(y,b.height-sticker.offsetHeight));sticker.style.transform='translate('+x+'px,'+y+'px)';document.querySelector('#position').textContent='x '+Math.round(x)+' / y '+Math.round(y);}function center(){x=(board.clientWidth-sticker.offsetWidth)/2;y=(board.clientHeight-sticker.offsetHeight)/2;render();}sticker.addEventListener('pointerdown',e=>{drag={px:e.clientX,py:e.clientY,x,y};sticker.setPointerCapture(e.pointerId);});sticker.addEventListener('pointermove',e=>{if(!drag)return;x=drag.x+e.clientX-drag.px;y=drag.y+e.clientY-drag.py;render();});['pointerup','pointercancel'].forEach(name=>sticker.addEventListener(name,()=>drag=null));sticker.addEventListener('keydown',e=>{const changes={ArrowLeft:[-10,0],ArrowRight:[10,0],ArrowUp:[0,-10],ArrowDown:[0,10]};if(changes[e.key]){e.preventDefault();x+=changes[e.key][0];y+=changes[e.key][1];render();}});document.querySelector('#size').addEventListener('input',e=>{const width=Number(e.target.value);sticker.style.width=width+'px';sticker.style.height=width*1.23+'px';render();});document.querySelector('#center').addEventListener('click',center);window.addEventListener('resize',render);center();",
      },
      {
        path: 'README.md',
        content:
          '# 可编辑海报画板\n\n拖动海报上的标记，再调整尺寸，体验一个最小视觉编辑器。\n\n## 学习步骤\n\n1. 将矩形转换为完整边界坐标。\n2. 约束拖动元素不越过画板。\n3. 让指针和滑杆共用同一状态。\n\n## 文件与运行\n\n点击工作区“运行预览”。index.html 是结构，style.css 是布局，app.js 是交互。所有演示数据与图形在浏览器中生成，不请求外网、读取凭证或运行服务器。动画尊重系统的减少动态效果设置。\n\n## 来源与范围\n\nhttps://github.com/taye/interact.js\n\n固定版本：a993eb8cd5cbc65f3a19e45ee24b7fedc026174f\n\n迁入 packages/@interactjs/utils/rect.ts 的 toFullRect 函数，参考 Interact.js 的拖动/约束交互模式。\n\n原创海报、Pointer Capture、键盘移动与尺寸滑杆；不迁入手势框架、插件、惯性、resize 调度或网络资源。\n\n完整许可与归属见 NOTICE.txt，继续改写请保留该文件。\n',
      },
      {
        path: 'NOTICE.txt',
        content:
          '来源: https://github.com/taye/interact.js\n固定版本: a993eb8cd5cbc65f3a19e45ee24b7fedc026174f\n迁入范围: 迁入 packages/@interactjs/utils/rect.ts 的 toFullRect 函数，参考 Interact.js 的拖动/约束交互模式。\n修改说明: 原创海报、Pointer Capture、键盘移动与尺寸滑杆；不迁入手势框架、插件、惯性、resize 调度或网络资源。\n\n完整上游许可:\nCopyright (c) 2012-present Taye Adeyemi <dev@taye.me>\n\nPermission is hereby granted, free of charge, to any person \nobtaining a copy of this software and associated \ndocumentation files (the "Software"), to deal in the Software \nwithout restriction, including without limitation the rights \nto use, copy, modify, merge, publish, distribute, sublicense, \nand/or sell copies of the Software, and to permit persons to \nwhom the Software is furnished to do so, subject to the \nfollowing conditions:\n\nThe above copyright notice and this permission notice shall \nbe included in all copies or substantial portions of the \nSoftware.\n\nTHE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY \nKIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE \nWARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR \nPURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR \nCOPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER \nLIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR \nOTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE \nSOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.\n',
      },
    ],
  },
  {
    id: 'snap-gallery',
    title: '横向故事展廊',
    category: '交互组件',
    tags: ['CSS scroll-snap', 'Carousel', '无图片布局'],
    description: '滑动原创几何海报，用滚动吸附组织一段横向故事。',
    learningGoals: [
      '用 scroll-snap-align 建立分页吸附',
      '把活动页索引与滚动位置联系起来',
      '提供按钮和触摸两种导航方式',
    ],
    source: {
      repository: 'https://github.com/nolimits4web/swiper',
      commit: 'fbf9ddb555edd2e0332e813dd69972ab9ee4b8b4',
      license: 'MIT',
      licenseText:
        'The MIT License (MIT)\n\nCopyright (c) 2019 Vladimir Kharlampidi\n\nPermission is hereby granted, free of charge, to any person obtaining a copy of\nthis software and associated documentation files (the "Software"), to deal in\nthe Software without restriction, including without limitation the rights to\nuse, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of\nthe Software, and to permit persons to whom the Software is furnished to do so,\nsubject to the following conditions:\n\nThe above copyright notice and this permission notice shall be included in all\ncopies or substantial portions of the Software.\n\nTHE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR\nIMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS\nFOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR\nCOPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER\nIN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN\nCONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.\n',
      files: [
        {
          title: 'src/core/update/updateActiveIndex.ts',
          url: 'https://github.com/nolimits4web/swiper/blob/fbf9ddb555edd2e0332e813dd69972ab9ee4b8b4/src/core/update/updateActiveIndex.ts',
        },
        {
          title: '完整 MIT 许可',
          url: 'https://github.com/nolimits4web/swiper/blob/fbf9ddb555edd2e0332e813dd69972ab9ee4b8b4/LICENSE',
        },
      ],
      videos: [],
      scope:
        '参考 Swiper README 的触摸分页/导航模式及 updateActiveIndex.ts 的活动索引概念；本模板用原生 CSS scroll-snap 与独立滚动代码实现，没有复制 Swiper 库。',
      changes:
        '仅保留三张原创 CSS 几何海报；移除图片、自动播放、框架包装器、模块加载、虚拟页、URL 历史及任何外网请求。',
    },
    files: [
      {
        path: 'index.html',
        content:
          '<!doctype html>\n<html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>横向故事展廊</title><link rel="stylesheet" href="style.css"><script src="app.js" defer></script></head><body><main><header><div><small>CREATIVE LAB / 交互组件</small><h1>横向故事展廊</h1><p>滑动原创几何海报，用滚动吸附组织一段横向故事。</p></div><span class="tag">LOCAL UI STUDY</span></header><section class="stage"><div id="carousel" tabindex="0" aria-label="几何海报展廊"><article class="slide a"><small>01 / OBSERVE</small><div class="art circle"></div><h2>观察</h2><p>从一条线、一种色彩开始。</p></article><article class="slide b"><small>02 / EXPLORE</small><div class="art square"></div><h2>探索</h2><p>给静态形状一个新的方向。</p></article><article class="slide c"><small>03 / BUILD</small><div class="art rings"></div><h2>创造</h2><p>让结构成为可感知的体验。</p></article></div></section><div class="controls"><button id="prev" class="secondary">上一张</button><button id="next">下一张</button><output id="index" class="readout" aria-live="polite">1 / 3</output></div><footer>本地 UI 学习模板 · 无外部资源 · 完整来源与许可见 NOTICE.txt</footer></main></body></html>',
      },
      {
        path: 'style.css',
        content:
          '*{box-sizing:border-box}body{margin:0;font-family:Inter,ui-sans-serif,system-ui,-apple-system,sans-serif;background:var(--bg,#eef3fa);color:var(--ink,#18233a);min-height:100vh}main{width:min(880px,100%);margin:auto;padding:32px 24px 24px}header{display:flex;justify-content:space-between;gap:16px;align-items:start}small{font-size:11px;letter-spacing:.2em;text-transform:uppercase;color:var(--accent,#4866f5);font-weight:800}h1{font-size:clamp(26px,5vw,42px);letter-spacing:-.04em;margin:10px 0}p{line-height:1.65;color:var(--muted,#617087)}.tag{font-size:11px;padding:7px 11px;border:1px solid currentColor;border-radius:30px;white-space:nowrap}.stage{position:relative;min-height:320px;display:grid;place-items:center;overflow:hidden;border-radius:24px;margin:22px 0;background:var(--surface,#fff);border:1px solid #18233a14}.controls{display:flex;gap:12px;flex-wrap:wrap;align-items:center}button,select,input{font:inherit}button{cursor:pointer;border:0;border-radius:10px;padding:11px 18px;background:var(--accent,#4866f5);color:#fff;font-weight:700}button.secondary{color:var(--ink,#18233a);background:#18233a0d}button:focus-visible,input:focus-visible,select:focus-visible{outline:3px solid #8aacf9;outline-offset:3px}label{font-size:13px;display:flex;gap:10px;align-items:center}input[type=range]{accent-color:var(--accent,#4866f5);max-width:100%}.readout{font-variant-numeric:tabular-nums;font-size:13px;color:var(--muted,#617087)}footer{margin-top:24px;font-size:11px;color:var(--muted,#617087)}svg,canvas{display:block;max-width:100%}@media(max-width:520px){main{padding:24px 16px}header{display:block}.tag{display:inline-block;margin-top:8px}.stage{min-height:300px}.controls{gap:10px}}@media(prefers-reduced-motion:reduce){*,*::before,*::after{animation:none!important;transition:none!important;scroll-behavior:auto!important}}\nbody{--bg:#f0eadf;--accent:#865537;--muted:#8c7565}.stage{background:#e1d6c2;padding:22px;min-height:340px}#carousel{display:flex;overflow-x:auto;scroll-snap-type:x mandatory;width:100%;gap:18px;scrollbar-width:thin;scrollbar-color:#ac9275 #0000}.slide{position:relative;flex:0 0 100%;scroll-snap-align:start;scroll-snap-stop:always;border-radius:18px;padding:26px;min-height:280px;overflow:hidden}.slide h2{position:relative;margin-top:135px;font-size:30px;margin-bottom:5px}.slide p{font-size:13px;margin:0;color:inherit}.a{background:#eaca82;color:#80502b}.b{background:#98b6a1;color:#264c38}.c{background:#b1a7cf;color:#423b6a}.art{position:absolute;right:35px;top:38px;width:140px;height:140px}.circle{border-radius:50%;background:repeating-radial-gradient(circle,#dfb356 0 8px,#fff4 9px 10px)}.square{background:repeating-linear-gradient(45deg,#284d3855 0 8px,#fff2 9px 10px);transform:rotate(25deg);border-radius:20px}.rings{border-radius:50%;background:repeating-radial-gradient(circle,#554b8655 0 4px,transparent 5px 14px)}@media(max-width:420px){.stage{padding:16px}.slide{padding:22px}.art{width:115px;height:115px;right:24px}.slide h2{margin-top:138px}}',
      },
      {
        path: 'app.js',
        content:
          "// UI source study: https://github.com/nolimits4web/swiper @ fbf9ddb555edd2e0332e813dd69972ab9ee4b8b4\n// 参考 Swiper README 的触摸分页/导航模式及 updateActiveIndex.ts 的活动索引概念；本模板用原生 CSS scroll-snap 与独立滚动代码实现，没有复制 Swiper 库。\n// See NOTICE.txt for complete upstream copyright and license.\n'use strict';\nconst reducedMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;\nconst carousel=document.querySelector('#carousel');let index=0;function goto(i){index=Math.max(0,Math.min(2,i));const slide=carousel.children[index];carousel.scrollTo({left:slide.offsetLeft-carousel.children[0].offsetLeft,behavior:reducedMotion?'instant':'smooth'});}carousel.addEventListener('scroll',()=>{const distance=carousel.children[1].offsetLeft-carousel.children[0].offsetLeft;index=Math.max(0,Math.min(2,Math.round(carousel.scrollLeft/distance)));document.querySelector('#index').textContent=(index+1)+' / 3';});document.querySelector('#prev').addEventListener('click',()=>goto(index-1));document.querySelector('#next').addEventListener('click',()=>goto(index+1));carousel.addEventListener('keydown',e=>{if(e.key==='ArrowRight'||e.key==='ArrowLeft'){e.preventDefault();goto(index+(e.key==='ArrowRight'?1:-1));}});",
      },
      {
        path: 'README.md',
        content:
          '# 横向故事展廊\n\n滑动原创几何海报，用滚动吸附组织一段横向故事。\n\n## 学习步骤\n\n1. 用 scroll-snap-align 建立分页吸附。\n2. 把活动页索引与滚动位置联系起来。\n3. 提供按钮和触摸两种导航方式。\n\n## 文件与运行\n\n点击工作区“运行预览”。index.html 是结构，style.css 是布局，app.js 是交互。所有演示数据与图形在浏览器中生成，不请求外网、读取凭证或运行服务器。动画尊重系统的减少动态效果设置。\n\n## 来源与范围\n\nhttps://github.com/nolimits4web/swiper\n\n固定版本：fbf9ddb555edd2e0332e813dd69972ab9ee4b8b4\n\n参考 Swiper README 的触摸分页/导航模式及 updateActiveIndex.ts 的活动索引概念；本模板用原生 CSS scroll-snap 与独立滚动代码实现，没有复制 Swiper 库。\n\n仅保留三张原创 CSS 几何海报；移除图片、自动播放、框架包装器、模块加载、虚拟页、URL 历史及任何外网请求。\n\n完整许可与归属见 NOTICE.txt，继续改写请保留该文件。\n',
      },
      {
        path: 'NOTICE.txt',
        content:
          '来源: https://github.com/nolimits4web/swiper\n固定版本: fbf9ddb555edd2e0332e813dd69972ab9ee4b8b4\n迁入范围: 参考 Swiper README 的触摸分页/导航模式及 updateActiveIndex.ts 的活动索引概念；本模板用原生 CSS scroll-snap 与独立滚动代码实现，没有复制 Swiper 库。\n修改说明: 仅保留三张原创 CSS 几何海报；移除图片、自动播放、框架包装器、模块加载、虚拟页、URL 历史及任何外网请求。\n\n完整上游许可:\nThe MIT License (MIT)\n\nCopyright (c) 2019 Vladimir Kharlampidi\n\nPermission is hereby granted, free of charge, to any person obtaining a copy of\nthis software and associated documentation files (the "Software"), to deal in\nthe Software without restriction, including without limitation the rights to\nuse, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of\nthe Software, and to permit persons to whom the Software is furnished to do so,\nsubject to the following conditions:\n\nThe above copyright notice and this permission notice shall be included in all\ncopies or substantial portions of the Software.\n\nTHE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR\nIMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS\nFOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR\nCOPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER\nIN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN\nCONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.\n',
      },
    ],
  },
  {
    id: 'donut-observatory',
    title: '环形数据观测站',
    category: '数据可视化',
    tags: ['Canvas', '弧度', '交互图例'],
    description: '切换图例并调整样本，理解份额如何转换成环形图弧度。',
    learningGoals: ['求可见数据的绝对值总和', '把 value / total 映射成 2π 弧度', '让图例状态驱动可视化重绘'],
    source: {
      repository: 'https://github.com/chartjs/Chart.js',
      commit: '7169e65147a47f3720957a6f156a33c838ab9f57',
      license: 'MIT',
      licenseText:
        'The MIT License (MIT)\n\nCopyright (c) 2014-2024 Chart.js Contributors\n\nPermission is hereby granted, free of charge, to any person obtaining a copy of this software and associated documentation files (the "Software"), to deal in the Software without restriction, including without limitation the rights to use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of the Software, and to permit persons to whom the Software is furnished to do so, subject to the following conditions:\n\nThe above copyright notice and this permission notice shall be included in all copies or substantial portions of the Software.\n\nTHE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.\n',
      files: [
        {
          title: 'src/controllers/controller.doughnut.js',
          url: 'https://github.com/chartjs/Chart.js/blob/7169e65147a47f3720957a6f156a33c838ab9f57/src/controllers/controller.doughnut.js',
        },
        {
          title: '完整 MIT 许可',
          url: 'https://github.com/chartjs/Chart.js/blob/7169e65147a47f3720957a6f156a33c838ab9f57/LICENSE.md',
        },
      ],
      videos: [],
      scope:
        '迁入并改写 src/controllers/controller.doughnut.js 的 calculateCircumference 份额到弧度公式，参考 calculateTotal 的可见值求和。',
      changes:
        '原创 Canvas 环形图、数据样本与图例；不迁入 Chart.js 的控制器、坐标系统、插件或任何真实学习数据。',
    },
    files: [
      {
        path: 'index.html',
        content:
          '<!doctype html>\n<html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>环形数据观测站</title><link rel="stylesheet" href="style.css"><script src="app.js" defer></script></head><body><main><header><div><small>CREATIVE LAB / 数据可视化</small><h1>环形数据观测站</h1><p>切换图例并调整样本，理解份额如何转换成环形图弧度。</p></div><span class="tag">LOCAL UI STUDY</span></header><section class="stage"><div class="dashboard"><canvas id="chart" width="340" height="300" aria-label="学习时间环形图"></canvas><div class="legend" id="legend"></div></div></section><div class="controls"><button id="random">生成新样本</button><output id="total" class="readout" aria-live="polite"></output></div><footer>本地 UI 学习模板 · 无外部资源 · 完整来源与许可见 NOTICE.txt</footer></main></body></html>',
      },
      {
        path: 'style.css',
        content:
          '*{box-sizing:border-box}body{margin:0;font-family:Inter,ui-sans-serif,system-ui,-apple-system,sans-serif;background:var(--bg,#eef3fa);color:var(--ink,#18233a);min-height:100vh}main{width:min(880px,100%);margin:auto;padding:32px 24px 24px}header{display:flex;justify-content:space-between;gap:16px;align-items:start}small{font-size:11px;letter-spacing:.2em;text-transform:uppercase;color:var(--accent,#4866f5);font-weight:800}h1{font-size:clamp(26px,5vw,42px);letter-spacing:-.04em;margin:10px 0}p{line-height:1.65;color:var(--muted,#617087)}.tag{font-size:11px;padding:7px 11px;border:1px solid currentColor;border-radius:30px;white-space:nowrap}.stage{position:relative;min-height:320px;display:grid;place-items:center;overflow:hidden;border-radius:24px;margin:22px 0;background:var(--surface,#fff);border:1px solid #18233a14}.controls{display:flex;gap:12px;flex-wrap:wrap;align-items:center}button,select,input{font:inherit}button{cursor:pointer;border:0;border-radius:10px;padding:11px 18px;background:var(--accent,#4866f5);color:#fff;font-weight:700}button.secondary{color:var(--ink,#18233a);background:#18233a0d}button:focus-visible,input:focus-visible,select:focus-visible{outline:3px solid #8aacf9;outline-offset:3px}label{font-size:13px;display:flex;gap:10px;align-items:center}input[type=range]{accent-color:var(--accent,#4866f5);max-width:100%}.readout{font-variant-numeric:tabular-nums;font-size:13px;color:var(--muted,#617087)}footer{margin-top:24px;font-size:11px;color:var(--muted,#617087)}svg,canvas{display:block;max-width:100%}@media(max-width:520px){main{padding:24px 16px}header{display:block}.tag{display:inline-block;margin-top:8px}.stage{min-height:300px}.controls{gap:10px}}@media(prefers-reduced-motion:reduce){*,*::before,*::after{animation:none!important;transition:none!important;scroll-behavior:auto!important}}\nbody{--bg:#eaf0f6;--accent:#46699c;--muted:#6f849d}.stage{background:#fff}.dashboard{display:flex;align-items:center;gap:24px;padding:24px}.legend{min-width:150px}.legend button{display:flex;align-items:center;width:100%;justify-content:space-between;gap:12px;margin:12px 0;background:#f1f5f8;color:#3a526f;font-size:13px;padding:11px 13px}.legend i{height:9px;width:9px;border-radius:50%}.legend .off{opacity:.4}.legend span{flex:1;text-align:left}@media(max-width:600px){.dashboard{display:block;padding:18px}.legend{display:grid;grid-template-columns:1fr 1fr;gap:0 12px}.legend button{margin:6px 0}#chart{height:260px;width:300px}}',
      },
      {
        path: 'app.js',
        content:
          "// UI source study: https://github.com/chartjs/Chart.js @ 7169e65147a47f3720957a6f156a33c838ab9f57\n// 迁入并改写 src/controllers/controller.doughnut.js 的 calculateCircumference 份额到弧度公式，参考 calculateTotal 的可见值求和。\n// See NOTICE.txt for complete upstream copyright and license.\n'use strict';\nconst reducedMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;\nconst c=document.querySelector('#chart'),ctx=c.getContext('2d');const labels=['阅读','练习','编程','复习'],colors=['#799cc0','#96b5a1','#d6b17e','#a99ac4'];let values=[32,24,28,16],visible=[true,true,true,true];function circumference(value,total){return total>0&&!isNaN(value)?Math.PI*2*(Math.abs(value)/total):0;}function draw(){const total=values.reduce((sum,v,i)=>sum+(visible[i]?Math.abs(v):0),0);ctx.clearRect(0,0,340,300);let angle=-Math.PI/2;values.forEach((v,i)=>{if(!visible[i])return;const sweep=circumference(v,total);ctx.beginPath();ctx.strokeStyle=colors[i];ctx.lineWidth=36;ctx.arc(170,150,100,angle+.018,angle+sweep-.018);ctx.stroke();angle+=sweep;});ctx.textAlign='center';ctx.fillStyle='#3a526f';ctx.font='bold 38px system-ui';ctx.fillText(String(total),170,155);ctx.fillStyle='#8a9baf';ctx.font='12px system-ui';ctx.fillText('TOTAL MINUTES',170,179);const legend=document.querySelector('#legend');legend.replaceChildren();labels.forEach((label,i)=>{const b=document.createElement('button');b.classList.toggle('off',!visible[i]);b.setAttribute('aria-pressed',String(visible[i]));const dot=document.createElement('i');dot.style.background=colors[i];const text=document.createElement('span');text.textContent=label;const count=document.createElement('b');count.textContent=String(values[i]);b.append(dot,text,count);b.addEventListener('click',()=>{visible[i]=!visible[i];draw();});legend.append(b);});document.querySelector('#total').textContent='当前可见总量：'+total+' 分钟';}document.querySelector('#random').addEventListener('click',()=>{values=values.map(()=>10+Math.floor(Math.random()*40));draw();});draw();",
      },
      {
        path: 'README.md',
        content:
          '# 环形数据观测站\n\n切换图例并调整样本，理解份额如何转换成环形图弧度。\n\n## 学习步骤\n\n1. 求可见数据的绝对值总和。\n2. 把 value / total 映射成 2π 弧度。\n3. 让图例状态驱动可视化重绘。\n\n## 文件与运行\n\n点击工作区“运行预览”。index.html 是结构，style.css 是布局，app.js 是交互。所有演示数据与图形在浏览器中生成，不请求外网、读取凭证或运行服务器。动画尊重系统的减少动态效果设置。\n\n## 来源与范围\n\nhttps://github.com/chartjs/Chart.js\n\n固定版本：7169e65147a47f3720957a6f156a33c838ab9f57\n\n迁入并改写 src/controllers/controller.doughnut.js 的 calculateCircumference 份额到弧度公式，参考 calculateTotal 的可见值求和。\n\n原创 Canvas 环形图、数据样本与图例；不迁入 Chart.js 的控制器、坐标系统、插件或任何真实学习数据。\n\n完整许可与归属见 NOTICE.txt，继续改写请保留该文件。\n',
      },
      {
        path: 'NOTICE.txt',
        content:
          '来源: https://github.com/chartjs/Chart.js\n固定版本: 7169e65147a47f3720957a6f156a33c838ab9f57\n迁入范围: 迁入并改写 src/controllers/controller.doughnut.js 的 calculateCircumference 份额到弧度公式，参考 calculateTotal 的可见值求和。\n修改说明: 原创 Canvas 环形图、数据样本与图例；不迁入 Chart.js 的控制器、坐标系统、插件或任何真实学习数据。\n\n完整上游许可:\nThe MIT License (MIT)\n\nCopyright (c) 2014-2024 Chart.js Contributors\n\nPermission is hereby granted, free of charge, to any person obtaining a copy of this software and associated documentation files (the "Software"), to deal in the Software without restriction, including without limitation the rights to use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of the Software, and to permit persons to whom the Software is furnished to do so, subject to the following conditions:\n\nThe above copyright notice and this permission notice shall be included in all copies or substantial portions of the Software.\n\nTHE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.\n',
      },
    ],
  },
  {
    id: 'gravity-bowl',
    title: '重力小球试验箱',
    category: '物理交互',
    tags: ['Verlet', '边界碰撞', '帧预算'],
    description: '投放小球，调节重力与空气阻力，观察边界回弹。',
    learningGoals: ['从当前位置与前一帧位置推导速度', '用摩擦系数衰减运动', '在边界修正位置并保留回弹速度'],
    source: {
      repository: 'https://github.com/liabru/matter-js',
      commit: 'b8ee71cd7f9b49f53639ddaedd6254f1929bcbe5',
      license: 'MIT',
      licenseText:
        'The MIT License (MIT)\n\nCopyright (c) Liam Brummitt and contributors.\n\nPermission is hereby granted, free of charge, to any person obtaining a copy\nof this software and associated documentation files (the "Software"), to deal\nin the Software without restriction, including without limitation the rights\nto use, copy, modify, merge, publish, distribute, sublicense, and/or sell\ncopies of the Software, and to permit persons to whom the Software is\nfurnished to do so, subject to the following conditions:\n\nThe above copyright notice and this permission notice shall be included in\nall copies or substantial portions of the Software.\n\nTHE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR\nIMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,\nFITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE\nAUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER\nLIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,\nOUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN\nTHE SOFTWARE.',
      files: [
        {
          title: 'src/body/Body.js',
          url: 'https://github.com/liabru/matter-js/blob/b8ee71cd7f9b49f53639ddaedd6254f1929bcbe5/src/body/Body.js',
        },
        {
          title: '完整 MIT 许可',
          url: 'https://github.com/liabru/matter-js/blob/b8ee71cd7f9b49f53639ddaedd6254f1929bcbe5/LICENSE',
        },
      ],
      videos: [],
      scope:
        '迁入并简化 src/body/Body.js 中 Body.update 的位置差推导速度与 frictionAir 衰减/Verlet 积分结构。',
      changes:
        '仅实现最多 15 个圆形的重力和容器边界碰撞；没有迁入 Matter.js 的刚体求解器、物体间碰撞、约束或完整引擎。每次操作最多模拟 600 帧，不持续后台运行。',
    },
    files: [
      {
        path: 'index.html',
        content:
          '<!doctype html>\n<html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>重力小球试验箱</title><link rel="stylesheet" href="style.css"><script src="app.js" defer></script></head><body><main><header><div><small>CREATIVE LAB / 物理交互</small><h1>重力小球试验箱</h1><p>投放小球，调节重力与空气阻力，观察边界回弹。</p></div><span class="tag">LOCAL UI STUDY</span></header><section class="stage"><canvas id="canvas" width="720" height="340" aria-label="重力小球模拟"></canvas></section><div class="controls"><button id="drop">投放小球</button><label>重力 <input id="gravity" type="range" min="0" max="100" value="45"></label><label>阻力 <input id="friction" type="range" min="0" max="12" value="2"></label><button id="reset" class="secondary">清空</button><output id="status" class="readout">3 个小球</output></div><footer>本地 UI 学习模板 · 无外部资源 · 完整来源与许可见 NOTICE.txt</footer></main></body></html>',
      },
      {
        path: 'style.css',
        content:
          '*{box-sizing:border-box}body{margin:0;font-family:Inter,ui-sans-serif,system-ui,-apple-system,sans-serif;background:var(--bg,#eef3fa);color:var(--ink,#18233a);min-height:100vh}main{width:min(880px,100%);margin:auto;padding:32px 24px 24px}header{display:flex;justify-content:space-between;gap:16px;align-items:start}small{font-size:11px;letter-spacing:.2em;text-transform:uppercase;color:var(--accent,#4866f5);font-weight:800}h1{font-size:clamp(26px,5vw,42px);letter-spacing:-.04em;margin:10px 0}p{line-height:1.65;color:var(--muted,#617087)}.tag{font-size:11px;padding:7px 11px;border:1px solid currentColor;border-radius:30px;white-space:nowrap}.stage{position:relative;min-height:320px;display:grid;place-items:center;overflow:hidden;border-radius:24px;margin:22px 0;background:var(--surface,#fff);border:1px solid #18233a14}.controls{display:flex;gap:12px;flex-wrap:wrap;align-items:center}button,select,input{font:inherit}button{cursor:pointer;border:0;border-radius:10px;padding:11px 18px;background:var(--accent,#4866f5);color:#fff;font-weight:700}button.secondary{color:var(--ink,#18233a);background:#18233a0d}button:focus-visible,input:focus-visible,select:focus-visible{outline:3px solid #8aacf9;outline-offset:3px}label{font-size:13px;display:flex;gap:10px;align-items:center}input[type=range]{accent-color:var(--accent,#4866f5);max-width:100%}.readout{font-variant-numeric:tabular-nums;font-size:13px;color:var(--muted,#617087)}footer{margin-top:24px;font-size:11px;color:var(--muted,#617087)}svg,canvas{display:block;max-width:100%}@media(max-width:520px){main{padding:24px 16px}header{display:block}.tag{display:inline-block;margin-top:8px}.stage{min-height:300px}.controls{gap:10px}}@media(prefers-reduced-motion:reduce){*,*::before,*::after{animation:none!important;transition:none!important;scroll-behavior:auto!important}}\nbody{--bg:#eee8f2;--accent:#805e9f;--muted:#8b749b}.stage{background:linear-gradient(#faf6fd,#e3d6eb)}canvas{width:100%;height:340px}.controls label input{width:95px}',
      },
      {
        path: 'app.js',
        content:
          "// UI source study: https://github.com/liabru/matter-js @ b8ee71cd7f9b49f53639ddaedd6254f1929bcbe5\n// 迁入并简化 src/body/Body.js 中 Body.update 的位置差推导速度与 frictionAir 衰减/Verlet 积分结构。\n// See NOTICE.txt for complete upstream copyright and license.\n'use strict';\nconst reducedMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;\nconst c=document.querySelector('#canvas'),ctx=c.getContext('2d');const colors=['#a28cbb','#e3b89f','#94b0b9','#c6bb86'];let balls=[{x:270,y:314,px:270,py:314,r:18,color:colors[0]},{x:370,y:314,px:370,py:314,r:18,color:colors[1]},{x:440,y:314,px:440,py:314,r:18,color:colors[2]}],raf=0,frames=0,last=0;function draw(){ctx.clearRect(0,0,720,340);ctx.fillStyle='#ad99ba';ctx.fillRect(18,332,684,3);balls.forEach(b=>{ctx.fillStyle=b.color;ctx.beginPath();ctx.arc(b.x,b.y,b.r,0,Math.PI*2);ctx.fill();ctx.fillStyle='#ffffff55';ctx.beginPath();ctx.arc(b.x-5,b.y-6,5,0,Math.PI*2);ctx.fill();});document.querySelector('#status').textContent=balls.length+' 个小球（最多 15 个）';}function step(){const air=1-Number(document.querySelector('#friction').value)/100,g=Number(document.querySelector('#gravity').value)/100;balls.forEach(b=>{const vx=(b.x-b.px)*air,vy=(b.y-b.py)*air+g;b.px=b.x;b.py=b.y;b.x+=vx;b.y+=vy;if(b.x<18+b.r||b.x>702-b.r){b.x=Math.max(18+b.r,Math.min(702-b.r,b.x));b.px=b.x+vx*.72;}if(b.y>332-b.r){b.y=332-b.r;b.py=b.y+vy*.68;}if(b.y<b.r){b.y=b.r;b.py=b.y+vy*.68;}});}function frame(now){if(document.hidden){raf=0;return;}if(now-last>15){step();draw();last=now;frames++;}if(frames<600)raf=requestAnimationFrame(frame);else raf=0;}function start(){if(reducedMotion){draw();return;}frames=0;if(!raf)raf=requestAnimationFrame(frame);}document.querySelector('#drop').addEventListener('click',()=>{if(balls.length>=15)return;const x=100+Math.random()*520,y=reducedMotion?314:35;balls.push({x,y,px:x+(Math.random()-.5)*8,py:y,r:18,color:colors[balls.length%4]});start();draw();});document.querySelector('#reset').addEventListener('click',()=>{balls=[];cancelAnimationFrame(raf);raf=0;draw();});['gravity','friction'].forEach(id=>document.querySelector('#'+id).addEventListener('input',start));document.addEventListener('visibilitychange',()=>{if(!document.hidden)start();});draw();",
      },
      {
        path: 'README.md',
        content:
          '# 重力小球试验箱\n\n投放小球，调节重力与空气阻力，观察边界回弹。\n\n## 学习步骤\n\n1. 从当前位置与前一帧位置推导速度。\n2. 用摩擦系数衰减运动。\n3. 在边界修正位置并保留回弹速度。\n\n## 文件与运行\n\n点击工作区“运行预览”。index.html 是结构，style.css 是布局，app.js 是交互。所有演示数据与图形在浏览器中生成，不请求外网、读取凭证或运行服务器。动画尊重系统的减少动态效果设置。\n\n## 来源与范围\n\nhttps://github.com/liabru/matter-js\n\n固定版本：b8ee71cd7f9b49f53639ddaedd6254f1929bcbe5\n\n迁入并简化 src/body/Body.js 中 Body.update 的位置差推导速度与 frictionAir 衰减/Verlet 积分结构。\n\n仅实现最多 15 个圆形的重力和容器边界碰撞；没有迁入 Matter.js 的刚体求解器、物体间碰撞、约束或完整引擎。每次操作最多模拟 600 帧，不持续后台运行。\n\n完整许可与归属见 NOTICE.txt，继续改写请保留该文件。\n',
      },
      {
        path: 'NOTICE.txt',
        content:
          '来源: https://github.com/liabru/matter-js\n固定版本: b8ee71cd7f9b49f53639ddaedd6254f1929bcbe5\n迁入范围: 迁入并简化 src/body/Body.js 中 Body.update 的位置差推导速度与 frictionAir 衰减/Verlet 积分结构。\n修改说明: 仅实现最多 15 个圆形的重力和容器边界碰撞；没有迁入 Matter.js 的刚体求解器、物体间碰撞、约束或完整引擎。每次操作最多模拟 600 帧，不持续后台运行。\n\n完整上游许可:\nThe MIT License (MIT)\n\nCopyright (c) Liam Brummitt and contributors.\n\nPermission is hereby granted, free of charge, to any person obtaining a copy\nof this software and associated documentation files (the "Software"), to deal\nin the Software without restriction, including without limitation the rights\nto use, copy, modify, merge, publish, distribute, sublicense, and/or sell\ncopies of the Software, and to permit persons to whom the Software is\nfurnished to do so, subject to the following conditions:\n\nThe above copyright notice and this permission notice shall be included in\nall copies or substantial portions of the Software.\n\nTHE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR\nIMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,\nFITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE\nAUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER\nLIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,\nOUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN\nTHE SOFTWARE.',
      },
    ],
  },
  {
    id: 'wireframe-orbit',
    title: '线框空间观察器',
    category: '空间交互',
    tags: ['3D 投影', '矩阵', 'Canvas'],
    description: '旋转一枚线框立方体，用二维画布理解三维投影。',
    learningGoals: ['用两个旋转角变换三维顶点', '在齐次矩阵变换后除以 w', '将顶点和边组合成线框图'],
    source: {
      repository: 'https://github.com/mrdoob/three.js',
      commit: 'd4f1373ea73704daae13281ff7e8c48761e777b3',
      license: 'MIT',
      licenseText:
        'The MIT License\n\nCopyright © 2010-2026 three.js authors\n\nPermission is hereby granted, free of charge, to any person obtaining a copy\nof this software and associated documentation files (the "Software"), to deal\nin the Software without restriction, including without limitation the rights\nto use, copy, modify, merge, publish, distribute, sublicense, and/or sell\ncopies of the Software, and to permit persons to whom the Software is\nfurnished to do so, subject to the following conditions:\n\nThe above copyright notice and this permission notice shall be included in\nall copies or substantial portions of the Software.\n\nTHE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR\nIMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,\nFITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE\nAUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER\nLIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,\nOUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN\nTHE SOFTWARE.\n',
      files: [
        {
          title: 'src/math/Vector3.js',
          url: 'https://github.com/mrdoob/three.js/blob/d4f1373ea73704daae13281ff7e8c48761e777b3/src/math/Vector3.js',
        },
        {
          title: '完整 MIT 许可',
          url: 'https://github.com/mrdoob/three.js/blob/d4f1373ea73704daae13281ff7e8c48761e777b3/LICENSE',
        },
      ],
      videos: [],
      scope: '迁入并改写 src/math/Vector3.js 的 applyMatrix4 齐次坐标变换和透视除法计算。',
      changes:
        '原创八个立方体顶点、十二条边、旋转与 Canvas 渲染；不迁入 Three.js WebGL 渲染器、着色器、模型加载器或场景系统，不要求 GPU 或外部模型。',
    },
    files: [
      {
        path: 'index.html',
        content:
          '<!doctype html>\n<html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>线框空间观察器</title><link rel="stylesheet" href="style.css"><script src="app.js" defer></script></head><body><main><header><div><small>CREATIVE LAB / 空间交互</small><h1>线框空间观察器</h1><p>旋转一枚线框立方体，用二维画布理解三维投影。</p></div><span class="tag">LOCAL UI STUDY</span></header><section class="stage"><canvas id="canvas" width="720" height="340" aria-label="可旋转的三维立方体"></canvas></section><div class="controls"><label>水平角度 <input id="yaw" type="range" min="-180" max="180" value="32"></label><label>俯仰角度 <input id="pitch" type="range" min="-90" max="90" value="22"></label><button id="reset" class="secondary">重置视角</button><output id="angles" class="readout"></output></div><footer>本地 UI 学习模板 · 无外部资源 · 完整来源与许可见 NOTICE.txt</footer></main></body></html>',
      },
      {
        path: 'style.css',
        content:
          '*{box-sizing:border-box}body{margin:0;font-family:Inter,ui-sans-serif,system-ui,-apple-system,sans-serif;background:var(--bg,#eef3fa);color:var(--ink,#18233a);min-height:100vh}main{width:min(880px,100%);margin:auto;padding:32px 24px 24px}header{display:flex;justify-content:space-between;gap:16px;align-items:start}small{font-size:11px;letter-spacing:.2em;text-transform:uppercase;color:var(--accent,#4866f5);font-weight:800}h1{font-size:clamp(26px,5vw,42px);letter-spacing:-.04em;margin:10px 0}p{line-height:1.65;color:var(--muted,#617087)}.tag{font-size:11px;padding:7px 11px;border:1px solid currentColor;border-radius:30px;white-space:nowrap}.stage{position:relative;min-height:320px;display:grid;place-items:center;overflow:hidden;border-radius:24px;margin:22px 0;background:var(--surface,#fff);border:1px solid #18233a14}.controls{display:flex;gap:12px;flex-wrap:wrap;align-items:center}button,select,input{font:inherit}button{cursor:pointer;border:0;border-radius:10px;padding:11px 18px;background:var(--accent,#4866f5);color:#fff;font-weight:700}button.secondary{color:var(--ink,#18233a);background:#18233a0d}button:focus-visible,input:focus-visible,select:focus-visible{outline:3px solid #8aacf9;outline-offset:3px}label{font-size:13px;display:flex;gap:10px;align-items:center}input[type=range]{accent-color:var(--accent,#4866f5);max-width:100%}.readout{font-variant-numeric:tabular-nums;font-size:13px;color:var(--muted,#617087)}footer{margin-top:24px;font-size:11px;color:var(--muted,#617087)}svg,canvas{display:block;max-width:100%}@media(max-width:520px){main{padding:24px 16px}header{display:block}.tag{display:inline-block;margin-top:8px}.stage{min-height:300px}.controls{gap:10px}}@media(prefers-reduced-motion:reduce){*,*::before,*::after{animation:none!important;transition:none!important;scroll-behavior:auto!important}}\nbody{--bg:#172536;--surface:#0f1c2b;--ink:#e5eef7;--accent:#71abc2;--muted:#8aaac3}.stage{background:radial-gradient(circle,#203b50,#0f1c2b)}canvas{width:100%;height:340px}button.secondary{color:#c5e7f4;background:#ffffff15}',
      },
      {
        path: 'app.js',
        content:
          "// UI source study: https://github.com/mrdoob/three.js @ d4f1373ea73704daae13281ff7e8c48761e777b3\n// 迁入并改写 src/math/Vector3.js 的 applyMatrix4 齐次坐标变换和透视除法计算。\n// See NOTICE.txt for complete upstream copyright and license.\n'use strict';\nconst reducedMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;\nconst c=document.querySelector('#canvas'),ctx=c.getContext('2d'),yaw=document.querySelector('#yaw'),pitch=document.querySelector('#pitch');const vertices=[[-90,-90,-90],[90,-90,-90],[90,90,-90],[-90,90,-90],[-90,-90,90],[90,-90,90],[90,90,90],[-90,90,90]],edges=[[0,1],[1,2],[2,3],[3,0],[4,5],[5,6],[6,7],[7,4],[0,4],[1,5],[2,6],[3,7]];function applyMatrix4(p,e){const{x,y,z}=p,w=1/(e[3]*x+e[7]*y+e[11]*z+e[15]);return{x:(e[0]*x+e[4]*y+e[8]*z+e[12])*w,y:(e[1]*x+e[5]*y+e[9]*z+e[13])*w,z:(e[2]*x+e[6]*y+e[10]*z+e[14])*w};}function draw(){const a=Number(yaw.value)*Math.PI/180,b=Number(pitch.value)*Math.PI/180;const points=vertices.map(([x,y,z])=>{const rx=x*Math.cos(a)+z*Math.sin(a),rz=-x*Math.sin(a)+z*Math.cos(a);return applyMatrix4({x:rx,y:y*Math.cos(b)-rz*Math.sin(b),z:y*Math.sin(b)+rz*Math.cos(b)},[470,0,0,0,0,470,0,0,0,0,1,1,0,0,0,400]);});ctx.clearRect(0,0,720,340);ctx.strokeStyle='#71abc244';ctx.lineWidth=1;for(let i=0;i<9;i++){ctx.beginPath();ctx.moveTo(100+i*65,300);ctx.lineTo(360+(i-4)*10,180);ctx.stroke();}ctx.strokeStyle='#91cee0';ctx.lineWidth=2;edges.forEach(([i,j])=>{ctx.beginPath();ctx.moveTo(360+points[i].x,160+points[i].y);ctx.lineTo(360+points[j].x,160+points[j].y);ctx.stroke();});points.forEach((p,i)=>{ctx.fillStyle='#d4eff7';ctx.beginPath();ctx.arc(360+p.x,160+p.y,4,0,Math.PI*2);ctx.fill();ctx.fillStyle='#8eb3c9';ctx.font='10px monospace';ctx.fillText(String(i),369+p.x,154+p.y);});document.querySelector('#angles').textContent='Yaw '+yaw.value+'° / Pitch '+pitch.value+'°';}[yaw,pitch].forEach(el=>el.addEventListener('input',draw));document.querySelector('#reset').addEventListener('click',()=>{yaw.value='32';pitch.value='22';draw();});draw();",
      },
      {
        path: 'README.md',
        content:
          '# 线框空间观察器\n\n旋转一枚线框立方体，用二维画布理解三维投影。\n\n## 学习步骤\n\n1. 用两个旋转角变换三维顶点。\n2. 在齐次矩阵变换后除以 w。\n3. 将顶点和边组合成线框图。\n\n## 文件与运行\n\n点击工作区“运行预览”。index.html 是结构，style.css 是布局，app.js 是交互。所有演示数据与图形在浏览器中生成，不请求外网、读取凭证或运行服务器。动画尊重系统的减少动态效果设置。\n\n## 来源与范围\n\nhttps://github.com/mrdoob/three.js\n\n固定版本：d4f1373ea73704daae13281ff7e8c48761e777b3\n\n迁入并改写 src/math/Vector3.js 的 applyMatrix4 齐次坐标变换和透视除法计算。\n\n原创八个立方体顶点、十二条边、旋转与 Canvas 渲染；不迁入 Three.js WebGL 渲染器、着色器、模型加载器或场景系统，不要求 GPU 或外部模型。\n\n完整许可与归属见 NOTICE.txt，继续改写请保留该文件。\n',
      },
      {
        path: 'NOTICE.txt',
        content:
          '来源: https://github.com/mrdoob/three.js\n固定版本: d4f1373ea73704daae13281ff7e8c48761e777b3\n迁入范围: 迁入并改写 src/math/Vector3.js 的 applyMatrix4 齐次坐标变换和透视除法计算。\n修改说明: 原创八个立方体顶点、十二条边、旋转与 Canvas 渲染；不迁入 Three.js WebGL 渲染器、着色器、模型加载器或场景系统，不要求 GPU 或外部模型。\n\n完整上游许可:\nThe MIT License\n\nCopyright © 2010-2026 three.js authors\n\nPermission is hereby granted, free of charge, to any person obtaining a copy\nof this software and associated documentation files (the "Software"), to deal\nin the Software without restriction, including without limitation the rights\nto use, copy, modify, merge, publish, distribute, sublicense, and/or sell\ncopies of the Software, and to permit persons to whom the Software is\nfurnished to do so, subject to the following conditions:\n\nThe above copyright notice and this permission notice shall be included in\nall copies or substantial portions of the Software.\n\nTHE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR\nIMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,\nFITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE\nAUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER\nLIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,\nOUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN\nTHE SOFTWARE.\n',
      },
    ],
  },
  {
    id: 'depth-picker',
    title: '景深选择卷轴',
    category: '空间交互',
    tags: ['CSS 3D', 'asin', '选择控件'],
    description: '上下切换数字，观察条目绕虚拟圆柱旋转进入焦点。',
    learningGoals: [
      '将条目偏移归一化并 clamp',
      '用 asin 将高度映射为绕轴角度',
      '用 cos 推导景深并保持选中状态',
    ],
    source: {
      repository: 'https://github.com/wcandillon/can-it-be-done-in-react-native',
      commit: '72678212d4041f124e1585cdf6360f36737daa5f',
      license: 'MIT',
      licenseText:
        'MIT License\n\nCopyright (c) 2019 William Candillon\n\nPermission is hereby granted, free of charge, to any person obtaining a copy\nof this software and associated documentation files (the "Software"), to deal\nin the Software without restriction, including without limitation the rights\nto use, copy, modify, merge, publish, distribute, sublicense, and/or sell\ncopies of the Software, and to permit persons to whom the Software is\nfurnished to do so, subject to the following conditions:\n\nThe above copyright notice and this permission notice shall be included in all\ncopies or substantial portions of the Software.\n\nTHE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR\nIMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,\nFITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE\nAUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER\nLIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,\nOUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE\nSOFTWARE.\n',
      files: [
        {
          title: 'the-10-min/src/Picker/AnimationHelpers.tsx',
          url: 'https://github.com/wcandillon/can-it-be-done-in-react-native/blob/72678212d4041f124e1585cdf6360f36737daa5f/the-10-min/src/Picker/AnimationHelpers.tsx',
        },
        {
          title: 'the-10-min/src/Picker/Picker.tsx',
          url: 'https://github.com/wcandillon/can-it-be-done-in-react-native/blob/72678212d4041f124e1585cdf6360f36737daa5f/the-10-min/src/Picker/Picker.tsx',
        },
        {
          title: '完整 MIT 许可',
          url: 'https://github.com/wcandillon/can-it-be-done-in-react-native/blob/72678212d4041f124e1585cdf6360f36737daa5f/LICENSE',
        },
      ],
      videos: [],
      scope:
        '迁入并改写 the-10-min/src/Picker/Picker.tsx 的相对偏移 clamp、asin 旋转和 radius*cos(angle)-radius 景深公式；参考 AnimationHelpers 的吸附到离散条目思想。',
      changes:
        '以 CSS 透视、原生按钮/键盘/触摸替换 React Native Reanimated、MaskedView 与外部字体；不复制完整原生组件或第三方 redash 的 snapPoint。仓库 README 明确关联原作者 YouTube 系列，但未独立核实具体单集链接，故不填单集视频地址。',
    },
    files: [
      {
        path: 'index.html',
        content:
          '<!doctype html>\n<html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>景深选择卷轴</title><link rel="stylesheet" href="style.css"><script src="app.js" defer></script></head><body><main><header><div><small>CREATIVE LAB / 空间交互</small><h1>景深选择卷轴</h1><p>上下切换数字，观察条目绕虚拟圆柱旋转进入焦点。</p></div><span class="tag">LOCAL UI STUDY</span></header><section class="stage"><div class="picker" id="picker" tabindex="0" role="spinbutton" aria-label="选择探索编号" aria-valuemin="1" aria-valuemax="12"><div class="focus"></div><div id="items"></div></div><div class="picker-caption"><small>EXPLORATION INDEX</small><p>每一步，都有新的角度。</p></div></section><div class="controls"><button id="prev" class="secondary">上一项</button><button id="next">下一项</button><output id="selected" class="readout" aria-live="polite"></output></div><footer>本地 UI 学习模板 · 无外部资源 · 完整来源与许可见 NOTICE.txt</footer></main></body></html>',
      },
      {
        path: 'style.css',
        content:
          '*{box-sizing:border-box}body{margin:0;font-family:Inter,ui-sans-serif,system-ui,-apple-system,sans-serif;background:var(--bg,#eef3fa);color:var(--ink,#18233a);min-height:100vh}main{width:min(880px,100%);margin:auto;padding:32px 24px 24px}header{display:flex;justify-content:space-between;gap:16px;align-items:start}small{font-size:11px;letter-spacing:.2em;text-transform:uppercase;color:var(--accent,#4866f5);font-weight:800}h1{font-size:clamp(26px,5vw,42px);letter-spacing:-.04em;margin:10px 0}p{line-height:1.65;color:var(--muted,#617087)}.tag{font-size:11px;padding:7px 11px;border:1px solid currentColor;border-radius:30px;white-space:nowrap}.stage{position:relative;min-height:320px;display:grid;place-items:center;overflow:hidden;border-radius:24px;margin:22px 0;background:var(--surface,#fff);border:1px solid #18233a14}.controls{display:flex;gap:12px;flex-wrap:wrap;align-items:center}button,select,input{font:inherit}button{cursor:pointer;border:0;border-radius:10px;padding:11px 18px;background:var(--accent,#4866f5);color:#fff;font-weight:700}button.secondary{color:var(--ink,#18233a);background:#18233a0d}button:focus-visible,input:focus-visible,select:focus-visible{outline:3px solid #8aacf9;outline-offset:3px}label{font-size:13px;display:flex;gap:10px;align-items:center}input[type=range]{accent-color:var(--accent,#4866f5);max-width:100%}.readout{font-variant-numeric:tabular-nums;font-size:13px;color:var(--muted,#617087)}footer{margin-top:24px;font-size:11px;color:var(--muted,#617087)}svg,canvas{display:block;max-width:100%}@media(max-width:520px){main{padding:24px 16px}header{display:block}.tag{display:inline-block;margin-top:8px}.stage{min-height:300px}.controls{gap:10px}}@media(prefers-reduced-motion:reduce){*,*::before,*::after{animation:none!important;transition:none!important;scroll-behavior:auto!important}}\nbody{--bg:#eff0f7;--accent:#6475a9;--muted:#8290b5}.stage{background:#e0e5f4;gap:0;grid-template-rows:240px auto;padding-top:18px}.picker{height:220px;width:260px;position:relative;perspective:600px;overflow:hidden;mask-image:linear-gradient(transparent,#000 18%,#000 82%,transparent);touch-action:pan-x}.focus{position:absolute;left:0;right:0;top:88px;height:44px;border-top:1px solid #7284b455;border-bottom:1px solid #7284b455;background:#fff7}.picker .item{position:absolute;height:44px;line-height:44px;left:0;right:0;top:88px;text-align:center;font-size:29px;font-weight:700;color:#4e6193;backface-visibility:hidden;transition:transform .35s,opacity .35s}.picker-caption{text-align:center}.picker-caption p{font-size:12px;margin:8px 0 20px}',
      },
      {
        path: 'app.js',
        content:
          "// UI source study: https://github.com/wcandillon/can-it-be-done-in-react-native @ 72678212d4041f124e1585cdf6360f36737daa5f\n// 迁入并改写 the-10-min/src/Picker/Picker.tsx 的相对偏移 clamp、asin 旋转和 radius*cos(angle)-radius 景深公式；参考 AnimationHelpers 的吸附到离散条目思想。\n// See NOTICE.txt for complete upstream copyright and license.\n'use strict';\nconst reducedMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;\nconst picker=document.querySelector('#picker'),items=document.querySelector('#items');let selected=5,startY=0;const rows=Array.from({length:12},(_,i)=>{const el=document.createElement('div');el.className='item';el.textContent=String(i+1).padStart(2,'0');el.setAttribute('aria-hidden','true');items.append(el);return el;});function render(){const radius=110;rows.forEach((el,i)=>{const y=Math.max(-1,Math.min(1,(i-selected)/2.5));const angle=Math.asin(y),z=radius*Math.cos(angle)-radius;el.style.transform='translateY('+(y*radius)+'px) translateZ('+z+'px) rotateX('+(-angle*180/Math.PI)+'deg)';el.style.opacity=Math.abs(i-selected)>2?.0:1-Math.abs(y)*.58;});picker.setAttribute('aria-valuenow',String(selected+1));document.querySelector('#selected').textContent='当前编号 '+String(selected+1).padStart(2,'0');}function move(delta){selected=Math.max(0,Math.min(11,selected+delta));render();}document.querySelector('#prev').addEventListener('click',()=>move(-1));document.querySelector('#next').addEventListener('click',()=>move(1));picker.addEventListener('keydown',e=>{if(e.key==='ArrowUp'||e.key==='ArrowDown'){e.preventDefault();move(e.key==='ArrowUp'?-1:1);}});picker.addEventListener('wheel',e=>{e.preventDefault();move(e.deltaY>0?1:-1);},{passive:false});picker.addEventListener('pointerdown',e=>{startY=e.clientY;picker.setPointerCapture(e.pointerId);});picker.addEventListener('pointerup',e=>{if(Math.abs(startY-e.clientY)>10)move(Math.sign(startY-e.clientY));});render();",
      },
      {
        path: 'README.md',
        content:
          '# 景深选择卷轴\n\n上下切换数字，观察条目绕虚拟圆柱旋转进入焦点。\n\n## 学习步骤\n\n1. 将条目偏移归一化并 clamp。\n2. 用 asin 将高度映射为绕轴角度。\n3. 用 cos 推导景深并保持选中状态。\n\n## 文件与运行\n\n点击工作区“运行预览”。index.html 是结构，style.css 是布局，app.js 是交互。所有演示数据与图形在浏览器中生成，不请求外网、读取凭证或运行服务器。动画尊重系统的减少动态效果设置。\n\n## 来源与范围\n\nhttps://github.com/wcandillon/can-it-be-done-in-react-native\n\n固定版本：72678212d4041f124e1585cdf6360f36737daa5f\n\n迁入并改写 the-10-min/src/Picker/Picker.tsx 的相对偏移 clamp、asin 旋转和 radius*cos(angle)-radius 景深公式；参考 AnimationHelpers 的吸附到离散条目思想。\n\n以 CSS 透视、原生按钮/键盘/触摸替换 React Native Reanimated、MaskedView 与外部字体；不复制完整原生组件或第三方 redash 的 snapPoint。仓库 README 明确关联原作者 YouTube 系列，但未独立核实具体单集链接，故不填单集视频地址。\n\n完整许可与归属见 NOTICE.txt，继续改写请保留该文件。\n',
      },
      {
        path: 'NOTICE.txt',
        content:
          '来源: https://github.com/wcandillon/can-it-be-done-in-react-native\n固定版本: 72678212d4041f124e1585cdf6360f36737daa5f\n迁入范围: 迁入并改写 the-10-min/src/Picker/Picker.tsx 的相对偏移 clamp、asin 旋转和 radius*cos(angle)-radius 景深公式；参考 AnimationHelpers 的吸附到离散条目思想。\n修改说明: 以 CSS 透视、原生按钮/键盘/触摸替换 React Native Reanimated、MaskedView 与外部字体；不复制完整原生组件或第三方 redash 的 snapPoint。仓库 README 明确关联原作者 YouTube 系列，但未独立核实具体单集链接，故不填单集视频地址。\n\n完整上游许可:\nMIT License\n\nCopyright (c) 2019 William Candillon\n\nPermission is hereby granted, free of charge, to any person obtaining a copy\nof this software and associated documentation files (the "Software"), to deal\nin the Software without restriction, including without limitation the rights\nto use, copy, modify, merge, publish, distribute, sublicense, and/or sell\ncopies of the Software, and to permit persons to whom the Software is\nfurnished to do so, subject to the following conditions:\n\nThe above copyright notice and this permission notice shall be included in all\ncopies or substantial portions of the Software.\n\nTHE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR\nIMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,\nFITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE\nAUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER\nLIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,\nOUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE\nSOFTWARE.\n',
      },
    ],
  },
  {
    id: 'liquid-page',
    title: '流体翻页海报',
    category: '图形动画',
    tags: ['SVG clipPath', '三次曲线', '转场'],
    description: '调整边缘拉伸量，让一道流体曲线把下一张海报带到眼前。',
    learningGoals: [
      '把拖动量映射为 Bézier 控制点',
      '用 clipPath 裁切图形而不是切换布局',
      '在转场结束后更新页面状态',
    ],
    source: {
      repository: 'https://github.com/ashutosh1919/react-liquidswipe',
      commit: '678cb1fc21d5f0523f189e90347ba9ce483a7cb4',
      license: 'MIT',
      licenseText:
        'MIT License\n\nCopyright (c) 2021 Ashutosh Hathidara\n\nPermission is hereby granted, free of charge, to any person obtaining a copy\nof this software and associated documentation files (the "Software"), to deal\nin the Software without restriction, including without limitation the rights\nto use, copy, modify, merge, publish, distribute, sublicense, and/or sell\ncopies of the Software, and to permit persons to whom the Software is\nfurnished to do so, subject to the following conditions:\n\nThe above copyright notice and this permission notice shall be included in all\ncopies or substantial portions of the Software.\n\nTHE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR\nIMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,\nFITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE\nAUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER\nLIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,\nOUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE\nSOFTWARE.\n',
      files: [
        {
          title: 'src/components/liquidswipe.js',
          url: 'https://github.com/ashutosh1919/react-liquidswipe/blob/678cb1fc21d5f0523f189e90347ba9ce483a7cb4/src/components/liquidswipe.js',
        },
        {
          title: '完整 MIT 许可',
          url: 'https://github.com/ashutosh1919/react-liquidswipe/blob/678cb1fc21d5f0523f189e90347ba9ce483a7cb4/LICENSE',
        },
      ],
      videos: [
        {
          platform: 'YouTube',
          title: 'DevSense · Liquid Swipe Animation（原作者仓库 Important Links 直接关联）',
          url: 'https://www.youtube.com/watch?v=uGoWVz-q2M8',
        },
      ],
      scope:
        '参考 src/components/liquidswipe.js 的 getPath 中 anchorDistance、curviness、C/S 三次曲线和 SVG clipPath 边缘裁切结构；路径坐标与驱动代码独立重写。',
      changes:
        '原创两张纯 SVG 海报，以滑杆和一次性 requestAnimationFrame 替换 Gatsby、React Spring、use-gesture、图片与付费设计素材；不迁入应用逻辑或上游整组件。',
    },
    files: [
      {
        path: 'index.html',
        content:
          '<!doctype html>\n<html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>流体翻页海报</title><link rel="stylesheet" href="style.css"><script src="app.js" defer></script></head><body><main><header><div><small>CREATIVE LAB / 图形动画</small><h1>流体翻页海报</h1><p>调整边缘拉伸量，让一道流体曲线把下一张海报带到眼前。</p></div><span class="tag">LOCAL UI STUDY</span></header><section class="stage"><svg id="poster" viewBox="0 0 720 340" width="720" height="340" aria-label="流体过渡海报"><defs><clipPath id="mask"><path id="blob"/></clipPath></defs><rect width="720" height="340" fill="#eaca8c"/><g fill="#a16438"><circle cx="180" cy="170" r="95" fill="#dfa967"/><text x="65" y="285" font-size="36" font-weight="800">形状 / FORM</text></g><g clip-path="url(#mask)"><rect width="720" height="340" fill="#9fbfae"/><g fill="none" stroke="#537f6a" stroke-width="13"><circle cx="515" cy="135" r="90"/><circle cx="515" cy="135" r="65"/><circle cx="515" cy="135" r="40"/></g><text x="65" y="285" fill="#365b49" font-size="36" font-weight="800">流动 / FLOW</text></g></svg></section><div class="controls"><label>拉伸进度 <input id="progress" type="range" min="0" max="100" value="45"></label><button id="swipe">流体切换</button><button id="reset" class="secondary">回到开始</button><output id="status" class="readout">45%</output></div><footer>本地 UI 学习模板 · 无外部资源 · 完整来源与许可见 NOTICE.txt</footer></main></body></html>',
      },
      {
        path: 'style.css',
        content:
          '*{box-sizing:border-box}body{margin:0;font-family:Inter,ui-sans-serif,system-ui,-apple-system,sans-serif;background:var(--bg,#eef3fa);color:var(--ink,#18233a);min-height:100vh}main{width:min(880px,100%);margin:auto;padding:32px 24px 24px}header{display:flex;justify-content:space-between;gap:16px;align-items:start}small{font-size:11px;letter-spacing:.2em;text-transform:uppercase;color:var(--accent,#4866f5);font-weight:800}h1{font-size:clamp(26px,5vw,42px);letter-spacing:-.04em;margin:10px 0}p{line-height:1.65;color:var(--muted,#617087)}.tag{font-size:11px;padding:7px 11px;border:1px solid currentColor;border-radius:30px;white-space:nowrap}.stage{position:relative;min-height:320px;display:grid;place-items:center;overflow:hidden;border-radius:24px;margin:22px 0;background:var(--surface,#fff);border:1px solid #18233a14}.controls{display:flex;gap:12px;flex-wrap:wrap;align-items:center}button,select,input{font:inherit}button{cursor:pointer;border:0;border-radius:10px;padding:11px 18px;background:var(--accent,#4866f5);color:#fff;font-weight:700}button.secondary{color:var(--ink,#18233a);background:#18233a0d}button:focus-visible,input:focus-visible,select:focus-visible{outline:3px solid #8aacf9;outline-offset:3px}label{font-size:13px;display:flex;gap:10px;align-items:center}input[type=range]{accent-color:var(--accent,#4866f5);max-width:100%}.readout{font-variant-numeric:tabular-nums;font-size:13px;color:var(--muted,#617087)}footer{margin-top:24px;font-size:11px;color:var(--muted,#617087)}svg,canvas{display:block;max-width:100%}@media(max-width:520px){main{padding:24px 16px}header{display:block}.tag{display:inline-block;margin-top:8px}.stage{min-height:300px}.controls{gap:10px}}@media(prefers-reduced-motion:reduce){*,*::before,*::after{animation:none!important;transition:none!important;scroll-behavior:auto!important}}\nbody{--bg:#f6eddd;--accent:#986545;--muted:#9b8068}.stage{background:#eaca8c}.stage svg{width:100%;height:340px}text{font-family:system-ui,sans-serif}@media(max-width:420px){.stage svg{height:300px}.stage{min-height:300px}}',
      },
      {
        path: 'app.js',
        content:
          "// UI source study: https://github.com/ashutosh1919/react-liquidswipe @ 678cb1fc21d5f0523f189e90347ba9ce483a7cb4\n// 参考 src/components/liquidswipe.js 的 getPath 中 anchorDistance、curviness、C/S 三次曲线和 SVG clipPath 边缘裁切结构；路径坐标与驱动代码独立重写。\n// See NOTICE.txt for complete upstream copyright and license.\n'use strict';\nconst reducedMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;\nconst path=document.querySelector('#blob'),progress=document.querySelector('#progress');let raf=0;function render(t){const x=720*(1-t),y=170,curve=90*Math.sin(t*Math.PI),anchor=90;path.setAttribute('d','M720 0H'+x+'V'+(y-anchor)+'C'+x+' '+(y-anchor*.5)+','+(x-curve)+' '+(y-anchor*.35)+','+(x-curve)+' '+y+'S'+x+' '+(y+anchor*.5)+','+x+' '+(y+anchor)+'V340H720Z');progress.value=String(Math.round(t*100));document.querySelector('#status').textContent=Math.round(t*100)+'%';}progress.addEventListener('input',()=>{cancelAnimationFrame(raf);render(Number(progress.value)/100);});document.querySelector('#swipe').addEventListener('click',()=>{cancelAnimationFrame(raf);if(reducedMotion){render(1);return;}const start=performance.now(),from=Number(progress.value)/100;function frame(now){const t=Math.min((now-start)/900,1);render(from+(1-from)*(1-Math.pow(1-t,3)));if(t<1)raf=requestAnimationFrame(frame);}raf=requestAnimationFrame(frame);});document.querySelector('#reset').addEventListener('click',()=>{cancelAnimationFrame(raf);render(0);});render(.45);",
      },
      {
        path: 'README.md',
        content:
          '# 流体翻页海报\n\n调整边缘拉伸量，让一道流体曲线把下一张海报带到眼前。\n\n## 学习步骤\n\n1. 把拖动量映射为 Bézier 控制点。\n2. 用 clipPath 裁切图形而不是切换布局。\n3. 在转场结束后更新页面状态。\n\n## 文件与运行\n\n点击工作区“运行预览”。index.html 是结构，style.css 是布局，app.js 是交互。所有演示数据与图形在浏览器中生成，不请求外网、读取凭证或运行服务器。动画尊重系统的减少动态效果设置。\n\n## 来源与范围\n\nhttps://github.com/ashutosh1919/react-liquidswipe\n\n固定版本：678cb1fc21d5f0523f189e90347ba9ce483a7cb4\n\n参考 src/components/liquidswipe.js 的 getPath 中 anchorDistance、curviness、C/S 三次曲线和 SVG clipPath 边缘裁切结构；路径坐标与驱动代码独立重写。\n\n原创两张纯 SVG 海报，以滑杆和一次性 requestAnimationFrame 替换 Gatsby、React Spring、use-gesture、图片与付费设计素材；不迁入应用逻辑或上游整组件。\n\n完整许可与归属见 NOTICE.txt，继续改写请保留该文件。\n',
      },
      {
        path: 'NOTICE.txt',
        content:
          '来源: https://github.com/ashutosh1919/react-liquidswipe\n固定版本: 678cb1fc21d5f0523f189e90347ba9ce483a7cb4\n迁入范围: 参考 src/components/liquidswipe.js 的 getPath 中 anchorDistance、curviness、C/S 三次曲线和 SVG clipPath 边缘裁切结构；路径坐标与驱动代码独立重写。\n修改说明: 原创两张纯 SVG 海报，以滑杆和一次性 requestAnimationFrame 替换 Gatsby、React Spring、use-gesture、图片与付费设计素材；不迁入应用逻辑或上游整组件。\n\n完整上游许可:\nMIT License\n\nCopyright (c) 2021 Ashutosh Hathidara\n\nPermission is hereby granted, free of charge, to any person obtaining a copy\nof this software and associated documentation files (the "Software"), to deal\nin the Software without restriction, including without limitation the rights\nto use, copy, modify, merge, publish, distribute, sublicense, and/or sell\ncopies of the Software, and to permit persons to whom the Software is\nfurnished to do so, subject to the following conditions:\n\nThe above copyright notice and this permission notice shall be included in all\ncopies or substantial portions of the Software.\n\nTHE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR\nIMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,\nFITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE\nAUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER\nLIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,\nOUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE\nSOFTWARE.\n',
      },
    ],
  },
];

// Put the newest full experiences first, alternating scene, tool and narrative.
const advancedGroups = [visualCreativeItems, productCreativeItems, narrativeCreativeItems];
export const creativeItems: CreativeItem[] = [
  ...Array.from({ length: Math.max(...advancedGroups.map((group) => group.length)) }, (_, index) =>
    advancedGroups.flatMap((group) => (group[index] ? [{ ...group[index], edition: 2 as const }] : [])),
  ).flat(),
  ...foundationCreativeItems,
];
