# 教师 AI 出题与组卷

教师入口为“题库与试卷 → AI 生成题目 / AI 编写试卷”，也可从侧栏进入 `/ai-authoring`。使用 `config.yaml` 已配置的 DeepSeek，无须添加另一项模型密钥。此流程根据教师提供的命题要求生成原创初稿，不调用 Tavily；联网找同类题仍在学生错题复盘中使用独立搜索服务。

## 使用

1. 选择本人授课的课程及可选章节，填写题目集或试卷名称、知识点、补充要求。可粘贴纯文本参考材料。
2. 设置题型组合：单选、多选、判断、填空、简答，每种题型可设置数量、每题分值和难度（1易–5难）。一次最多10题。
3. 生成后检查全部题干、选项、参考答案、解析和知识点，可逐题编辑、修改分值与难度、删除不需要的题目。填空题使用 `___` 标记每一空，每空对应一个标准答案；多选题至少两个正确选项。
4. 点击保存。题目模式将审核后的题目保存到本人私有题库；试卷模式在同一个数据库事务中保存题目和固定版本试卷。新题均为未开放学生练习的保密题。
5. 在考试中心创建考试，选择已有试卷，再使用现有考试排期、发布和阅卷流程。生成或保存试卷不会自动创建、发布考试。

生成历史保存在教师个人草稿中，可重新打开初稿、查看失败状态或已保存结果。页面中的编辑在提交成功前尚未入库，离开前应完成保存。删除草稿不删除已经保存的题目、试卷或调用计数。密钥未填或配置无效时显示原因；配置更新后可重新检查，无须重启。

AI初稿可能有事实、题意或答案错误，发布前应由教师逐题核对。格式验证只能检查题型、数量、答案结构与题目存储规则，不能保证学科内容正确。

## 数据和权限

- 仅当前教师身份可访问，需 `question.manage` 和 `course.read`；生成及保存还需 `course.manage`，并且课程未归档、本人仍有有效授课关系。
- 试卷模式额外需要 `assessment.manage`；撤销该权限后对应试卷草稿不会出现在历史列表，直链也被拒绝。其他教师、学生、机构管理员无法读取本人私有草稿。
- AI 返回后重新验证会话、身份、机构、权限及课程；提交时再次验证，并锁定草稿、课程及授课关系。题目和试卷全部成功后才提交事务；重复或并发保存返回已有结果，避免重复入库。
- 模型只接收教师填写的名称、知识点、要求、参考材料和题型计划，不自动读取课程教材、题库、现有考试、学生作答、姓名或内部课程ID。输入内容在模型提示中作为数据处理，输出按严格结构验证。
- 模型不能决定机构、课程、创建者、题目范围或学生练习开关。分值与难度按教师配置赋值，保存时的归属由服务端决定；所有生成文字均以纯文本预览，题干入库前转义。
- 与错题复盘共用 `limits.dailyRequests`：每人按北京时间累计分析、教师出题、搜索和来源下载的尝试次数，失败也计数。每人最多一个外部AI任务；数据库租约可恢复进程中断遗留的任务。普通保存不再调用模型，也不额外计入额度。
- 教师出题与现有题库保持一致，不受学生练习开关影响。新题默认不向学生开放练习；后续开放仍经过原有考试保密检查。

## API 与部署

写请求使用已有 Cookie 会话与 `x-csrf-token`。

| 方法   | 地址                                          | 内容                                               |
| ------ | --------------------------------------------- | -------------------------------------------------- |
| GET    | `/api/ai-authoring/status`                    | 安全配置状态、模型和限额，不返回密钥               |
| POST   | `/api/ai-authoring/drafts`                    | 根据课程、知识点、材料及 `blueprint` 生成草稿      |
| GET    | `/api/ai-authoring/drafts?page=1&pageSize=10` | 当前仍有访问权限的本人草稿历史                     |
| GET    | `/api/ai-authoring/drafts/:id`                | 草稿详情、输入要求、生成题目及保存结果             |
| POST   | `/api/ai-authoring/drafts/:id/commit`         | `{revision,title,questions}`，审核后的题目原子保存 |
| DELETE | `/api/ai-authoring/drafts/:id`                | 删除非生成中草稿，保留调用计数及已入库内容         |

草稿状态为 `pending`、`ready`、`failed`、`saved`。生成失败会返回带安全错误提示的 `failed` 草稿，前端必须检查状态，不能仅凭HTTP 201判断成功。超时租约恢复后的迟到响应不会覆盖草稿。

迁移 `202610080008_ai_authoring` 新增 `AiAuthoringDraft`，并扩展共享调用记录的 `authoring` 类型。新部署照常执行 `npm run db:generate` 和 `npm run db:migrate`；既有数据保留。

配置说明见 [AI 接入文档](ai-study.md)。DeepSeek 接口与 JSON 输出依据[官方文档](https://api-docs.deepseek.com/guides/json_mode/)。本轮真实演示后端已经报告 AI 配置可用；该状态检查不等于已验证供应商调用。本轮已完成一次真实 DeepSeek 调用：生成整数加法单选题并保存为私有题目及固定版本试卷，学生练习保持关闭，未发布考试。这是单道定向算术联调，不能证明广泛命题质量。

## 验证

```sh
npm run typecheck
npm run lint
npm test
npm run build
DOTENV_CONFIG_PATH=.data/review.env npm run test:ai-authoring
```

截至本轮已归档日志，验证结果如下。日志位置均相对于项目根目录。

| 检查                         | 结果                                                                        | 证据                                                                                                                                        |
| ---------------------------- | --------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| 全量单元测试                 | 107/107 通过，其中教师出题独立单测 16 项                                    | `.data/ai-authoring-all-unit.log`                                                                                                           |
| 教师出题 HTTP 集成           | 13/13 通过；真实 API、真实隔离 PostgreSQL，本地模拟 DeepSeek                | `.data/ai-authoring-integration.log`                                                                                                        |
| 学生错题复盘 HTTP 回归       | 13/13 通过；真实 API、真实隔离 PostgreSQL，本地模拟 DeepSeek/Tavily         | `.data/ai-authoring-student-regression.log`                                                                                                 |
| 全套浏览器回归               | 21/21 通过：12 项真实后端、9 项模拟 API 契约（教师 5 项、学生 4 项）        | `.data/ai-authoring-browser-full.log`                                                                                                       |
| 后续响应式定向复测           | 1/1 通过，与上述浏览器用例重叠，不计作第 22 项                              | `.data/ai-authoring-responsive-check.log`                                                                                                   |
| TypeScript、ESLint、生产构建 | 均通过；最终前端重建也通过                                                  | `.data/ai-authoring-typecheck.log`、`.data/ai-authoring-lint.log`、`.data/ai-authoring-build.log`、`.data/ai-authoring-web-final-build.log` |
| 空库启动                     | 迁移、重复种子、撤权保留、受控生产初始化、健康检查与四种身份登录通过        | `.data/ai-authoring-clean-start.log`                                                                                                        |
| 演示环境只读冒烟             | 教师入口与读取、学生拒绝访问、OpenAPI、390px 手机题库无横向溢出；无页面错误 | `.data/ai-authoring-demo-smoke.json`                                                                                                        |
| 真实 DeepSeek 算术题生成     | 通过；仅真实调用 1 次，生成并保存 1 道算术单选题及私有试卷                  | `.data/ai-authoring-live-model.json`                                                                                                        |

真实调用使用隔离 review 数据库和 `deepseek-flash`，返回 `ready` 草稿。人工检查样题“2 + 3”的正确选项 C 对应 5，解析与答案一致；随后回查确认题目为 `private`、`practiceEnabled=false`，试卷保存成功且没有发布考试。初版冒烟断言误用了大写 `PRIVATE`，按实际小写枚举纠正后仅做只读回查，未增加模型调用，这不是应用程序缺陷。此项证据独立于演示环境的只读页面冒烟，也不计入上述自动化测试数量。

HTTP 测试要求名称包含 `review` 的隔离数据库，教师套件自动启动 3033 API 和本地模拟 DeepSeek，结束后清理临时进程与配置。HTTP 的 TAP 计数包含父测试：各为 12 个子测试加 1 个父测试。模拟模型用于验证接口、格式、权限和故障处理，不能证明真实模型的学科质量或供应商额度可用。

全部 8 个数据库迁移已应用到演示环境和 review 隔离环境，其中本功能新增 `202610080008_ai_authoring`。空库启动使用已有锁定依赖及编译后的 API；Docker、全新依赖下载和远程 CI 未在本机执行。

截图按证据类型区分：真实演示后端为 `docs/screenshots/ai-authoring-live-demo.png` 和 `docs/screenshots/ai-authoring-live-question-bank-mobile.png`；`ai-authoring-compose-desktop.png`、`ai-authoring-compose-mobile.png`、`ai-authoring-preview-desktop.png`、`ai-authoring-preview-mobile.png` 为明确标注的模拟 API 契约截图。真实生成并保存的试卷页面见 [已保存试卷截图](screenshots/ai-authoring-live-saved-paper.png)，使用 review 环境的真实后端，显示前述一次供应商调用的结果。

完整计数、证据类型及真实调用结果见 [验收记录](verification/ai-authoring.json)。文档、日志和截图均不包含密钥值。
