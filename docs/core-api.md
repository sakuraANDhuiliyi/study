# 基础 API 约定

API 前缀 `/api`，UTC ISO 时间，JSON 请求体。成功返回资源或 `{items,total,page,pageSize}`，默认每页 20，最多 100。资源不存在 404，未登录 401，范围或操作不允许 403，版本冲突 409，校验失败 400，限流 429。错误包含 `error.message`、可选 `error.fields` 和 `requestId`。

交互式 OpenAPI：`/api/docs`，JSON：`/api/openapi.json`。测评和交流细节见同目录 `assessment-api.md`、`communication-api.md`。

## 认证

- `POST /auth/login {username,password}` → `{user:{id,name,username,organizationId,roles,role,permissions},csrfToken}`，并设置 HttpOnly Cookie。
- `GET /auth/me` → 同上。后续写请求必须包含 `x-csrf-token`；浏览器 Origin 必须等于 APP_ORIGIN。
- `POST /auth/role {role}` → 新上下文、新 CSRF。只能使用已授予的角色。
- `POST /auth/logout {}` 清除会话。
- `PATCH /auth/profile {name}` 更新本人名称。
- `POST /auth/password {oldPassword,newPassword}` 修改后所有旧会话失效，需重新登录。
- `GET /auth/recovery` 查看本人是否已预留恢复码；`POST /auth/recovery-code {oldPassword}` 生成新的高熵恢复码，只返回给本人一次，轮换会使旧码和恢复许可失效。
- `POST /auth/recover {username,code,newPassword}` 在管理员已开启的 15 分钟许可内消费本人恢复码，无需登录；仍检查请求来源并执行数据库限流。成功后恢复码作废，全部旧会话和敏感授权撤销。

## 课程

- `GET /courses?page=1&pageSize=20&search=…&status=PUBLISHED` 当前可见列表。
- `GET /courses/:id` 章节、已开放课时、进度；非学生附课程名单。
- `POST /courses {title,description?,category?,teacherId?,termId?}`，教师只能负责自己创建的课程，后台必须指定有效教师。
- `PATCH /courses/:id {title?,description?,category?,teacherId?,termId?,status?}`；教师交接需 course.admin。
- `POST /courses/:id/chapters {title,sortOrder?}`；`PATCH /chapters/:id {title?,sortOrder?}`。
- `POST /chapters/:id/lessons {title,content?,type?,resourceUrl?,attachmentId?,opensAt?,sortOrder?}`；`PATCH /lessons/:id` 同字段。类型 TEXT、VIDEO、PDF、DOCUMENT、LINK。resourceUrl 只允许 http(s)，私有文件用 attachmentId。
- `PUT /lessons/:id/progress {completed,positionSeconds?}` 本人保存与恢复。
- `GET /courses/:id/members` 教师／管理员读取名单；`POST … {userId,kind:'student'|'teacher'}`；`DELETE /courses/:id/members/:userId?kind=student` 停用关系。
- `GET/POST /announcements`；创建 `{courseId?,title,content}`，机构公告需 org.manage。

## 后台

- `GET /admin/users?search=&role=&active=&page=&pageSize=`。
- `POST /admin/users {username,name,password,studentNo?,roles:string[]}`。
- `PATCH /admin/users/:id {name?,active?,studentNo?,roles?}`，拒绝自身权限变更，管理员只能操作学生／教师。所有已有账号禁止通过此接口设置密码。
- `POST /admin/users/:id/recovery` 开启 15 分钟恢复许可，需要 `users.manage` 和相同目标管理边界；目标必须已由本人预留恢复码。事务先锁定目标 User，再复核当前机构、机构账号模式、角色上限与启用状态；与退出机构、迁移或角色更新并发时，按锁内当前状态拒绝过期操作。管理员拿不到恢复码，也不能指定新密码。
- `POST /admin/users/import {rows:[…新增账号字段],commit:false}` 先预览；全量通过后 `commit:true` 事务导入。错误 `{row,message}`；返回预览不会含密码。
- `GET /admin/users/template` CSV 模板；`GET /admin/users/export` 当前权限复查后直接下载，无永久导出链接。
- `POST /admin/users/batch {ids,active}` 每项独立授权并返回结果。
- `GET /admin/people?role=&search=&page=&pageSize=` 教师范围缩到自己课程的人员，管理员限本机构。
- `GET/POST /admin/classes`，创建 `{name,grade,termId?}`；`PATCH /admin/classes/:id {name?,grade?}`。
- `GET /admin/classes/:id/members`；`POST … {userId,active?,transferFrom?}` 转班保留旧记录。
- `POST /admin/classes/:id/courses {courseId,name?}` 创建教学班关联，将当前有效班级成员加入课程；后续转班需显式调整选课关系。
- `GET/POST /admin/terms`，创建 `{name,startsAt,endsAt}`。
- `GET/POST /admin/organizations` 需 org.platform，创建 `{name}`。
- `GET /admin/roles`；`PATCH /admin/roles/:id {permissions,reason}` 需 roles.manage，拒绝修改自身角色和超出授权上限。
- `POST /admin/grants {userId,permissionId,reason,expiresAt}` 独立敏感授权，最长 30 天，拒绝自行授予。
- `GET /admin/settings` → `{items:[{key,value}]}`；`PATCH … {key,value,reason}`。
- `GET /admin/audit?search=&action=&actorId=&resourceType=&resourceId=&requestId=&from=&to=&page=&pageSize=` 需 `audit.read`，范围固定为当前机构。组合条件为 AND；`search` 在操作、资源类型／标识、追踪 ID 中做大小写无关的字面子串匹配，旧 `action` 保留原大小写敏感 contains 语义。`from/to` 为含时区偏移的 ISO 瞬间，双端包含；界面明确按北京时间输入到秒，不自动扩展结束日期。已删除或迁出的操作人可以用原始 ID 筛选，姓名只关联当前机构成员，否则显示“历史账号”；空操作人显示“系统”。返回原 `{items,total,page,pageSize}`，计数与稳定分页来自同一查询快照，读取后复核当前会话与权限。
- `POST /admin/audit/export {search?,action?,actorId?,resourceType?,resourceId?,requestId?,from?,to?,limit?}` 使用相同筛选，严格拒绝机构／用户覆盖与列表分页字段。当前所选角色必须同时具有 `audit.read`、`data.export`，并持有当前机构的独立限时导出授权；超级管理员和误设非敏感的权限配置都不能跳过独立授权。`limit` 为 1–5000 的整数，默认 5000；按最新记录优先，覆盖筛选结果，不限当前列表页。
- 导出直接返回 `audit-records.csv` 附件，UTF-8 BOM、CRLF、公式保护，至多 8 MiB。只含审计 ID、UTC 时间、操作人 ID／名称、操作、资源类型／标识与追踪 ID，排除详情正文。`X-Export-Matched-Count`、`X-Export-Record-Count`、`X-Export-Truncated` 说明同一数据快照的总数、实际数与数量上限限制；没有匹配记录时返回仅表头的文件，超出字节上限返回 413，不发送部分文件。准备和发送前均复核当前会话与授权；审计 `admin.audit.export` 的 `deliveryState:prepared` 表示准备完成，不宣称客户端已收件。
- 第十四轮合同（完整本机验收通过）：`GET /admin/jobs?action=&status=&page=&pageSize=` 需要当前 `audit.read`。`action` 仅在 `kind` 中做大小写无关的字面包含匹配，最多 200 字符；百分号、下划线和反斜杠不是通配符，非空关键词保留空白。`status` 为 `ALL`（默认）、`PENDING`、`RUNNING`、`SUCCEEDED`、`FAILED`。分页保留原取整与限幅：默认第 1 页、每页 20 项，最大页码 100000、每页 100 项。已知字段拒绝重复参数、对象／数组、NUL 和过长文本；机构、用户、角色、权限或会话覆盖字段不能改变服务器授权范围。
- 返回 `{items,total,page,pageSize,examDeadlineRuns,stateCounts,scope,serverTime}`。`stateCounts:{pending,running,succeeded,failed,other,all}` 按已应用类型关键词和服务器机构范围完整计数，忽略当前 `status`；列表 `total` 再应用该状态条件。`all` 包含未知存储状态的 `other`，不能由当前页或四种已知状态之和代替。任务按创建时间倒序、ID 升序稳定分页。
- `scope:platform_institutions` 仅由当前 `org.platform` 决定，覆盖全部 `INSTITUTION`，包含停用机构、排除个人空间；没有该权限时为 `current_organization`，只返回当前机构。角色名称本身不授予平台范围，也没有客户端机构选择器。每行只返回 `id,kind,status,attempts,runAt,lastError,createdAt,organizationId,organizationName`；不返回 `payload,eventKey,details,metadata`，也不虚构后台任务完成时间。最近错误按文本显示；带错误的 `PENDING` 不改称 `FAILED`。
- `examDeadlineRuns` 保留平台权限下独立的全局考试截止处理最近 20 次运行记录，按开始时间倒序、ID 倒序；不受任务类型／状态条件影响，不计入后台任务列表或六项概览。普通范围返回空数组，查询不读取该全局表。
- 任务行、总数、状态概览和可选全局运行记录来自同一个 SQL 语句快照；`serverTime` 是该语句开始的 ISO 时间，界面按北京时间显示，不代表任务完成时间。所有私有读取完成后重新解析当前会话，核对账号、机构、所选角色、账号模式和 CSRF，重新要求 `audit.read`，并核对捕获的 `org.platform` 是否仍一致；范围改变时拒绝旧结果。这一语句快照不保证返回瞬间全局状态不再变化。
- 后台任务界面将草稿与已应用筛选分开，应用／重置回到第 1 页，刷新沿用已应用条件。只读展示和分页；不新增任务创建、执行、重试、删除、取消或 cron 设置。成功空结果显示真实 0；加载、权限拒绝和普通错误不伪装成 0。完整授权与 CSRF 隔离缓存，读取响应头和正文后先核对当前身份，再处理 401；当前 4xx 撤回本域所有筛选／分页旧行和计数，覆盖导航返回和此前在途请求。普通故障仅可带提示保留已授权快照，新成功读取后才恢复被拒绝数据。

实际数据库迁移保留审计操作人的外键保护：仍有审计记录的账号不能硬删除，停用或迁出不改写历史审计。历史账号的原始 ID 仍可用于筛选；不存在或已删除但没有审计记录的 ID 返回空结果，不通过删除外键制造历史数据。

配置 key：dataDictionary、platformName、logoUrl、notificationEnabled、maxUploadMB、allowedFileTypes、features、loginPolicy。安全和功能开关需 settings.platform；实际登录时长、上传策略、通知开关和功能开关由服务端执行。

## 分析

`GET /dashboard` 返回实际课程、任务、公告与 `metrics`。机构学生工作台使用以下两张卡片；教师和管理员保留原指标与读流程，个人空间首页仍使用专业学习中心。学生接口同时要求当前 `learning.use` 和 `course.read`，不允许客户端指定用户或机构。缺少课程权限时不请求旧工作台，独立的个人行动清单仍按 `learning.use` 授权。

| 学生卡片       | 计数口径                                                                                                |
| -------------- | ------------------------------------------------------------------------------------------------------- |
| 当前待交作业   | 当前已开放、未正式提交或最新正式提交被退回、且仍可提交的作业；说明为“未交或退回且现在可提交，不限7天”。 |
| 当前可作答考试 | 当前可以新进入或继续本人答卷的考试，每场最多计一次；说明为“现在可进入或继续作答，尚未开始不计入”。      |

两项只计算当前机构、本人有效选课、已发布或已归档课程中的已发布任务，并要求本人受众资格。概览完整数据库聚合不限 7 天，不依赖下方行动页、日历首 500 行或旧工作台任务摘要。卡片值仍来自 `metrics[].value`，没有新增独立 `counts` 对象。

作业还须未被豁免且正式提交次数未达到原次数加本人额外次数。有效截止为原始 `dueAt` 与本人 `allowUntil` 的较晚值；允许迟交或有效截止不早于本次服务器时间时才可提交，截止相等仍允许。草稿不算正式提交；已交作业即使还可以自愿重交，也不算“待交”。未来超过 7 天才截止但现在已开放的作业仍计入。

考试还须成绩未公开且本人仍可参考。正在作答以本人答卷 `deadlineAt` 严格晚于本次服务器时间为准，即使一般入场窗口已关闭也可继续。新进入要求考试已经开始、本人覆盖的入场截止（没有覆盖时用一般 `entryClosesAt`）严格晚于本次时间，并有剩余次数。未来未开始不计入；已取消的历史答卷在资格恢复且满足窗口、次数时可以再次进入，但那次仍消耗次数；考试本体取消始终排除。

`GET /dashboard` 和 `GET /planner/actions` 都不会替过期 `in_progress` 答卷执行清算，也不会凭剩余次数把它当新入场。答卷读取、开始或交卷按既有 API 清算后，下次只读统计才反映新状态；实际提交或进入仍重新校验当时权限、个人安排和时间。

学生响应附加 `learningOverview: {serverTime, timezone:"Asia/Shanghai", scope:"actionable_now"}`，其中 `serverTime` 是本次统一计算时间的 ISO 字符串。元信息缺失时前端兼容原 `metrics`；显示时采用北京时间。统计先读取完整事实，再验证当前身份，末端完整 SQL 同时复核既有课程／任务摘要资格并重算全部计数，只返回末端计数，之后再次验证会话、当前机构、模式、角色、CSRF 和双权限。它描述有限语句快照，不保证全局串行化或返回后资格不再变化。

概览独立加载和刷新，首次慢读或错误不阻止行动清单及本人待办版本操作。缓存与迟到响应按账号、机构、角色、账户模式、完整角色／有效权限和 CSRF 隔离；处理响应头、JSON 与 401 事件前再次判断当前范围。当前 4xx 拒绝隐藏该范围的旧卡片、课程和入口，卸载再进入也须新授权成功才能恢复；普通网络故障只可明确提示上次授权快照，不能伪装零。

`GET /planner/actions?bucket=today|upcoming|overdue&page=1&pageSize=10` 返回学生本人的学习行动清单。需要 `learning.use`；课程来源另需 `course.read`、当前空间有效选课和本人受众资格，没有课程权限时仍返回个人待办。`page` 为 1–10000，`pageSize` 为 1–20，不允许客户端指定用户或机构。

响应包含 `{items,counts:{today,upcoming,overdue},total,page,pageSize,bucket,timezone,serverTime,range}`。三桶匹配数与当前页来自同一条数据库查询的快照，在分页前计算，不以日历首 500 行或当前页替代完整计数。逾期为实际时间早于 `serverTime`；今日为当前时间至北京时间明日零点；未来 7 天从明日零点至再后七日零点，右边界不含。今天已过截止的事项只归入逾期。逾期按最近到时优先，其余按时间升序，同时间按类型和 ID 排序。

每条摘要包含 `id/type/title/dueAt/overdue/status/action/actionLabel/path/reason`。个人待办另有 `revision`；作业另有当前课程和 `originalDueAt`，采用本人补交许可后的有效截止，豁免与已经正式提交的作业不进入清单，退回作业重新进入；草稿不代表正式提交。考试采用本人的进入窗口或正在作答答卷的实际期限，入口分别指向考试和本人答卷，允许重试时明确显示“再次考试”。考试本体取消、仍失去参考资格、次数用完或关闭窗口时不显示为可进入；历史答卷取消后恢复资格且还有有效窗口与次数时可再次考试。已经截止且不允许迟交的作业只提供查看入口。

个人完成沿用 `PATCH /planner/tasks/:id {revision,completed:true}` 的版本校验。清单只读接口在查询后复核会话、角色、空间和权限，以及全部贡献课程和当前页任务受众；资格变化返回拒绝，不裁剪旧行后保留旧总数。过程内非当前页受众变化仍遵循第一条查询的计数快照，下一次读取更新。前端拒绝时隐藏旧行、计数和课程入口；普通网络故障可提示并保留上次清单，完成按钮停用，显式重试后恢复。

`GET /analytics?courseId=&classId=&termId=` 返回 metrics、scoreTrend、knowledgePoints、courseProgress、distribution、students、rules。管理员只有运行指标，除非获独立教学统计授权。`GET /analytics/export` 使用相同计算结果并再次授权。

`GET /health` 查询数据库后返回服务健康与服务器时间。

`GET /catalog` 需要登录，返回本机构 `{courseCategories,grades}`。管理员通过 `PATCH /admin/settings`、`key:dataDictionary` 维护两个最多100项的数组，写入审计原因；课程与班级表单使用该字典。未配置时从本机构已有课程/班级的类别和年级生成建议值。

课时新增 `relatedTasks:[{type:"practice"|"assignment"|"exam",id}]`；章节练习ID为章节ID，其余为作业/考试ID，全部必须同课程。学生只收到当前有权访问的引用。`content` 支持安全图文HTML，私有图片引用由服务端提取并保存，不能由请求任意授予附件范围。

`GET /courses/:id/members?page=&pageSize=&kind=teacher|student&search=` 返回 `{items,total,page,pageSize}`。课程详情兼容返回首100位成员摘要和完整memberCount，完整名单与人员选择使用分页接口。课程封面使用可选HTTPS URL `cover`。
