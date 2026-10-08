# 算法判题服务

学生的源码只发送至管理员配置的独立 Judge0 CE 服务。API 进程不启动解释器、编译器、子进程或 Docker 来执行学生代码；没有配置服务时，学生仍可浏览题目、编辑和保存代码，但运行与提交会明确显示不可用。

## 配置

推荐在根目录 `config.yaml` 填写 `judge0` 节；`config.example.yaml` 已提供空白模板。真实配置被 Git 和 Docker 构建上下文排除。与 AI 共用 `AI_CONFIG_PATH` 指定的文件及严格 YAML 解析器，拒绝未知字段、重复键、别名、非法 URL 和超大配置文件。凭证不返回浏览器、不写入提交记录。

```yaml
judge0:
  enabled: true
  baseUrl: '' # 填写独立Judge0 CE服务的HTTPS地址
  apiKey: '' # 填写服务AUTHN_TOKEN；自托管本身无需购买云API key
  timeoutMs: 45000
  pollMs: 250
  languageIds:
    cpp: 54
    python: 71
    javascript: 63
    java: 62
```

每次状态查询和执行都会重新读取文件，地址、令牌、语言映射、开关更新无需重启 API；已经创建的提交保持启动时的配置。文件应只允许管理员与 API 进程读取。若部署使用单文件 Docker bind mount，编辑器以重命名替换文件可能令容器仍看到旧 inode，需要重新创建 API 容器或在挂载文件内更新内容并核实容器实际看到的新配置。整个 YAML 文件必须保持有效，不能只填新增字段而破坏其他节。

旧部署仍支持以下环境变量，**已设置的变量逐字段覆盖 YAML**，未设置的字段来自 YAML；因此推荐清理旧的 `ALGORITHM_JUDGE_*` 变量后统一维护 YAML。修改容器或进程的环境变量需要重启相应进程。仅当配置文件不存在时允许旧式纯环境变量部署；现存文件无效时不静默回退。

```dotenv
ALGORITHM_JUDGE_URL=https://judge.example.edu
ALGORITHM_JUDGE_TOKEN=由管理员设置的凭证
ALGORITHM_JUDGE_TIMEOUT_MS=45000
ALGORITHM_JUDGE_POLL_MS=250
ALGORITHM_JUDGE_LANGUAGE_IDS={"cpp":54,"python":71,"javascript":63,"java":62}
ALGORITHM_JUDGE_ENABLED=true
```

只有服务地址必填。令牌使用 Judge0 标准 `X-Auth-Token` 请求头；无需认证的受控内网实例可以留空，不过本项目自托管启动模板主动要求强令牌。此客户端直接对接 Judge0 CE，不直接使用需要另一套认证头的第三方市场代理。HTTPS URL 可以包含服务前缀路径，但不允许用户名、密码、查询参数或片段。开发和测试模式仅允许回环地址使用 HTTP，生产要求 HTTPS。

语言 ID 可以按实际部署的 `/languages` 部分覆盖。浏览器只使用 `cpp`、`python`、`javascript`、`java`，不能提交任意 Judge0 语言、编译选项或命令行参数。默认 ID 对应 Judge0 CE 文档中的 C++ 17、Python 3、JavaScript、Java，具体工具链版本取决于部署实例，应由运维验证并更新。[Judge0 CE 接口文档](https://ce.judge0.com/docs)

`status().available` 表示本地配置完整且有效，不是外部服务健康探测；实际认证失败、排队超时、服务故障仍会单独报错。

## 独立执行环境

截至 2026-10-09，官方 Releases 标记的最新稳定版本是 **Judge0 CE 1.13.1**，该版修补了 1.13.0 及更早版本的三项严重漏洞。仓库模板固定使用 `judge0/judge0:1.13.1`，不使用浮动 `latest`。这并不免除后续镜像、语言工具链、Docker 和宿主内核的补丁维护；上线前再次核对官方安全公告并扫描镜像，按需固定经过审核的镜像 digest。[官方发布与部署说明](https://github.com/judge0/judge0/releases/tag/v1.13.1)

Judge0 worker 应放在与学习平台、数据库和密钥存储隔离的专用主机/虚拟机中；不要给 worker 挂载学习平台目录、数据库凭证或宿主 Docker socket。只允许学习平台后端访问 Judge0 API。部署当前受支持并已修补的 Judge0 和 isolate，结合防火墙阻断 worker 访问互联网和内网业务服务。

在 Judge0 的 `judge0.conf` 固定 `ENABLE_NETWORK=false`、`ALLOW_ENABLE_NETWORK=false`。客户端也为每次提交发送 `enable_network=false`。服务端应将 CPU、内存、线程数、文件大小和队列上限限制到可承受范围；不要只依赖客户端传参。[Judge0 官方配置说明](https://github.com/judge0/judge0/blob/master/judge0.conf)

### 自托管部署

模板位于 `deploy/judge0/compose.yaml`、`judge0.conf.example` 和 `nginx.conf.example`，与主应用 Compose 完全分开。准备专用 Linux x86_64 VM（建议至少 4 核 / 6 GiB 内存），按官方说明配置 Ubuntu 22.04、cgroup v1、Docker 和 Compose v2。官方要求的 GRUB 参数是 `systemd.unified_cgroup_hierarchy=0`，需要管理员在 VM 中审核修改、执行 `update-grub` 并重启；本项目脚本不会更改宿主启动参数。Judge0 的 server 和 worker 沿用官方 `privileged` 要求，因此 **VM 才是与业务系统之间的隔离边界**。[官方 Compose](https://github.com/judge0/judge0/blob/v1.13.1/docker-compose.yml)

在 VM 上保存本仓库的 `scripts/judge0-selfhost.mjs` 与 `deploy/judge0/` 目录，安装 Node.js 22 后执行：

```bash
node scripts/judge0-selfhost.mjs --check
node scripts/judge0-selfhost.mjs --init
node scripts/judge0-selfhost.mjs --start --dedicated-vm
```

`--check` 仅检查 Linux、架构、cgroup 与本地 Docker；拒绝连接远程 Docker。`--init` 通过系统安全随机数分别生成数据库、Redis、Rails、认证及授权令牌，写入权限 `600` 的 `deploy/judge0/judge0.conf`，不输出秘密，不覆盖现有文件。将其中的 `AUTHN_TOKEN` 通过安全编辑器填写到应用 `config.yaml` 的 `judge0.apiKey`，其他部署凭证只留在判题 VM。自托管无需第三方付费 key。启动脚本不接受用户代码，只启动受审查的独立 Compose，资源配置偏离模板时拒绝启动。

模板最多两个 worker、32 个排队作业，固定禁网并关闭回调、附加文件、自定义编译选项和命令行参数；容器有 CPU、内存、进程数与日志容量上限。PostgreSQL / Redis 采用受维护的同一大版本标签，定期拉取补丁并验证；生产可以审核后固定 digest。判题数据保存在独立 `judge-data` 卷，部署机磁盘和提交历史需按组织保留策略维护，不能将它挂入学习平台数据库。

Docker 网络设置 `internal: true`，API 只发布到 VM 的 `127.0.0.1:2358`。在 VM 宿主配置提供有效证书的 HTTPS 反向代理，可参考 Nginx 示例，替换域名、证书路径和学习平台后端出口 IP，只允许后端访问。代理需允许至少 8 MiB 请求体，并禁止记录认证头和请求正文。不要开放 2358 公网端口。VM / 云防火墙还应阻断判题环境到互联网和业务内网的主动连接，只放行受控的管理及 API 入站；容器内网不能替代这一层。镜像拉取由 VM Docker 守护进程进行，运行中的执行器不需要联网。

首次 `up --wait` 只确认容器与数据库初始化，不能证明编译器或隔离正常；按下一节从应用主机完成诊断与四语言烟测，再验证 VM 的网络隔离。升级时先在备用 VM 烟测，备份判题卷后切换 YAML 地址；不要在主应用主机临时运行学生代码作为替代。

本项目请求的上限为每用例 CPU 10 秒、墙钟 20 秒、内存 512 MiB（524288 KiB）、栈 64000 KiB、进程/线程数 60、文件大小 1024 KiB、运行次数 1；时间和内存使用整组进程限制。题目可以使用更小的限制。管理员必须使服务允许的上限与题库相符：例如使用 256 MiB 的题目需要 Judge0 的 `MAX_MEMORY_LIMIT` 至少为 262144 KiB。Java 和 Node.js 启动有额外资源开销，上线前应实际运行相应模板验证配置。

网关设置 `enable_per_process_and_thread_memory_limit=false`，对应 Judge0 的 cgroup 整组内存限制，避免将 JVM 的虚拟地址预留误当作物理内存超限；线程上限采用 Judge0 的默认值 60。编译阶段由 Judge0 服务端的 `MAX_*` 资源限制约束，管理员应同时控制这些上限。某个用例报告编译失败后，网关立即停止创建后续作业并取消本地在途轮询，为整组用例返回编译错误。[Judge0 worker 实现](https://github.com/judge0/judge0/blob/master/app/jobs/isolate_job.rb)

## 判题行为

每个用例异步创建一次提交，再按 token 查询结果；不使用 `wait=true` 或回调。源码和 stdin 以 Base64 传输，输出也按 Base64 接收。参考输出保留在学习平台，本地比较时统一 CRLF/CR 换行为 LF，忽略每行尾部空格和 Tab 以及末尾空行，保留前导、行内空白和中间空行。该策略适用于题库的普通文本题，不实现浮点容差或多种合法解特判。

仅 Judge0 正常退出且本地比较通过的用例得到 `accepted`；自定义运行省略参考输出时，`accepted` 仅表示成功运行，业务层不得据此完成题目。Judge0 的 CPU 超时、编译错误和运行错误分别映射为对应状态。Judge0 CE 没有独立的内存超限状态，仅当错误与报告的内存达到限制一致时返回 `memory_limit`，其余保持 `runtime_error`，不根据 stderr 猜测。

隐藏用例只返回序号、状态、耗时和内存。输入、参考输出、stdout、stderr、上游 message 都不返回学生；包含隐藏用例的提交也不返回编译诊断，防止上游文本回显隐藏输入。学生可先使用样例运行查看编译诊断。所有上游文本均作为纯文本处理，已知凭证和服务地址会脱敏。

每次最多 30 个用例，源码最多 64 KiB；可信题库的每份输入最多 4 MiB、参考输出和 stdout 最多 1 MiB，整组请求序列化后最多 16 MiB。学生提交接口仍独立限制源码 16000 字符/48000 字节、自定义 stdin 16000 字符/32000 字节；学生不能提交用例数组。stderr 和编译日志仍最多 64 KiB，返回可见诊断最多 16384 字符。

每次执行最多同时处理两个用例，每个 API 网关实例最多四次执行。整个提交共用 45 秒默认截止时间（可配置为 100–60000 毫秒），每个用例最多轮询 180 次；轮询间隔可配为 10–2000 毫秒。每个响应流最多 2 MiB，涵盖 Base64 编码后的 1 MiB 输出，并严格校验 JSON、Base64、状态及 token。禁止重定向，避免认证信息转发到另一地址。

内置题库每题不超过 10 个用例，其中增加 1–2 组确定性的边界用例：十万规模数组/字符串、十万查询、500×500 网格、二十万条依赖边、64 位累加和取模结果。大用例只保存在服务端，不会出现在题目 DTO、历史明文或 AI 输入中。这样能检测不少小样例暴露不了的低效解法与溢出错误；固定用例和时间限制不能证明任意程序的复杂度或正确性。

基础设施错误、畸形响应或总超时返回 `system_error`，丢弃部分通过结果，本次不计为通过。达到总超时会停止本地等待；已经在 Judge0 创建的作业仍由其有限的运行资源限制终止，API 不假装已经取消远端作业。跨进程或多实例部署仍需业务层的限流和并发租约。

## 验证

```bash
node --import tsx --test tests/algorithm-judge.unit.test.ts
node --import tsx --test tests/algorithm-judge-config.unit.test.ts
node --import tsx --test tests/algorithm-catalog.unit.test.ts
node scripts/check-judge0.mjs
node scripts/check-judge0.mjs --smoke
```

单测用本机 HTTP fixture 模拟协议，覆盖正确答案、错误答案、编译/运行/资源错误、隐藏输出清洗、配置脱敏、路径注入、重定向、响应大小限制、总超时与并发槽位回收；不执行学生代码，不向公共判题服务发送测试数据。接入真实实例后，管理员需额外验证四种语言的模板、实际编译、网络隔离和资源限制。

`check-judge0.mjs` 默认只调用 `/about`、`/languages`、`/config_info`、`/workers`，检查版本、语言 ID、网络禁用、资源预算和可用 worker。元数据探测共用最多 10 秒截止时间，继承网关的大小上限、禁止重定向和认证头处理。只有加 `--smoke` 且所有前置检查成功，才在配置的远程服务依次提交四个固定的 64 位加法程序；脚本不接受源码、URL、令牌或运行选项参数，不在本地编译执行。结果只报告分类状态，不输出地址、令牌、上游响应或编译日志。烟测通过只能证明这组程序和已报告配置可用，不能证明宿主防火墙、恶意程序隔离或所有题目的性能约束。

本次开发环境为 macOS ARM，未安装 Docker / Podman / Colima，无法按官方 Linux 环境部署；现有 `config.yaml` 的地址和令牌保留空白，诊断明确显示待配置。仓库已验证本地协议 fixture、YAML 热更新与诊断逻辑，**尚未对真实 Judge0 实例执行部署或四语言烟测**。

## 内置题解参考程序的离线验证

维护者可以用以下脚本编译、运行仓库固定的四语言参考解，逐一核对题库的公开和隐藏用例：

```bash
node scripts/verify-algorithm-references.mjs
node scripts/verify-algorithm-references.mjs --languages=python,javascript --problems=maximum-subarray,inversion-count
node --import tsx --test tests/algorithm-editorials.unit.test.ts
```

脚本仅导入仓库内置题库与题解，参数只允许选择已知语言和题目 ID，不接受源码、任意路径或浏览器输入。它是可信参考程序的离线维护工具，不能接到学生运行接口，也不能作为 Judge0 失效时的后备执行方式。参考程序使用临时目录，编译和单用例进程均有截止时间，结束后清理临时文件。

这些检查验证教学内容结构、样例推演一致性和参考程序的功能正确性。主机上的 Python、Node、C++、Java 版本及资源环境与部署的 Judge0 不同，因此离线通过不等于已经验证真实判题实例的版本兼容性或题目时间限制。
