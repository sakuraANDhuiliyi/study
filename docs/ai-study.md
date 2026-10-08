# AI 错题复盘、联网检索与资料下载

本模块接在现有“练习中心 → 我的错题本”上，另有学生侧栏“AI 错题复盘”入口。默认使用 DeepSeek 的 `deepseek-flash` 分析真实错题，使用 Tavily 检索公开资料；报告与联网结果持久化保存在 PostgreSQL。DeepSeek 和 Tavily 的密钥由部署者分别填写，浏览器不接触密钥。

## 配置

项目根目录已提供空密钥的 `config.yaml`，可直接编辑。新检出项目执行：

```sh
cp config.example.yaml config.yaml
chmod 600 config.yaml
```

默认配置需要两项独立密钥：`ai.apiKey` 填写 DeepSeek 密钥，`webSearch.tavily.apiKey` 填写 Tavily 密钥，两者不复用。`ai.baseUrl` 默认是 `https://api.deepseek.com`，不要附加 `/chat/completions`；`webSearch.tavily.baseUrl` 默认是 `https://api.tavily.com`，不要附加 `/search`。模型采用 [DeepSeek 官方首页](https://api-docs.deepseek.com/) 当前推荐的名称 `deepseek-flash`，实际可用模型和额度以账号权限为准。

```yaml
ai:
  enabled: true
  apiStyle: deepseek
  structuredOutput: json_object
  baseUrl: https://api.deepseek.com
  apiKey: ''
  model: deepseek-flash
  timeoutMs: 60000
  maxOutputTokens: 6000
webSearch:
  enabled: true
  provider: tavily
  maxResults: 6
  allowedDomains: []
  tavily:
    baseUrl: https://api.tavily.com
    apiKey: ''
limits:
  dailyRequests: 20
  maxDownloadMb: 10
  downloadTimeoutMs: 15000
```

`apiStyle: deepseek` 使用 DeepSeek Chat Completions 接口，发送 `max_tokens` 和 `thinking: {type: 'disabled'}`，不发送通用兼容分支的 `max_completion_tokens`。本项目的 DeepSeek 分支要求 `structuredOutput: json_object`，通过 `response_format` 开启 JSON 模式，并在提示中提供 JSON 格式说明与示例；服务端仍校验完整结构、长度和错题 ID。JSON 模式不等于严格 JSON Schema 保证，空内容、截断或结构不符会作为生成失败处理。配置方式依据 [DeepSeek JSON Output 文档](https://api-docs.deepseek.com/guides/json_mode/)。

仍保留以下可选兼容方式，切换时需要同时调整服务根地址、模型、密钥和结构化输出格式：

- `apiStyle: responses` 使用 `/responses`，可搭配支持该接口的服务；支持严格 JSON Schema 时可设置 `structuredOutput: json_schema`。
- `apiStyle: chat_completions` 使用通用 `/chat/completions`，要求服务支持 `response_format` 和 `max_completion_tokens`；它与 DeepSeek 专用分支的请求参数不同。不支持严格 JSON Schema 的服务可设置 `structuredOutput: json_object`，但仍须通过本项目结果校验。

兼容能力不代表所有第三方接口都能直接使用，实际参数支持须以所选服务为准。

默认联网检索独立调用 Tavily 的 `POST /search`，不依赖 DeepSeek 模型自带搜索，也不使用 `webSearch.model`，因此示例不配置该字段。Tavily 路径展示带来源和可点击引用的检索摘录。只有切换为支持 Responses `web_search` 的服务时，才使用 `webSearch.provider: openai`，并可配置对应 `webSearch.model` 来生成带引用的检索归纳。`allowedDomains` 可限制到指定教育网站及其子域，不填写时搜索公开互联网。请求与返回字段见 [Tavily Search API](https://docs.tavily.com/documentation/api-reference/endpoint/search)。

配置在每次请求时读取，填写后在页面点击“重新检查”即可，不必重启。格式错误、缺少密钥或主动关闭时，页面显示不可用原因，不会用假结果替代。`AI_CONFIG_PATH` 可指定服务端配置路径，默认按项目根目录定位，不依赖启动时的工作目录。YAML 未知字段、重复键、别名、超大文件会被拒绝，解析错误不会回显文件内容。服务地址生产环境要求 HTTPS；开发环境仅额外允许本机 HTTP，便于本地兼容服务与自动化测试。

`config.yaml` 已加入 `.gitignore` 和 `.dockerignore`。Compose 以只读文件挂载 `/app/config.yaml`，不会把密钥烘焙进镜像；运行 Compose 前先创建该文件，并确保容器内的 `node` 用户（UID 1000）有读权限。Linux部署可将文件属主设为该UID并保留600权限，本机开发保持当前用户所有。修改限额需同时考虑服务商自己的配额与账单设置。

## 使用流程

1. 学生打开错题本，在某道题旁点击 AI 复盘，或从侧栏进入。
2. 从当前可练习的错题中选择 1–10 道，可跨页选择，并可补充自己的解题思路。
3. 点击生成。页面说明将向所配置的服务发送选中题目、作答和补充思路。服务不自动发送姓名、学号、机构、课程 ID 或登录信息。
4. 阅读共性错因、逐题诊断、教学依据、订正建议和复习计划。只有答案、没有解题过程时，提示模型说明推测及证据不足；“诊断把握”不是正式能力评级。
5. 核对、修改推荐知识点关键词后点击联网搜索。搜索请求只发送确认的关键词，不自动发送整个错题报告。推荐关键词要求去掉身份、内部 ID 和完整私有题干。
6. 查看来源标题、摘录和可点击引用。可打开原文，也可下载来源资料：PDF 保存为 PDF，网页提取成 UTF-8 纯文本。报告可单独导出 Markdown 或 JSON。
7. 历史报告可刷新、重新搜索和删除。删除报告不改变错题、练习作答或成绩。

当前错题来源是已有练习错题本中判定 `correct=false` 的作答。AI 取本人最近一次答错的练习快照，而不是题库后来修订的版本。缺失原始已判错记录的历史条目会被拒绝，并提示补齐真实练习记录。未公开的考试答案不会进入 AI 分析。

本功能检索同类题所在的公开网页或题单，不把模型生成的题目冒充网络原题，也不自动将第三方题目导入正式题库。搜索不到有效来源时明确显示无结果。登录、付费或禁止访问的来源不绕过；不抓取整站。

## 接口

所有接口要求当前学生身份、`learning.use`、`course.read` 及有效会话；写请求沿用 Cookie + CSRF。机构关闭练习功能时一起关闭 AI 入口。

| 方法   | 地址                                                   | 内容                                                                      |
| ------ | ------------------------------------------------------ | ------------------------------------------------------------------------- |
| GET    | `/api/ai-study/status`                                 | 配置是否可用、模型、搜索类型和限额；不返回密钥/服务地址                   |
| GET    | `/api/ai-study/reports?page=1&pageSize=10`             | 本人当前仍授权的历史报告                                                  |
| POST   | `/api/ai-study/reports`                                | `{mistakeIds: string[], reflection?: string}`，最多10题、思路最多2000字符 |
| GET    | `/api/ai-study/reports/:id`                            | 报告详情与固定错题快照                                                    |
| POST   | `/api/ai-study/reports/:id/search`                     | `{query: string}`，最长300字符                                            |
| DELETE | `/api/ai-study/reports/:id`                            | 删除本人报告，保留审计与调用计数                                          |
| GET    | `/api/ai-study/reports/:id/export?format=md`           | 报告导出，支持md/json                                                     |
| POST   | `/api/ai-study/reports/:id/sources/:sourceId/download` | 下载已存真实检索来源，需CSRF；无任意URL参数                               |

分析采用同步有界请求。生成失败会保存 `failed` 报告与安全错误提示；搜索失败保留上一次结果并设置 `searchError`。不能仅凭 HTTP 201/200 判断 AI 成功，客户端须检查报告状态。历史中的请求若因进程中断停留在 pending，超过租约后下一次读取/操作会恢复为失败。

## 数据与访问边界

- 迁移007新增 `AiStudyReport`、来源关联 `AiStudyReportSource` 和请求记录 `AiStudyOperation`，不修改原始错题或成绩。
- 报告仅本人可见，管理员和教师不能读取他人报告。每次查看、列表、导出、搜索、下载都重查课程、题目开放状态和原始作答归属。
- 外部请求结束后再次检查会话、当前身份、机构开关及来源授权，避免长请求期间撤权后仍返回敏感内容。
- 每人同时最多1次分析/搜索/来源下载；数据库事务锁与唯一索引防止多进程绕过。每日尝试次数按北京时间计算，失败也计数，删除报告不重置限额；普通报告导出不消耗该额度。
- AI 输出按严格结构校验且必须对应所选错题。AI 文本以纯文本呈现；课程原始富文本沿用现有清理组件。
- 请求不自动重试；外部错误体、配置文件内容、密钥不返回前端或写入日志。Responses 请求设置 `store: false`；供应商自身数据处理政策仍由其服务约定决定。
- 联网来源仅接受工具返回的来源和引用，不从模型正文里正则提取或信任自造URL。配置的域名限制会再次在服务端过滤。
- 来源下载禁止本地、私网、云元数据与保留地址，检查 DNS 所有解析结果并固定连接IP，每次跳转重新检查。拒绝认证URL、非默认端口、压缩响应、超限流和可执行类型。
- PDF 与附件上传共用独立进程中的 `pdf-lib` 解析，检查解码后的名称、引用及压缩对象流；拒绝脚本、嵌入文件等活动内容，以及加密、损坏、未知流编码或解析超限文件。检查最多 5 秒且纳入下载总截止时间，最多 2 个并发、128 MB 解析堆、16 MB 单流解压及 64 MB 累计解压缓冲分配；并发满额立即拒绝。HTML去掉脚本等内容后导出纯文本，不在应用内执行下载内容。文字优先按 HTTP 字符集解码；未声明时，仅 HTML 解析前16KiB的 meta 字符集，支持常见 UTF-8、GB2312/GBK 等白名单编码，未知编码或错误字节序列会被拒绝。这是有限格式验证，不是完整的病毒扫描。

## 官方参考

- [DeepSeek API 首页](https://api-docs.deepseek.com/)：当前模型名称 `deepseek-flash`、API 根地址与 Chat Completions 调用方式。
- [DeepSeek JSON Output](https://api-docs.deepseek.com/guides/json_mode/)：`json_object`、JSON 提示要求、输出上限及空内容处理注意事项。
- [Tavily Search API](https://docs.tavily.com/documentation/api-reference/endpoint/search)：默认独立搜索接口、来源与内容摘录。
- [OpenAI Web search](https://developers.openai.com/api/docs/guides/tools-web-search)：Responses联网工具、来源与内联引用，以及域名过滤。
- [OpenAI Structured Outputs](https://developers.openai.com/api/docs/guides/structured-outputs)：严格JSON结构；本项目另做业务ID与长度校验。
- [YAML解析器](https://eemeli.org/yaml/)：重复键与别名限制。

## 验证与实际限制

当前配置切换（2026-10-08）：默认模型服务改为 DeepSeek `deepseek-flash`，搜索服务改为 Tavily。本次没有使用真实 DeepSeek 或 Tavily 账号发起请求，也没有验证真实模型输出、搜索质量、账号认证或计费额度。填写各自密钥后仍需做首次实际调用核验。以下保留此前验收历史；其中的模拟供应商、浏览器契约与公开文件下载结果，不构成本次 DeepSeek/Tavily 真实账号验证。

切换后的验证：全量单元测试91项通过（含14项网关契约测试），API生产构建、改动文件ESLint通过；DeepSeek/Tavily本地模拟服务与真实数据库串联的HTTP集成13项通过，覆盖请求参数、报告保存、搜索来源、权限撤销、限额及下载CSRF。本地运行服务已确认读取 `deepseek-flash` 和 `tavily`，两个密钥仍为空。本次未修改前端，未重复此前浏览器回归。

密钥按用户要求留空。本轮可验证配置解析、真实数据库/HTTP链路、供应商接口契约、失败恢复、权限隔离、下载防护与浏览器交互；没有调用真实 OpenAI/Tavily 账号，也没有把模拟输出描述为实际模型能力验证。填写密钥后，服务商的认证、配额、模型兼容性及真实搜索质量需做首次实际调用核验。

```sh
npm run typecheck
npm run lint
npm test
npm run build
DOTENV_CONFIG_PATH=.data/review.env npm run test:ai-study
DOTENV_CONFIG_PATH=.data/review.env WEB_BASE_URL=http://localhost:5174 npm run test:browser
```

接口测试使用名字包含 `review` 的隔离数据库，自行启动本地模拟供应商和3032 API，完成后停止进程、删除临时空密钥配置。新增浏览器用例名称明确包含 Mocked API contract，表示只验证前端契约，不表示真实联网能力。最终测试计数与验收截图见 [AI验收记录](verification/ai-study.json)。

本次浏览器回归16项通过（12项现有功能真实API、4项AI前端契约）；下载改为POST+CSRF后，受影响的4项契约测试再次通过，无障碍与角色检查另有1项定向复测。真实数据库与本地模拟供应商的HTTP集成共13项通过（含父测试）。这些复测与原用例重叠，不累计为新增用例数。

公网下载已实际验证[清华大学出版社高等数学练习册样章PDF](https://www.tup.tsinghua.edu.cn/upload/books/yz/084530-01.pdf)、[现代HTML图书介绍](https://www.tup.tsinghua.edu.cn/booksCenter/book_10285601.html)和[北大计算概论作业网页](https://math.pku.edu.cn/teachers/qiuzy/computing/execises.htm)。北大旧页面首次因GB2312仅在meta中声明而失败；补齐有界编码识别后重试成功，验收记录保留失败与修复后的成功结果。这些公开来源用于下载能力测试，不代表AI搜索效果。

截图：[真实后端空密钥状态](screenshots/ai-study-live-unconfigured.png)。以下为明确标注的固定数据契约测试截图：[选题](screenshots/ai-study-compose-desktop.png)、[报告](screenshots/ai-study-report-desktop.png)、[联网来源](screenshots/ai-study-sources-desktop.png)、[手机报告](screenshots/ai-study-report-mobile.png)。
