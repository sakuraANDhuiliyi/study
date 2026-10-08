# 题库、作业、练习、考试接口与一致性约定

所有路径以下省略 `/api`。鉴权使用当前角色的安全 Cookie 会话；写请求必须携带 `X-CSRF-Token`。本文所有 `DateTime` 为带时区 ISO 8601 输入和 UTC ISO 输出，界面转换到 Asia/Shanghai。所有分数使用整数百分之一分（`scoreCents: 1250` 表示 12.50 分）。

## 权限和范围

| 操作                                            | 功能权限                             | 数据范围                                                                 |
| ----------------------------------------------- | ------------------------------------ | ------------------------------------------------------------------------ |
| 题目查询、维护、版本、复制、导入                | `question.manage`                    | 当前机构、当前授课课程；仅创建人可改私有或共享原题；其他教师可复制共享题 |
| 试卷、作业/考试编排、发布、延时、补交、资格取消 | `assessment.manage`                  | 当前被授权的可写课程                                                     |
| 提交名单、批改、阅卷、结果发布、复核处理        | `assessment.grade`                   | 当前授课课程；指定阅卷人时须匹配 `graderIds`                             |
| 练习、作业答题、考试、本人结果与复核申请        | `learning.use`                       | 当前有效选课、对应发布对象、仅本人提交或答卷                             |
| 复核时改分                                      | `grade.revise` 加 `assessment.grade` | 独立敏感授权；原分、新分、原因、审批人及复核单持久化                     |

没有超级管理员绕过。角色和资源校验每次请求重新执行。管理员若没有题库/阅卷权限不能以机构管理员身份读取答卷。

分页列表返回 `{items,total,page,pageSize}`，默认 `page=1,pageSize=20`，最大 100；稳定时间排序后按 ID 排序。筛选可用 `courseId,search,status`，题目增加 `type,difficulty,knowledgePoint,creatorId,chapterId`。学生列表和详情均在数据库查询及响应投影阶段限制范围。

## 题库和试卷

`GET /questions/template?courseId=...` 下载 JSON 模板；`GET /questions/export` 使用相同筛选和分页导出固定最多 100 行，写导出审计，`items` 可直接作为导入的 `rows`。

`GET/POST /questions`；`GET/PATCH /questions/:id`；`GET /questions/:id/versions`；`POST /questions/:id/copy`。

新增题目格式：

```json
{
  "courseId": "course-id",
  "type": "single",
  "stem": "题干",
  "options": [
    { "id": "A", "text": "甲" },
    { "id": "B", "text": "乙" }
  ],
  "answer": "A",
  "explanation": "解析",
  "scoreCents": 1000,
  "difficulty": 2,
  "knowledgePoints": ["知识点"],
  "tags": [],
  "scope": "private",
  "practiceEnabled": false,
  "rules": { "partialCredit": false, "caseSensitive": false, "trim": true, "collapseWhitespace": true },
  "children": []
}
```

类型为 `single,multiple,boolean,blank,short,composite`。单选答案为选项 ID；多选为 ID 数组；判断为布尔值；填空为每空可接受答案数组，例如 `[["SELECT","查询"],["ORDER BY"]]`；简答为参考文字；综合题在 `children` 中提供带 `id` 的完整子题，子题总分必须等于母题分数，不支持递归综合题。题干及综合子题题干支持安全 HTML 与绝对 HTTPS 图片地址；服务端移除脚本、事件属性、危险协议、SVG 和未允许标签。选项、解析等其他文字字段仍剥离 HTML。

PATCH 必须包含 `expectedVersion`。每次编辑创建新的 `QuestionVersion`；旧版本不覆盖。传 `active:false` 停用原题。版本冲突 409。当前版本由题目 `currentVersion` 指向；已发布业务持有固定版本。

`POST /questions/import` 接受 `{rows:[题目对象],commit:false}`，返回逐行验证结果。`commit:true` 必须全部行通过验证，然后在一个事务中写入；数据库错误全部回滚。每批最多 500 行。

`GET/POST /papers`。新增 `{courseId,title,questionVersionIds:[...]} 或 {courseId,title,rule:{count,type?,difficulty?,knowledgePoint?,practiceEnabled?}}`；抽题不足返回明确 400，不重复或静默缩减题量。试卷保存固定版本引用与总分。题库版本不可从 URL 越权读取。

## 作业

`GET/POST /assignments`；`GET/PATCH /assignments/:id`；`POST /assignments/:id/publish`。

新增 `{courseId,title,description,opensAt,dueAt,questionVersionIds,audienceIds?,allowLate?,maxAttempts?,attachmentIds?}`。`audienceIds` 空数组代表课程当前全部学生，创建时冻结对象。必须有有效对象，默认禁止迟交、仅一次提交。附件 ID 必须属于操作者且绑定当前课程或未绑定业务，不能引用私信、另一作业、另一课程或导出归档的附件。发布时重新检查附件课程归属、题目停用状态和共享授权；不会因当前发布教师与原附件上传者不同而阻止合法教学交接。

详情返回 `items:[{questionVersionId,question:{id,questionId,type,stem,options,scoreCents,...}}]`、`draft`、`mySubmissions`、`exception`、`serverTime`。`question.id` 为版本 ID。未开放时学生拿不到题目；未公开结果时拿不到标准答案、解析、分数、教师反馈或批阅记录。

- `PUT /assignments/:id/draft`：`{revision,answers:[{questionVersionId,value}],attachmentIds:[]}`。初次 revision 为 0，保存返回新 revision。草稿不代表正式提交。
- `POST /assignments/:id/submit`：`{answers:[...],attachmentIds:[],idempotencyKey}`，同一键相同内容返回原提交；同键不同内容 409。每次正式提交独立 `version`，历史答案/批注不会被新版本覆盖。
- `GET /assignments/:id/submissions`：教师查询授权提交，学生仅本人版本；`GET /assignments/:id/roster`：教师按学生查看未提交、迟交、待批、已豁免、已退回等状态。
- `PUT /submissions/:id/grade`：`{revision,items:[{questionVersionId,scoreCents,comment}],comment}`。客观题缺省自动评分，`finalize:false` 可先暂存部分评分与反馈；正式完成时所有主观题须有分值。成功新增版本化 `AssignmentFeedback`。
- `POST /assignments/:id/release`：必须完成所有有效提交的批改，统一公开。发布后不能用普通批改覆盖该版本。
- `POST /submissions/:id/return`：`{reason}`，保留原版本，授予一次额外重交和至少七天重做窗口。
- `POST /assignments/:id/exceptions`：`{userId,reason,allowUntil?,extraAttempts?,exempt?}`，单独批准补交/次数/豁免并审计。

已发布作业 PATCH 必须带 `{revision,reason}`，仅允许修改标题、说明和延后截止；题目、对象、次数等关键规则冻结。补交使用例外记录。通知通过独立任务入队，不决定提交事务的成败。

## 练习、错题和收藏

- `GET /practice`：本人最近练习列表。
- `POST /practice`：`{courseId,count:10,mode:"random"|"mistakes"|"favorites",questionIds?,knowledgePoint?,chapterId?,type?,difficulty?}`。
- `GET /practice/:id`：`{id,status,items,answers,report,flags,currentPosition,revision}`；未答题不返回答案和解析，已答题可复盘。
- `PUT /practice/:id/progress`：`{revision,flags:[questionVersionId],currentPosition}`，持久化稍后标记与从零开始的位置；返回新版本。仅本人当前有权访问的练习可写，其他练习题目 ID 或越界位置返回 400，多页面旧版本覆盖返回 409；已完成练习仍可维护复习标记。
- `POST /practice/:id/answer`：`{questionVersionId,value}` 返回 `{answer,question,report}`，count 可省略以采用当前可用题量（最多 10）；明确指定题量不足时拒绝，不静默缩减。第一次作答按题唯一，重试不重复计入错题。需要重做请创建新练习。
- `GET /mistakes`；`PATCH /mistakes/:id {mastered}`；`GET /favorites`；`PUT /questions/:id/favorite {favorite}`。

题目必须显式 `practiceEnabled=true`，默认为 false。任何曾开放练习的题都保留 `everPracticeEnabled=true`，不得重新充当保密考试题。存在尚未公开答案的考试时，不得把关联题开放练习或发布到作业；考试发布也检查题目没有已发布作业或其他正式考试用途，防止跨场次公开答案泄露。有历史答卷的考试即使取消，题目也不能重新用作另一场保密考试。发布和题目开放使用共享题目事务锁消除并发检查窗口。

客观评分：单选/判断全对满分；多选错选为零，漏选仅在 `partialCredit=true` 时按命中标准选项数占比计分并向下取整到分币；填空各空等权，按配置做 NFKC、去首尾空格、合并空白、大小写标准化。简答/综合题不伪造自动评分，练习显示参考答案供自主复盘，`correct/scoreCents=null`，排除在客观正确率分母外。

错题自动累计每次新练习的错误次数；答对更新最近活动但不删除历史，不自动宣称掌握。掌握标记由学生显式操作。

## 考试生命周期与可靠性

`GET/POST /exams`；`GET/PATCH /exams/:id`；`POST /exams/:id/publish`。

新增 `{courseId,title,description,startsAt,endsAt,entryClosesAt,durationMinutes,questionVersionIds,audienceIds?,maxAttempts?,shuffleQuestions?,shuffleOptions?,allowBacktrack?,passCents,graderIds?,scoreReleaseAt?,answerReleaseAt?,explanationReleaseAt?,commentReleaseAt?,appealDeadline?}`。四种公开时间分别校验，不得早于考试窗口结束；未设置评语时间时随正式成绩公开。

发布前检查有效学生、当前题目、总分、时间、参考答案规则、主观阅卷教师及保密隔离。发布后冻结试卷和关键设置，题目完整内容进入 `ExamPaperSnapshot/ExamPaperItem`。题目或选项随机顺序首次开始时持久化在 `ExamAttempt`，刷新不改变。

状态独立存储：

| 字段                      | 状态                                            |
| ------------------------- | ----------------------------------------------- |
| Exam.status               | draft / published / cancelled                   |
| ExamAttempt.status        | in_progress / submitted / timed_out / cancelled |
| ExamAttempt.gradingStatus | pending / graded                                |
| ExamAttempt.releaseStatus | hidden / released                               |
| 名单衍生状态              | not_started / absent（窗口结束且没有答卷）      |

- `POST /exams/:id/start`：检查当前选课、指定对象、资格、窗口、进入时间、次数；有进行中答卷时返回同一答卷。默认截止 `min(实际开始时间+允许时长,考试窗口结束)`。
- `GET /attempts/:id`：只允许本人或授权教师。返回 `deadlineAt,serverTime,lastSavedAt,revision,items,answers,flags,currentPosition`。每个 `items[].id` 是版本 ID。学生成绩可见时才返回具体 `scoreCents`；教师另有 `gradingRevision`。
- `PUT /attempts/:id/answers`：`{revision,answers:[{questionVersionId,value}],flags?,currentPosition?}`；成功 `{revision,lastSavedAt,serverTime}`。只写增量答案，版本冲突 409。客户端必须读取服务器新版本进行人工合并，禁止盲目以新的 revision 重发旧整卷覆盖。禁止返回上一题的考试限制位置单调递增且每次最多前进一题。
- `POST /attempts/:id/submit {idempotencyKey}`：只提交服务器已确认保存的答案；重复请求返回同一答卷。客户端未同步草稿不是提交内容。
- `GET /exams/:id/attempts`、`GET /exams/:id/roster`：教师分页名单，缺考、取消资格和已提交区分。

服务每十秒扫描数据库中的到期 `in_progress` 答卷，并在启动时补扫。数据库保存所有待处理截止任务（答卷的状态和 deadline），进程中断后无需浏览器恢复。行锁和状态条件更新串行化保存、手动交卷、自动交卷、延时，防止同一答卷重复评分。每轮有 `AssessmentJobRun` 持久运行日志，失败保留错误类别并在下轮重试尚未完成答卷。一次扫描最多 100 份；扩容工作进程仍凭行级幂等认领保证一致性，不宣称任何未测并发上限。

`POST /exams/:id/extensions {userId,reason,deadlineAt,extraAttempts}` 保存独立授权记录，更新仍在作答的截止时间；已提交内容不重新开放。额外次数用于新尝试。延时不能越过既定成绩/答案/解析/评语公开时间；已发布成绩后须另建补考。`PUT /exams/:id/eligibility {userId,eligible,reason}` 保留名单并取消正在作答的资格。`POST /exams/:id/cancel {reason}` 保留历史并停止当前答卷。

## 阅卷、成绩与复核

- `GET /exams/:id/questions/:questionVersionId/answers`：当前课程中指定阅卷教师的逐题批阅列表，分页返回固定版本题目、该题学生作答、分值、批注和每份答卷 `gradingRevision`；只包含已提交或超时交卷，`status` 可按整份答卷 `gradingStatus` 筛选。其余题目答案不进入该响应。配合以下单题 `items` 的批阅请求，可按题逐份保存。
- `PUT /attempts/:id/grade {revision:gradingRevision,items:[{questionVersionId,scoreCents,comment}],comment?}` 支持分批暂存逐题评分；保存 `GradingRecord` 和独立批阅版本 CAS。顶层 `comment` 为总体评语，持久保存于 `ExamAttempt.feedback` 并逐次留存评分历史；省略时保留现有总评，传空字符串明确清空。未完成全部主观题时 `scoreCents=null,gradingStatus=pending`。
- `POST /exams/:id/release` 要求窗口已结束、没有进行中或未批阅答卷；设置 `releaseStatus`，再按 `scoreReleaseAt` 展示。未配置分数时间时采用实际发布时刻。答案和解析分别按自身时间，默认不公开。
- 学生答卷中的单题 `answers[].comment` 和总体 `feedback` 仅在统一发布后、到达 `commentReleaseAt` 时返回；可独立于成绩时间公开。未配置评语时间时采用成绩公开时间。尚未到各自时间的成绩、答案、解析与评语字段都不会进入学生接口响应。
- `POST /attempts/:id/appeals {reason}`：本人已发布成绩、未过复核期限、同一答卷唯一申请。
- `GET /appeals`：学生本人或授权教师复核列表。
- `POST /appeals/:id/resolve {resolution,scoreCents?}`：仅处理意见无需改分权限；传 scoreCents 另需 `grade.revise`。事务保存原分、新分、原因、操作人、关联复核单，随后更新唯一正式总分。
- `GET /attempts/:id/revisions`：有权限的成绩修改历史。

复核支持总分调整，答题逐题记录原样保留；返回 `scoreAdjustmentCents` 明确表示正式总分与逐题分数之和的差额。分析使用最新正式总分，题目正确率仍使用题目原始评分，不能把总分调整伪造为某一道题答对。

## 错误和前端处理

`400` 参数或发布校验失败；`401` 会话失效；`403` 操作/当前资源范围不足；`404` 当前范围下资源不存在；`409` 版本冲突、截止、重复有效业务或不允许的生命周期迁移。错误外层结构和请求跟踪 ID 由全局过滤器统一。

自动保存客户端应防抖、串行请求，以服务端时间校正倒计时；保存成功与未同步草稿要分开展示；断线保留本地草稿并重试；409 必须让用户选择合并服务器版本。正式交卷前等待已排队保存完成，并确认未答题数量。

## 外键补充和已知边界

跨模块标量 ID 由初始 SQL 迁移添加 RESTRICT 外键：

- Question：organizationId → Organization、courseId → Course、chapterId → Chapter、creatorId → User。
- Paper、Assignment、Exam：organizationId → Organization、courseId → Course、creatorId → User。
- AssignmentAudience、AssignmentDraft、AssignmentSubmission、AssignmentException、ExamAudience、ExamAttempt、GradeAppeal、ExamExtension：userId → User。
- AssignmentFeedback、GradingRecord：graderId → User；AssignmentException、ExamExtension：approvedBy → User。
- PracticeSession：organizationId → Organization、courseId → Course、userId → User。
- PracticeAnswer：questionId → Question、questionVersionId → QuestionVersion。
- MistakeRecord、QuestionFavorite：userId → User、courseId → Course、questionId → Question。
- ExamAnswer：questionVersionId → QuestionVersion；GradeRevision：actorId → User、appealId → GradeAppeal。

业务内部关系已用 Prisma relation 建模。数组型附件、评分人、知识点及标签由业务层验证，题目不可破坏性删除。题干支持安全图文；题目图片使用 HTTPS 地址，尚无随题版本冻结图片二进制内容的私有资源库。题目 Excel 导入导出、复杂按知识点分层随机试卷、逐子题综合题评分尚未实现；当前 JSON 导入、基本规则抽题及综合题整体人工评分可运行。

作业批量下载由附件模块提供 `POST /attachments/assignments/:id/export {clientId:UUID}`，返回持久任务 ID；`GET /attachments/exports/:jobId` 轮询完成后获取私有 TAR.GZ 下载附件。须同时具备 `assessment.grade` 与独立 `data.export` 授权，下载重新验证当前权限；清单保留各次提交、答案、批注及文件。生成归档禁止作为普通作业附件再次共享。

自动化验证：`tests/assessment.unit.test.ts` 覆盖六类评分语义、整数精度、白名单递归脱敏、独立公开开关、截止计算、随机顺序与 DTO 边界。数据库/HTTP 集成由项目端到端测试覆盖；未实际执行的结果不得算通过。

独立并发/权限集成测试：启动开发服务并配置 DEV_SEED_PASSWORD 后运行 `npx tsx --test tests/assessment.integration.ts`。每轮新建隔离课程和题目，覆盖并发开始/保存/练习/批改、题目跨流程隔离、未阅全禁止发布、导入回滚及导出再验证，不依赖浏览器模拟。
