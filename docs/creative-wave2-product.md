# 第二批创意：产品与工具界面

这组新增 7 件作品。重点是可以操作的完整工具场景：主视图、导航、选中属性、执行记录或时间线互相联动。所有作品是对开源项目交互模型的**独立原生 HTML/CSS/JavaScript 重实现**，不是上游整库集成，也不包含上游服务器、账号、云协作或 AI 执行能力。每件具备 5 个工作区文件、固定源码版本、完整 MIT 许可和中文学习步骤。

| 作品                              | 本地可操作内容                                                                       | 对应 GitHub 项目及固定版本                                                                                                      |
| --------------------------------- | ------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------- |
| 信号编排工作台 `signal-workflow`  | 拖动/方向键移动节点、选中属性、乘法/加法/平方、添加变换、本地链路执行和逐步结果      | [xyflow/xyflow](https://github.com/xyflow/xyflow/tree/3d35b57317576b0916c0bfeaaedd573aaacc2839)                                 |
| 产品叙事白板 `storyboard-canvas`  | 添加形状/便签、拖动、文字/颜色编辑、复制/删除、缩放和撤销                            | [excalidraw/excalidraw](https://github.com/excalidraw/excalidraw/tree/4c00f31ddcc20086bac1020428819fe0b9a30bce)                 |
| 轨道研究桌面 `orbital-desktop`    | 多窗口拖动/聚焦、最小化/Dock 唤回、专注/探索布局、信号切换、观测角度和便笺编辑       | [pmndrs/use-gesture](https://github.com/pmndrs/use-gesture/tree/c779631aa05959638dee81b9a25fb1299a7467f6)                       |
| 航行指令中枢 `navigation-command` | 搜索命令、方向键/Enter、三个真实视图、星域选择/扫描、本地跃迁、能量和日志联动        | [dip/cmdk](https://github.com/dip/cmdk/tree/dd2250ed608443e8f32bafc5fa2d1d07a3746aa3)（原 pacocoursey/cmdk 的当前仓库）         |
| 标本档案馆 `specimen-archive`     | 目录展开、保留祖先的过滤、选中预览、重命名、收藏筛选和归档/移回                      | [jameskerr/react-arborist](https://github.com/jameskerr/react-arborist/tree/d74c4ec696ba98c1a4e981075f6d60cdff3e290b)           |
| 片段导演台 `sequence-director`    | 三轨片段拖动、开始/结束修剪、播放头、拆分/添加、范围缩放、静默轨道和真实图形帧       | [xzdarcy/react-timeline-editor](https://github.com/xzdarcy/react-timeline-editor/tree/4148f4a837dd767ea66807560d05bc7b65c7e578) |
| 界面分镜造型台 `screen-sculptor`  | 组件添加/拖动/方向键微调、文字/形状/配色、两屏导航、原型点击试用和确定性本地说明生成 | [lnkiai/m3e-canvas](https://github.com/lnkiai/m3e-canvas/tree/0239ae1a8532f905388de4b46ff88a1c90641bb2)                         |

## 视频选型与 GitHub 关系

- [What is React Flow? Explained in 60 Seconds](https://www.youtube.com/watch?v=aUBWE41a900)：xyflow 官方发布，视频链接由 [xyflow 官方博客](https://xyflow.com/blog/spring-update-2023) 提取，YouTube oEmbed 核验标题和作者。这是节点工作台的上游项目介绍，标为 `source`。
- [zotero-excalidraw - 功能操作教程](https://www.bilibili.com/video/BV1wYi2YeEbK/)：视频简介直接列出 [018/zotero-excalidraw](https://github.com/018/zotero-excalidraw)，并说明内嵌的 [Excalidraw 上游](https://github.com/excalidraw/excalidraw)。这是封装作者的白板功能教程，作为选型参考标为 `inspiration`，没有声称是 Excalidraw 官方视频；迁入内容仍然只研究 MIT 上游的白板交互模型。
- [抖音 M3E Canvas 展示](https://www.douyin.com/video/7684299385588436258/)：视频提及界面设计工具；其 [官方 GitHub 项目](https://github.com/lnkiai/m3e-canvas) 另行核对。标为 `inspiration`，不声称视频作者直接贴出了 GitHub 链接，也不搬运视频帧。

其他作品没有找到可靠的视频关联，保留已验证的 GitHub 来源，未补造视频链接。

## 实际迁入边界

每件 `source.scope` 和 `source.changes` 说明研究了哪个数据/交互模型、如何改为原生界面，以及没有集成的能力。所有示例数据、几何图形、视觉布局和简化状态处理在本项目内编写；未安装或运行上游代码，不依赖 CDN、外部媒体、图标字体、网络接口或浏览器持久存储。

M3E Canvas 自身以 MIT 发布，但其 [NOTICE](https://github.com/lnkiai/m3e-canvas/blob/0239ae1a8532f905388de4b46ff88a1c90641bb2/NOTICE) 还列出 Apache-2.0 的 Material loading 图形/算法。本地造型台**没有迁入**这些 loading 形状、`shapes.ts`、Material Symbols 或 Google 字体；只研究 MIT 屏幕/组件/导航/说明面板模型，使用原创 CSS 和 Unicode/几何。项目的 LICENSE 和第三方 NOTICE 均保留固定来源链接。

航行、流程和导演台里的执行均为浏览器内的确定性数值/场景模拟；造型台说明由当前设计数据生成，没有调用 AI 模型。学习者创建项目后，可继续使用已有编程模块的 AI 编辑功能。

## 验证

在真实 Chrome 中，使用与正式编程预览一致的 CSP 和 `sandbox="allow-scripts"` 的独立 opaque iframe，分别以 390 像素手机和 960 像素桌面宽度验证：7 件 × 2 = **14 场景通过**，共 **106 个控件动作**。包括执行结果、形状属性/撤销、窗口显隐、键盘指令、目录移动、时间线修剪/拆分和双页原型导航。所有场景无 JavaScript 页面错误、外部网络请求或横向溢出；已人工检查 7 件桌面和手机布局截图。CSS 遵循减少动态效果设置，自动播放仅由用户操作启动。

可重复的动作与封面状态写在 `.data/creative-wave2-product-probes.json`；本轮临时证据位于 `.data/creative-product-wave2/smoke-results.json`、`smoke.log` 和各场景截图。临时 HTTP 服务器由验证脚本结束时关闭。全目录/API/工作区联调和 20 件新增的封面由主流程统一验证。
