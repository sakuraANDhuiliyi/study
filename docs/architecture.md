# 架构、权限与业务规则

## 技术与边界

采用 React 18.3 + TypeScript + Vite + Ant Design + React Router + TanStack Query + ECharts 6.1；NestJS 11 + Prisma 6 + PostgreSQL 的模块化单体。保留用户指定栈与 Docker 部署方式，不使用静态页面或浏览器存储替代数据库。认证、课程、机构管理、测评、交流、统计各有独立目录。单进程即可运行后台通知与考试到期扫描，多进程通过数据库状态条件和行锁避免重复处理。

开发环境可用 `embedded-postgres` 下载的真正 PostgreSQL 二进制运行持久数据库，不是内存模拟。生产使用 Compose 中的 PostgreSQL 或独立 PostgreSQL 服务。

所有时间以 UTC 瞬时时间存储为 PostgreSQL `timestamptz(3)`，前端统一 Asia/Shanghai。分数以 1/100 分为单位存储整数（`scoreCents`），避免浮点累计。

## 核心关系

```mermaid
erDiagram
  Organization ||--o{ User : owns
  User ||--o{ UserRole : assigned
  Role ||--o{ UserRole : grants
  Role ||--o{ RolePermission : defines
  Permission ||--o{ RolePermission : allows
  User ||--o{ Session : authenticates
  User ||--o{ SensitiveGrant : independently_authorized
  Organization ||--o{ Class : contains
  Class ||--o{ ClassMember : contains
  Class ||--o{ CourseClass : teaches
  Course ||--o{ CourseClass : faces
  Course ||--o{ Enrollment : enrolls
  Course ||--o{ TeachingAssignment : authorizes
  Course ||--o{ Chapter : organizes
  Chapter ||--o{ Lesson : contains
  Lesson ||--o{ LearningProgress : records
  Question ||--o{ QuestionVersion : versions
  QuestionVersion ||--o{ AssignmentItem : snapshots
  Assignment ||--o{ AssignmentItem : contains
  Assignment ||--o{ AssignmentSubmission : receives
  AssignmentSubmission ||--o{ AssignmentFeedback : versioned_feedback
  Exam ||--|| ExamPaperSnapshot : freezes
  ExamPaperSnapshot ||--o{ ExamPaperItem : contains
  Exam ||--o{ ExamAttempt : attempts
  ExamAttempt ||--o{ ExamAnswer : answers
  ExamAttempt ||--o{ GradingRecord : grades
  ExamAttempt ||--o{ GradeAppeal : appeals
  ExamAttempt ||--o{ GradeRevision : revises
  Conversation ||--o{ ConversationMember : contains
  Conversation ||--o{ Message : persists
```

题目选项、评分规则、知识点和标签存于不可变版本的 JSON／文本数组中；综合题子题存为版本 JSON。作业答案与每次批注存为提交版本 JSON。课时本身承担 Resource 职责，Attachment 保存受控二进制资源；行政 Class 与 CourseClass 教学安排分别保留。数据库中的跨模块标识列仍有真实外键，由初始迁移补充；Prisma 层刻意不暴露这些跨模块导航属性。历史记录外键采用 RESTRICT，不提供破坏性账号或课程删除。

## 权限矩阵

| 范围                 | 学生                       | 教师                               | 机构管理员                                      | 超级管理员                         |
| -------------------- | -------------------------- | ---------------------------------- | ----------------------------------------------- | ---------------------------------- |
| 课程内容             | 本人有效选课；已发布／归档 | 当前有效授课                       | 本机构教学管理                                  | 本机构教学管理                     |
| 学習与提交           | 本人                       | 无学生身份时不可作答               | 无                                              | 无                                 |
| 题库、作业、考试配置 | 无                         | 当前授课；题库私有创建者或共享     | 无默认教学评分权限                              | 无默认教学评分权限                 |
| 批阅                 | 无                         | 当前授课及考试指定阅卷关系         | 无                                              | 无                                 |
| 已发布个人成绩       | 本人                       | 当前授课学生                       | 需独立教学统计授权                              | 需独立教学统计授权                 |
| 成绩复核改分         | 申请                       | 需 grade.revise 限时授权与复核流程 | 无默认权限                                      | 无默认权限                         |
| 用户与角色           | 个人资料                   | 个人资料                           | 本机构学生、教师                                | 本机构学生、教师、管理员           |
| 平台角色模板         | 无                         | 无                                 | 无                                              | roles.manage；不能改自己持有的模板 |
| 敏感授权             | 无                         | 无                                 | 无                                              | grants.manage；不能自授            |
| 私信                 | 当前共有课程的师生双方     | 同左                               | 不能浏览                                        | 不能浏览                           |
| 内容治理             | 举报、屏蔽                 | 本课程讨论治理                     | 本机构公开内容                                  | 本机构公开内容                     |
| 导出                 | 无                         | 需 data.export 限时授权            | 需 data.export；教学成绩另需 analysis.sensitive | 同左                               |

权限模板不是超级管理员名称判定的通行证。`SensitiveGrant` 必须与当前角色模板中的敏感能力交集，过期立即失效。开发种子默认不授予敏感权限。平台初始化账户仅通过受控环境创建；多机构人员管理当前以账户所在机构为上下文，不接受请求体中的 `organizationId` 切换机构。

会话保存 token 哈希和 CSRF 随机值，Cookie 为 HttpOnly、SameSite=Lax，生产必须 Secure。每次请求重新检查账号、机构、角色关系和权限模板；密码变化、停用和角色变化撤销会话。文件访问、WebSocket、导出和批量操作均独立检查范围。登录失败按 IP + 账号限流；当前为单进程内存限流，生产入口应另加网关限流。

## 关键状态与一致性

- 课程：DRAFT → PUBLISHED／UNPUBLISHED → ARCHIVED。归档禁止修改教学内容与配置；当前成员可查看历史并按原有任务时间规则继续学习。课程成员关系停用不删除历史。
- 作业：draft → published；草稿不是提交。每次提交有独立 version 和唯一幂等键。退回、迟交、豁免、待批阅、零分分别存储。反馈绑定 submissionId + revision。
- 考试配置状态：draft／published／cancelled；答卷状态、gradingStatus 和 releaseStatus 分列保存。
- 答卷：in_progress → submitted／timed_out；服务端计算 deadlineAt，自动保存用 revision 比较并交换；锁定答卷行后判定截止，交卷后拒绝写答案。
- 服务器每 10 秒扫描到期答卷；重启后从数据库扫描补做。答卷读取也执行到期补偿。随机题序和选项序持久化。
- 简答与综合题人工评分；未全部完成前总分为 null。客观题空答确认为零分，与未交卷／缺考不同。
- 成绩统一发布受批阅完成和考试结束限制；分数、答案、解析分别检查公开时间。学生响应使用字段白名单，隐藏评分规则。
- 练习题及曾经开放过的练习题不能作为保密考试题。作业发布与考试题引用做交叉校验，以防从练习或作业接口绕过保密时间。
- 成绩修改只能经复核流程和 `grade.revise`，保留原分、新分、理由和操作者。
- 通知持久化为 BackgroundJob，失败指数退避重试。通知失败不回滚已完成提交或交卷。未配置邮件和短信，不声称外部投递成功。

## 统计口径

工作台数量通过独立统计查询获取。学习完成率按用户主动确认完成的已开放课时／应完成已开放课时；访问次数与学习时长不等同于掌握程度。

成绩趋势采用每人每项任务最近一次已发布、有效、批阅完成的成绩，统一折算百分制；缺考、未提交、未发布、待批阅和已退回无效版本不当作零分。考试及格线由考试配置决定，作业分析采用 60%。均分、中位数、分布与导出来自同一组有效成绩。更改成绩后即时读取，不使用过期成绩缓存。

练习正确率只统计客观题；知识点正确率为完全答对次数／可自动评分次数，展示样本数，少于 3 个样本标为数据不足。复习建议基于固定规则，不使用 AI。后台默认只展示运行指标，读取个人教学统计需独立授权。

## 阶段与验收

1. 基础工程与权限：迁移、种子、登录和 CSRF、四角色、组织／用户／课程。
2. 教学交流：章节课时、进度、范围受限讨论／私信／班级消息、通知、私有附件。
3. 作业与练习：题目版本、手动／规则组卷、作业版本提交批阅、错题收藏。
4. 考试成绩：时间、资格、稳定乱序、CAS 保存、到期幂等、分时公开、复核历史。
5. 分析后台：规则口径、授权导出、内容治理、配置、审计和任务记录。
6. 真实验证：构建、单元测试、HTTP 业务与安全集成、浏览器交互、性能和恢复。

真实执行结果与未完项见 `docs/acceptance.md`，不把源码存在视作验收通过。

行政班成员关系与选课关系独立：转班立即改变班级交流资格，但不隐式删除既有课程授权。退选旧课和加入新课通过课程成员或教学安排明确操作；历史提交继续保留。

课时图文支持安全 HTML 与私有 PNG/JPEG 图片；图片仅在课时已开放且仍被正文引用时对当前学生开放。课时可以关联同课程的章节练习、作业和考试，学生只收到其有权访问的已发布任务引用。课程成员与公告使用服务端分页。

练习的标记、当前位置和 revision 持久化到 PostgreSQL，冲突返回409。评语与分数、答案、解析分别检查公开时间；省略评语时间时沿用成绩公开时间，总评与单题批注都受这一规则约束。
