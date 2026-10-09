# 知学 · 学习管理系统

简体中文响应式学习平台，使用真实 PostgreSQL 存储课程、学习进度、作业提交、练习、考试答卷、交流消息和审计记录。React 前端通过同源 NestJS API 完成业务，不使用前端假数据。可选的 AI 错题复盘默认使用 DeepSeek，联网检索使用 Tavily，两项服务的密钥由部署者分别填写。

实现范围及实际验证结果以 [验收记录](docs/acceptance.md) 为准。架构、权限矩阵、实体关系、状态与统计口径见 [架构文档](docs/architecture.md)。

学生首页提供学习行动清单，汇总本人作业、考试和个人待办，区分今日、未来 7 天与逾期；支持个人待办完成和版本冲突恢复，按本人延期与答卷期限显示入口。接口与时间口径见 [核心 API](docs/core-api.md)。

学习行动清单支持按来源与授权课程组合筛选：个人待办不归属课程，选课后只显示该课程作业和考试；下方三个时间桶的筛选不改变全量学习概览。接口合同和权限边界见 [核心 API](docs/core-api.md#分析)，本轮完整验收见 [第十五轮记录](docs/verification/iteration-015.json)。

机构学生学习概览显示“当前待交作业”和“当前可作答考试”：按本人提交状态、延期、次数及答卷期限完整计数，不限未来 7 天。概览和行动清单独立加载，统计暂时失败仍可处理已授权个人待办；教师、管理员和个人专业学习首页保留原流程。精确规则与权限见 [核心 API](docs/core-api.md#分析)。

机构管理支持审计组合筛选与 CSV 下载，可按操作人、资源、追踪 ID 和北京时间定位记录；下载需要当前机构的独立限时导出授权，并说明实际数量与上限。

后台任务支持类型关键词／状态筛选、完整状态概览和机构归属。平台权限覆盖全部机构及停用机构历史，普通权限限当前机构；支持手动刷新和手机分页。完整本机验收通过，合同见 [核心 API](docs/core-api.md#后台)，结果见 [第十四轮验收记录](docs/verification/iteration-014.json)。

平台后台任务页还显示本次响应 API 实例的自动调度配置、生命周期、轮询间隔和是否有轮询在途；其他机构不返回或显示该状态。精确的 `DISABLE_JOBS=true` 启动配置说明见 [核心 API](docs/core-api.md#后台)；实例状态不代表全平台或集群健康。本轮测试记录见 [第十六轮记录](docs/verification/iteration-016.json)。

## 环境要求

- Node.js 22.11+（建议 Node 22 LTS）、npm 10+。
- PostgreSQL 17/18；开发可使用随 npm 安装的本地 PostgreSQL 二进制，无需预装数据库。
- Docker Compose 是生产部署选项。本地 PostgreSQL 辅助工具仅用于开发。

## 本地启动

```sh
npm ci
cp .env.example .env
```

修改 `.env` 的 `DEV_SEED_PASSWORD` 为自己设置的开发密码（至少 12 字符）。示例密码仅用于本地，绝不可用于生产。

终端一启动持久化本地 PostgreSQL（数据位于 `.data/postgres`，仅监听 127.0.0.1）：

```sh
npm run db:local
```

终端二执行迁移与初始化：

```sh
npm run db:generate
npm run db:migrate
npm run db:seed
npm run dev
```

如果使用自己的 PostgreSQL，直接配置 `DATABASE_URL`，跳过 `db:local`。

AI 错题复盘、联网找同类题及来源下载使用根目录 `config.yaml`：新环境先 `cp config.example.yaml config.yaml`，分别在 `ai.apiKey` 填写 DeepSeek 密钥，在 `webSearch.tavily.apiKey` 填写 Tavily 密钥。默认模型为 `deepseek-flash`（`apiStyle: deepseek`、`structuredOutput: json_object`），搜索提供方为 `tavily`；仍保留 Responses 和 Chat Completions 兼容接入。空密钥时其他学习功能照常运行。本次配置切换没有调用真实 DeepSeek 或 Tavily 账号，实际认证、配额和效果需填写密钥后核验。完整示例、官方参考和使用流程见 [AI 错题复盘接入说明](docs/ai-study.md)。

教师可在“题库与试卷”或侧栏“AI 出题”中生成题目与试卷初稿，编辑确认后保存到私有题库和固定版本试卷，再在考试中心选用。沿用同一 DeepSeek 配置，支持单选、多选、判断、填空和简答；说明见 [教师 AI 出题](docs/ai-authoring.md)。

学生侧栏“编程工作室”提供个人及机构学习空间的多文件网页项目：从 HTML/CSS/JavaScript 模板开始，用桌面 Monaco 或手机简易编辑器修改源码，运行独立来源的本地预览并查看日志。DeepSeek 生成的完整候选代码先展示差异，由学生确认应用；替换前保存原源码版本，可恢复历史及下载 ZIP。默认学习平台使用 localhost:5173，预览使用 127.0.0.1:4173；本版提供本地工作区，不含公开子域名发布。配置、边界、官方调研及 Android-Agent 流程参考见 [编程工作室](docs/programming.md)。

编程项目支持复制为独立项目、下载标准 JSON 备份及在项目列表导入备份，方便继续实验与复用源码。算法题库增加“我的训练计划”：自行选择和排序题目，按真实正式通过记录显示进度，并沿计划顺序继续练习、归档或恢复。新功能沿用本人和当前学习空间隔离、版本冲突与容量限制；升级需应用迁移 `202610090028_algorithm_training_plans`。

学生侧栏“算法练习”内置 **119 道原创题和 10 条学习路线**，支持 Monaco 四语言编辑器、样例与自定义测试、隐藏用例判题、详细题解、AI 提示/解析/诊断，以及个人收藏、笔记、复习和提交历史。新增 100 题涵盖数论、数据结构、字符串、动态规划、图论、树与计算几何，包含四语言起始代码与完整 JavaScript 参考解；原 19 题的编号、ID和四语言参考解保持不变。整库有 821 个判题用例，每题提供提示、具体样例推演、正确性与复杂度说明。题目与资料来源见 [题库扩展](docs/algorithm-catalog.md)。代码执行需在 `config.yaml` 的 `judge0` 中填写独立 Judge0 CE 服务地址和认证令牌，AI 沿用同文件的 DeepSeek 配置；未配置时页面明确提示，不生成模拟判题结果。使用流程与接口见 [算法练习](docs/algorithms.md)，执行服务隔离与配置见 [判题服务](docs/algorithm-judge.md)。升级时须应用新增数据库迁移。

“算法论坛”支持关联题目的提问、题解与讨论、搜索、回复、标记解决及管理。新帖明确选择可见范围：**公共社区供全站登录身份阅读，本机构讨论仅当前学校/机构可读**；个人学习空间只发布公共帖子。原有课程讨论不转为公开内容。帖子使用学习者别名，权限与版本冲突处理见 [算法论坛](docs/algorithm-forum.md)。

编程“创意广场”收录 **41 件 UI 作品，来自 41 个 GitHub 仓库**。包含 20 件基础交互、20 件完整场景及 Aora 动态表情实验室；后者支持 32 种 SVG 表情、三种身体形态、分组搜索和本地工作状态消息。学生可按新增/第一批筛选、分类搜索、私有收藏、运行隔离互动预览、查看完整来源与源码，或创建为自己的编程项目后继续编辑与使用 DeepSeek。仅迁入 HTML/CSS/JavaScript 界面和交互，保留固定来源版本及完整许可；原 40 件使用 MIT/ISC，Aora 社区许可仅供非商业学习研究，其球形角色禁止任何商业用途。项目与 AI 候选均保留 `NOTICE.txt`。使用说明及 Aora 来源见 [创意广场](docs/creative-square.md)，原作品来源与视频证据见 [来源清单](docs/creative-sources.md) 和 [第二批20件](docs/creative-wave2-sources.md)。

“专业学习中心”提供 15 个学科分类、76 个专业模板和 55 个学习模块：33 个实际计算工具、18 个结构化学习工作台、2 组原创知识练习、只读 SQL 实验室及算法入口。学生可以修改参数、运行课程模型、保存结果并补充个人笔记；工作台做结构检查与明确的数值核对，不生成虚构 AI 评分。专业目录是可扩展的起步模板，不是官方完整专业目录。公共目录随数据库迁移初始化，普通计算与笔记不需要外部 AI 密钥；完整模块清单、权限与 API 见 [专业学习中心](docs/academics.md)。

生物与农学相关专业新增群体遗传实验：从 AA、Aa、aa 观察计数计算等位基因频率，展示模型期望、完整差值表和分组柱状图。六个课堂示例覆盖小样本、零频率和稀少等位基因；结果可保存、补充笔记并导出。使用方法见 [群体遗传实验](docs/academics.md#群体遗传课堂实验)。

统计、数据科学、经济与营销专业新增“分层与汇总比例：辛普森反转”：比较两个分层、原始汇总与共同权重，展示原始人数、权重、贡献和精确方向。六个原创示例帮助学生解释汇总为什么可能反转；个人学生也可自由选择，保留笔记并导出。使用方法见 [分层比例实验](docs/academics.md#分层与汇总比例实验)。

统计、数据科学与人工智能专业新增“二分类混淆矩阵与指标”：由四格计数核对准确率、精确率、召回率、负类召回率、F1 和二分类平衡准确率，逐项展示公式与分母。六个原创示例包含类别失衡和零分母；未定义与零值分别显示，实验可保存笔记和导出。使用方法见 [混淆矩阵实验](docs/academics.md#二分类混淆矩阵实验)。

学生还可创建带期限的模块学习目标：普通模块按新完成的练习记录计数，算法目标按正式通过的不同题目计数。支持编辑、归档、恢复、删除和版本冲突核对，个人与机构空间分别保存。功能规则与逐轮完整验收见 [持续迭代](docs/iterations.md)。

学习记录可按模块和完成状态筛选，并导出 CSV 总览或 Markdown 详细笔记。导出本人当前空间已保存的实验参数、结果与补充笔记，不限当前列表页；页面明确显示数量范围，并对完整文件执行大小限制。操作和接口见 [实验记录导出](docs/iterations.md#第二轮专业实验记录与笔记导出)。

数字逻辑实验支持可选的第二表达式，逐一枚举两边变量的全部输入，验证是否等价并完整列出反例；配有德摩根定律、吸收律及优先级示例。原单表达式、历史记录与草稿继续可用，详细结果可保存并导出。规则和验收见 [逻辑等价实验](docs/iterations.md#第三轮逻辑表达式等价验证与反例分析)。

算法提交历史可与打开时的当前草稿作只读代码对比，保留缩进和空白差异，支持桌面并排与手机内联查看。比较包含尚未同步的代码，关闭后主编辑器与撤销记录保留；恢复历史版本仍需确认。使用方法见 [代码对比](docs/algorithms.md#对比历史代码与当前草稿)。

本题提交记录支持按正式提交／样例运行／自定义运行、代码语言和执行结果组合筛选，显示匹配总数并分页。筛选保留当前草稿、编辑器语言和已打开的结果或代码对比，便于定位之前的失败版本。使用方法见 [提交记录筛选](docs/algorithms.md#筛选本题提交记录)。

登录页支持“个人注册”：无需加入机构即可自主选专业和学习模块，使用日历、笔记、算法及已配置的 AI 学习功能。个人学生可通过邀请码申请加入机构，由管理员审批并指定专业；审批后需要重新登录，组织学生不能自行修改专业。符合条件的学生可返回原个人空间，原个人记录和设置保留。管理员可在“用户管理”创建或导入学生时分配专业，并在“专业与成员申请”复制公共模板、维护本机构目录及审核申请；该管理入口同时要求 `org.manage` 和 `users.manage`。

前端：<http://localhost:5173>；API：<http://127.0.0.1:3001/api>；Swagger：<http://127.0.0.1:3001/api/docs>。Vite 会代理 API 与 WebSocket。浏览器地址必须与 `APP_ORIGIN` 一致，否则写请求会被 Origin 检查拒绝。

种子可重复执行，不覆盖已有账号密码或业务操作。开发账号如下，密码均为 `.env` 配置的 `DEV_SEED_PASSWORD`：

| 账号                               | 身份           | 入口                                   |
| ---------------------------------- | -------------- | -------------------------------------- |
| `student`                          | 学生           | 工作台、课程、作业、练习、考试、交流   |
| `teacher`                          | 教师           | 课程管理、题库试卷、作业批改、考试阅卷 |
| `admin`                            | 机构管理员     | 用户、班级、机构配置、内容治理、审计   |
| `superadmin`                       | 超级管理员     | 机构、权限模板、独立敏感授权、平台配置 |
| `student2`、`teacher2`、`outsider` | 权限验收用账号 | 同学、其他授课教师、其他机构学生       |

同一登录入口根据当前已授予角色生成菜单。可切换已授予身份，服务端每次请求重新验证权限。

## 测试与构建

```sh
npm run typecheck
npm run lint
npm test
npm run build
```

启动 API、迁移并运行开发种子后，执行真实数据库与 HTTP 集成测试：

```sh
npm run test:e2e
npm run test:assessment
npm run test:communication
npm run test:security
npm run test:clean-start
npm run test:performance
```

集成测试会在开发数据库中创建带唯一名称的验收记录并保留审计，禁止用于生产数据库。测试中的时间边界通过仅调整本次创建考试的数据库时刻验证，以避免等待完整考试窗口。性能脚本输出环境、请求数、并发、延迟和失败数，不等同于生产容量承诺。

浏览器验收（API 与 Vite 都须运行）：`npm run test:browser`。macOS 默认使用本机 Chrome；Linux／CI 先执行 `npx playwright install --with-deps chromium`。浏览器报告在 `playwright-report`，截图在 `test-results`。

专业学习中心的真实浏览器验收位于 `tests/browser/academics-live.spec.ts`，覆盖个人注册、实际电路／SQL 计算、清除浏览器缓存后的服务端记录、组织审批及返回个人空间。它仅在回环地址和独立 `review` 数据库上启用；专用环境文件、运行命令及与界面模拟测试的区别见 [专业学习验收说明](docs/academics.md#验证与后续扩展)。

`test:clean-start` 建立独立临时空数据库，迁移、重复初始化、启动独立 API 并验证四角色登录；完成后只删除本脚本创建的临时数据库。

安全回归：`test:security` 顺序执行附件授权、机构功能开关、模板权限边界、考试并发和统计筛选用例。请使用独立开发数据库；可用 `DOTENV_CONFIG_PATH` 指定测试配置，`TEST_BASE_URL` 指向 API 根地址，交流测试的 `TEST_API_URL` 指向 `/api`。浏览器测试支持 `WEB_BASE_URL`，Vite 支持 `API_PROXY_TARGET`，可在独立端口连接测试库，不必污染演示库。

新增功能回归 `test:extensions` 和完整浏览器回归要求隔离验证环境：数据库名称包含 `review`，本机 API 使用 loopback 3002。先在该库执行迁移与种子，另起 API 3002 和代理它的 Vite 5174；测试配置文件应包含 `DATABASE_URL`、`DEV_SEED_PASSWORD`、`APP_ORIGIN=http://localhost:5174`、`TEST_BASE_URL=http://127.0.0.1:3002` 和 `TEST_API_URL=http://127.0.0.1:3002/api`。然后执行：

```sh
DOTENV_CONFIG_PATH=.data/review.env npm run test:extensions
DOTENV_CONFIG_PATH=.data/review.env npm run test:ai-study
DOTENV_CONFIG_PATH=.data/review.env npm run test:ai-authoring
DOTENV_CONFIG_PATH=.data/review.env WEB_BASE_URL=http://localhost:5174 npm run test:browser
```

考试题目分析的测试夹具会拒绝演示库和非本机地址；CI 已配置独立 `review` 数据库，允许在 `CI=true` 下使用3001。

开发 API 使用 Node 22 原生 `--watch` 自动重启；无需 nodemon。依赖检查使用 `npm audit` 覆盖开发和生产依赖，CI 拒绝 high/critical 等级公告。

格式化：`npm run format`。首次开发运行不要跳过 Prisma Client 生成。迁移源在 `prisma/migrations`；不要在生产执行 `db push`、`migrate reset` 或开发种子。

## Docker 部署

1. 准备域名和 HTTPS 反向代理，把同一域名的 HTTP 和 WebSocket 流量转发至本机 3001。
2. 在部署环境安全设置迁移账号的 `POSTGRES_PASSWORD`、独立运行账号的 `APP_DATABASE_PASSWORD` 与 `APP_ORIGIN=https://你的域名`。运行密码必须与迁移密码不同，使用 16–128 位 URL 安全字母、数字、下划线或连字符；默认运行账号 `lms_app`，可用 `APP_DATABASE_USER` 指定新的受限账号。不要将真实凭据提交到仓库。
3. 首次部署先复制 `config.example.yaml` 为 `config.yaml`，填写所需 AI 密钥，并确保容器用户（UID 1000）可读取该文件；文件以只读方式挂载。执行 `docker compose up --build -d`。`migrate` 服务先等待数据库，再应用迁移；应用等待迁移成功。
4. 生产禁用演示种子，通过受控环境创建管理员：

```sh
# 使用你所在环境的密钥管理方式注入这两个变量，避免把密码写进 shell 历史。
docker compose run --rm \
  -e BOOTSTRAP_USERNAME \
  -e BOOTSTRAP_PASSWORD \
  app ./node_modules/.bin/tsx scripts/bootstrap.ts
```

`BOOTSTRAP_PASSWORD` 至少 16 字符，初始化拒绝覆盖已存在账号，创建后清除初始化变量。可指定 `BOOTSTRAP_ORGANIZATION_ID` 和 `BOOTSTRAP_ORGANIZATION_NAME`；默认 `org-main`。多机构公开品牌可设置 `PUBLIC_ORGANIZATION_ID`。生产登录必须 HTTPS，`COOKIE_SECURE=true`。

数据卷分别保存 PostgreSQL 与私有上传文件。应用以非 root 用户运行，只暴露回环地址端口。`/api/health` 会实际查询数据库。

迁移容器在每次迁移成功后运行 `scripts/provision-runtime-db.mjs`，仅向运行账号授予业务表的 SELECT/INSERT/UPDATE/DELETE、序列使用和 schema 使用权限。运行账号不能创建表、管理角色、拥有业务表或读取迁移记录；生产 API 在启动时验证这些权限。已有部署应先配置独立运行凭据再升级，不能继续使用超级用户启动生产应用。非 Compose 部署使用迁移连接串运行该脚本，并把应用的 `DATABASE_URL` 切换为运行账号。备份与迁移继续使用受控运维连接。

登录限流在 PostgreSQL 中原子预占，失败和在途请求计入同账号 8 次、同 IP 50 次／15 分钟；成功仅返还自身额度，跨实例也不会清掉其他并发失败。密码校验使用有界异步队列。已有账号的密码不能由管理员直接设置：用户先在“个人设置”用当前密码预留一次性恢复码并离线保存；组织账号还需管理员在用户管理开启 15 分钟恢复许可，个人账号无需此许可。本人在登录页使用预留恢复码设置新密码。恢复成功会撤销全部会话和敏感授权；没有预留恢复码时不能通过管理员接口覆盖已有密码。

附件默认按用户 1 GiB／1000 个、机构 10 GiB／20000 个限制累计容量和数量。每用户最多 2 个、整个平台最多 8 个上传或文件导出在途请求，每用户每分钟最多 20 次。对应设置见 `.env.example`；未被任何业务引用过的附件默认 24 小时后回收，已引用文件不会自动删除。用户可以通过 `DELETE /api/attachments/:id` 删除本人当前未被引用的普通附件。容量预留在接收文件前完成，因此剩余空间不足以容纳当前单文件上限时也会暂时拒绝新上传。

Nginx 示例（TLS 证书配置请使用部署环境的证书）：

```nginx
location / {
  proxy_pass http://127.0.0.1:3001;
  proxy_set_header Host $host;
  proxy_set_header X-Forwarded-Proto $scheme;
  proxy_set_header X-Forwarded-For $remote_addr;
  proxy_http_version 1.1;
  proxy_set_header Upgrade $http_upgrade;
  proxy_set_header Connection "upgrade";
  client_max_body_size 50m;
}
```

此示例只有一层可信 Nginx；Compose 默认 `TRUST_PROXY_HOPS=1`，应用端口仅绑定回环地址，Nginx 必须覆盖而非直接信任客户端传入的 `X-Forwarded-For`。本地直连默认值为 0。更复杂的代理链应明确配置实际可信层数并限制直连，否则登录限流可能误将全体用户视作同一来源，或信任伪造的 IP。

## 升级

先暂停写入并备份数据库及文件，检出经验证的新版本，运行 `npm ci` 与构建；部署时先执行 `prisma migrate deploy --schema prisma`，再以迁移连接运行 `node scripts/provision-runtime-db.mjs` 更新运行账号权限。确认健康检查、登录、提交和文件下载后恢复流量。数据库版本升级或不可逆迁移前，应在独立数据库恢复备份并完整演练。不要只回滚应用镜像而忽略数据库兼容性。

本次安全修复需顺序应用迁移 25–27：算法草稿版本号、学科计算尝试预算、随机论坛别名。升级后请刷新已打开的网页；旧客户端缺少草稿版本号的保存请求会返回 400，旧窗口的冲突写入会返回 409。历史草稿内容保持原样，旧论坛别名会替换为持久随机别名。新增资源限额及学校共用 IP 配置见 `.env.example`、[学科学习](docs/academics.md)和[编程工作室](docs/programming.md)。

## 备份与恢复

备份与恢复需要单独提供 PostgreSQL 客户端工具 `pg_dump` 和 `pg_restore`，不能假定用于开发数据库启动的 `embedded-postgres` 包含这两个程序。请通过 PostgreSQL 官方安装方式或官方源码安装客户端，客户端主版本须不低于服务端，建议两个工具使用同一套版本。将实际安装的 `bin` 目录设为环境变量 `PG_BIN`（绝对路径），或将工具加入 `PATH`；脚本优先使用 `PG_BIN`。生产也可以在数据库容器内运行对应的备份、恢复命令。脚本不会把连接密码写入清单或输出。

本次本机验证的客户端从 PostgreSQL 18.1 官方源码构建，位于 `.data/pg-tools/install/bin`。该目录属于本机验证产物，不随仓库交付，也不保证在其他机器存在；新环境应使用自己的客户端安装目录。

暂停写入及后台任务后：

```sh
# 先确保 PG_BIN 指向实际客户端 bin 目录，或 PATH 中已有 pg_dump/pg_restore。
node scripts/backup.mjs backup .data/backups/manual
node scripts/backup.mjs verify .data/backups/manual
```

备份包含数据库自定义格式 dump、上传目录 tar.gz 和 SHA-256 清单。`verify` 在开发环境建立独立临时数据库恢复，比较核心表数量和每个附件的 SHA-256，最后删除自己创建的临时数据库。它不会覆盖工作数据库。

真实恢复必须明确设置 **空数据库** `RESTORE_DATABASE_URL` 和 **空目录** `RESTORE_UPLOAD_DIR`，然后运行：

```sh
node scripts/backup.mjs restore .data/backups/manual --confirm
```

脚本拒绝覆盖非空目标。恢复后调整应用连接串及上传目录，验证健康、登录、关键历史记录和授权文件下载，再恢复服务。备份本身包含个人数据，应加密、限制访问并按保留策略离线存放。

## 接口与规则文档

- [基础接口、身份与管理](docs/core-api.md)
- [题库、作业、练习、考试和成绩](docs/assessment-api.md)
- [讨论、私信、通知、文件与导出](docs/communication-api.md)
- [权限、数据库关系、状态和统计口径](docs/architecture.md)
- [实际验收结果、未完成项和已知限制](docs/acceptance.md)
- [追加安全审查与优化记录](docs/security-review.md)
- [Tabler 浅色界面参考、主题规则与新版截图](docs/ui-refresh.md)
- [官方平台功能调研及学习日历、私人笔记、题目分析扩展](docs/feature-expansion.md)
- [DeepSeek 错题复盘、Tavily 检索与来源下载配置](docs/ai-study.md)
- [学生算法练习、代码草稿、提交与 AI 解析](docs/algorithms.md)
- [119 道题、学习路线与官方算法资料来源](docs/algorithm-catalog.md)
- [公共与学校/机构算法论坛](docs/algorithm-forum.md)
- [多文件编程工作室、DeepSeek 候选审阅、版本与独立预览](docs/programming.md)
- [创意广场使用与来源归属保护](docs/creative-square.md)
- [第一批20件 UI 的 GitHub 来源与许可](docs/creative-sources.md)
- [新增20件完整交互场景与视频核对](docs/creative-wave2-sources.md)
- [创意广场第二批验收记录](docs/verification/creative-wave2.json)
- [题库、论坛与创意广场验收记录](docs/verification/community-creative.json)
- [独立 Judge0 编译运行服务配置](docs/algorithm-judge.md)
- [学科专业学习中心、个人注册、组织审批与学习模块](docs/academics.md)
- [持续迭代、完整验收与专业学习目标](docs/iterations.md)

## 常见问题

- **登录后操作提示安全校验失败**：检查浏览器来源是否严格匹配 `APP_ORIGIN`；角色切换会更新 CSRF。前后端需同源部署。
- **教师没有课程**：后台分配有效 TeachingAssignment；`teacherId` 字段本身不是权限通行证。
- **管理员看不到个人成绩或不能导出**：这是独立授权要求。由拥有 `grants.manage` 的另一管理员通过 `/admin/grants` 限时授予模板允许的 `analysis.sensitive`／`data.export`。不能自授，也不默认允许浏览私信。
- **练习题不能加入考试**：已开放练习的答案可能已被学生看到，系统要求使用独立保密题。需要另外创建考试专用题。
- **考试保存冲突**：另一个页面已经更新了答案。读取服务器最新版本再继续，客户端不会静默覆盖。
- **学生看不到分数／答案**：批阅完成、成绩发布以及各自公开时间分别生效。
- **实时连接数量**：默认每用户最多 20 个连接、单进程最多 2000 个；可通过 `MAX_WEBSOCKETS_PER_USER`、`MAX_WEBSOCKETS_TOTAL` 调整。页面仍可使用受控 REST 请求；这些限制不代替网关限流或容量测试。
- **通知稍有延迟**：后台每 5 秒处理持久任务，失败会重试；通知投递不阻塞提交。
- **端口占用**：先停止本项目对应服务，或统一修改 `.env` 和 Vite 代理；不要误停其他项目服务。
- **npm 下载停滞**：重试时可使用 `npm install --prefer-offline --fetch-timeout=30000`；保留 lockfile，不绕过校验或禁用安全连接。

AI 错题复盘需填写相应服务密钥后使用。直播、付费课程、商城、小程序和摄像头监考尚未启用，属于可选扩展。
