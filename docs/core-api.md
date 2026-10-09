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
- `GET /admin/jobs` 继续提供后台任务分页与详情。

实际数据库迁移保留审计操作人的外键保护：仍有审计记录的账号不能硬删除，停用或迁出不改写历史审计。历史账号的原始 ID 仍可用于筛选；不存在或已删除但没有审计记录的 ID 返回空结果，不通过删除外键制造历史数据。

配置 key：dataDictionary、platformName、logoUrl、notificationEnabled、maxUploadMB、allowedFileTypes、features、loginPolicy。安全和功能开关需 settings.platform；实际登录时长、上传策略、通知开关和功能开关由服务端执行。

## 分析

`GET /dashboard` 实际课程、任务、公告与计数。

`GET /planner/actions?bucket=today|upcoming|overdue&page=1&pageSize=10` 返回学生本人的学习行动清单。需要 `learning.use`；课程来源另需 `course.read`、当前空间有效选课和本人受众资格，没有课程权限时仍返回个人待办。`page` 为 1–10000，`pageSize` 为 1–20，不允许客户端指定用户或机构。

响应包含 `{items,counts:{today,upcoming,overdue},total,page,pageSize,bucket,timezone,serverTime,range}`。三桶匹配数与当前页来自同一条数据库查询的快照，在分页前计算，不以日历首 500 行或当前页替代完整计数。逾期为实际时间早于 `serverTime`；今日为当前时间至北京时间明日零点；未来 7 天从明日零点至再后七日零点，右边界不含。今天已过截止的事项只归入逾期。逾期按最近到时优先，其余按时间升序，同时间按类型和 ID 排序。

每条摘要包含 `id/type/title/dueAt/overdue/status/action/actionLabel/path/reason`。个人待办另有 `revision`；作业另有当前课程和 `originalDueAt`，采用本人补交许可后的有效截止，豁免与已经正式提交的作业不进入清单，退回作业重新进入；草稿不代表正式提交。考试采用本人的进入窗口或正在作答答卷的实际期限，入口分别指向考试和本人答卷，允许重试时明确显示“再次考试”。已取消、资格取消、次数用完或关闭窗口的考试不显示为可进入；已经截止且不允许迟交的作业只提供查看入口。

个人完成沿用 `PATCH /planner/tasks/:id {revision,completed:true}` 的版本校验。清单只读接口在查询后复核会话、角色、空间和权限，以及全部贡献课程和当前页任务受众；资格变化返回拒绝，不裁剪旧行后保留旧总数。过程内非当前页受众变化仍遵循第一条查询的计数快照，下一次读取更新。前端拒绝时隐藏旧行、计数和课程入口；普通网络故障可提示并保留上次清单，完成按钮停用，显式重试后恢复。

`GET /analytics?courseId=&classId=&termId=` 返回 metrics、scoreTrend、knowledgePoints、courseProgress、distribution、students、rules。管理员只有运行指标，除非获独立教学统计授权。`GET /analytics/export` 使用相同计算结果并再次授权。

`GET /health` 查询数据库后返回服务健康与服务器时间。

`GET /catalog` 需要登录，返回本机构 `{courseCategories,grades}`。管理员通过 `PATCH /admin/settings`、`key:dataDictionary` 维护两个最多100项的数组，写入审计原因；课程与班级表单使用该字典。未配置时从本机构已有课程/班级的类别和年级生成建议值。

课时新增 `relatedTasks:[{type:"practice"|"assignment"|"exam",id}]`；章节练习ID为章节ID，其余为作业/考试ID，全部必须同课程。学生只收到当前有权访问的引用。`content` 支持安全图文HTML，私有图片引用由服务端提取并保存，不能由请求任意授予附件范围。

`GET /courses/:id/members?page=&pageSize=&kind=teacher|student&search=` 返回 `{items,total,page,pageSize}`。课程详情兼容返回首100位成员摘要和完整memberCount，完整名单与人员选择使用分页接口。课程封面使用可选HTTPS URL `cover`。
