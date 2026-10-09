# 创意广场：来源、许可与 UI 迁入范围

当前广场已收录 40 件；本页保留第一批 20 件来源，新增 20 件完整场景见 [第二批来源与视频核对](creative-wave2-sources.md)。

第一批收录 20 件不同的浏览器交互作品，对应 20 个 GitHub 仓库。核对日期：2026-10-09。每件都有可运行的 HTML/CSS/JS、多文件源码、中文学习步骤、固定版本的上游源文件链接，以及完整版权和许可 NOTICE。不是配色变体或无法运行的图片卡片。

## 使用方式

在编程工作室打开创意广场，按分类、标签或关键词寻找作品；详情可以查看来源、学习目标和源码，并运行本地交互预览。把作品创建为自己的项目后，可以修改界面、让 AI 提议变更、保存版本或下载源码 ZIP。创建后继承来源 NOTICE.txt，工作区会保护该归属文件。

每件包含 index.html、style.css、app.js、README.md 和 NOTICE.txt。当前收录的 20 件源码合计约 154 KiB；每件都通过工作区 24 文件、单文件 64 KiB、总量 256 KiB 的校验。所有图形和样本在页面内生成，不依赖 CDN、网络字体、外部图片、数据库、登录、支付或服务端进程。

## 查证方式

首先读取用户指定的 [Android-Agent](https://github.com/sakuraANDhuiliyi/Android-Agent/tree/15d461d1f5bc86132ce2850233cc6e34c8381520) 创意目录，了解“来源可追溯、最小 UI 提取、归属随源码保留”的广场组织方式。没有复制或运行该仓库的 Android/Kotlin/Agent 服务实现。随后直接搜索并读取各上游 GitHub 仓库、固定提交源码和完整许可；参考目录只作为检索线索，实际范围在下面逐项说明。上游源码下载仅用于只读审查，没有执行其安装脚本。

视频关联仅收录两条能由原作者仓库 README 直接确认的 YouTube 链接：[Flubber 的形状插值演讲](https://github.com/veltman/flubber/blob/0cadadf3eb15cd5b2ec7c45c70601ff88b76a6c3/README.md) 与 [DevSense 的 Liquid Swipe 教程](https://github.com/ashutosh1919/react-liquidswipe/blob/678cb1fc21d5f0523f189e90347ba9ce483a7cb4/README.md)。YouTube 视频正文抓取受限，因此关联证据来自作者 README 的直接链接，没有声称读取字幕或完整观看视频。

[William Candillon 的仓库 README](https://github.com/wcandillon/can-it-be-done-in-react-native/blob/72678212d4041f124e1585cdf6360f36737daa5f/README.md) 明确写明源码来自其 YouTube 系列，但未独立核实景深选择器的具体单集地址，故该件不填写视频链接。没有把 Bilibili 或抖音搜索到的相似效果当作未经核实的源码对应关系。其余作品通过 GitHub 直接发现并核对。

## 许可与移植原则

这批使用 19 个 MIT 来源和 1 个 ISC 来源。小函数或公式确实迁入的部分逐项写明；只参考界面模式后独立实现的作品也明确标注，没有称为复制了上游整组件。上游完整版权声明和许可原文保存在每件 NOTICE.txt 中，并写入源文件注释的固定仓库/版本归属。下载 ZIP、创建项目和版本恢复应继续携带 NOTICE。

Typed.js 使用已核实 MIT 的历史版本 **v2.0.12 / 337109d9ac6558475eea301693e64071dafc9961**。其当前主分支出现商业许可文件，本项目没有使用该分支，也不据此宣称当前版本仍采用同一许可。

动画默认尊重 prefers-reduced-motion；粒子/重力演示限制对象数量、帧预算或在隐藏时暂停。预览继续使用本项目独立来源的 sandbox iframe。这里是浏览器 UI 学习演示，不提供执行上游后端、安装依赖或访问外网的能力。Canvas 物理、路径插值等都是写明范围的简化实验，不能替代完整上游引擎。

## 收录清单

| 作品           | 类型        | 上游固定版本                                                                                                                                                       | 许可 |
| -------------- | ----------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---- |
| 折光身份卡     | 空间交互    | [micku7zu/vanilla-tilt.js / 48f4ee93](https://github.com/micku7zu/vanilla-tilt.js/tree/48f4ee931d4d91dcdd2f91803db67a9f3a16587e)                                   | MIT  |
| 形态铸造台     | 图形动画    | [veltman/flubber / 0cadadf3](https://github.com/veltman/flubber/tree/0cadadf3eb15cd5b2ec7c45c70601ff88b76a6c3)                                                     | MIT  |
| 可拖拽灵感清单 | 交互组件    | [SortableJS/Sortable / 48b626bb](https://github.com/SortableJS/Sortable/tree/48b626bbc61afbb0f179730c1dd3cca3dcc8b788)                                             | MIT  |
| 星点连接场     | Canvas 实验 | [VincentGarreau/particles.js / d01286d6](https://github.com/VincentGarreau/particles.js/tree/d01286d6dcd61f497d07cc62bd48e692f6508ad5)                             | MIT  |
| 纸屑发射台     | Canvas 实验 | [catdad/canvas-confetti / 20eebad5](https://github.com/catdad/canvas-confetti/tree/20eebad51dde793070c373d594099a7ed8d96e22)                                       | ISC  |
| 手绘蓝图工坊   | 绘图工具    | [rough-stuff/rough / 56a27621](https://github.com/rough-stuff/rough/tree/56a2762171b1294d643501e8d14f120db6b27bd7)                                                 | MIT  |
| 笔迹速度实验   | 绘图工具    | [szimek/signature_pad / 0a33fd67](https://github.com/szimek/signature_pad/tree/0a33fd6791e0df151c4e9421193cfc03f18732a7)                                           | MIT  |
| 线描航行图     | 图形动画    | [maxwellito/vivus / 06b7adb5](https://github.com/maxwellito/vivus/tree/06b7adb5d543b6b1d0d93fa83dea137b1f8644a5)                                                   | MIT  |
| 滚动数字仪表   | 交互组件    | [HubSpot/odometer / 0bc5470e](https://github.com/HubSpot/odometer/tree/0bc5470eeb822f828d6ac8cca8b87a02413f6260)                                                   | MIT  |
| 逐字探索终端   | 文字交互    | [mattboldt/typed.js / 337109d9](https://github.com/mattboldt/typed.js/tree/337109d9ac6558475eea301693e64071dafc9961)                                               | MIT  |
| 时间窗口筛选器 | 交互组件    | [leongersen/noUiSlider / 57033672](https://github.com/leongersen/noUiSlider/tree/57033672d07e8bac527d7147721a4a2e07e0d699)                                         | MIT  |
| 缓动曲线试验场 | 动效工具    | [gre/bezier-easing / d3021221](https://github.com/gre/bezier-easing/tree/d3021221b2e50efad768ab88e76ccbf9d4c72498)                                                 | MIT  |
| HSV 配色观测室 | 设计工具    | [bgrins/TinyColor / b49018c9](https://github.com/bgrins/TinyColor/tree/b49018c9f2dbca313d80d7a4dad25e26143cfe01)                                                   | MIT  |
| 可编辑海报画板 | 设计工具    | [taye/interact.js / a993eb8c](https://github.com/taye/interact.js/tree/a993eb8cd5cbc65f3a19e45ee24b7fedc026174f)                                                   | MIT  |
| 横向故事展廊   | 交互组件    | [nolimits4web/swiper / fbf9ddb5](https://github.com/nolimits4web/swiper/tree/fbf9ddb555edd2e0332e813dd69972ab9ee4b8b4)                                             | MIT  |
| 环形数据观测站 | 数据可视化  | [chartjs/Chart.js / 7169e651](https://github.com/chartjs/Chart.js/tree/7169e65147a47f3720957a6f156a33c838ab9f57)                                                   | MIT  |
| 重力小球试验箱 | 物理交互    | [liabru/matter-js / b8ee71cd](https://github.com/liabru/matter-js/tree/b8ee71cd7f9b49f53639ddaedd6254f1929bcbe5)                                                   | MIT  |
| 线框空间观察器 | 空间交互    | [mrdoob/three.js / d4f1373e](https://github.com/mrdoob/three.js/tree/d4f1373ea73704daae13281ff7e8c48761e777b3)                                                     | MIT  |
| 景深选择卷轴   | 空间交互    | [wcandillon/can-it-be-done-in-react-native / 72678212](https://github.com/wcandillon/can-it-be-done-in-react-native/tree/72678212d4041f124e1585cdf6360f36737daa5f) | MIT  |
| 流体翻页海报   | 图形动画    | [ashutosh1919/react-liquidswipe / 678cb1fc](https://github.com/ashutosh1919/react-liquidswipe/tree/678cb1fc21d5f0523f189e90347ba9ce483a7cb4)                       | MIT  |

## 逐项提取说明

### 折光身份卡（foil-tilt）

移动指针，观察卡片的视差、倾角与柔和反光。

- 来源：[固定提交 48f4ee931d4d91dcdd2f91803db67a9f3a16587e](https://github.com/micku7zu/vanilla-tilt.js/tree/48f4ee931d4d91dcdd2f91803db67a9f3a16587e)。
- 迁入范围：迁入并改写 src/vanilla-tilt.js 的 getValues 坐标归一化、clamp、倾角与 atan2 反光方向公式。
- 修改说明：以 Pointer Events 和原创 CSS 身份卡替换库的初始化、陀螺仪、全页监听与 DOM glare 构建；不引入上游整库。原库源自 Gijs Rogé 的 Tilt.js。
- 核对文件：[src/vanilla-tilt.js](https://github.com/micku7zu/vanilla-tilt.js/blob/48f4ee931d4d91dcdd2f91803db67a9f3a16587e/src/vanilla-tilt.js)、[完整 MIT 许可](https://github.com/micku7zu/vanilla-tilt.js/blob/48f4ee931d4d91dcdd2f91803db67a9f3a16587e/LICENSE)。
- 许可：MIT；全文 SHA-256：`0767a62d7b0d377af71662c070a763ceaf53f43412b59951c4fefcbc1b2467f9`。原文随模板的 NOTICE.txt 保存。
- 视频：通过 GitHub 直接发现/核对；没有填写未经确认的视频关联。
- 学习目标：把指针坐标转换为 0～1 的相对坐标；用 rotateX / rotateY 构建透视；分离几何状态与渲染。

### 形态铸造台（shape-morph）

在圆环、星芒和花瓣之间拖动，探索顶点插值的连续变化。

- 来源：[固定提交 0cadadf3eb15cd5b2ec7c45c70601ff88b76a6c3](https://github.com/veltman/flubber/tree/0cadadf3eb15cd5b2ec7c45c70601ff88b76a6c3)。
- 迁入范围：迁入 src/math.js 的 pointAlong 函数；参考 interpolatePoint 的等点数线性插值接口。
- 修改说明：原创生成 80 个均匀极角顶点、三个目标轮廓和静态 SVG 工作台；不迁入 flubber 的路径解析、轮廓重采样、D3 依赖或多形状匹配。
- 核对文件：[src/math.js](https://github.com/veltman/flubber/blob/0cadadf3eb15cd5b2ec7c45c70601ff88b76a6c3/src/math.js)、[src/rotate.js](https://github.com/veltman/flubber/blob/0cadadf3eb15cd5b2ec7c45c70601ff88b76a6c3/src/rotate.js)、[完整 MIT 许可](https://github.com/veltman/flubber/blob/0cadadf3eb15cd5b2ec7c45c70601ff88b76a6c3/LICENSE)。
- 许可：MIT；全文 SHA-256：`3eb888ef31044c40757fe52030e381d2b7ec6ef5e90379920ea18b98ac32d187`。原文随模板的 NOTICE.txt 保存。
- 视频：[Noah Veltman · OpenVisConf 2017 形状插值演讲（上游 README 的 Video 链接）](https://www.youtube.com/watch?v=PLc1y-gim_0)
- 学习目标：让轮廓使用相同数量的顶点；理解 pointAlong 与 interpolatePoint 的线性插值；将点列表渲染为 SVG 路径。

### 可拖拽灵感清单（drag-playlist）

抓住拖动柄重新排序，也可以用上下按钮完成同样的操作。

- 来源：[固定提交 48b626bbc61afbb0f179730c1dd3cca3dcc8b788](https://github.com/SortableJS/Sortable/tree/48b626bbc61afbb0f179730c1dd3cca3dcc8b788)。
- 迁入范围：参考 SortableJS README 的 drag handle、重排与触摸交互模式；本模板排序与 Pointer Capture 代码为独立实现，没有复制 SortableJS 库。
- 修改说明：只保留四项单列表视觉交互；去除多列表、插件、自动滚动、持久化与外部依赖，新增明确的上下按钮替代拖拽。
- 核对文件：[src/utils.js](https://github.com/SortableJS/Sortable/blob/48b626bbc61afbb0f179730c1dd3cca3dcc8b788/src/utils.js)、[完整 MIT 许可](https://github.com/SortableJS/Sortable/blob/48b626bbc61afbb0f179730c1dd3cca3dcc8b788/LICENSE)。
- 许可：MIT；全文 SHA-256：`199071e94a4d6ba6f634acd6020842efc55161b9fb639a432c50da687781219d`。原文随模板的 NOTICE.txt 保存。
- 视频：通过 GitHub 直接发现/核对；没有填写未经确认的视频关联。
- 学习目标：将 UI 顺序与数组顺序保持同步；使用 Pointer Capture 支持鼠标和触摸；为拖动交互提供键盘替代。

### 星点连接场（particle-network）

调整连线半径，观察静态点云如何构成动态网络。

- 来源：[固定提交 d01286d6dcd61f497d07cc62bd48e692f6508ad5](https://github.com/VincentGarreau/particles.js/tree/d01286d6dcd61f497d07cc62bd48e692f6508ad5)。
- 迁入范围：迁入并简化 particles.js 中 linkParticles 的 dx/dy 欧氏距离与距离衰减透明度计算。
- 修改说明：原创固定 48 个粒子及控制面板；不迁入图片加载、配置解析、插件与整库。将持续动画限制为约 40 帧/秒，并在页面不可见时暂停。
- 核对文件：[particles.js](https://github.com/VincentGarreau/particles.js/blob/d01286d6dcd61f497d07cc62bd48e692f6508ad5/particles.js)、[完整 MIT 许可](https://github.com/VincentGarreau/particles.js/blob/d01286d6dcd61f497d07cc62bd48e692f6508ad5/LICENSE.md)。
- 许可：MIT；全文 SHA-256：`24140fe37766cec891c268d521c7b1942bf72fcab059fafc04865ed4fd05773b`。原文随模板的 NOTICE.txt 保存。
- 视频：通过 GitHub 直接发现/核对；没有填写未经确认的视频关联。
- 学习目标：用欧氏距离判断邻近粒子；将距离映射为连线透明度；控制粒子数并暂停无用动画。

### 纸屑发射台（confetti-launch）

点击发射，从初始角度、速度衰减和重力理解粒子动画。

- 来源：[固定提交 20eebad51dde793070c373d594099a7ed8d96e22](https://github.com/catdad/canvas-confetti/tree/20eebad51dde793070c373d594099a7ed8d96e22)。
- 迁入范围：迁入并改写 src/confetti.js 的 randomPhysics 角度扩散和 updateFetti 速度分解、decay 更新公式。
- 修改说明：原创成就卡与 80 个矩形纸屑；去除 worker、Path2D 图形解析、文字/图片栅格化与包导出，仅点击后执行一轮有限动画。
- 核对文件：[src/confetti.js](https://github.com/catdad/canvas-confetti/blob/20eebad51dde793070c373d594099a7ed8d96e22/src/confetti.js)、[完整 ISC 许可](https://github.com/catdad/canvas-confetti/blob/20eebad51dde793070c373d594099a7ed8d96e22/LICENSE)。
- 许可：ISC；全文 SHA-256：`fd44477c30a832a1dee9ef0b6cfb34677fbe5ef58c0cf655d27c646f11bb2f7a`。原文随模板的 NOTICE.txt 保存。
- 视频：通过 GitHub 直接发现/核对；没有填写未经确认的视频关联。
- 学习目标：用角度与速度分解水平和垂直位移；用 decay 模拟空气阻力；在粒子结束后停止 requestAnimationFrame。

### 手绘蓝图工坊（rough-blueprint）

给规整几何注入轻微随机偏移，生成有手绘感的蓝图。

- 来源：[固定提交 56a2762171b1294d643501e8d14f120db6b27bd7](https://github.com/rough-stuff/rough/tree/56a2762171b1294d643501e8d14f120db6b27bd7)。
- 迁入范围：迁入并改写 RoughJS src/renderer.ts 的 _offset 有界随机扰动公式，参考 _doubleLine 双次描边结构。
- 修改说明：原创小屋/飞行器顶点与 Bézier 控制点；只绘制两幅有限图形，不迁入 RoughJS 的 SVG 解析、填充算法或随机数实现。
- 核对文件：[src/renderer.ts](https://github.com/rough-stuff/rough/blob/56a2762171b1294d643501e8d14f120db6b27bd7/src/renderer.ts)、[完整 MIT 许可](https://github.com/rough-stuff/rough/blob/56a2762171b1294d643501e8d14f120db6b27bd7/LICENSE)。
- 许可：MIT；全文 SHA-256：`dca9a392272606ac748ac0976a2a1133f14eef841c27beaa51a844d53c56a09d`。原文随模板的 NOTICE.txt 保存。
- 视频：通过 GitHub 直接发现/核对；没有填写未经确认的视频关联。
- 学习目标：为线段加入有界随机偏移；用双描边模拟手绘复线；比较随机种子与不稳定随机数的区别。

### 笔迹速度实验（signature-studio）

在画布上留下笔迹，感受速度变化如何影响线宽。

- 来源：[固定提交 0a33fd6791e0df151c4e9421193cfc03f18732a7](https://github.com/szimek/signature_pad/tree/0a33fd6791e0df151c4e9421193cfc03f18732a7)。
- 迁入范围：迁入 src/point.ts 的 distanceTo 与 velocityFrom 方法，改写为两个纯函数。
- 修改说明：原创速度平滑、线宽映射和界面；不迁入签名序列化、SVG 导出、完整 Bézier 笔迹生成或上传逻辑。笔迹仅保留在当前页面内存。
- 核对文件：[src/point.ts](https://github.com/szimek/signature_pad/blob/0a33fd6791e0df151c4e9421193cfc03f18732a7/src/point.ts)、[完整 MIT 许可](https://github.com/szimek/signature_pad/blob/0a33fd6791e0df151c4e9421193cfc03f18732a7/LICENSE)。
- 许可：MIT；全文 SHA-256：`7d461320b6c69581bd19cc9402aa9a5e33ad826ed2f977d03bcb884e0cc6ce54`。原文随模板的 NOTICE.txt 保存。
- 视频：通过 GitHub 直接发现/核对；没有填写未经确认的视频关联。
- 学习目标：采集指针坐标和时间戳；把距离除以时间得到移动速度；将平滑速度映射为笔触宽度。

### 线描航行图（line-reveal）

手动描摹一张航行示意图，看看虚线偏移如何让路径出现。

- 来源：[固定提交 06b7adb5d543b6b1d0d93fa83dea137b1f8644a5](https://github.com/maxwellito/vivus/tree/06b7adb5d543b6b1d0d93fa83dea137b1f8644a5)。
- 迁入范围：迁入并改写 src/vivus.js 的 trace 进度 clamp 以及 length * (1 - progress) 计算；参考路径长度映射。
- 修改说明：原创船帆/水波 SVG；不迁入外部 SVG 请求、PathFormer、viewport 监听或全局库，保留滑杆与一次性播放。
- 核对文件：[src/vivus.js](https://github.com/maxwellito/vivus/blob/06b7adb5d543b6b1d0d93fa83dea137b1f8644a5/src/vivus.js)、[完整 MIT 许可](https://github.com/maxwellito/vivus/blob/06b7adb5d543b6b1d0d93fa83dea137b1f8644a5/LICENSE)。
- 许可：MIT；全文 SHA-256：`35ee652cf6f12f4d897a3b11064c2e47a398243b8538cea9789201e65f979af0`。原文随模板的 NOTICE.txt 保存。
- 视频：通过 GitHub 直接发现/核对；没有填写未经确认的视频关联。
- 学习目标：读取 getTotalLength 得到路径长度；用 stroke-dasharray 隐藏整条路径；让 stroke-dashoffset 随进度减少。

### 滚动数字仪表（rolling-meter）

每个数字都有自己的纵向胶片，修改目标值让它们同步滚动。

- 来源：[固定提交 0bc5470eeb822f828d6ac8cca8b87a02413f6260](https://github.com/HubSpot/odometer/tree/0bc5470eeb822f828d6ac8cca8b87a02413f6260)。
- 迁入范围：参考 odometer.coffee 的 digit/ribbon 分位滚动结构；DOM 创建、状态更新与 CSS 胶片为独立实现，没有复制 Odometer 整库。
- 修改说明：只保留五位非负整数仪表；去除格式/小数解析、MutationObserver、全局补丁与自动更新，新增输入和按钮。
- 核对文件：[odometer.coffee](https://github.com/HubSpot/odometer/blob/0bc5470eeb822f828d6ac8cca8b87a02413f6260/odometer.coffee)、[完整 MIT 许可](https://github.com/HubSpot/odometer/blob/0bc5470eeb822f828d6ac8cca8b87a02413f6260/LICENSE)。
- 许可：MIT；全文 SHA-256：`7415a0a1c245c068a22c955200ef39e80a4a938b2383d3f30b028e0d8b5602e3`。原文随模板的 NOTICE.txt 保存。
- 视频：通过 GitHub 直接发现/核对；没有填写未经确认的视频关联。
- 学习目标：把数字拆为固定宽度字符数组；用固定高度窗口裁切数字条；用 transform 更新显示而不改变布局。

### 逐字探索终端（typing-terminal）

点击重新输入，让一句短文沿着时间轴逐字出现。

- 来源：[固定提交 337109d9ac6558475eea301693e64071dafc9961](https://github.com/mattboldt/typed.js/tree/337109d9ac6558475eea301693e64071dafc9961)。
- 迁入范围：迁入 v2.0.12 src/typed.js 中 humanizer 的有界随机延迟公式；参考 typewrite 的逐步位置状态。
- 修改说明：仅使用明确 MIT 的历史版本 v2.0.12；原创中文终端、Unicode 字符遍历和取消逻辑。移除 HTML 解析、循环删除、动态资源及整库，不据此宣称当前版本许可相同。
- 核对文件：[src/typed.js](https://github.com/mattboldt/typed.js/blob/337109d9ac6558475eea301693e64071dafc9961/src/typed.js)、[完整 MIT 许可](https://github.com/mattboldt/typed.js/blob/337109d9ac6558475eea301693e64071dafc9961/LICENSE.txt)。
- 许可：MIT；全文 SHA-256：`c8d97645320f86d487d0f78bb7071fd19647095b2d26673bdeb1fe93e2d59b78`。原文随模板的 NOTICE.txt 保存。
- 视频：通过 GitHub 直接发现/核对；没有填写未经确认的视频关联。
- 学习目标：用 textContent 安全呈现用户文本；用取消定时器避免重入；用有界随机延迟模拟打字节奏。

### 时间窗口筛选器（range-window）

拖动起止边界，观察时间窗口与样本柱状图同步变化。

- 来源：[固定提交 57033672d07e8bac527d7147721a4a2e07e0d699](https://github.com/leongersen/noUiSlider/tree/57033672d07e8bac527d7147721a4a2e07e0d699)。
- 迁入范围：迁入 src/nouislider.ts 的 limit（0～100 百分比 clamp）函数；参考双 handle 的范围约束模式。
- 修改说明：以两个原生 range 与原创柱状图替换库的非线性 Spectrum、插件与拖动实现；无表单提交或持久化。
- 核对文件：[src/nouislider.ts](https://github.com/leongersen/noUiSlider/blob/57033672d07e8bac527d7147721a4a2e07e0d699/src/nouislider.ts)、[完整 MIT 许可](https://github.com/leongersen/noUiSlider/blob/57033672d07e8bac527d7147721a4a2e07e0d699/LICENSE.md)。
- 许可：MIT；全文 SHA-256：`0d1fc6e9892bfb1946c780f040578a4d17060182f7721df77b8e068ac19d1ce4`。原文随模板的 NOTICE.txt 保存。
- 视频：通过 GitHub 直接发现/核对；没有填写未经确认的视频关联。
- 学习目标：将连续滑杆映射到离散时间范围；保证下界不超过上界；把派生选择状态投射到图表。

### 缓动曲线试验场（bezier-timing）

调节两个控制点，在曲线与移动小球之间建立直觉。

- 来源：[固定提交 d3021221b2e50efad768ab88e76ccbf9d4c72498](https://github.com/gre/bezier-easing/tree/d3021221b2e50efad768ab88e76ccbf9d4c72498)。
- 迁入范围：迁入 src/index.js 的 Y 三次多项式求值函数；参考 bezier(x1,y1,x2,y2) 的缓动接口。
- 修改说明：原创 SVG 控制点和 20 次二分反解，未迁入上游代数求根器；所有控制点限定在 0～1，以有限播放替代持续动画。上游注明代数求解贡献来自 Dmitry Baranovskiy，本模板未复制该部分。
- 核对文件：[src/index.js](https://github.com/gre/bezier-easing/blob/d3021221b2e50efad768ab88e76ccbf9d4c72498/src/index.js)、[完整 MIT 许可](https://github.com/gre/bezier-easing/blob/d3021221b2e50efad768ab88e76ccbf9d4c72498/LICENSE)。
- 许可：MIT；全文 SHA-256：`32bfd1097d45b41ca6792bf07b389b26ee4045e7f7db28349f4199eef889c516`。原文随模板的 NOTICE.txt 保存。
- 视频：通过 GitHub 直接发现/核对；没有填写未经确认的视频关联。
- 学习目标：用三次多项式计算 Bézier 坐标；用二分法反求 x 对应的参数 t；比较线性时间与缓动时间。

### HSV 配色观测室（color-atlas）

通过色相、饱和度与明度，配出一组可解释的界面颜色。

- 来源：[固定提交 b49018c9f2dbca313d80d7a4dad25e26143cfe01](https://github.com/bgrins/TinyColor/tree/b49018c9f2dbca313d80d7a4dad25e26143cfe01)。
- 迁入范围：迁入并改写 tinycolor.js 的 hsvToRgb 六区间转换公式。上游注明该转换参考 Michael Jackson 的颜色模型转换文章。
- 修改说明：以原生 range 输入和原创五色阶/界面卡代替 TinyColor 字符串解析、全局对象及扩展颜色名称表；仅接受界面提供的数值范围。
- 核对文件：[tinycolor.js](https://github.com/bgrins/TinyColor/blob/b49018c9f2dbca313d80d7a4dad25e26143cfe01/tinycolor.js)、[完整 MIT 许可](https://github.com/bgrins/TinyColor/blob/b49018c9f2dbca313d80d7a4dad25e26143cfe01/LICENSE)。
- 许可：MIT；全文 SHA-256：`c6cb470a9ba0a50d57611aeec1f31da609c5aefdbee8eac7f289bcb0e30625fa`。原文随模板的 NOTICE.txt 保存。
- 视频：通过 GitHub 直接发现/核对；没有填写未经确认的视频关联。
- 学习目标：将 HSV 色相映射到六个 RGB 区间；把 RGB 数字转换为十六进制字符串；以不同明度派生五个色阶。

### 可编辑海报画板（poster-transform）

拖动海报上的标记，再调整尺寸，体验一个最小视觉编辑器。

- 来源：[固定提交 a993eb8cd5cbc65f3a19e45ee24b7fedc026174f](https://github.com/taye/interact.js/tree/a993eb8cd5cbc65f3a19e45ee24b7fedc026174f)。
- 迁入范围：迁入 packages/@interactjs/utils/rect.ts 的 toFullRect 函数，参考 Interact.js 的拖动/约束交互模式。
- 修改说明：原创海报、Pointer Capture、键盘移动与尺寸滑杆；不迁入手势框架、插件、惯性、resize 调度或网络资源。
- 核对文件：[packages/@interactjs/utils/rect.ts](https://github.com/taye/interact.js/blob/a993eb8cd5cbc65f3a19e45ee24b7fedc026174f/packages/@interactjs/utils/rect.ts)、[完整 MIT 许可](https://github.com/taye/interact.js/blob/a993eb8cd5cbc65f3a19e45ee24b7fedc026174f/LICENSE)。
- 许可：MIT；全文 SHA-256：`e805e2367aed149858263a4ae0a62168146af837a9ba3095aa01d02c8559e7fe`。原文随模板的 NOTICE.txt 保存。
- 视频：通过 GitHub 直接发现/核对；没有填写未经确认的视频关联。
- 学习目标：将矩形转换为完整边界坐标；约束拖动元素不越过画板；让指针和滑杆共用同一状态。

### 横向故事展廊（snap-gallery）

滑动原创几何海报，用滚动吸附组织一段横向故事。

- 来源：[固定提交 fbf9ddb555edd2e0332e813dd69972ab9ee4b8b4](https://github.com/nolimits4web/swiper/tree/fbf9ddb555edd2e0332e813dd69972ab9ee4b8b4)。
- 迁入范围：参考 Swiper README 的触摸分页/导航模式及 updateActiveIndex.ts 的活动索引概念；本模板用原生 CSS scroll-snap 与独立滚动代码实现，没有复制 Swiper 库。
- 修改说明：仅保留三张原创 CSS 几何海报；移除图片、自动播放、框架包装器、模块加载、虚拟页、URL 历史及任何外网请求。
- 核对文件：[src/core/update/updateActiveIndex.ts](https://github.com/nolimits4web/swiper/blob/fbf9ddb555edd2e0332e813dd69972ab9ee4b8b4/src/core/update/updateActiveIndex.ts)、[完整 MIT 许可](https://github.com/nolimits4web/swiper/blob/fbf9ddb555edd2e0332e813dd69972ab9ee4b8b4/LICENSE)。
- 许可：MIT；全文 SHA-256：`99f08e3e3ee0799fe1488fcbcb41dc933b14873e9556693209daf9e1007601d6`。原文随模板的 NOTICE.txt 保存。
- 视频：通过 GitHub 直接发现/核对；没有填写未经确认的视频关联。
- 学习目标：用 scroll-snap-align 建立分页吸附；把活动页索引与滚动位置联系起来；提供按钮和触摸两种导航方式。

### 环形数据观测站（donut-observatory）

切换图例并调整样本，理解份额如何转换成环形图弧度。

- 来源：[固定提交 7169e65147a47f3720957a6f156a33c838ab9f57](https://github.com/chartjs/Chart.js/tree/7169e65147a47f3720957a6f156a33c838ab9f57)。
- 迁入范围：迁入并改写 src/controllers/controller.doughnut.js 的 calculateCircumference 份额到弧度公式，参考 calculateTotal 的可见值求和。
- 修改说明：原创 Canvas 环形图、数据样本与图例；不迁入 Chart.js 的控制器、坐标系统、插件或任何真实学习数据。
- 核对文件：[src/controllers/controller.doughnut.js](https://github.com/chartjs/Chart.js/blob/7169e65147a47f3720957a6f156a33c838ab9f57/src/controllers/controller.doughnut.js)、[完整 MIT 许可](https://github.com/chartjs/Chart.js/blob/7169e65147a47f3720957a6f156a33c838ab9f57/LICENSE.md)。
- 许可：MIT；全文 SHA-256：`41a84aa2caba645f966a18d9c2056b73e6d3a81d80bc0046bc0011a2634d4cce`。原文随模板的 NOTICE.txt 保存。
- 视频：通过 GitHub 直接发现/核对；没有填写未经确认的视频关联。
- 学习目标：求可见数据的绝对值总和；把 value / total 映射成 2π 弧度；让图例状态驱动可视化重绘。

### 重力小球试验箱（gravity-bowl）

投放小球，调节重力与空气阻力，观察边界回弹。

- 来源：[固定提交 b8ee71cd7f9b49f53639ddaedd6254f1929bcbe5](https://github.com/liabru/matter-js/tree/b8ee71cd7f9b49f53639ddaedd6254f1929bcbe5)。
- 迁入范围：迁入并简化 src/body/Body.js 中 Body.update 的位置差推导速度与 frictionAir 衰减/Verlet 积分结构。
- 修改说明：仅实现最多 15 个圆形的重力和容器边界碰撞；没有迁入 Matter.js 的刚体求解器、物体间碰撞、约束或完整引擎。每次操作最多模拟 600 帧，不持续后台运行。
- 核对文件：[src/body/Body.js](https://github.com/liabru/matter-js/blob/b8ee71cd7f9b49f53639ddaedd6254f1929bcbe5/src/body/Body.js)、[完整 MIT 许可](https://github.com/liabru/matter-js/blob/b8ee71cd7f9b49f53639ddaedd6254f1929bcbe5/LICENSE)。
- 许可：MIT；全文 SHA-256：`ed182087be5b26734aa6d4789743de3a97417950e8c1e3ff2e3d19c6462720d3`。原文随模板的 NOTICE.txt 保存。
- 视频：通过 GitHub 直接发现/核对；没有填写未经确认的视频关联。
- 学习目标：从当前位置与前一帧位置推导速度；用摩擦系数衰减运动；在边界修正位置并保留回弹速度。

### 线框空间观察器（wireframe-orbit）

旋转一枚线框立方体，用二维画布理解三维投影。

- 来源：[固定提交 d4f1373ea73704daae13281ff7e8c48761e777b3](https://github.com/mrdoob/three.js/tree/d4f1373ea73704daae13281ff7e8c48761e777b3)。
- 迁入范围：迁入并改写 src/math/Vector3.js 的 applyMatrix4 齐次坐标变换和透视除法计算。
- 修改说明：原创八个立方体顶点、十二条边、旋转与 Canvas 渲染；不迁入 Three.js WebGL 渲染器、着色器、模型加载器或场景系统，不要求 GPU 或外部模型。
- 核对文件：[src/math/Vector3.js](https://github.com/mrdoob/three.js/blob/d4f1373ea73704daae13281ff7e8c48761e777b3/src/math/Vector3.js)、[完整 MIT 许可](https://github.com/mrdoob/three.js/blob/d4f1373ea73704daae13281ff7e8c48761e777b3/LICENSE)。
- 许可：MIT；全文 SHA-256：`8b378ebe60e2fe500158cb0ac71cb5e8b7d92953c2abcc63a0eb90499653b5bc`。原文随模板的 NOTICE.txt 保存。
- 视频：通过 GitHub 直接发现/核对；没有填写未经确认的视频关联。
- 学习目标：用两个旋转角变换三维顶点；在齐次矩阵变换后除以 w；将顶点和边组合成线框图。

### 景深选择卷轴（depth-picker）

上下切换数字，观察条目绕虚拟圆柱旋转进入焦点。

- 来源：[固定提交 72678212d4041f124e1585cdf6360f36737daa5f](https://github.com/wcandillon/can-it-be-done-in-react-native/tree/72678212d4041f124e1585cdf6360f36737daa5f)。
- 迁入范围：迁入并改写 the-10-min/src/Picker/Picker.tsx 的相对偏移 clamp、asin 旋转和 radius*cos(angle)-radius 景深公式；参考 AnimationHelpers 的吸附到离散条目思想。
- 修改说明：以 CSS 透视、原生按钮/键盘/触摸替换 React Native Reanimated、MaskedView 与外部字体；不复制完整原生组件或第三方 redash 的 snapPoint。仓库 README 明确关联原作者 YouTube 系列，但未独立核实具体单集链接，故不填单集视频地址。
- 核对文件：[the-10-min/src/Picker/AnimationHelpers.tsx](https://github.com/wcandillon/can-it-be-done-in-react-native/blob/72678212d4041f124e1585cdf6360f36737daa5f/the-10-min/src/Picker/AnimationHelpers.tsx)、[the-10-min/src/Picker/Picker.tsx](https://github.com/wcandillon/can-it-be-done-in-react-native/blob/72678212d4041f124e1585cdf6360f36737daa5f/the-10-min/src/Picker/Picker.tsx)、[完整 MIT 许可](https://github.com/wcandillon/can-it-be-done-in-react-native/blob/72678212d4041f124e1585cdf6360f36737daa5f/LICENSE)。
- 许可：MIT；全文 SHA-256：`69643065d80bce8e2d278f33ab3763d18604c4776c1089ac7dc2f22cba7d8ccb`。原文随模板的 NOTICE.txt 保存。
- 视频：通过 GitHub 直接发现/核对；没有填写未经确认的视频关联。
- 学习目标：将条目偏移归一化并 clamp；用 asin 将高度映射为绕轴角度；用 cos 推导景深并保持选中状态。

### 流体翻页海报（liquid-page）

调整边缘拉伸量，让一道流体曲线把下一张海报带到眼前。

- 来源：[固定提交 678cb1fc21d5f0523f189e90347ba9ce483a7cb4](https://github.com/ashutosh1919/react-liquidswipe/tree/678cb1fc21d5f0523f189e90347ba9ce483a7cb4)。
- 迁入范围：参考 src/components/liquidswipe.js 的 getPath 中 anchorDistance、curviness、C/S 三次曲线和 SVG clipPath 边缘裁切结构；路径坐标与驱动代码独立重写。
- 修改说明：原创两张纯 SVG 海报，以滑杆和一次性 requestAnimationFrame 替换 Gatsby、React Spring、use-gesture、图片与付费设计素材；不迁入应用逻辑或上游整组件。
- 核对文件：[src/components/liquidswipe.js](https://github.com/ashutosh1919/react-liquidswipe/blob/678cb1fc21d5f0523f189e90347ba9ce483a7cb4/src/components/liquidswipe.js)、[完整 MIT 许可](https://github.com/ashutosh1919/react-liquidswipe/blob/678cb1fc21d5f0523f189e90347ba9ce483a7cb4/LICENSE)。
- 许可：MIT；全文 SHA-256：`a915fe3679b3abb14db19d72b1000936c0beb987ed0bc69c752e8bcb0eb9bd82`。原文随模板的 NOTICE.txt 保存。
- 视频：[DevSense · Liquid Swipe Animation（原作者仓库 Important Links 直接关联）](https://www.youtube.com/watch?v=uGoWVz-q2M8)
- 学习目标：把拖动量映射为 Bézier 控制点；用 clipPath 裁切图形而不是切换布局；在转场结束后更新页面状态。

## 内容验证

`tests/creative-catalog.unit.test.ts` 检查 20 个不同的作品/仓库、固定 40 位提交、完整 NOTICE 和许可、源码文件链接、视频关联限定、工作区字节/路径限制、本地资源与 JavaScript 语法。另用真实 Chrome、390 × 900 视口、allow-scripts iframe 和与项目相同的预览 CSP 逐件运行 20 件内容；减少动态效果模式下，每件关键控件均通过，页面没有横向溢出、JavaScript 错误或外网资源请求。该项验证覆盖模板内容；产品接口、收藏、创建项目与实际广场导航由创意广场集成测试记录。封面由实际浏览器渲染生成。

## 封面生成

20 张封面位于 apps/web/public/creative，使用真实浏览器 DOM 截图，每张约 640 × 400 像素。截图后没有编辑像素，不使用视频截图、下载图片或外部字体。所有 20 张已在拼组图中逐件查看，核心 UI 没有白图或截断。public/creative/NOTICE.txt 汇总每件固定提交、迁入范围及完整许可。

可在安装开发依赖和 Chrome（macOS）或 Playwright Chromium（Linux）后复现：

```sh
node --import tsx scripts/creative-covers.mjs
```

脚本只读取内置创意目录，不接受用户源码或项目路径。两个临时本地 HTTP 服务提供固定静态文件，浏览器使用 opaque sandbox iframe 及项目相同的预览 CSP；结束时关闭服务。为统一封面大小，截图时仅将 stage 展示高度设为 400px，模板源码不变。纸屑和重力演示会短暂渲染真实动画，暂停后再截图，其余使用减少动态效果模式；这不会改变下载到工作区的实现。

生成记录位于 .data/creative-covers-manifest.json，记录尺寸、字节数、SHA-256 和源提交；拼组检查图位于 .data/creative-covers-contact.png。两者属于本地验证输出。景深卷轴曾在截图中发现相邻标签重叠，已修正景深位移与旋转的顺序，并加入截图脚本中的邻项间距校验。
