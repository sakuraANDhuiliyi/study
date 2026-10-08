# Tabler 浅色界面改版

日期：2026-10-08。用户确认采用 Tabler 浅色专业风格。

## 网络参考与使用方式

- [Tabler 官方纵向后台示例](https://preview.tabler.io/layout-vertical.html?theme=light)：白色侧栏、浅灰工作区、紧凑页头、指标卡与分区列表。
- [Tabler 官方登录页](https://preview.tabler.io/sign-in.html)：居中登录卡片、清晰标签和主操作。
- [Tabler 官方许可说明](https://docs.tabler.io/ui/getting-started/license)：Tabler 开源项目采用 MIT 许可。
- 同时比较了 [Ant Design Pro](https://github.com/ant-design/ant-design-pro)，最终按用户选择采用 Tabler 方向。

本次是根据上述视觉参考，为现有 React / Ant Design 组件编写主题与页面布局。没有引入 Tabler 的 Bootstrap 样式包、JavaScript、品牌图标、插画或付费模板源码；现有图标继续使用 Lucide。不增加字体 CDN、远程脚本或新的依赖包。

## 设计规则

| 项目            | 规范                                                   |
| --------------- | ------------------------------------------------------ |
| 主色            | `#206bc4`                                              |
| 页面背景 / 卡片 | `#f6f8fb` / `#ffffff`                                  |
| 正文 / 次级文本 | `#182433` / `#626976`                                  |
| 边框            | `#dce1e7`                                              |
| 圆角            | 6px                                                    |
| 正文            | 系统字体，14px，中文优先 PingFang SC / Microsoft YaHei |
| 间距            | 卡片 18–20px，桌面页面 24–28px                         |
| 手机导航        | 可展开侧栏，关闭按钮、遮罩及 Escape 关闭               |
| 手机表格        | 保持合理列宽，在表格内部横向滚动                       |

颜色同时定义于 `apps/web/src/theme.ts`（Ant Design）和 `apps/web/src/tabler.css`（全局 CSS 变量），修改主主题时须同步。`styles.css` 保留业务布局基础，`tabler.css` 是统一外观层，`workflows.css` 是答题、交流与管理组件的外观层。登录和工作台使用独立、按需加载的样式文件；工作台引用全局颜色变量。

## 改动范围

- 登录：居中白色卡片、真实错误与加载状态、多角色说明；开发账号选择只填账号，生产构建不显示。
- 框架：白色侧栏、蓝色选中项、清晰面包屑与账号区、移动导航关闭控件、跳转到正文链接。
- 四角色工作台：移除装饰性大横幅，保留真实指标、课程、任务、活动图与公告。机构指标指向已有组织管理路由。
- 课程：重新设计课程封面占位、卡片与进度区；统一课时目录、内容、引用和附件样式。
- 作业、练习、考试：统一表格、答题选项、答题卡、计时器、保存状态和弹窗。
- 交流、通知、分析和管理：统一列表、聊天气泡、指标卡、权限面板与提示文字。
- 清理 35 条已弃用的旧登录 CSS 规则。

接口、数据库及答题保存机制未因本次主题改版更改。

## 验证

- Web TypeScript、全仓 ESLint、Web 生产构建通过。
- 原有 7 项 Playwright 浏览器用例全部通过：桌面页面、手机布局、考试离线恢复、创建和编辑考试、练习位置恢复、主观题阅卷及管理权限页面。
- 在最后一次手机表格和导航调整后，另执行手机布局用例，通过。
- 四种身份的 1440px 桌面和 390px 手机工作台均检查了真实指标、图表、页面宽度和脚本异常。
- 登录页额外检查 320px；课程、课时与分析检查桌面及手机；题库、考试、交流、私信、通知、用户管理、题目预览弹窗完成代表性截图检查。
- 手机表格实测内部可横向滚动，页面本身无横向溢出。
- 业务浏览器回归使用独立验证数据库；演示库仅登录和只读浏览。此次没有向外部托管环境发布。

## 新版截图

- [登录页](screenshots/tabler-login-desktop.png)
- [学生工作台 · 桌面](screenshots/tabler-student-dashboard-desktop.png)
- [教师工作台 · 桌面](screenshots/tabler-teacher-dashboard-desktop.png)
- [学生工作台 · 手机](screenshots/tabler-student-dashboard-mobile.png)
- [课程列表 · 手机](screenshots/tabler-courses-mobile.png)
- [题库 · 手机](screenshots/tabler-teacher-questions-390.png)
- [题目预览 · 手机](screenshots/tabler-teacher-question-preview-390.png)

截图来自本地真实演示数据，日期和统计值随数据变化。
