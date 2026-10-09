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
- `GET /admin/audit?action=&page=&pageSize=`、`GET /admin/jobs`。

配置 key：dataDictionary、platformName、logoUrl、notificationEnabled、maxUploadMB、allowedFileTypes、features、loginPolicy。安全和功能开关需 settings.platform；实际登录时长、上传策略、通知开关和功能开关由服务端执行。

## 分析

`GET /dashboard` 实际课程、任务、公告与计数。

`GET /analytics?courseId=&classId=&termId=` 返回 metrics、scoreTrend、knowledgePoints、courseProgress、distribution、students、rules。管理员只有运行指标，除非获独立教学统计授权。`GET /analytics/export` 使用相同计算结果并再次授权。

`GET /health` 查询数据库后返回服务健康与服务器时间。

`GET /catalog` 需要登录，返回本机构 `{courseCategories,grades}`。管理员通过 `PATCH /admin/settings`、`key:dataDictionary` 维护两个最多100项的数组，写入审计原因；课程与班级表单使用该字典。未配置时从本机构已有课程/班级的类别和年级生成建议值。

课时新增 `relatedTasks:[{type:"practice"|"assignment"|"exam",id}]`；章节练习ID为章节ID，其余为作业/考试ID，全部必须同课程。学生只收到当前有权访问的引用。`content` 支持安全图文HTML，私有图片引用由服务端提取并保存，不能由请求任意授予附件范围。

`GET /courses/:id/members?page=&pageSize=&kind=teacher|student&search=` 返回 `{items,total,page,pageSize}`。课程详情兼容返回首100位成员摘要和完整memberCount，完整名单与人员选择使用分页接口。课程封面使用可选HTTPS URL `cover`。
