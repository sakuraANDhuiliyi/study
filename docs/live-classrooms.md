# 课程互动直播

本功能把课程预约、音视频课堂、举手审批、课堂消息与成员管理接入现有网站。音视频使用独立部署的开源 LiveKit 1.13.10；不依赖 LiveKit Cloud，不调用收费 AI 或判题服务。第一版不包含录制、回放、白板或人脸/注意力识别。

## 使用

- 教师在侧栏“互动直播”或课程“互动直播”页签进入，选择本人授权课程、填写主题、北京时间及人数上限后预约。课程已发布才能开播，同一课程同时最多一场直播。
- 学生只看到本人已选课程的课堂。点击“进入课堂”后默认仅观看与收听，不自动开启设备；举手后由教师批准，才可以手动开启麦克风和摄像头。
- 教师可以共享屏幕、允许或收回连麦、全员下麦、禁言、移出成员。移出后该用户本场无法重新加入。结束课堂后不可重新开播，需要另建预约。
- 摄像头、麦克风、系统屏幕录制仍需要本人浏览器/系统授权。浏览器禁止自动播放时点击“启用声音”。手机浏览器可以观看、开麦和使用摄像头；屏幕共享以桌面浏览器为主，实际能力取决于设备。
- 课堂消息是纯文本，最近50条可见；支持提交去重，每人10秒最多5条，每场最多5000条。机构交流开关及读写权限同样约束课堂消息。

机构管理员在“机构配置 → 平台功能开关”控制直播入口对应的接口权限。管理员仅管理本机构、教师仅管理当前被授权的课程，平台角色也不跨机构读取课堂内容。

## 部署到现有 Ubuntu Docker 网站

### 1. 获取升级代码并应用迁移

保留现有 `.env`、`config.yaml`、`compose.override.yaml` 和数据卷，不重置数据库。迁移 `202610170029_live_classrooms` 新建课堂、成员及消息表。生产迁移仍通过现有 migrate 容器，运行账号权限由原有脚本补充。

### 2. 初始化媒体配置

在 `/opt/study` 用 root 或 UID 1000 执行，公网 IPv4 改为媒体服务器实际地址；当前部署同机时为 `123.207.184.119`：

```bash
cd /opt/study
node scripts/livekit-selfhost.mjs --init --node-ip=123.207.184.119
node scripts/livekit-selfhost.mjs --check
```

生成 `deploy/livekit/.env` 和 `deploy/livekit/livekit.yaml`，均为权限600的私有文件；容器配置归 UID 1000。命令不输出密钥，不覆盖已有配置。两文件均排除出 Git 和 Docker 构建上下文。媒体配置中的 `rtc.node_ip` 必须与实际媒体服务器公网IP相同。

API 配置为 `LIVEKIT_ENABLED=true`、`LIVEKIT_URL=http://livekit:7880`、独立的 `LIVEKIT_API_KEY` 和 `LIVEKIT_API_SECRET`。这些由附加 Compose 配置注入，现有 AI/Judge0 的 `config.yaml` 不用修改。

### 3. 增加网站 Nginx 路由

把 `deploy/livekit/nginx.location.conf` 中的 `location` 完整加入现有 `study.huiliyi.cn` 的 HTTPS `server {}` 中，与原 `location /` 并列。不要创建第二个同域名 server，也不要替换原站点。然后执行：

```bash
nginx -t && systemctl reload nginx
```

浏览器信令通过本站 `/api/live/media/` 到网站后端，再经登录、课程资格、课堂状态和连麦授权校验转发。使用现有网站证书，不需要新域名或新证书。此路径包含短期凭证，示例关闭其访问日志；其他代理或监控也不得记录这一路径的原始查询参数。

### 4. 启动

以下命令适用于已经有 `compose.override.yaml` 的当前部署。新部署没有该文件时去掉对应 `-f` 参数。每次维护都要保留同一组参数，避免意外禁用直播环境变量。

```bash
cd /opt/study
docker compose --env-file .env --env-file deploy/livekit/.env \
  -f compose.yaml -f compose.override.yaml -f deploy/livekit/compose.yaml \
  config --quiet

docker compose --env-file .env --env-file deploy/livekit/.env \
  -f compose.yaml -f compose.override.yaml -f deploy/livekit/compose.yaml \
  up --build -d
```

不要把展开后的 `docker compose config` 输出发到聊天或保存到公共日志，其中包含密钥。示例仅发布媒体 TCP 7881、UDP 7882；LiveKit 7880 不发布到宿主机公网，防止绕过网站的准入校验。媒体服务以非root、只读文件系统运行，默认限制2 CPU/2 GiB；同机还有Judge0和数据库，实际人数需压测，不承诺100人容量。

在云安全组和宿主防火墙允许媒体服务器的 **TCP 7881、UDP 7882** 入站，网站 HTTPS 443 保持原配置。部分校园/企业网络同时限制UDP及直连TCP时，需要另配TURN/TLS；本版基础部署没有自动搭建TURN，不能保证此类网络可连接。不要为排障公开7880。

### 5. 验证

```bash
docker compose --env-file .env --env-file deploy/livekit/.env \
  -f compose.yaml -f compose.override.yaml -f deploy/livekit/compose.yaml \
  exec -T app node scripts/check-livekit.mjs
```

此检查只验证服务端认证，不创建课堂或发送音视频。实际验收必须分别用教师、已选课学生登录两台设备或两个独立浏览器会话，验证：预约/开播、默认观看、双向音视频、屏幕共享、举手批准、下麦、禁言、移出、结束，以及手机网络和目标校园网络。浏览器开发工具可确认媒体收发统计持续增长。共享屏幕时的系统音频能力由操作系统及浏览器决定。

## 权限与一致性

- 使用网站的同源HTTPOnly Cookie及写接口CSRF，不向客户端提供管理密钥或 LiveKit roomAdmin 权限；学生的屏幕共享和数据通道发布也被服务端限制，聊天走授权HTTP接口。
- 自建LiveKit不自动撤销旧JWT，因此不能只依赖短TTL。所有浏览器信令及重新连接都经过网站网关，检查签名、当前会话、一次进入对应的连接标识、课程资格、课堂状态和当前发布权限。务必保持原始7880只能由网站可信后端访问。
- 初次进入凭证有效60秒；已建立信令每5秒重新检查网站资格，过期会话、移出、选课撤销或功能关闭会导致断开。5秒是信令资格检查间隔，不代表设备或网络媒体必然在5秒内停止；媒体服务清理和网络超时还会影响实际停止时间。LiveKit内部刷新凭证不延长网站会话。
- 同一账号同一课堂以最近一次进入为准；旧标签页不能继续心跳或退出新连接。设备关闭与页面离开会停止本地音视频轨道。
- 课堂状态和成员审批使用数据库锁及版本校验；人数预留与发言限频在锁内完成。媒体权限同步失败会关闭对应信令，并保留待同步状态进行重试；结束状态先落库，即使媒体服务故障也不能重新加入。
- 最长单场8小时；结束或超时的媒体清理会重试。页面在场秒数仅累计服务器接收到的连续心跳间隔，超过45秒的间隔不累计。这是页面在场记录，不等于有效学习时长、注意力或正式考勤成绩。
- 当前附加部署面向单网站API实例。多实例时应另做连接撤销广播及媒体路由设计，不将本机连接注册表当作集群全局状态。

## 开发与验收

Node 24 LTS及项目依赖安装后：

```bash
node scripts/setup-livekit.mjs
npx playwright install chromium firefox webkit
npm run build
DOTENV_CONFIG_PATH=.data/review.env node --import tsx --test tests/live.integration.ts tests/live-browser.integration.ts
node --env-file=.data/review.env scripts/verify-iteration.mjs
```

配置必须是本机、名称含review的测试数据库，且用户具有CREATEDB权限。直播测试只新建和删除自己随机创建的测试库、端口和子进程，不改生产数据库或现有服务。固定媒体二进制经SHA256校验，保存在忽略目录`.data/tools`。三浏览器验收使用合成摄像头、音频和屏幕源，经真实WebRTC/LiveKit收发，验证收包统计；不能替代真实摄像头、麦克风及操作系统权限弹窗的人工验收。

官方参考：

- [LiveKit媒体发布](https://docs.livekit.io/transport/media/publish/)
- [访问凭证与自建撤销限制](https://docs.livekit.io/frontends/reference/tokens-grants/)
- [成员管理](https://docs.livekit.io/intro/basics/rooms-participants-tracks/participants/)
- [固定版本媒体配置](https://github.com/livekit/livekit/blob/v1.13.10/config-sample.yaml)
- [端口和防火墙](https://docs.livekit.io/transport/self-hosting/ports-firewall/)
