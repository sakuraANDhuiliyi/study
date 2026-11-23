import React, { useEffect, useRef, useState } from 'react';
import { Alert, ScrollView, Switch, Text, TextInput, View } from 'react-native';
import type { MobileClient, MobileUser } from './client';
import { a, AButton } from './assignment-ui';
import { decodeText } from './assignment-model';
import { formatPlanTime } from './planner-model';
import { useResource } from './resource';
import { Pager, State } from './staff-ui';
import {
  adminControlsRoot,
  adminControlsApi,
  type AdminAudit,
  type AdminReport,
  type AdminSetting,
  type AdminSettingInput,
} from './admin-controls-model';

function useOperation(client: MobileClient) {
  const [busy, setBusy] = useState(false),
    [notice, setNotice] = useState('');
  const mounted = useRef(true),
    flight = useRef(false),
    epoch = useRef(client.sessionEpoch());
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  const live = () => mounted.current && client.ownsSession(epoch.current);
  const run = async (operation: () => Promise<unknown>, done: () => void) => {
    if (flight.current) return;
    flight.current = true;
    setBusy(true);
    setNotice('');
    try {
      await operation();
      if (live()) {
        setNotice('操作已保存并记录审计。');
        done();
      }
    } catch (error) {
      if (live()) setNotice((error as Error).message);
    } finally {
      flight.current = false;
      if (live()) setBusy(false);
    }
  };
  return { busy, notice, run };
}
const sections = [
  ['reports', '举报治理', 'communication.moderate'],
  ['audit', '审计日志', 'audit.read'],
  ['settings', '机构设置', 'settings.org'],
] as const;
export function AdminControls({ client, user }: { client: MobileClient; user: MobileUser }) {
  const allowed = sections.filter(([, , permission]) => user.permissions.includes(permission));
  const [section, setSection] = useState<string | undefined>(allowed[0]?.[0]);
  if (user.accountMode !== 'ORGANIZATION' || !['ADMIN', 'SUPER_ADMIN'].includes(user.role) || !allowed.length)
    return <Text style={a.error}>当前身份没有机构治理权限。</Text>;
  return (
    <View style={a.flex}>
      <View style={[a.row, { padding: 16 }]}>
        {allowed.map(([id, name]) => (
          <AButton key={id} title={name} secondary={section !== id} onPress={() => setSection(id)} />
        ))}
      </View>
      {section === 'reports' ? (
        <Reports client={client} />
      ) : section === 'audit' ? (
        <Audit client={client} />
      ) : (
        <Settings client={client} canPlatform={user.permissions.includes('settings.platform')} />
      )}
    </View>
  );
}
function Reports({ client }: { client: MobileClient }) {
  const [status, setStatus] = useState('PENDING'),
    [page, setPage] = useState(1),
    [editing, setEditing] = useState(''),
    [reason, setReason] = useState('');
  const q = useResource<{ items: AdminReport[]; total: number }>(
    client,
    adminControlsRoot + '/reports?' + new URLSearchParams({ status, page: String(page), pageSize: '20' }),
  );
  const action = useOperation(client);
  const resolve = (report: AdminReport, choice: 'hide' | 'dismiss') => {
    const detail = reason.trim();
    Alert.alert(
      choice === 'hide' ? '隐藏公开内容？' : '记录处理结论？',
      choice === 'hide'
        ? '隐藏后普通用户将无法继续访问该公开内容。处理原因会写入审计。'
        : '将保留内容并结束此举报处理，原因会写入审计。',
      [
        { text: '取消', style: 'cancel' },
        {
          text: '确认处理',
          onPress: () =>
            void action.run(
              () => adminControlsApi.resolve(client, report.id, choice, detail),
              () => {
                setEditing('');
                setReason('');
                q.reload();
              },
            ),
        },
      ],
    );
  };
  return (
    <ScrollView contentContainerStyle={a.page} keyboardShouldPersistTaps="handled">
      <Text style={a.title}>举报治理</Text>
      <Text style={a.muted}>
        只处理当前机构授权范围。私信举报显示举报人提供的原因，不授予会话正文访问权。
      </Text>
      <View style={a.row}>
        {[
          ['PENDING', '待处理'],
          ['RESOLVED', '已隐藏'],
          ['DISMISSED', '已结案'],
          ['ALL', '全部'],
        ].map(([value, label]) => (
          <AButton
            key={value}
            title={label}
            secondary={status !== value}
            disabled={action.busy}
            onPress={() => {
              setStatus(value);
              setPage(1);
              setEditing('');
              setReason('');
            }}
          />
        ))}
      </View>
      <AButton title="刷新举报" secondary onPress={q.reload} />
      <State resource={q} />
      {!!action.notice && (
        <Text accessibilityRole="alert" style={a.notice}>
          {action.notice}
        </Text>
      )}
      {!q.error &&
        q.data?.items.map((report) => (
          <View key={report.id} style={a.card}>
            <Text style={a.subtitle}>
              {report.target?.title
                ? decodeText(report.target.title)
                : report.privateContentRestricted
                  ? '私信举报'
                  : '内容举报'}{' '}
              · {report.status}
            </Text>
            <Text style={a.muted}>
              {report.reporterName || '用户'} · {formatPlanTime(report.createdAt)}
            </Text>
            <Text selectable style={a.body}>
              举报原因：{decodeText(report.reason)}
            </Text>
            {report.target && (
              <Text selectable style={a.body}>
                {decodeText(report.target.body)}
              </Text>
            )}
            {report.privateContentRestricted && (
              <Text style={a.notice}>私信正文不可查看或隐藏，可记录处理结论。</Text>
            )}
            {report.resolution && <Text style={a.muted}>处理结论：{decodeText(report.resolution)}</Text>}
            {report.status === 'PENDING' &&
              (editing === report.id ? (
                <>
                  <TextInput
                    accessibilityLabel="举报处理原因"
                    style={[a.input, a.textarea]}
                    multiline
                    value={reason}
                    onChangeText={setReason}
                    maxLength={1000}
                    editable={!action.busy}
                    placeholder="具体处理原因（3–1000字）"
                  />
                  <View style={a.row}>
                    {!report.privateContentRestricted && (
                      <AButton
                        title="隐藏公开内容并结案"
                        disabled={action.busy || reason.trim().length < 3}
                        onPress={() => resolve(report, 'hide')}
                      />
                    )}
                    <AButton
                      title="保留内容并结案"
                      secondary
                      disabled={action.busy || reason.trim().length < 3}
                      onPress={() => resolve(report, 'dismiss')}
                    />
                    <AButton
                      title="取消处理"
                      secondary
                      disabled={action.busy}
                      onPress={() => {
                        setEditing('');
                        setReason('');
                      }}
                    />
                  </View>
                </>
              ) : (
                <AButton
                  title="处理这条举报"
                  disabled={action.busy}
                  onPress={() => {
                    setEditing(report.id);
                    setReason('');
                  }}
                />
              ))}
          </View>
        ))}
      {!q.error && q.data?.items.length === 0 && <Text style={a.muted}>没有匹配的举报。</Text>}
      {q.data && !q.error && <Pager page={page} total={q.data.total} change={setPage} />}
    </ScrollView>
  );
}
function Audit({ client }: { client: MobileClient }) {
  const [page, setPage] = useState(1),
    [text, setText] = useState(''),
    [action, setAction] = useState(''),
    [resource, setResource] = useState(''),
    [filters, setFilters] = useState<Record<string, string>>({});
  const q = useResource<{ items: AdminAudit[]; total: number }>(
    client,
    adminControlsRoot + '/audit?' + new URLSearchParams({ ...filters, page: String(page), pageSize: '20' }),
  );
  return (
    <ScrollView contentContainerStyle={a.page} keyboardShouldPersistTaps="handled">
      <Text style={a.title}>机构审计日志</Text>
      <Text style={a.muted}>显示当前机构的操作、时间和资源追踪信息。原始请求载荷不保存在此页面。</Text>
      <View style={a.card}>
        <TextInput
          accessibilityLabel="搜索审计"
          placeholder="搜索操作或资源"
          value={text}
          onChangeText={setText}
          maxLength={200}
          style={a.input}
        />
        <TextInput
          accessibilityLabel="审计操作类型"
          placeholder="操作类型，例如 settings.change"
          value={action}
          onChangeText={setAction}
          maxLength={200}
          style={a.input}
          autoCapitalize="none"
        />
        <TextInput
          accessibilityLabel="审计资源类型"
          placeholder="资源类型，例如 SystemSetting"
          value={resource}
          onChangeText={setResource}
          maxLength={100}
          style={a.input}
          autoCapitalize="none"
        />
        <View style={a.row}>
          <AButton
            title="筛选审计"
            onPress={() => {
              setFilters({
                ...(text.trim() ? { search: text.trim() } : {}),
                ...(action ? { action } : {}),
                ...(resource ? { resourceType: resource } : {}),
              });
              setPage(1);
            }}
          />
          <AButton
            title="清除审计筛选"
            secondary
            onPress={() => {
              setText('');
              setAction('');
              setResource('');
              setFilters({});
              setPage(1);
            }}
          />
          <AButton title="刷新审计" secondary onPress={q.reload} />
        </View>
      </View>
      <State resource={q} />
      {!q.error &&
        q.data?.items.map((row) => (
          <View key={row.id} style={a.card}>
            <Text style={a.subtitle}>{row.action}</Text>
            <Text style={a.muted}>
              {row.actorName} · {formatPlanTime(row.createdAt)}
            </Text>
            <Text selectable style={a.body}>
              {row.resourceType} · {row.resourceId}
            </Text>
            {row.requestId && (
              <Text selectable style={a.muted}>
                追踪编号：{row.requestId}
              </Text>
            )}
          </View>
        ))}
      {!q.error && q.data?.items.length === 0 && <Text style={a.muted}>没有匹配的审计记录。</Text>}
      {q.data && !q.error && <Pager page={page} total={q.data.total} change={setPage} />}
    </ScrollView>
  );
}
function Settings({ client, canPlatform }: { client: MobileClient; canPlatform: boolean }) {
  const q = useResource<{ items: AdminSetting[] }>(client, adminControlsRoot + '/settings');
  const [editing, setEditing] = useState(false);
  return (
    <ScrollView contentContainerStyle={a.page} keyboardShouldPersistTaps="handled">
      <Text style={a.title}>机构设置</Text>
      <Text style={a.muted}>
        更改对当前机构生效。功能与安全设置需要独立的平台配置权限，每次变更必须填写原因。
      </Text>
      <AButton title="刷新机构设置" secondary disabled={editing} onPress={q.reload} />
      <State resource={q} />
      {q.data && !q.error && (
        <SettingsEditor
          key={JSON.stringify(q.data.items)}
          client={client}
          items={q.data.items}
          canPlatform={canPlatform}
          changed={q.reload}
          editing={setEditing}
        />
      )}
    </ScrollView>
  );
}
function SettingsEditor({
  client,
  items,
  canPlatform,
  changed,
  editing,
}: {
  client: MobileClient;
  items: AdminSetting[];
  canPlatform: boolean;
  changed(): void;
  editing(value: boolean): void;
}) {
  const get = (key: string) => items.find((item) => item.key === key)?.value;
  const features = get('features') as
    { practice?: boolean; communication?: boolean; live?: boolean } | undefined;
  const login = get('loginPolicy') as { sessionHours?: number } | undefined;
  const [key, setKey] = useState<AdminSettingInput['key']>('platformName'),
    [name, setName] = useState(String(get('platformName') || '知学')),
    [notify, setNotify] = useState(get('notificationEnabled') !== false),
    [practice, setPractice] = useState(features?.practice !== false),
    [communication, setCommunication] = useState(features?.communication !== false),
    [live, setLive] = useState(features?.live !== false),
    [upload, setUpload] = useState(String(get('maxUploadMB') ?? '')),
    [hours, setHours] = useState(String(login?.sessionHours ?? '')),
    [reason, setReason] = useState('');
  const action = useOperation(client);
  useEffect(() => {
    editing(action.busy || !!reason);
    return () => editing(false);
  }, [action.busy, reason, editing]);
  const choices: [AdminSettingInput['key'], string][] = [
    ['platformName', '平台名称'],
    ['notificationEnabled', '通知开关'],
    ...(canPlatform
      ? ([
          ['features', '功能开关'],
          ['maxUploadMB', '上传上限'],
          ['loginPolicy', '登录时长'],
        ] as [AdminSettingInput['key'], string][])
      : []),
  ];
  const submit = () => {
    let input: AdminSettingInput;
    if (key === 'platformName') input = { key, value: name.trim(), reason: reason.trim() };
    else if (key === 'notificationEnabled') input = { key, value: notify, reason: reason.trim() };
    else if (key === 'features')
      input = { key, value: { practice, communication, live }, reason: reason.trim() };
    else if (key === 'maxUploadMB') input = { key, value: Number(upload), reason: reason.trim() };
    else input = { key, value: { sessionHours: Number(hours) }, reason: reason.trim() };
    Alert.alert(
      '确认修改机构设置？',
      `修改${choices.find((c) => c[0] === key)?.[1]}将影响当前机构。原因：${reason.trim()}`,
      [
        { text: '取消', style: 'cancel' },
        {
          text: '保存设置',
          onPress: () => void action.run(() => adminControlsApi.setting(client, input), changed),
        },
      ],
    );
  };
  const toggle = (label: string, value: boolean, change: (value: boolean) => void) => (
    <View style={[a.row, { justifyContent: 'space-between' }]}>
      <Text style={a.body}>
        {label}：{value ? '开启' : '关闭'}
      </Text>
      <Switch accessibilityLabel={label} value={value} onValueChange={change} disabled={action.busy} />
    </View>
  );
  const valid =
    key === 'platformName'
      ? !!name.trim()
      : key === 'maxUploadMB'
        ? /^\d+$/.test(upload) && +upload >= 1 && +upload <= 50
        : key === 'loginPolicy'
          ? /^\d+$/.test(hours) && +hours >= 1 && +hours <= 72
          : true;
  return (
    <View style={a.card}>
      {!items.some((item) => item.key === key) && (
        <Text style={a.notice}>此项尚未单独配置，当前沿用服务器默认设置。下方为待保存的新设置。</Text>
      )}
      <View style={a.row}>
        {choices.map(([id, label]) => (
          <AButton
            key={id}
            title={label}
            secondary={key !== id}
            disabled={action.busy}
            onPress={() => setKey(id)}
          />
        ))}
      </View>
      {key === 'platformName' && (
        <TextInput
          accessibilityLabel="平台名称"
          value={name}
          onChangeText={setName}
          style={a.input}
          maxLength={80}
          editable={!action.busy}
        />
      )}
      {key === 'notificationEnabled' && toggle('通知', notify, setNotify)}
      {key === 'features' && (
        <>
          {toggle('练习功能', practice, setPractice)}
          {toggle('师生交流', communication, setCommunication)}
          {toggle('直播课堂', live, setLive)}
        </>
      )}
      {key === 'maxUploadMB' && (
        <>
          <Text style={a.body}>机构单文件上限（1–50 MiB，实际仍受服务器全局上限约束）</Text>
          <TextInput
            accessibilityLabel="上传上限 MiB"
            value={upload}
            onChangeText={setUpload}
            style={a.input}
            keyboardType="number-pad"
            maxLength={2}
            editable={!action.busy}
          />
        </>
      )}
      {key === 'loginPolicy' && (
        <>
          <Text style={a.body}>新登录会话有效期（1–72小时）</Text>
          <TextInput
            accessibilityLabel="登录会话小时数"
            value={hours}
            onChangeText={setHours}
            style={a.input}
            keyboardType="number-pad"
            maxLength={2}
            editable={!action.busy}
          />
        </>
      )}
      <TextInput
        accessibilityLabel="设置变更原因"
        placeholder="变更原因（5–500字）"
        value={reason}
        onChangeText={setReason}
        style={[a.input, a.textarea]}
        multiline
        maxLength={500}
        editable={!action.busy}
      />
      {!!action.notice && (
        <Text accessibilityRole="alert" style={a.notice}>
          {action.notice}
        </Text>
      )}
      <AButton
        title="确认变更设置"
        disabled={action.busy || reason.trim().length < 5 || !valid}
        onPress={submit}
      />
    </View>
  );
}
