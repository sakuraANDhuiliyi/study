# 创意广场第二批：视觉与空间作品来源

这 7 件作品分别对应 7 个 GitHub 仓库；每件有 5 个可编辑工作区文件，完整 MIT 许可保存在 `NOTICE.txt`。固定源码已下载并逐件查看，没有安装或运行来源仓库的依赖。界面、图形与演示数据由浏览器生成。

“改写”指具体公式或渲染流程的适配。标注“概念借鉴 / 独立实现”的作品不声称移植上游完整效果。原仓照片、商标、字体、视频帧和服务器能力没有进入作品。

| 作品                                 | 来源与固定提交                                                                                                                      | 可检查源码与实现范围                                                                                                                                                                                                                                                                        |
| ------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 地球航线指挥台 (`orbital-route`)     | [shuding/cobe](https://github.com/shuding/cobe/tree/7e94076fa8c38707f4c9cd114ff4f7c5c880971e)                                       | `src/index.js` 球面坐标转换与 `src/arc.glslx` 二次贝塞尔升空航线，改为 Canvas 正交投影及深度裁剪。新增目的地、夜航、视角、航线日志。点阵陆块是程序化示意，不用于导航。                                                                                                                      |
| 极光光谱演播室 (`aurora-spectrum`)   | [patriciogonzalezvivo/glslCanvas](https://github.com/patriciogonzalezvivo/glslCanvas/tree/9ed588a7a2d079db1bcc3d8badb8e7de64b75249) | `src/gl/gl.js` 的着色器编译与链接检查、`src/GlslCanvas.js` 的时间与分辨率 uniform 更新流程。极光 GLSL 独立编写，增加光谱预设、密度、曝光、磁场指针与冻结快门；WebGL 不可用时保留 Canvas 后备。                                                                                              |
| 等高线地形档案 (`contour-atlas`)     | [ashima/webgl-noise](https://github.com/ashima/webgl-noise/tree/6abed1e77ed1e18b181627c35f688eb30c9fe75e)                           | `src/noise2D.glsl` 的 simplex、mod289、permute 与梯度归一化改为 JavaScript 多尺度采样。新增连续等高线、海平面、地形种子、地图探针、剖面线与蓝图视图；不使用真实高度图。                                                                                                                     |
| 曲线光廊驾驶舱 (`curve-corridor`)    | [pmndrs/drei](https://github.com/pmndrs/drei/tree/bf6f4addf47467d3885de272d94ca5127f6ef68f)                                         | 借鉴 `src/core/CatmullRomLine.tsx` 的分段曲线与颜色插值概念，独立实现透视环截面、程序化航路与驾驶仪表。没有复制 drei/Three.js 程序。航路、速度、截面边数、转向、检查点均有状态。                                                                                                            |
| 空间色谱档案馆 (`chromatic-archive`) | [houmahani/codrops-depth-gallery](https://github.com/houmahani/codrops-depth-gallery/tree/28190e0920df887f069524c3863db397af34c1c8) | 改写 `src/Experience/Gallery.js` 景深归一化、深度缩放和视差概念，参考背景着色流程。以 6 张原创程序化色谱海报替代上游 Lummi.ai 图像，不迁媒体与 Three.js。新增档案选择、景深、氛围亮度与作品解读。                                                                                           |
| 环轨未来展览 (`orbital-exhibition`)  | [codrops/3DCarousel](https://github.com/codrops/3DCarousel/tree/f354a11d19777b4e573d47b016354951b1ecace3)                           | 保留 `js/index.js` 的 `getCarouselCellTransforms` 等角 `rotateY + translateZ` 布局公式，用显式展览状态替代 GSAP。8 件原创 Canvas 海报组成真实 CSS 3D 环轨，支持选择、半径、俯仰与聚焦。上游摄影和 GSAP 插件未迁入。                                                                         |
| 液态玻璃光学工坊 (`liquid-optics`)   | [iyinchao/liquid-glass-studio](https://github.com/iyinchao/liquid-glass-studio/tree/f7b28c36305a862f5cffed3ddd51511cf1204f56)       | `src/shaders/lib/sdf.glsl` 超椭圆范数及 `src/shaders/fragment-main.glsl` 法线、Snell 边缘折射、分通道色散思路改为 Canvas CPU 像素采样。新增原创色带与网格、拖动透镜、3 种轮廓、折射、色散与原画对照。上游注明 SDF 思路来自 Inigo Quilez；当前是光学近似，不声称迁入完整 React/WebGPU 引擎。 |

每件作品的来源页同时包含固定提交下的源码路径与 `LICENSE` 链接；全文许可、改写范围和本地修改随项目及 ZIP 一起保留。

## 视频平台检索与对应关系

检索了 Bilibili 与 YouTube 的创意展示入口。[在 HTML 中实现液态玻璃组件](https://www.bilibili.com/video/BV1vwM3zFESr/) 与作者 [rxing365/html-liquid-glass-effect-webgl](https://github.com/rxing365/html-liquid-glass-effect-webgl) 的 README 存在来源关联。Bilibili 页面在本次读取中返回 412，记录依据检索描述和作者仓库的官方链接，不声称完整观看视频。该仓库没有明确 LICENSE，因此没有迁其源码；最终工坊使用已经核对 MIT 的 Liquid Glass Studio 公式。

`liquid-optics` 视频元数据采用 `relation: inspiration`，携带视频原对应的 `repository`；标题明确“视觉参考 / 未迁其源码”。视频不被误记为 Charles Yin 的 Liquid Glass Studio 演示。没有核实到新的 YouTube 对应地址，没有补造视频链接。

`codrops/InfiniteTubes` 同样没有仓内 LICENSE，因此没有迁源码；曲线光廊采用 MIT 的 drei 分段曲线概念并独立实现。

## 内容验证

- 7 件工作区通过文件路径、文件数、单文件与总量边界校验，以及 JavaScript 语法检查。每件 5 文件，总量约 12.1–15.1 KB，最大文件 6,045 字节。
- 真实 Chrome、390 px 宽、系统减少动态效果、仅 `allow-scripts` 的 opaque iframe、产品相同 CSP：7 件共 29 个控件操作与可见状态断言通过。
- 每件主要操作还验证 Canvas 像素或 CSS 3D transform 改变，避免只检查状态文字。没有脚本错误、外部资源请求或水平溢出。
- 极光的 WebGL 不可用路径、Canvas 后备与密度调整通过。
- 已查看全部桌面与手机截图；测绘图补充连续等高线，手机角落标注使用独立宽度，避免图例覆盖。
- 可复现验证：`node --import tsx .data/creative-wave2-visual-smoke.mjs`。证据：`.data/creative-wave2-visual-smoke.json`。稳定控件与封面动作：`.data/creative-wave2-visual-probes.json`。
- 来源只读参考及 SHA256：`.data/creative-wave2-visual/<owner>__<repo>/`、`upstream-evidence.json`。质检图：该目录 `contact-desktop.png` 与 `contact-mobile.png`。

这些是作品内容验证。平台列表、收藏、项目创建与权限接口由主任务另外回归。临时内容验证服务器均已关闭。
