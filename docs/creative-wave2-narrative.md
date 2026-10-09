# 第二批创意 UI：叙事、设计与探索

本组 6 件作品围绕完整的工作台和可探索叙事设计，每件至少包含三组会改变真实状态的操作。它们不是来源项目的整站复制，而是对开源交互思想的独立浏览器 UI 适配。固定 GitHub 版本、源文件链接和完整许可随各作品保存在 `NOTICE.txt`；每件项目包含 `index.html`、`style.css`、`app.js`、中文 `README.md` 和 `NOTICE.txt`。

实现位置：`apps/api/src/programming/creative.advanced-narrative.ts`，导出 `narrativeCreativeItems`。

## 作品与来源

| 作品                                      | 固定来源 / 许可                                                                                                            | 交互与适配范围                                                                                                                                                                             |
| ----------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 夜曲 · 分轨编曲台 `nocturne-sequencer`    | [Tone.js](https://github.com/Tonejs/Tone.js/tree/de9df332ca7573b90a9aaca10c0729a3091dda0a) / MIT                           | 参考 Step Sequencer 的轨道触发、时钟和节奏交互，原生 DOM / Web Audio 独立实现。4 轨 16 步编辑、3 种预设、轨道静音、BPM、摆动和可选本地合成音。没有迁入 Tone 引擎和采样音频。               |
| 夜航档案 · 联动观测叙事 `orbital-archive` | [Observable Plot](https://github.com/observablehq/plot/tree/535723d5e433727720d9b673c31622821bb03210) / ISC                | 研究 Dot mark 与 Pointer interaction，原生 SVG 实现 48 个原创虚构样本的三章叙事、年份/族群筛选、矩形刷选、关联分布和详情卡。没有真实天文数据或科学结论。                                   |
| 循环之城 · 能源河流推演 `circular-energy` | [d3-sankey-circular](https://github.com/tomshanley/d3-sankey-circular/tree/7d9a6e3fba7aafdc7f4664e6bcac5879ad46a5b2) / MIT | 研究循环连线、流量宽度与路径详情。原生 SVG 固定教学网络，含 3 种供给方案、需求与余热回收控制、回流聚焦、主干守恒检查和流量检查器。不迁入 d3 布局引擎。                                     |
| 轻城 · 等距规划沙盘 `isometric-city`      | [PixiJS](https://github.com/pixijs/pixijs/tree/2f01671aa654edefb8a6a8013d3b28c1a65c1813) / MIT                             | 研究 Container 的场景层次与 Graphics 的几何绘制，原生 Canvas 重建 49 地块的等距城市。住宅/工作室/花园/留白、1–6 层高度、夜景、绿化覆盖、撤销和派生容量统计。无真实地图和规划服务。         |
| 褶地 · 矢量地形雕刻台 `contour-sculpture` | [Paper.js](https://github.com/paperjs/paper.js/tree/92775f5279c05fb7f0a743e9e7fa02cd40ec1e70) / MIT                        | 研究 Path 的采样、平滑和编辑接口。原生 SVG 用 3 个控制点驱动 12–40 条平滑闭合轮廓，支持起伏、扭曲、键盘精确位移、构图开窗与铜/蓝墨切换。不宣称通用布尔几何或真实等高线地理数据。           |
| 知枝 · 交互知识星图 `knowledge-canopy`    | [Markmap](https://github.com/markmap/markmap/tree/122bf0500ee7aca4f023c2465f7e26bf023eec52) / MIT                          | 研究分支折叠、活动节点、连线和自动适配。原生 SVG 固定 3 套原创知识纲要，支持星图/树形布局、分支折叠、搜索及祖先路径高亮、聚焦阅读、可见节点计数。未接入 Markdown 引擎、AI 生成或协作服务。 |

来源内容只读下载以核验，不运行上游脚本，不导入上游 npm 依赖。图形全部由 Canvas、SVG 或 DOM 程序化生成，不拷贝视频截图、摄影、音频采样和字体素材。

已搜索 YouTube / Bilibili 展示和教学关联。本组没有取得足够可靠的“发布者视频 → 对应源仓库”证据，因此 `source.videos` 保持空数组，避免把第三方教学或搜索结果当成作者的作品来源。固定 GitHub 源可直接访问与审查。

## 音频与状态边界

编曲台只有在用户点击“声音开启”后才建立 Web Audio 上下文，使用本地振荡器和音量包络合成声音，无媒体请求。声音可关闭，每次播放最多 60 秒，切换预设、隐藏页面或退出页面会停止播放。默认关闭声音，仍可观看图形节拍。

所有作品的状态仅存在当前页面。界面不声称有真实后端、AI、多人协作、科学预测、工程设计审批或云保存功能。收藏、创建项目、版本、下载和项目 AI 修改由主系统已有功能负责。

## 验证与捕获合同

本组在真实 Chrome 中验证，运行于仅 `allow-scripts` 的不透明 iframe，并使用产品相同的 `programmingPreviewHeaders` CSP。

- 390 px 手机与 1200 px 桌面均加载、交互、截图；31 个操作均核对了实际可见状态，页面没有横向溢出。
- 6 件作品各 5 个文件通过 `programmingFilesSchema`；JavaScript 通过可信目录的语法检查；固定来源 SHA 为 40 位，许可全文保留。
- 无外部网络请求、无页面脚本错误。
- 另外以真实鼠标验证观测档案刷选（15 / 48 个样本并可重置）、雕刻台控制点拖动（A → 350 / 230）、城市反投影点选（G7）。
- Web Audio 用户点击启用、播放及停止通过真实浏览器测试。

探针合同：`.data/creative-wave2-narrative-probes.json`。每个 action 含 `type`、`selector`、可选 `value`、`assertSelector` 和期望文本 `expected`；`first` 用于首个匹配项，`changeRange` 应派发 `input` 和 `change`。目录封面可以使用 `capture` 数组并截取 `.stage`，不包含断言动作带来的临时高亮。雕刻台 stage 为 480 px，知识星图为 500 px，其他作品为 400 px（手机按 CSS 适配）。

验收记录：`.data/creative-wave2-narrative-smoke.json` 与 `.data/creative-wave2-narrative-pointer-smoke.json`。固定来源只读证据和 12 张实拍截图保存在 `.data/creative-wave2-narrative/`。上述 `.data` 证据属于本地测试材料，不作为学生代码执行入口。
