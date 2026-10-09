# 编程工作室：从网页练习到 AI 候选代码

学生从侧栏“编程工作室”进入 **/programming**，创建自己的多文件网页项目，修改 HTML、CSS、JavaScript，运行预览、查看日志，并保存版本或下载 ZIP。个人学生和机构学生均可使用；项目、AI 草稿及版本按本人和当前学习空间保存，切换空间不会混合记录。

本版按用户选择提供本地工作区与预览。网页中没有发布按钮，也没有连接公开部署服务。算法题的编译、测试和判题仍由[算法练习与 Judge0](algorithm-judge.md)负责。

## 开始一次练习

1. 选择“我的第一个网页”“交互计数器”或“学习待办清单”，输入项目名称并创建项目。
2. 在文件列表选择 **index.html**、**style.css** 或 **app.js**。可以编辑源码、增加和删除其他文件，根目录 **index.html** 必须保留。
3. 修改标题、配色或点击事件，点击“运行预览”。预览可以使用当前尚未保存的源码；修改源码后需重新运行才能看到新效果。
4. 点击“保存草稿”把名称和完整源码写入数据库。浏览器离开页面时会提示未保存修改。
5. 学会一个知识点后保存版本，并写明备注，例如“完成按钮事件”。版本记录可以查看源码和恢复；需要在外部保留时下载 ZIP。

桌面使用本地打包的 Monaco 编辑器，支持对应文件语言的高亮；宽度不超过 600 px 的设备默认使用简易文本编辑器，也可手动切换。专业编辑器加载失败时会回退到简易编辑器。**Ctrl / ⌘ + S** 保存，**Ctrl / ⌘ + Enter** 运行预览。专业编辑器在文件切换时保留各自的视图和模型，项目离开后清理对应模型。

页面内计数器、待办列表等运行状态存在预览窗口的内存中，重新运行后重置。项目源代码的数据库保存与网页运行状态是不同的数据。

## 用 DeepSeek 编写或改进网页

先保存当前草稿，在“你想做什么？”中描述目标。例如：

> 保留原有计数按钮，增加步长输入框，限制步长为 1 至 10；展示非法输入提示，并解释输入校验与 DOM 更新的关系。

点击“生成候选代码”后，服务端发送项目名称、需求和当前完整源码，要求模型返回改动说明、实现计划、知识讲解及完整文件列表。模型不会自动替换当前项目。

任务列表只读取状态、需求、摘要等元数据，不读取或传输项目及候选的整份源码、实现计划和知识讲解。仅在存在生成中的任务时每 5 秒刷新列表；全部完成后停止轮询。选择一个任务后按需加载详情与候选源码，页面会显示加载状态或可重试的错误；选中的生成中任务完成时自动加载一次更新后的详情。

生成完成后，查看“候选代码审阅”中的新增、修改和删除文件，打开源码对比，确认后点击应用。应用前，服务端把当前已保存源码保留为版本快照；如果最新快照已经与当前源码一致，就复用它。应用和版本保存位于同一数据库事务中，成功后会记录应用后的版本。随后运行预览，手动核对交互、布局和控制台错误。

若模型生成期间项目在其他页面发生修改，候选仍可查看，但不能直接覆盖新修订。应保留需要的源码，以当前版本重新生成。失败、超时或无效 JSON 会明确显示，已有源码保留；系统不会伪造“测试通过”或“已经部署”的结果。

AI 沿用根目录 **config.yaml** 的 **ai** 配置，默认接入 DeepSeek。新环境先：

```sh
cp config.example.yaml config.yaml
```

由部署者自行填写 **ai.apiKey**，保留所需 **ai.model**、**ai.baseUrl** 和 **ai.apiStyle**。现有有效配置可直接复用，不需要新建另一套密钥。密钥只由 API 服务读取，浏览器不会收到密钥；**config.yaml** 已被 Git 和 Docker 构建忽略。完整提供方配置见 [AI 接入说明](ai-study.md)。

编程生成不调用 Tavily，不下载外部依赖，也不把用户身份、机构或课程内部 ID 作为模型输入。源码和需求会发送到配置的模型服务，因此不要在学习文件中粘贴真实账号、密钥或其他私密材料。未配置 AI 时，手动编辑、项目保存、版本和预览仍可使用。

生成请求与错题分析、教师出题、搜索和来源下载共用 **limits.dailyRequests**：按北京时间统计，失败尝试也计入，每人同时只允许一个在途 AI 请求。删除项目不会删除已消耗的额度记录。

## 本地预览配置

正常启动数据库、迁移与 API 后，API 同时启动独立静态预览监听器。开发默认配置为：

```dotenv
APP_ORIGIN=http://localhost:5173
PROGRAMMING_PREVIEW_PORT=4173
PROGRAMMING_PREVIEW_ORIGIN=http://127.0.0.1:4173
PROGRAMMING_PREVIEW_BIND_HOST=127.0.0.1
```

使用 **http://localhost:5173** 登录学习平台。**localhost** 与 **127.0.0.1** 在这里刻意使用不同主机名：Cookie 按主机名而非端口隔离，单纯改为 **localhost:4173** 仍可能携带学习平台的主机 Cookie。预览配置必须同时与平台使用不同主机名和不同 origin，否则预览关闭并说明原因。

| 环境变量                                   | 用途                                                             |
| ------------------------------------------ | ---------------------------------------------------------------- |
| PROGRAMMING_PREVIEW_ENABLED                | 默认尝试启动；设为 false 关闭预览，项目编辑仍可使用              |
| PROGRAMMING_PREVIEW_PORT                   | API 进程内的预览监听端口，默认 4173，范围 1024–65535             |
| PROGRAMMING_PREVIEW_BIND_HOST              | 默认 127.0.0.1，供本地使用；调整监听范围需同时考虑代理和访问控制 |
| PROGRAMMING_PREVIEW_ORIGIN                 | 浏览器实际访问的独立预览 origin，不允许路径、查询参数或 URL 凭据 |
| APP_ORIGIN                                 | 学习平台来源，也是预览允许嵌入及回传日志的目标来源               |
| PROGRAMMING_PREVIEW_USER_CONCURRENCY       | 同一用户跨空间和链接的文件验证并发，默认 24，可设 1–24           |
| PROGRAMMING_PREVIEW_USER_READS_PER_MINUTE  | 每用户 GET/HEAD 文件读取量，默认 480，可设 48–9600               |
| PROGRAMMING_PREVIEW_TOKEN_READS_PER_MINUTE | 每临时链接 GET/HEAD 文件读取量，默认 240，可设 24–4800           |
| PROGRAMMING_PREVIEW_IP_READS_PER_MINUTE    | 每直连 socket IP GET/HEAD 文件读取量，默认 9600，可设 240–100000 |

预览相关环境变量在启动时读取，修改后重启 API。端口被占用或配置无效时，学习平台继续启动，页面说明预览不可用。开发环境的 HTTP 预览仅允许回环主机。生产环境必须显式提供 HTTPS 预览地址，平台地址也必须使用 HTTPS，并通过反向代理将独立预览域名转发到监听端口；默认不启用公开预览。

每次运行创建 10 分钟的只读内存快照和随机查看链接。链接是临时查看凭据，持有者在有效期内可能加载该预览，不应分享。服务端每次文件读取都会重新核对签发者会话、学生权限、机构功能开关和项目归属；注销或删除项目后不可继续读取。每用户最多保留 3 个预览快照，后续运行会替换最早快照，API 重启后全部失效。预览源码不会因点击运行自动写入项目数据库。

文件读取另设上述每分钟配额，GET 与 HEAD 合并计数；创建快照仍单独限制为每用户每分钟 20 次。同一用户跨链接最多同时占用 24 个验证槽，全局硬上限为 32，避免一个用户阻塞所有其他人；默认并发也允许一个最多 24 文件的网页同时读取全部资源。用户并发或读取配额用尽时返回 **429**，全局并发或限流状态容量用尽时返回 **503**，均携带秒数格式的 **Retry-After**。限流状态最多 1024 项并定期清理过期窗口；IP 取直接连接的 socket 地址，忽略客户端提供的 Forwarded/X-Forwarded-For，较高的默认 IP 配额用于兼容共享代理和校园网络。非法或越界的读取限额配置回退到默认值；调整得过低可能使多文件页面部分资源加载失败。

## 支持的文件及限制

| 项目     | 规则                                                                        |
| -------- | --------------------------------------------------------------------------- |
| 项目数量 | 每人当前空间最多 20 个                                                      |
| 入口     | 根目录 index.html                                                           |
| 文件类型 | html、css、js、json、md、txt、svg                                           |
| 文件数量 | 每项目最多 24 个                                                            |
| 源码大小 | 单文件最多 64 KiB，完整项目最多 256 KiB，按 UTF-8 字节计算                  |
| 文件路径 | 普通 ASCII 相对路径，禁止隐藏文件、绝对路径、目录穿越、编码路径及大小写重复 |
| 版本     | 每项目最多 30 个，创建项目、手动快照、应用或恢复前后的快照均计入            |
| AI 草稿  | 每项目最多 20 个生成草稿，包含失败草稿                                      |

达到版本上限时不会自动删除旧历史；相关操作会拒绝并保留当前项目，应下载源码并新建项目继续。恢复和 AI 应用可能同时需要操作前、后两个快照，剩余容量不足时整个操作回滚。手动保存普通草稿不等于创建历史快照，重要阶段应主动保存版本。

资源应引用相对路径，例如 **style.css**、**assets/main.js**。预览支持浏览器原生网页代码；没有 npm 安装、Node/Python 后端、TypeScript/JSX 编译器、Gradle 构建或 Android 模拟器。**package.json** 仅作为普通 JSON 文件保存，不会触发依赖安装或脚本执行。运行状态应保存在页面内存，不依赖 Cookie、localStorage 或 Service Worker。

ZIP 包含当前数据库中已保存的项目源码，不包含密钥、学习平台代码或预览日志。下载前先保存本地修改；AI 应用后的代码可在下载后继续由自己的开发工具编辑。

## 预览隔离的实际边界

学习平台服务端只校验、保存和提供源码文件，不执行学生的命令或项目代码。JavaScript 在浏览器的独立预览 origin 中运行，iframe 与响应 CSP 都使用 **sandbox allow-scripts**，不授予同源父窗口、表单提交、弹窗或顶层导航权限。CSP 限制脚本、样式和图片的资源来源，禁止 API 连接、嵌套 iframe、对象和 base 标签，并禁用摄像头、麦克风等能力。

控制台日志和运行错误通过指定目标来源的消息回传。前端检查窗口来源、随机 nonce、消息类型和长度，并以纯文本显示；最多保留 200 条，每条 2000 字符。日志来源于学生代码，不能作为可信的测试证明。

这种机制提供浏览器权限及资源访问隔离，没有容器或 microVM 的独立内核、CPU 和内存配额。无限循环仍可能卡住浏览器预览；iframe 自身导航及链接请求也不能保证被 CSP 完全阻断，因此不承诺“完全离网”。若未来需要安装依赖、执行后端、自动运行测试或长期托管不可信程序，必须增加独立运行基础设施和资源、网络、生命周期控制。

## 调研及 Android-Agent 的流程借鉴

以下资料在 2026-10-09 查阅，用于比较实现方式；本版没有安装或接入这些运行服务。

| 方案      | 官方能力与本项目的选择                                                                                                                                                                                                                                                                                                                           |
| --------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Sandpack  | 提供 iframe、文件更新和多种运行 client，bundler 可单独托管；静态 client 使用 Service Worker。本版保留文件编辑与预览体验，使用自有受限静态服务，没有引入其 bundler 或 Service Worker。[Client](https://sandpack.codesandbox.io/docs/advanced-usage/client)、[独立托管与隔离说明](https://sandpack.codesandbox.io/docs/guides/hosting-the-bundler) |
| OpenHands | SDK、Agent Server 和 Sandbox Server 分别负责代理、远程执行 API 与沙箱管理。适合以后扩展完整工具执行；本版模型只生成候选源码。[官方组件说明](https://docs.openhands.dev/overview/introduction)、[自定义沙箱](https://github.com/OpenHands/docs/blob/main/openhands/usage/advanced/custom-sandbox-guide.mdx)                                       |
| Daytona   | 提供沙箱内代码/命令执行及可过期、可撤销的预览链接。若以后接入，需区分运行服务凭据与可分享的单端口查看凭据。[代码执行](https://www.daytona.io/docs/en/process-code-execution/)、[预览权限](https://www.daytona.io/docs/en/preview/)                                                                                                               |

用户指定的 [Android-Agent](https://github.com/sakuraANDhuiliyi/Android-Agent) 按提交 **15d461d1f5bc86132ce2850233cc6e34c8381520** 只读审阅，借鉴以下行为：

- [jobs.py](https://github.com/sakuraANDhuiliyi/Android-Agent/blob/15d461d1f5bc86132ce2850233cc6e34c8381520/agent/jobs.py) 与 [database.py](https://github.com/sakuraANDhuiliyi/Android-Agent/blob/15d461d1f5bc86132ce2850233cc6e34c8381520/agent/database.py)：写锁、任务租约与状态记录，避免同一项目的写任务相互覆盖。
- [workspace.py](https://github.com/sakuraANDhuiliyi/Android-Agent/blob/15d461d1f5bc86132ce2850233cc6e34c8381520/agent/workspace.py)：before/after checkpoint、可审阅的文件差异及冲突检测。
- [history.py](https://github.com/sakuraANDhuiliyi/Android-Agent/blob/15d461d1f5bc86132ce2850233cc6e34c8381520/agent/history.py)：恢复前核对当前 revision，先保存备份，再替换文件。

本项目重新实现了适用于 LMS 的数据库项目、版本、AI 候选和独立静态预览，并结合现有学生身份、空间权限、每日 AI 配额及审计。没有复制上述仓库源码，也没有连接它的 Android 服务、终端、MCP 工具或 APK 构建流程。参考仓库未提供可确认的根目录许可文件，本版不据此假定可以直接复制分发。

## 后续子域名发布的条件

公开发布属于后续扩展，需要域名控制权、DNS 配置、HTTPS、部署服务账号或服务器，以及服务端保存的部署凭据。静态作品可以选择 Cloudflare Pages、Vercel 或 Netlify；三者官方均提供自定义域名或子域名配置，具体 DNS 与域名验证要求应按选定服务执行。[Cloudflare Pages](https://developers.cloudflare.com/pages/configuration/custom-domains/)、[Vercel](https://vercel.com/docs/domains/working-with-domains/add-a-domain)、[Netlify](https://docs.netlify.com/manage/domains/get-started-with-domains/)。

建议以经用户审阅的确定版本为发布输入，记录构建/上传任务和发布结果，提供撤销及回滚，并保持学生作品与学习平台的凭据和来源隔离。后端项目还需要沙箱构建与独立运行服务。这些是调研后的后续设计，本次没有创建外部站点、子域名或部署账号。

## 开发验证与接口

```sh
node --import tsx --test tests/programming.unit.test.ts tests/programming-resources.unit.test.ts
npm run test:programming
npm run typecheck
npm run lint
npm run build
```

HTTP 集成测试使用独立本地 review 数据库、测试 API/预览端口和模型夹具；不可对生产数据库运行。浏览器验证通过项目的 Playwright 配置执行。单元或模型夹具通过，不代表真实 DeepSeek 认证、生成质量或外部部署已经验证；本次实际运行结果及其边界见[编程工作室验证记录](verification/programming.json)。

业务 API 位于 **/api/programming**，统一要求已登录的学生身份和 **learning.use**；机构练习功能关闭时不可使用。

| 路径                                                                              | 行为                                 |
| --------------------------------------------------------------------------------- | ------------------------------------ |
| GET /status、GET /templates                                                       | AI/预览状态与模板                    |
| GET /projects、POST /projects                                                     | 本人项目列表、从模板创建             |
| POST /projects/import                                                             | 导入标准 JSON 备份，创建独立项目     |
| POST /projects/:id/duplicate                                                      | 按源修订复制项目，保留来源模板       |
| GET /projects/:id/backup                                                          | 下载可重新导入的 JSON 项目备份       |
| GET/PATCH/DELETE /projects/:id                                                    | 查看、保存完整源码、删除             |
| GET/POST /projects/:id/versions                                                   | 版本列表、保存快照                   |
| GET /projects/:id/versions/:versionId、POST /projects/:id/restore                 | 查看指定版本、恢复                   |
| GET /projects/:id/export                                                          | 下载已保存源码 ZIP                   |
| POST /projects/:id/preview                                                        | 使用当前修订及完整文件创建临时预览   |
| POST/GET /projects/:id/ai-drafts                                                  | 生成候选、查询不含源码的任务摘要列表 |
| GET /projects/:id/ai-drafts/:draftId、POST /projects/:id/ai-drafts/:draftId/apply | 查看候选、确认应用                   |

所有版本敏感写入提交整数 **revision**；服务端以当前版本复核并拒绝过期覆盖。AI 生成时预占共享额度，在服务端完成结构校验和当前访问资格复核后成为可审阅候选。重复应用已完成的同一候选返回原应用结果，不重复写入版本。

### 项目复制与可导入备份

工作区的“复制项目”和“JSON 备份”会先保存当前未保存修改；保存失败或遇到过期修订时停止后续操作，保留本地源码。复制提交 `{title, revision}`，服务端在权限与用户锁保护的事务内核对源修订并创建独立项目，不修改源项目。项目列表的“导入 JSON 备份”先读取本地 JSON，展示文件列表、文件数和源码大小，可调整新项目名称后确认导入。

切换账号、切换身份或离开页面后，旧页面的异步结果不会触发下载、成功提示、导航或旧项目重新查询；取消文件读取并选择另一份备份时，较晚返回的旧文件也不会覆盖新摘要。

备份格式固定为 `{format: "zhixue-programming", version: 1, title, templateId, files}`，仅含项目名称、来源模板和源码，不包含用户、机构、项目 ID、修订、历史版本或 AI 草稿。未知字段、未知格式/版本、未知模板及无效文件会被拒绝。导入与复制都受每个用户最多 20 项目、24 文件、单文件 64 KiB、总源码 256 KiB 和文件 JSON 序列化负载限制；本地导入文件最多 380,000 字节。新项目从修订 0 和版本 1 开始，不继承源项目历史、AI 草稿或临时预览。

来源模板仅接受 `starter`、`counter`、`todo`、`imported` 和创意目录中的 `creative:<id>`。创意导入必须完整保留目录对应的 `NOTICE.txt`；即使模板字段被改为普通模板，完整原始 NOTICE 或同一文件中的上游仓库与固定提交组合仍会识别创意来源并恢复其来源模板，确保后续保存继续保护 NOTICE。普通说明仅提及仓库 URL 不会触发来源识别。离线 JSON 未签名，来源识别无法证明所有标记均被移除后的任意源码血缘。

聚焦验证：`node --import tsx --test tests/programming-portability.unit.test.ts` 与 `npx playwright test -c playwright.config.ts tests/browser/programming-portability.spec.ts`。这些测试使用本地源码、内存数据库夹具和浏览器 API 模拟，不请求真实模型或判题服务。
