# 考试题目分析

教师在“考试 → 考试详情 → 题目分析”查看固定试卷的作答人数、客观完全正确率、平均得分、平均得分率及选项频次。展开表格行显示选项条形分布、空答人数和无效选项答复人数。支持刷新、分页和窄屏表格横向滚动。

## 官方资料与本项目选择

- [Moodle Quiz statistics report](https://docs.moodle.org/503/en/Quiz_statistics_report)：提供考试概览、逐题表格和题目响应频率，Facility Index 定义为题目平均得分百分比，并提醒低区分度不能直接证明题目有问题。
- [Canvas New Quizzes Quiz and Item Analysis](https://community.instructure.com/en/kb/articles/580197-new-quizzes-quiz-and-item-analysis)：只纳入最后一次测验尝试，完全正确比例与得分指标分开，完全正确比例不将部分分视为正确；无法计算的指标使用 N/A。
- [Canvas 教师报告入口与频次说明](https://community.instructure.com/en/kb/articles/661090-how-do-i-view-reports-for-a-quiz-in-new-quizzes)：题目报告包含平均得分和选项选择人数、比例。

本项目采用描述性指标，并分别标明“客观完全正确率”和“平均得分率”。默认每人最近一次**已结束的有效交卷**，更晚的作答中或取消记录不会遮蔽已交卷记录。样本不足 5 人只作提示，不推导题目质量；5 是产品提示阈值，不是统计显著性标准。当前不实现区分度、信度、原始文本答案聚类或自动修改题库。

## 接口

`GET /api/exams/:id/item-analysis?page=1&pageSize=20`

题目按固定试卷 position 升序分页；pageSize 默认 20，最大实际返回 50（查询值 51–100 截为 50，超过 100 返回参数错误）。返回字段：

| 字段                              | 含义                                       |
| --------------------------------- | ------------------------------------------ |
| exam                              | 仅 id、title、status                       |
| participantCount                  | 去重后的有效参考人数                       |
| submittedAttemptCount             | submitted / timed_out 答卷总数，含重复尝试 |
| attemptPolicy                     | 固定为 latest_finished_per_student         |
| total / page / pageSize           | 固定试卷题目总数及当前页                   |
| smallSample / generatedAt / rules | 小样本提示、生成时间、完整统计口径         |
| items[]                           | 当前页题目及聚合指标                       |

每题返回 questionVersionId、position（从 0 开始）、type、stem、scoreCents，以及 participantCount、answeredCount、unansweredCount、gradedCount、pendingCount、correctCount、correctRate、averageScoreCents、scoreRate、invalidResponseCount、options[]。选项仅有 id、text、count、percent。比例范围 0–100，保留最多两位小数；平均分内部仍用百分之一分，UI 除以 100 后最多显示两位小数。

## 统计口径

1. 仅使用指定考试的 submitted / timed_out，按 userId 分组取 number 最大记录。排除 in_progress / cancelled，不因学生退课或资格后续撤销而删去历史已交卷样本；教师访问则每次重新校验当前授课范围。
2. 题干、题型、选项、正确答案和评分规则来自 ExamPaperSnapshot，后续题库版本变化不影响本报告。随机显示顺序不影响选项 ID 的归类。
3. 空答不计入作答人数。`false` 和 `0` 是有效值；空白字符串、全空数组、空综合题槽位不算作答。完全正确率分母是有效参考人数，空答仍计入分母。
4. 客观题按冻结的自动评分规则重新判定是否完全正确，部分分不算完全正确；零权重题仍可判定正误。人工对题目评分的调整不会反过来改变正确率。
5. 平均得分仅纳入 graded=true 且有数值分数的本题答案，待批阅或缺失评分均不计零。得分率=已评分答案得分之和÷（已评分人数×本题满分）。分母为零时为 null；主观题正确率为 null，UI 显示“不适用”。
6. 多选题每人对同一选项最多计一次，选项比例分母为有效参考人数，总和可超过 100%。无效选项仅计人数，不回传原始值。填空、简答、综合题不汇总自由文本；综合题按整题分析。
7. 整卷复核调分不自动分摊到各题，本报告使用当前逐题评分。阅卷后刷新即时更新。
8. 已取消考试明确标记取消状态，保留交卷历史描述，不作为当前有效测验结论。

## 权限与保密

- 学生明确返回 403；教师必须同时拥有 assessment.grade、当前机构考试访问权和当前课程授课权。若配置了阅卷名单，必须在名单中。
- 管理角色额外要求 analysis.sensitive，并保留上述阅卷与范围要求。默认 ADMIN / SUPER_ADMIN 没有 assessment.grade，单独授予 analysis.sensitive 仍返回 403；本功能不扩大管理员阅卷权限。拥有全部授权的管理读取写入 analysis.sensitive.read 审计。
- 报告不返回学生身份、答卷 ID、原始作答、评语、标准答案、解析或评分规则。教师报告不受学生成绩公开时间限制，也不加入学生任何接口响应。
- 题目最多每页 50 项，答案按 ID 游标每批 1000 条增量聚合，数据库内选择最近交卷；不把整张答卷表或全部考试答案装入应用内存。分母与所有批次在同一个 RepeatableRead 事务内读取。
- 本功能不创建数据库模型或修改现有考试、答案、分数。没有异步统计缓存；大规模统计受 30 秒事务上限限制。

## 验证

本机测试使用 `.data/review.env` 的隔离数据库和 loopback API 3002；CI 可以在明确 `CI=true` 且数据库名包含 review 时使用 loopback 3001。fixture 拒绝生产模式、非 review 数据库、非本机 API 和本机常规 3001，避免写入演示库。地址优先读取 TEST_BASE_URL，其次 TEST_API_URL，未配置回退 3001（本机安全校验会拒绝，必须显式指定 3002）。数据库测试数据都属于本轮新建课程/考试；批次边界临时记录在测试结束时删除。

```sh
node --import tsx --test tests/exam-insights.unit.test.ts
DOTENV_CONFIG_PATH=.data/review.env TEST_BASE_URL=http://127.0.0.1:3002 node --import tsx --test tests/exam-insights.integration.ts
DOTENV_CONFIG_PATH=.data/review.env TEST_BASE_URL=http://127.0.0.1:3002 WEB_BASE_URL=http://localhost:5174 npx playwright test tests/browser/exam-insights.spec.ts
```

2026-10-08 最终统一验证结果：

- `npm run test:extensions`：28/28 通过、0 失败；其中题目分析为 11 个子场景及 1 个父测试全部通过。真实 HTTP 覆盖空样本、最近有效交卷、超时与取消状态、聚合白名单、学生与非指定阅卷教师拒绝、分页、阅卷后更新、固定试卷、撤权与跨机构隔离、管理员敏感授权边界及超过 1000 行的批次边界。日志：`.data/extensions-http.log`。
- `npm test`：全项目单测 48/48 通过；其中新增题目分析指标单测 8/8 通过。
- `npm run test:browser`：全项目浏览器测试 12/12 通过；其中题目分析 1 项真实 Chrome 流程通过，覆盖教师表格与选项分布、320px 页面无横向溢出、学生无入口且直接访问接口返回 403、取消后的历史数据提示。
- 全项目 `typecheck`、`lint`、`build` 均通过。
- 已实际检查桌面及手机截图：`test-results/exam-item-analysis-desktop.png`、`test-results/exam-item-analysis-mobile.png`。
