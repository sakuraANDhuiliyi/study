# 网站与 Android App 工作室

编程模块提供两个入口：`/programming` 是网站工作室，`/programming/android` 是 Android App 工作室。学生与当前学习空间仍由平台登录会话、学习权限和机构功能配置控制。

## 网站

网站保留 HTML/CSS/JavaScript 多文件编辑、AI 候选审阅、版本恢复、项目复制和备份。保存后点击“在本站运行”，进入 `/programming/sites/<项目ID>`。该路径始终读取本人当前空间的已保存版本，再创建隔离运行会话；重新运行会加载最新保存内容。运行会话沿用十分钟期限。

本站子目录是经过登录验证的运行入口；网站代码在已有独立预览服务及 iframe 沙箱中执行。这样生成的脚本不会取得平台 Cookie、登录页面 DOM 或任意平台接口权限。HTML/CSS/JavaScript 网站的相对资源仍由预览服务提供，前端工程没有新增公开分享或服务端代码执行权限。

## Android App

从本地 Android Agent 迁入完整 Python 服务模块、Android 模板、工具运行时和 Web 工作台，保留项目、任务、多轮对话、文件操作、版本/检查点、变更审查、审批、反馈和 APK 下载等原始逻辑。来源记录见 `services/android-agent/UPSTREAM.json`。

新增平台适配层将学生和机构组合映射成独立工作区身份。浏览器只使用本平台会话；Node API 为每次内部请求签名，Python 只接受短期有效且不可重放的签名，不把构建服务凭据暴露到浏览器。代理仅开放项目、任务、对话、模型和健康入口，独立账号管理、终端、MCP 及主机执行配置不通过学生入口开放。下载返回前会再次复核平台身份与权限。

工作台支持创建项目、提交 Agent 修改需求、查看任务过程、停止任务、查看源码和构建日志。另有无需 AI 的“构建 APK”“停止构建”“下载 APK”“下载源码”。真实构建成功才产生 APK；失败显示真实日志。源码 ZIP 不包含运行缓存、构建目录或本机 SDK 配置。人工构建至多两项并行，同一项目只接受一项，且与原项目锁和活跃 Agent 任务保持互斥。

进入工作室时会验证实际签名健康响应和当前工作区身份，短暂连接失败可点击“刷新状态”重试。未配置模型密钥时显示提示，仍可使用编辑、人工构建和下载。这里的可用性只表示服务连通；模型密钥配置状态不证明模型请求一定成功，构建是否成功仍以实际结果为准。健康状态不向页面转发凭据和主机地址。

原始进程执行器仍在 macOS 使用系统沙箱，在 Linux 要求 bubblewrap，缺少隔离执行器时拒绝执行。Gradle 使用预先准备的可信缓存进行离线构建。macOS 对 JVM 固定使用 IPv4 本机通信，允许 Gradle/Kotlin 自身 IPC；外部网络和其他工作区文件继续拒绝。构建限制为两名 Gradle worker、2 GiB JVM 堆及 2,048 个文件描述符，其他命令保留原 512 描述符限制。

集成版已移除原 Agent 的独立后台界面，管理使用本平台已有页面。LMS 模式也不安装原 Agent 创意目录，不导入其子系统或初始化创意数据表；已有历史数据保持。可选目录源码仍保留供独立模式使用，启用时才安装。学生的创意入口由平台原有创意模块提供。

## 本地启动

安装 Python 3.10+、Android SDK 和 JDK；首次准备：

```sh
npm run android:setup
JAVA_HOME="/你的/JDK目录" ANDROID_HOME="/你的/AndroidSDK目录" \
  .data/android-venv/bin/python services/android-agent/scripts/prepare_gradle_seed.py \
  --output .data/android-agent/gradle-seed
npm run dev:programming
```

`android:setup` 保留已有私有配置，首次从本项目 `config.yaml` 的 AI 部分创建 `.data/android-agent/config.yaml`。没有密钥时仍可编辑、构建和下载，AI 生成需要实际配置。可用 `ANDROID_SETUP_PYTHON` 选择创建虚拟环境的解释器，用 `ANDROID_AGENT_PYTHON` 指定服务解释器。默认 Android 服务仅绑定 `127.0.0.1:8011`，由 API 进程管理。

配置、数据库、工作区、APK 和构建缓存都放在忽略的 `.data` 中。迁移没有复制原 Android Agent 的配置、凭据、用户数据或既有构建产物。普通 `npm run dev` 保留原网站开发流程；`npm run dev:programming` 同时启用 Android 服务。

## 参考与验收

Android 构建过程参考 [Android 官方命令行构建指南](https://developer.android.com/build/building-cmdline)，使用实际 `assembleDebug` 结果。网站执行隔离参考 [MDN iframe 文档](https://developer.mozilla.org/en-US/docs/Web/HTML/Reference/Elements/iframe)。Gradle 本机通信问题通过原始 TCP/地址选择源码和本机 JVM 实验定位。

协议测试执行真实 FastAPI、SQLite 和独立临时工作区，覆盖签名、重放、客户端身份覆盖、项目跨空间隔离、APK 不存在和源码下载；不调用模型。完整迭代门禁会执行 `integration:android-protocol`、新增四项 Node 单元与三项浏览器场景，并覆盖项目全部现有测试。真实 APK、OS 沙箱边界和构建并发的本机专项记录保存在本轮验收报告中。

迁入的 Python 依赖已重新生成带哈希的版本锁，修复原锁中的 AnyIO、python-dotenv 和 Starlette 已知漏洞。独立 Python 依赖审计零漏洞，并在更新后的实际运行环境复验 APK 构建、下载与取消操作。APK 协议测试同时覆盖成功下载和跨用户拒绝。
