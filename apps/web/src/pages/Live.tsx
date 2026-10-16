import { useEffect, useRef, useState } from 'react';
import {
  Alert,
  App,
  Button,
  Form,
  Input,
  InputNumber,
  List,
  Modal,
  Pagination,
  Popconfirm,
  Select,
  Space,
  Tag,
} from 'antd';
import { Camera, CameraOff, Hand, Mic, MicOff, MonitorUp, Radio, Volume2 } from 'lucide-react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import {
  ConnectionState,
  Room,
  RoomEvent,
  Track,
  type Participant,
  type TrackPublication,
} from 'livekit-client';
import { date, send, useData } from '../api';
import { useAuth } from '../auth';
import { EmptyState, PageTitle, Panel, QueryState } from '../components/shared';
import { RemoteSelect } from '../components/RemoteSelect';
import './live.css';

type Member = {
  id: string;
  name: string;
  host: boolean;
  state: string;
  approved: boolean;
  handRaised: boolean;
  chatMuted: boolean;
  online: boolean;
  revision: number;
  attendanceSeconds: number;
};
type Classroom = {
  id: string;
  title: string;
  courseId: string;
  courseTitle: string;
  status: string;
  revision: number;
  scheduledAt: string;
  maxParticipants: number;
  canManage: boolean;
  canChat: boolean;
  chatAvailable: boolean;
  cleanupPending: boolean;
  own: Member | null;
  members: Member[];
  messages: { id: string; name: string; text: string; createdAt: string }[];
  provider: { available: boolean; reason: string };
};
type Admission = {
  token: string;
  path: string;
  identity: string;
  connectionId: string;
  approved: boolean;
  host: boolean;
};
const statuses: Record<string, string> = { SCHEDULED: '待开始', LIVE: '直播中', ENDED: '已结束' };

export function LiveClasses() {
  const { user } = useAuth();
  const [params] = useSearchParams();
  const courseId = params.get('courseId') || '';
  const [page, setPage] = useState(1);
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [form] = Form.useForm();
  const navigate = useNavigate();
  const { message } = App.useApp();
  const query = useData(
    `/live/classes?page=${page}&pageSize=12${courseId ? `&courseId=${encodeURIComponent(courseId)}` : ''}`,
    true,
    15000,
  );
  const canManage = user?.permissions.some((p) => ['course.manage', 'course.admin'].includes(p));
  useEffect(() => setPage(1), [courseId]);
  return (
    <>
      <PageTitle
        eyebrow="LIVE CLASSROOM"
        title="互动直播课堂"
        description="与老师面对面交流，让提问和实践发生在同一间课堂。"
        extra={
          canManage && (
            <Button
              type="primary"
              onClick={() => {
                form.resetFields();
                form.setFieldsValue({ courseId: courseId || undefined, maxParticipants: 32 });
                setOpen(true);
              }}
            >
              预约直播
            </Button>
          )
        }
      />
      {courseId && (
        <p>
          <Link to={`/courses/${courseId}`}>← 返回课程</Link> · <Link to="/live">查看全部直播</Link>
        </p>
      )}
      {query.data?.provider && !query.data.provider.available && (
        <Alert type="info" showIcon message={query.data.provider.reason} style={{ marginBottom: 20 }} />
      )}
      <QueryState query={query}>
        <div className="live-class-grid">
          {query.data?.items?.map((c: Classroom) => (
            <Panel
              key={c.id}
              title={c.title}
              extra={<Tag color={c.status === 'LIVE' ? 'green' : undefined}>{statuses[c.status]}</Tag>}
            >
              <p>{c.courseTitle}</p>
              <p>预约时间：{date(c.scheduledAt)}</p>
              <p>人数上限：{c.maxParticipants} 人</p>
              <Link to={`/live/${c.id}`}>
                <Button type={c.status === 'LIVE' ? 'primary' : 'default'}>
                  {c.status === 'LIVE' ? '进入直播课堂' : '查看课堂'}
                </Button>
              </Link>
            </Panel>
          ))}
        </div>
        {!query.data?.items?.length && <EmptyState description="暂无课程直播，老师预约后会显示在这里" />}
        <Pagination
          current={page}
          pageSize={12}
          total={query.data?.total || 0}
          onChange={setPage}
          showSizeChanger={false}
          hideOnSinglePage
        />
      </QueryState>
      <Modal
        title="预约课程直播"
        open={open}
        onCancel={() => setOpen(false)}
        onOk={() => form.submit()}
        confirmLoading={saving}
        okText="保存预约"
      >
        <Form
          form={form}
          layout="vertical"
          onFinish={async (values) => {
            setSaving(true);
            try {
              const result = await send('/live/classes', {
                ...values,
                scheduledAt: new Date(values.scheduledAt + '+08:00').toISOString(),
              });
              setOpen(false);
              navigate(`/live/${result.id}`);
            } catch (e) {
              message.error((e as Error).message);
            } finally {
              setSaving(false);
            }
          }}
        >
          <Form.Item name="courseId" label="所属课程" rules={[{ required: true }]}>
            <RemoteSelect endpoint="/courses" labelField="title" />
          </Form.Item>
          <Form.Item name="title" label="直播主题" rules={[{ required: true, min: 2, max: 120 }]}>
            <Input maxLength={120} />
          </Form.Item>
          <Form.Item name="scheduledAt" label="预约时间（北京时间）" rules={[{ required: true }]}>
            <Input type="datetime-local" />
          </Form.Item>
          <Form.Item name="maxParticipants" label="课堂人数上限（含教师）" rules={[{ required: true }]}>
            <InputNumber min={2} max={100} />
          </Form.Item>
        </Form>
      </Modal>
    </>
  );
}

function VideoTile({
  participant,
  publication,
  local,
}: {
  participant: Participant;
  publication: TrackPublication;
  local: boolean;
}) {
  const ref = useRef<HTMLVideoElement>(null);
  const track = publication.track;
  useEffect(() => {
    const element = ref.current;
    if (track && element) {
      // Audio uses a separate element; muted video also permits Safari autoplay.
      element.muted = true;
      track.attach(element);
      return () => {
        track.detach(element);
      };
    }
  }, [track, local]);
  return (
    <div
      className={`live-video-tile ${publication.source === Track.Source.ScreenShare ? 'live-screen-tile' : ''}`}
      data-testid="live-video-tile"
    >
      <video
        ref={ref}
        autoPlay
        playsInline
        muted
        className={local && publication.source === Track.Source.Camera ? 'live-mirror' : ''}
        aria-label={`${participant.name || '课堂成员'}的${publication.source === Track.Source.ScreenShare ? '共享屏幕' : '摄像头'}`}
      />
      <span>
        {participant.name || '课堂成员'}
        {local ? '（我）' : ''}
        {publication.isMuted ? ' · 已关闭' : ''}
      </span>
    </div>
  );
}
function AudioTrack({ publication }: { publication: TrackPublication }) {
  const ref = useRef<HTMLAudioElement>(null);
  useEffect(() => {
    const el = ref.current;
    const track = publication.track;
    if (el && track) {
      track.attach(el);
      return () => {
        track.detach(el);
      };
    }
  }, [publication.track]);
  return <audio ref={ref} autoPlay />;
}

export function LiveClassroom() {
  const { id = '' } = useParams();
  const { user } = useAuth();
  const { message } = App.useApp();
  const query = useData<Classroom>(`/live/classes/${id}`, true, 4000);
  const c = query.data;
  const clientRef = useRef<Room | null>(null);
  const leaseRef = useRef<Admission | null>(null);
  const generation = useRef(0);
  const [client, setClient] = useState<Room | null>(null);
  const [state, setState] = useState('未进入');
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState('');
  const [epoch, setEpoch] = useState(0);
  const [text, setText] = useState('');
  const [devicesOpen, setDevicesOpen] = useState(false);
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([]);
  const [pendingMessage, setPendingMessage] = useState(false);
  const host = !!c?.canManage;
  const connected = client?.state === ConnectionState.Connected;
  const canPublish = !!client?.localParticipant.permissions?.canPublish;

  const localDisconnect = () => {
    const active = clientRef.current;
    clientRef.current = null;
    setClient(null);
    setState('未进入');
    if (active) {
      active.removeAllListeners();
      void active.disconnect(true);
    }
  };
  useEffect(() => {
    return () => {
      generation.current++;
      const lease = leaseRef.current;
      leaseRef.current = null;
      const active = clientRef.current;
      clientRef.current = null;
      if (active) {
        active.removeAllListeners();
        void active.disconnect(true);
      }
      if (lease)
        void send(`/live/classes/${id}/leave`, { connectionId: lease.connectionId }).catch(() => undefined);
    };
  }, [id, user?.id, user?.role, user?.organizationId]);
  useEffect(() => {
    if (!client) return;
    let pending = false;
    const beat = async () => {
      const lease = leaseRef.current;
      if (pending || !lease || clientRef.current !== client) return;
      pending = true;
      try {
        await send(`/live/classes/${id}/heartbeat`, { connectionId: lease.connectionId });
      } catch {
        if (clientRef.current === client) {
          setNotice('课堂资格或连接已变化，请重新进入课堂。');
          localDisconnect();
        }
      } finally {
        pending = false;
      }
    };
    const timer = setInterval(() => void beat(), 10000);
    return () => clearInterval(timer);
  }, [client, id]);
  useEffect(() => {
    if (c?.status === 'ENDED' || query.isError || c?.own?.state === 'BLOCKED') {
      localDisconnect();
      leaseRef.current = null;
    }
  }, [c?.status, c?.own?.state, query.isError]);

  async function join() {
    if (busy || !c || c.status !== 'LIVE') return;
    const version = ++generation.current;
    setBusy(true);
    setNotice('');
    let lease: Admission | undefined;
    let room: Room | undefined;
    try {
      localDisconnect();
      lease = await send(`/live/classes/${id}/join`);
      if (generation.current !== version) return;
      leaseRef.current = lease!;
      room = new Room({
        adaptiveStream: true,
        dynacast: true,
        publishDefaults: { videoCodec: 'vp8' },
        videoCaptureDefaults: { resolution: { width: 1280, height: 720, frameRate: 24 } },
      });
      clientRef.current = room;
      const update = () => {
        if (clientRef.current === room) setEpoch((x) => x + 1);
      };
      for (const event of [
        RoomEvent.TrackSubscribed,
        RoomEvent.TrackUnsubscribed,
        RoomEvent.LocalTrackPublished,
        RoomEvent.LocalTrackUnpublished,
        RoomEvent.TrackMuted,
        RoomEvent.TrackUnmuted,
        RoomEvent.ParticipantConnected,
        RoomEvent.ParticipantDisconnected,
        RoomEvent.ParticipantPermissionsChanged,
        RoomEvent.AudioPlaybackStatusChanged,
      ])
        room.on(event, update);
      room.on(RoomEvent.Reconnecting, () => {
        if (clientRef.current === room) setState('正在重连');
      });
      room.on(RoomEvent.Reconnected, () => {
        if (clientRef.current === room) setState('已连接');
      });
      room.on(RoomEvent.Disconnected, () => {
        if (clientRef.current !== room) return;
        setNotice('音视频连接已断开，可在确认课堂状态后重新进入。');
        localDisconnect();
      });
      const url = new URL(lease!.path, window.location.origin);
      url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
      setState('正在连接');
      await room.connect(url.href, lease!.token, { autoSubscribe: true });
      if (generation.current !== version || clientRef.current !== room) {
        await room.disconnect(true);
        return;
      }
      setClient(room);
      setState('已连接');
      // Some browsers keep AudioContext.resume pending until another user gesture.
      // Never hold admission/busy state waiting for autoplay permission.
      void room.startAudio().catch(() => undefined);
      await query.refetch();
    } catch {
      if (generation.current === version) {
        setNotice('暂时无法连接音视频，请检查直播服务和网络后重试。');
        localDisconnect();
        leaseRef.current = null;
        if (lease)
          void send(`/live/classes/${id}/leave`, { connectionId: lease.connectionId }).catch(() => undefined);
      }
      if (room) await room.disconnect(true);
    } finally {
      if (generation.current === version) setBusy(false);
    }
  }
  async function leave() {
    generation.current++;
    const lease = leaseRef.current;
    leaseRef.current = null;
    localDisconnect();
    setBusy(false);
    if (lease)
      try {
        await send(`/live/classes/${id}/leave`, { connectionId: lease.connectionId });
        await query.refetch();
      } catch (e) {
        message.error((e as Error).message);
      }
  }
  async function action(path: string, body: unknown) {
    setBusy(true);
    try {
      const result = await send(`/live/classes/${id}/${path}`, body);
      if (result.cleanupPending) message.warning('发言权限已收回，部分媒体清理仍在重试。');
      await query.refetch();
    } catch (e) {
      message.error((e as Error).message);
      await query.refetch();
    } finally {
      setBusy(false);
    }
  }
  async function device(action: 'mic' | 'camera' | 'screen') {
    if (!client || !canPublish) return;
    try {
      if (action === 'mic')
        await client.localParticipant.setMicrophoneEnabled(!client.localParticipant.isMicrophoneEnabled);
      if (action === 'camera')
        await client.localParticipant.setCameraEnabled(!client.localParticipant.isCameraEnabled);
      if (action === 'screen' && host)
        await client.localParticipant.setScreenShareEnabled(!client.localParticipant.isScreenShareEnabled);
      setEpoch((x) => x + 1);
    } catch {
      message.error('无法开启设备或共享，请检查浏览器授权、设备占用及系统权限。');
    }
  }
  const participants = client ? [client.localParticipant, ...client.remoteParticipants.values()] : [];
  const videos = participants.flatMap((p) =>
    [...p.videoTrackPublications.values()].filter((t) => t.track && !t.isMuted).map((t) => ({ p, t })),
  );
  videos.sort(
    (a, b) =>
      Number(b.t.source === Track.Source.ScreenShare) - Number(a.t.source === Track.Source.ScreenShare),
  );
  const audio = participants
    .filter((p) => p !== client?.localParticipant)
    .flatMap((p) => [...p.audioTrackPublications.values()].filter((t) => t.track));
  void epoch;
  return (
    <QueryState query={query}>
      {c && (
        <>
          <Link className="back-link" to={`/live?courseId=${c.courseId}`}>
            ← 返回课程直播
          </Link>
          <PageTitle
            eyebrow="LIVE CLASSROOM"
            title={c.title}
            description={`${c.courseTitle} · ${date(c.scheduledAt)}`}
            extra={<Tag color={c.status === 'LIVE' ? 'green' : undefined}>{statuses[c.status]}</Tag>}
          />
          {!c.provider.available && <Alert type="info" showIcon message={c.provider.reason} />}
          {notice && (
            <Alert type="warning" showIcon message={notice} closable onClose={() => setNotice('')} />
          )}
          {c.cleanupPending && <Alert type="warning" message="课堂已结束，媒体连接清理仍在重试。" />}
          <div className="live-room-layout">
            <section className="live-stage" aria-label="直播画面">
              <div className="live-stage-status">
                <Radio size={18} />
                <span role="status">{state}</span>
                <span>
                  {c.members.filter((m) => m.online).length} / {c.maxParticipants} 人
                </span>
              </div>
              <div className="live-video-grid">
                {videos.map(({ p, t }) => (
                  <VideoTile
                    key={`${p.identity}:${t.trackSid}`}
                    participant={p}
                    publication={t}
                    local={p === client?.localParticipant}
                  />
                ))}
                {!videos.length && (
                  <div className="live-stage-empty">
                    <Camera size={48} />
                    <h3>
                      {c.status === 'ENDED'
                        ? '本场课堂已结束'
                        : connected
                          ? '等待老师或同学开启画面'
                          : c.status === 'SCHEDULED'
                            ? '课堂尚未开始'
                            : '准备进入互动课堂'}
                    </h3>
                    <p>进入后可观看和收听，麦克风与摄像头由你手动开启。</p>
                  </div>
                )}
              </div>
              {audio.map((t) => (
                <AudioTrack key={t.trackSid} publication={t} />
              ))}
              <div className="live-controls">
                {!connected ? (
                  <Button
                    aria-label="进入课堂"
                    type="primary"
                    loading={busy}
                    disabled={
                      busy || c.status !== 'LIVE' || !c.provider.available || c.own?.state === 'BLOCKED'
                    }
                    onClick={() => void join()}
                  >
                    进入课堂
                  </Button>
                ) : (
                  <>
                    <Button
                      aria-label={client?.localParticipant.isMicrophoneEnabled ? '关闭麦克风' : '开启麦克风'}
                      disabled={!canPublish}
                      onClick={() => void device('mic')}
                      icon={
                        client?.localParticipant.isMicrophoneEnabled ? (
                          <Mic size={18} />
                        ) : (
                          <MicOff size={18} />
                        )
                      }
                    >
                      麦克风
                    </Button>
                    <Button
                      aria-label={client?.localParticipant.isCameraEnabled ? '关闭摄像头' : '开启摄像头'}
                      disabled={!canPublish}
                      onClick={() => void device('camera')}
                      icon={
                        client?.localParticipant.isCameraEnabled ? (
                          <Camera size={18} />
                        ) : (
                          <CameraOff size={18} />
                        )
                      }
                    >
                      摄像头
                    </Button>
                    {host && (
                      <Button onClick={() => void device('screen')} icon={<MonitorUp size={18} />}>
                        {client?.localParticipant.isScreenShareEnabled ? '停止共享' : '共享屏幕'}
                      </Button>
                    )}
                    {!host && (
                      <Button
                        disabled={busy || canPublish}
                        onClick={() =>
                          void action('hand', {
                            connectionId: leaseRef.current?.connectionId,
                            raised: !c.own?.handRaised,
                          })
                        }
                        icon={<Hand size={18} />}
                      >
                        {c.own?.handRaised ? '取消举手' : '举手申请连麦'}
                      </Button>
                    )}
                    <Button
                      onClick={async () => {
                        try {
                          setDevices(await navigator.mediaDevices.enumerateDevices());
                          setDevicesOpen(true);
                        } catch {
                          message.error('无法读取设备列表');
                        }
                      }}
                    >
                      选择设备
                    </Button>
                    <Button
                      icon={<Volume2 size={18} />}
                      onClick={() => {
                        void client?.startAudio().catch(() => message.error('请检查浏览器声音权限'));
                      }}
                    >
                      启用声音
                    </Button>
                    <Button danger onClick={() => void leave()}>
                      离开课堂
                    </Button>
                  </>
                )}
                {host && c.status === 'SCHEDULED' && (
                  <Button
                    aria-label="开始直播"
                    loading={busy}
                    disabled={busy || !c.provider.available}
                    onClick={() => void action('start', { revision: c.revision })}
                  >
                    开始直播
                  </Button>
                )}
                {host && c.status === 'LIVE' && (
                  <Popconfirm
                    okText="确认下麦"
                    title="收回所有学生的音视频发布权限？学生需要重新申请连麦。"
                    onConfirm={() => action('revoke-all', {})}
                  >
                    <Button disabled={busy}>全员下麦</Button>
                  </Popconfirm>
                )}
                {host && c.status !== 'ENDED' && (
                  <Popconfirm
                    okText="确认结束"
                    title={
                      c.status === 'LIVE'
                        ? '结束后所有成员都会退出音视频，且不能重新开播。确认结束？'
                        : '确认取消这场直播预约？'
                    }
                    onConfirm={() => action('end', { revision: c.revision })}
                  >
                    <Button
                      aria-label={c.status === 'LIVE' ? '结束课堂' : '取消预约'}
                      danger
                      disabled={busy}
                      loading={busy}
                    >
                      {c.status === 'LIVE' ? '结束课堂' : '取消预约'}
                    </Button>
                  </Popconfirm>
                )}
              </div>
              {connected && !host && (
                <p className="live-stage-hint">
                  {canPublish
                    ? '老师已允许你连麦，可自行开启麦克风和摄像头。'
                    : '当前为观看模式，举手并获得教师批准后可以连麦。'}
                </p>
              )}
            </section>
            <aside className="live-sidebar">
              <Panel title="课堂成员">
                <List
                  dataSource={c.members}
                  locale={{ emptyText: '暂无成员进入课堂' }}
                  renderItem={(m) => (
                    <List.Item>
                      <div className="live-member">
                        <div>
                          <strong>{m.name}</strong> {m.host && <Tag>教师</Tag>}{' '}
                          {m.handRaised && <Tag color="orange">举手中</Tag>}{' '}
                          {m.approved && !m.host && <Tag color="green">已允许连麦</Tag>}
                          <small>
                            {m.state === 'BLOCKED' ? '已移出' : m.online ? '在线' : '离线'}
                            {m.chatMuted ? ' · 已禁言' : ''}
                          </small>
                        </div>
                        {host && !m.host && m.state === 'ACTIVE' && (
                          <Space size={4} wrap>
                            <Button
                              size="small"
                              disabled={busy}
                              onClick={() =>
                                void action(`members/${m.id}`, {
                                  revision: m.revision,
                                  action: m.approved ? 'revoke' : 'approve',
                                })
                              }
                            >
                              {m.approved ? '收回连麦' : '允许连麦'}
                            </Button>
                            <Button
                              size="small"
                              aria-label={m.chatMuted ? '解除禁言' : '禁言'}
                              disabled={busy}
                              onClick={() =>
                                void action(`members/${m.id}`, {
                                  revision: m.revision,
                                  action: m.chatMuted ? 'unmute-chat' : 'mute-chat',
                                })
                              }
                            >
                              {m.chatMuted ? '解除禁言' : '禁言'}
                            </Button>
                            <Popconfirm
                              okText="确认移出"
                              title="移出后该成员本场不能再次进入，确认移出？"
                              onConfirm={() =>
                                action(`members/${m.id}`, { revision: m.revision, action: 'remove' })
                              }
                            >
                              <Button size="small" danger disabled={busy}>
                                移出
                              </Button>
                            </Popconfirm>
                          </Space>
                        )}
                      </div>
                    </List.Item>
                  )}
                />
              </Panel>
              <Panel title="课堂交流">
                <div className="live-chat" role="log" aria-label="课堂消息">
                  {c.messages.length ? (
                    c.messages.map((m) => (
                      <div className="live-chat-message" key={m.id}>
                        <strong>{m.name}</strong>
                        <time>{date(m.createdAt)}</time>
                        <p>{m.text}</p>
                      </div>
                    ))
                  ) : (
                    <p>还没有课堂消息。</p>
                  )}
                </div>
                <Form
                  onFinish={async () => {
                    const lease = leaseRef.current;
                    if (!lease || !text.trim() || pendingMessage) return;
                    setPendingMessage(true);
                    try {
                      await send(`/live/classes/${id}/messages`, {
                        text: text.trim(),
                        connectionId: lease.connectionId,
                        clientId: crypto.randomUUID(),
                      });
                      setText('');
                      await query.refetch();
                    } catch (e) {
                      message.error((e as Error).message);
                    } finally {
                      setPendingMessage(false);
                    }
                  }}
                >
                  <Input.TextArea
                    aria-label="课堂发言"
                    placeholder={
                      !c.canChat ? '课堂交流未开放' : c.own?.chatMuted ? '你已被禁言' : '输入问题或学习心得'
                    }
                    value={text}
                    onChange={(e) => setText(e.target.value)}
                    maxLength={1000}
                    rows={2}
                    disabled={!connected || c.own?.chatMuted || !c.canChat}
                  />
                  <Button
                    htmlType="submit"
                    loading={pendingMessage}
                    disabled={!connected || c.own?.chatMuted || !text.trim() || !c.canChat}
                  >
                    发送消息
                  </Button>
                </Form>
              </Panel>
            </aside>
          </div>
          <Modal
            title="选择音视频设备"
            open={devicesOpen}
            onCancel={() => setDevicesOpen(false)}
            footer={null}
          >
            {(['audioinput', 'videoinput'] as const).map((kind) => (
              <div className="live-device" key={kind}>
                <label>{kind === 'audioinput' ? '麦克风' : '摄像头'}</label>
                <Select
                  aria-label={kind === 'audioinput' ? '选择麦克风' : '选择摄像头'}
                  style={{ width: '100%' }}
                  placeholder="使用默认设备"
                  options={devices
                    .filter((d) => d.kind === kind)
                    .map((d, i) => ({ value: d.deviceId, label: d.label || `设备 ${i + 1}` }))}
                  onChange={(deviceId) => {
                    void client
                      ?.switchActiveDevice(kind, deviceId)
                      .catch(() => message.error('切换设备失败，请检查设备权限'));
                  }}
                />
              </div>
            ))}
          </Modal>
        </>
      )}
    </QueryState>
  );
}
