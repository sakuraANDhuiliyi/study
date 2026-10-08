# 交流、通知与私有文件

所有路径带 `/api` 前缀。需要 `lms_session` Cookie，写入请求同时带登录接口返回的 `x-csrf-token`。时间统一为 ISO UTC；显示时换算 Asia/Shanghai。分页使用 `page=1&pageSize=20`，页容量上限 100，返回 `{items,total,page,pageSize}`。错误状态为 400 参数错误、401 会话失效、403 当前范围无权操作、404 不存在、409 业务冲突、413 上传超限。

## 权限与访问范围

| 能力             | 学生                          | 教师                          | 管理员/超级管理员                               |
| ---------------- | ----------------------------- | ----------------------------- | ----------------------------------------------- |
| 课程讨论         | 当前已发布/归档课程；归档只读 | 当前授课课程                  | `course.admin` 与交流权限限定本机构             |
| 标记已解决       | 本人帖子                      | 当前课程                      | 独立 `communication.moderate`                   |
| 置顶、精华、关闭 | 无                            | 当前课程 `course.manage`      | 独立 `communication.moderate`                   |
| 班级交流         | 当前有效行政班成员            | 当前课程关联班级              | 独立 `communication.moderate` 限本机构          |
| 私信             | 同一已发布课程当前授课教师    | 同一已发布课程当前学生        | 不提供私人会话浏览能力                          |
| 举报处理/禁言    | 举报可见内容                  | 当前教学范围，不含私信正文    | 独立 `communication.moderate`，私信仅举报元数据 |
| 私人作业附件     | 本人且仍有课程/作业资格       | 当前课程且 `assessment.grade` | 需要同样的独立评分与课程权限                    |

每次列表、历史、发送、文件下载均重查当前成员资格及活跃用户角色，退出班级、退课、交接或角色撤销后生效。保存历史记录不等于保留访问权。屏蔽阻止双方继续发送私信，不删除既有历史。全机构禁言影响全部交流，课程/班级禁言只影响指定讨论范围。禁言最长 30 天，保留原因与操作者。当前版本只接受纯文本，提交的 HTML 会在服务端过滤成文本。

## 课程讨论

- `GET /communication/posts?courseId=&q=&authorId=&featured=true&createdFrom=&createdTo=&page=&pageSize=`：只返回授权课程，置顶优先、时间与 ID 稳定排序；含 `authorName,replyCount`。`createdFrom/createdTo` 是可独立提供的 ISO 时间，包含边界；起始晚于结束返回带字段错误的 400。查询计数与列表使用同一时间范围。
- `POST /communication/posts`：`{courseId,title,body,attachmentIds?:[],linkType?:"chapter"|"assignment"|"question",linkId?}`。
- `GET /communication/posts/:id?page=&pageSize=`：帖子与当前页 `replies`，回复包含引用 `quote`、作者、附件；`replyPage` 提供总数。引用只能来自同一讨论。
- `POST /communication/posts/:id/replies`：`{body,quoteReplyId?,attachmentIds?:[]}`。
- `PATCH /communication/posts/:id`：`{pinned?,featured?,closed?,solved?}`。作者只能修改自己的 `solved`。关闭与回复写入采用行锁约束。

## 班级和私信

- `GET /communication/contacts?page=&pageSize=&q=`：当前同课程师生联系人，条目 `{id,name,role,courseNames}`。
- `GET /communication/classes`：当前可进入的班级 `{items:[{id,name,grade}]}`。
- `POST /communication/classes/:classId/conversation`：幂等取得班级房间。
- `POST /communication/conversations`：`{userId}`，幂等创建同课程师生会话。
- `GET /communication/conversations?page=&pageSize=`：会话 `id,kind,title,peerId?,lastMessage,unreadCount,updatedAt`。
- `GET /communication/conversations/:id/messages?page=&pageSize=&afterId=`：消息分页。默认第一页是最新一页，页内按时间正序；`afterId` 模式按该 ID 后的时间/ID 顺序补取断线消息，含 `hasMore`。
- `POST /communication/conversations/:id/messages`：`{body,clientId,attachmentIds?:[]}`，`clientId` 长度 8–100，只包含字母数字、横线、下划线。消息唯一键为会话、发送人和客户端 ID；失败重试必须复用同一个 ID，相同 ID 不同内容返回 409。
- `POST /communication/conversations/:id/read`：`{messageId}`，游标只能前进。未读数不计本人发送、隐藏或已撤回消息。
- `DELETE /communication/messages/:id`：本人发送后严格两分钟内撤回，正文和附件引用移除，留下撤回占位与审计。

消息包含 `{id,conversationId,senderId,senderName,body,attachmentIds,attachments,clientId,createdAt,retractedAt}`。客户端只在成功收到服务端响应或同步结果后标为发送成功。

Socket.IO namespace `/notifications`，同源 Cookie，握手 `auth:{csrfToken}`。仅允许与 `APP_ORIGIN` 完全匹配的 Origin；不提供客户端指定的用户或课程房间。连接后收到 `ready`；变化时收到 `invalidate:{resources:["notifications","conversations","messages","discussions"]}`，应使相应 REST 查询失效并补取。每 15 秒重新验证会话并触发补查；会话失效断开。Socket 不传业务正文，所有内容仍走授权 REST。用户身份、权限或课程资格发生变化时，后续 REST 总是重新授权。定时失效消息也是连接丢失后的兜底同步机制。

连接在异步鉴权或加入房间期间断开时不会继续登记会话或创建定时器。同一连接重叠触发的授权重查合并为一次。默认每用户最多 20 个连接、单进程最多 2000 个连接；应用环境变量 `MAX_WEBSOCKETS_PER_USER`、`MAX_WEBSOCKETS_TOTAL` 可调整（硬上限分别为 100、10000）。超过限制的连接会断开，关闭已有标签页后可重新连接。这些限制按单进程计数，不代表容量承诺。

## 举报与治理

- `POST /communication/reports`：`{targetType:"post"|"reply"|"message",targetId,reason}`。
- `GET /communication/reports?status=PENDING|RESOLVED|DISMISSED|ALL&page=&pageSize=`：当前可处理范围的举报。私信举报仅显示报告人提供的原因和目标元数据，`privateContentRestricted:true`；不返回原始私信。
- `POST /communication/reports/:id/resolve`：`{action:"hide"|"dismiss",reason}`。私信不能通过该接口隐藏/查看；可记录处理结论。处理与审计写入同一事务。
- `POST /communication/mutes`：`{userId,courseId?,classId?,expiresAt,reason}`，课程与班级只能选一个；教师不能创建全机构禁言。
- `GET /communication/mutes` / `DELETE /communication/mutes/:id`：查看当前范围有效禁言/提前解除。
- `GET /communication/blocks` / `POST /communication/blocks {userId}` / `DELETE /communication/blocks/:userId`：本人屏蔽列表及修改。

## 通知

- `GET /notifications?page=&pageSize=&type=&unread=true`：分页通知，加总 `unreadCount`。
- `POST /notifications/:id/read` / `POST /notifications/read-all`：单条/全部已读，只操作本人数据。

通知使用持久化后台任务与 `(userId,eventKey)` 去重。消息事务成功后通知入队；通知错误不会回滚已发送消息。通知正文只包含行为摘要，私信内容始终需要进入当前可访问的会话查看。邮件和短信未配置，不伪造发送成功。

## 附件

- `POST /attachments`：multipart `file` 与可选 `courseId`、`conversationId`、`assignmentId`；最多指定一个业务范围。未指定时为本人私有文件。
- 返回 `{id,name,mime,size}`，不返回存储键或公开 URL。
- `GET /attachments/:id/download`：重新校验当前业务范围，返回 `Content-Disposition: attachment` 和 `Cache-Control: private,no-store`。
- `GET /attachments/:id/preview`：同样的即时授权，图片/PDF/MP4 支持 `inline` 预览；其余类型须下载。预览增加 `nosniff` 与沙箱 CSP。
- `DELETE /attachments/:id`：仅本人可删除当前未被讨论、消息、课时、作业或提交版本引用的普通附件。已引用附件和归档导出文件返回 409。

运行时上限为 `min(MAX_UPLOAD_MB, 机构 maxUploadMB, 50)` MB，未指定环境变量时默认 10 MB。机构 `allowedFileTypes` 能进一步限制类型。字节、扩展名与 MIME 必须匹配，支持 PNG/JPEG/GIF/WebP、PDF、无宏 DOCX/XLSX/PPTX、UTF-8 TXT/CSV、MP4。SVG、HTML、执行文件、含脚本 PDF、可疑/含宏 Office 均不支持。文件名清理路径与控制字符；文件实际以服务端随机 UUID 存储，目录不是静态资源目录。

接收 multipart 数据前执行权限、容量预留和并发检查，并按当前机构单文件上限设置解析器限制；请求体接收最多 60 秒。默认累计配额为用户 1 GiB/1000 个文件、机构 10 GiB/20000 个文件；用户最多 2 个、整个平台最多 8 个在途上传/导出，每用户每分钟 20 次。配额、速率和并发租约存储在 PostgreSQL，多个实例共享同一限制；导出也计入累计容量。环境变量为 `MAX_USER_UPLOAD_MB`、`MAX_ORG_UPLOAD_MB`、`MAX_USER_UPLOAD_FILES`、`MAX_ORG_UPLOAD_FILES`、`MAX_UPLOADS_PER_USER`、`MAX_UPLOADS_TOTAL`、`UPLOADS_PER_MINUTE`。

普通上传按当前单文件上限预留容量，完成后按实际大小计费；剩余容量不足以预留上限时会返回 413。失败或进程中断的文件在移除后释放预留；一分钟一次的后台维护回收过期租约。未被任何业务引用过的文件默认 24 小时回收（`UNUSED_UPLOAD_TTL_HOURS`），已经用于业务的文件保留历史，删除前重新检查所有引用。数据库触发器在业务写入事务中标记引用并锁定附件，避免新引用与回收竞态。

PDF 上传和 AI 来源下载共用独立进程内的成熟解析器，检查解码名称、引用和压缩对象流；拒绝活动内容、加密、损坏、未知过滤器及资源超限，不能仅用原始关键词判定。解析限制为 5 秒、2 并发、128 MiB 堆、16 MiB 单流解压、64 MiB 累计解压分配，并有对象、深度和输出上限；未知情况拒绝文件。

课程文件必须关联当前开放课时、已发布作业说明或未隐藏讨论后才允许其他学生下载。尚未被任何业务引用的文件仍只属于上传者，授课教师不能仅凭课程权限下载其他人的未发送草稿。课程管理权限允许读取已绑定的未来课时资源；隐藏讨论附件要求该课程教师的治理权限或机构内容治理权限。课时主附件与图文内容中经过服务端验证的内联图片使用同一开放时间规则；移除最后一个有效引用后，旧图片链接也会重新拒绝访问。会话文件必须关联仍有效消息，撤回/隐藏后其他人不能继续使用旧链接，关闭交流功能后旧会话文件链接也不可访问。

学生作业附件正式提交前仅本人可访问；保存草稿不授予教师下载权限。提交后仅本人或当前有评分权限的教师可访问，已归档课程的正式提交保留当前教师阅读权限。个人上传文件被作业说明引用后，学生仍须满足已发布、已开放、参考对象和当前课程资格；不能通过文件 ID 绕过上述条件。同一个个人附件被多个正式提交引用时，在请求者当前授权课程内寻找有效引用，不依赖数据库任意返回的首个提交。上传者退课后，课程/会话/作业范围附件同样失去访问权；未绑定业务范围的个人原始文件仍归本人所有。存储通过 `PrivateStorage` 接口实现，本地 `LocalPrivateStorage` 可替换为使用私有对象的 S3 适配器。

## 作业提交资料批量归档

- `POST /attachments/assignments/:id/export {clientId}`：需 `assessment.grade`、独立授予且尚未过期的 `data.export`、当前课程阅读范围。`clientId` 为 8–100 位字母数字/横线/下划线，重试复用同一 ID。返回 `{jobId,status}`。
- `GET /attachments/exports/:jobId`：仅申请人；同样重新验证权限。返回状态 `PENDING/RUNNING/SUCCEEDED/FAILED`、尝试次数、错误摘要，成功时返回 `attachmentId`。
- 使用普通 `/attachments/:id/download` 下载私有 TAR.GZ，下载时再次校验申请人、当前权限与课程范围。不会创建永久公开链接。

后台任务持久化、可重试与回收过期锁，每 20 秒续约运行锁。任务在开始和文件落库前重新检查当前会话。`exportJobId` 唯一键使重复执行只产生一个有效结果。TAR.GZ 包含 UTF-8 `manifest.json`（所有提交版本、在线答案、分数状态、批注历史、原始文件名、附件 SHA-256）和按提交版本组织的原文件；不包含密码或会话信息。归档文件不能重新作为普通作业附件提交或发布。

为避免大导出耗尽内存，单次上限为 500 个提交版本、20 MB 原始答案/批注 JSON、30 MB 格式化清单、默认 100 MB 附件（`MAX_ASSIGNMENT_EXPORT_MB` 可调，硬上限 500 MB）。超限明确拒绝，不生成截断资料。流式 TAR/GZIP 不把附件整包读入内存。归档申请、完成、下载留审计，日志不记录答案正文。已归档课程仍可在当前教学授权和独立导出权限有效时导出历史。

## 验证方法

```sh
node --import tsx --test tests/communication.unit.test.ts tests/communication.gateway.unit.test.ts tests/archive.unit.test.ts
node --import tsx --test tests/communication.integration.ts
# 安全回归需自行准备独立数据库/API配置；下例为本次审查使用的本机文件。
# TEST_API_URL 必须包含 /api，APP_ORIGIN 必须与目标 API 一致。
DOTENV_CONFIG_PATH=.data/review.env TEST_API_URL=http://127.0.0.1:3002/api node --import tsx --test tests/communication.security.integration.ts
```

集成测试要求真实数据库已迁移、种子账号已初始化、API 正在运行，使用 `.env` 中开发账号密码；可通过 `TEST_API_URL` 指定含 `/api` 的服务地址。套件创建独立课程、班级与账号，完成后归档课程、停用测试账号，保留历史和审计。验证讨论时间筛选、引用回复、XSS 过滤、文件类型和范围、课时图片开放与撤销、私信边界、消息幂等、补取、未读游标、举报禁言、退课权限、真实 WebSocket 来源/CSRF 及注销断开。作业归档生成、版本清单与下载授权撤销由 `tests/assessment.integration.ts` 另外覆盖。

2026-10-08 在本机执行交流、归档与 WebSocket 单元测试 14/14；独立审查 PostgreSQL 与 NestJS API 上的交流集成测试 11/11（包含 10 个业务子场景与父测试）、附件安全回归 5/5（4 个业务子场景与父测试），均无跳过。安全回归覆盖草稿保密、有效引用、未来开放时间、说明附件、不同课程复用和授权撤销。最终跨模块验收以验收文档为准。
