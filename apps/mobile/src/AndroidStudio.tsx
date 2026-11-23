import React, { useRef, useState } from 'react';
import { Alert, ScrollView, Text, TextInput, View } from 'react-native';
import type { MobileClient } from './client';
import type { LeaveGuard } from './Assignments';
import { a, AButton } from './assignment-ui';
import { AcademicChoice, AcademicQuery, useAcademicLeave, useAcademicLive } from './academic-ui';
import { useResource } from './resource';
import {
  androidBase,
  androidTaskActive,
  androidTaskStatus,
  type AndroidBuild,
  type AndroidFile,
  type AndroidJob,
  type AndroidProject,
  type AndroidStatus,
} from './android-studio-model';
import { shareTeachingFile } from './teaching-files';
type Common = { client: MobileClient; registerLeave?: (guard: LeaveGuard) => void };
export function AndroidStudio({
  client,
  openProject,
  registerLeave,
}: Common & { openProject: (id: string) => void }) {
  const status = useResource<AndroidStatus>(client, androidBase + '/status'),
    templates = useResource<{ items: { id: string; title: string; description: string }[] }>(
      client,
      androidBase + '/templates',
    ),
    projects = useResource<{ items: AndroidProject[] }>(client, androidBase + '/projects'),
    alive = useAcademicLive(client);
  const [name, setName] = useState(''),
    [pkg, setPkg] = useState(''),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(''),
    [uncertain, setUncertain] = useState(false),
    flight = useRef(false);
  useAcademicLeave(registerLeave, !!name || !!pkg, busy);
  const create = async () => {
    if (flight.current) return;
    flight.current = true;
    setBusy(true);
    setError('');
    try {
      const out = await client.request<AndroidProject>(
        androidBase + '/projects',
        { name: name.trim(), ...(pkg.trim() ? { package: pkg.trim() } : {}) },
        'POST',
      );
      if (!alive()) return;
      setName('');
      setPkg('');
      registerLeave?.(null);
      openProject(out.id);
    } catch (e) {
      if (alive()) {
        setError((e as Error).message);
        if (!(e as { status?: number }).status) setUncertain(true);
      }
    } finally {
      flight.current = false;
      if (alive()) setBusy(false);
    }
  };
  return (
    <ScrollView contentContainerStyle={a.page} keyboardShouldPersistTaps="handled">
      <Text style={a.title}>Android 作品工作区</Text>
      <Text style={a.muted}>
        创建原生项目，编辑源码，查看生成和构建结果，下载调试 APK。构建器与 AI 状态以服务器实际配置为准。
      </Text>
      <AcademicQuery {...status} retry={status.reload} />
      {status.data && !status.data.available && <Text style={a.error}>{status.data.reason}</Text>}
      <View style={a.card}>
        <Text style={a.subtitle}>新建项目</Text>
        {templates.data?.items.map((t) => (
          <View key={t.id}>
            <Text style={a.body}>{t.title}</Text>
            <Text style={a.muted}>{t.description}</Text>
          </View>
        ))}
        <TextInput
          accessibilityLabel="Android 项目名称"
          placeholder="作品名称"
          value={name}
          onChangeText={setName}
          maxLength={50}
          style={a.input}
          editable={!busy}
        />
        <TextInput
          accessibilityLabel="应用包名（可选）"
          placeholder="应用包名（可选，如 com.example.study）"
          value={pkg}
          onChangeText={setPkg}
          autoCapitalize="none"
          maxLength={200}
          style={a.input}
          editable={!busy}
        />
        <AButton
          title={busy ? '创建中…' : '从基础模板创建'}
          disabled={busy || !name.trim() || !status.data?.available || uncertain}
          onPress={() => void create()}
        />
        {uncertain && (
          <>
            <Text style={a.error}>创建结果未确认，请先刷新项目列表，避免重复创建。</Text>
            <AButton
              title="刷新项目列表后检查"
              onPress={() => {
                projects.reload();
                setUncertain(false);
              }}
            />
          </>
        )}
        {error && <Text style={a.error}>{error}</Text>}
      </View>
      <View style={a.row}>
        <Text style={a.subtitle}>我的 Android 项目</Text>
        <AButton
          title="刷新"
          onPress={() => {
            projects.reload();
            status.reload();
          }}
        />
      </View>
      <AcademicQuery {...projects} retry={projects.reload} />
      {projects.data?.items.length === 0 && <Text style={a.muted}>还没有 Android 项目。</Text>}
      {projects.data?.items.map((p) => (
        <View style={a.card} key={p.id}>
          <Text style={a.subtitle}>{p.name}</Text>
          <Text selectable style={a.muted}>
            {p.package}
          </Text>
          <Text style={a.muted}>{p.hasApk ? '已有 APK · 请留意构建时间' : '尚无 APK'}</Text>
          <AButton title="打开工作区" onPress={() => openProject(p.id)} />
        </View>
      ))}
    </ScrollView>
  );
}
export function AndroidWorkspace({
  client,
  id,
  openFile,
  registerLeave,
}: Common & { id: string; openFile: (path: string) => void }) {
  const base = androidBase + '/projects/' + encodeURIComponent(id),
    project = useResource<AndroidProject>(client, base, 5000),
    status = useResource<AndroidStatus>(client, androidBase + '/status'),
    jobs = useResource<{ items: AndroidJob[] }>(client, base + '/jobs', 5000),
    build = useResource<{ build: AndroidBuild | null }>(client, base + '/build', 5000),
    alive = useAcademicLive(client);
  const [dir, setDir] = useState('.'),
    [prompt, setPrompt] = useState(''),
    [mode, setMode] = useState<'read_only' | 'workspace'>('workspace'),
    [busy, setBusy] = useState(''),
    [error, setError] = useState(''),
    [notice, setNotice] = useState(''),
    [selected, setSelected] = useState(''),
    [log, setLog] = useState(''),
    [uncertain, setUncertain] = useState(false),
    flight = useRef(false);
  const files = useResource<{ entries: { name: string; path: string; type: 'dir' | 'file' }[] }>(
    client,
    base + '/files?path=' + encodeURIComponent(dir),
  );
  useAcademicLeave(registerLeave, !!prompt, !!busy);
  async function action(key: string, work: () => Promise<void>) {
    if (flight.current) return;
    flight.current = true;
    setBusy(key);
    setError('');
    try {
      await work();
    } catch (e) {
      if (alive()) {
        setError((e as Error).message);
        if (!(e as { status?: number }).status && ['generate', 'build'].includes(key)) setUncertain(true);
      }
    } finally {
      flight.current = false;
      if (alive()) setBusy('');
    }
  }
  const active = jobs.data?.items.some((j) => androidTaskActive(j.status)),
    building = build.data?.build && !build.data.build.completedAt;
  const generate = () =>
    Alert.alert(
      mode === 'workspace' ? '生成或修改项目？' : '让 AI 阅读项目？',
      mode === 'workspace'
        ? '当前已保存的项目源码和需求将交给已配置的 AI。任务会修改项目；请先保存需要保留的编辑。'
        : 'AI 将读取已保存的项目并回答需求。模型输出需要你核对。',
      [
        { text: '取消', style: 'cancel' },
        {
          text: '确认发送',
          onPress: () =>
            void action('generate', async () => {
              const job = await client.request<AndroidJob>(base + '/generate', { prompt, mode }, 'POST');
              if (alive()) {
                setSelected(job.id);
                setPrompt('');
                jobs.reload();
              }
            }),
        },
      ],
    );
  return (
    <ScrollView contentContainerStyle={a.page} keyboardShouldPersistTaps="handled">
      <Text style={a.title}>{project.data?.name || 'Android 工作区'}</Text>
      <AcademicQuery {...project} retry={project.reload} />
      <Text selectable style={a.muted}>
        {project.data?.package}
      </Text>
      <View style={a.card}>
        <Text style={a.subtitle}>生成与修改</Text>
        {status.data?.ai && !status.data.ai.available && <Text style={a.muted}>{status.data.ai.reason}</Text>}
        <AcademicChoice
          title="修改项目源码"
          selected={mode === 'workspace'}
          onPress={() => setMode('workspace')}
          disabled={!!busy}
        />
        <AcademicChoice
          title="只读分析项目"
          selected={mode === 'read_only'}
          onPress={() => setMode('read_only')}
          disabled={!!busy}
        />
        <TextInput
          accessibilityLabel="Android 作品需求"
          placeholder="描述想实现的界面或需要解决的问题"
          value={prompt}
          onChangeText={setPrompt}
          maxLength={20000}
          multiline
          style={[a.input, { minHeight: 140, textAlignVertical: 'top' }]}
          editable={!busy}
        />
        <AButton
          title="发送给 AI"
          disabled={
            !!busy || !prompt.trim() || !status.data?.ai?.available || active || !!building || uncertain
          }
          onPress={generate}
        />
        {uncertain && (
          <>
            <Text style={a.error}>操作结果未确认。请先查看最新任务和构建日志，确认后再继续。</Text>
            <AButton
              title="刷新并核对状态"
              onPress={() => {
                jobs.reload();
                build.reload();
                project.reload();
                setUncertain(false);
              }}
            />
          </>
        )}
      </View>
      {error && <Text style={a.error}>{error}</Text>}
      {notice && <Text style={a.notice}>{notice}</Text>}
      <View style={a.card}>
        <Text style={a.subtitle}>构建与下载</Text>
        <Text style={a.muted}>
          构建仅使用服务器保存的源码。已有 APK 可能来自上一次成功构建，不代表当前源码已验证。
        </Text>
        {build.data?.build && (
          <>
            <Text style={a.body}>
              {
                (
                  {
                    running: '正在构建',
                    cancel_requested: '正在停止构建',
                    succeeded: '构建成功',
                    failed: '构建失败或未确认',
                  } as const
                )[build.data.build.status]
              }
            </Text>
            <Text style={a.muted}>{new Date(build.data.build.startedAt).toLocaleString()}</Text>
            <Text selectable style={a.body}>
              {build.data.build.message}
            </Text>
          </>
        )}
        <AButton
          title="构建调试 APK"
          disabled={!!busy || !!building || active || !status.data?.available || uncertain}
          onPress={() =>
            void action('build', async () => {
              await client.request(base + '/build', {}, 'POST');
              if (alive()) build.reload();
            })
          }
        />
        {building && (
          <AButton
            title="停止当前构建"
            disabled={!!busy}
            onPress={() =>
              void action('cancel-build', async () => {
                await client.request(base + '/build/cancel', {}, 'POST');
                if (alive()) build.reload();
              })
            }
          />
        )}
        <AButton
          title="下载 APK"
          disabled={!!busy || !project.data?.hasApk}
          onPress={() =>
            void action('apk', async () => {
              await shareTeachingFile(client, base + '/apk', alive, '保存 Android APK');
              if (alive()) setNotice('已打开系统文件保存工具');
            })
          }
        />
        <AButton
          title="导出源码 ZIP"
          disabled={!!busy || active || !!building}
          onPress={() =>
            void action('source', () =>
              shareTeachingFile(client, base + '/source', alive, '保存 Android 源码'),
            )
          }
        />
        {project.data?.buildLogs.map((row) => (
          <AButton
            key={row.id}
            title={'查看构建日志 ' + row.id}
            disabled={!!busy}
            onPress={() =>
              void action('log', async () => {
                const out = await client.request<{ content: string }>(
                  base + '/logs/' + encodeURIComponent(row.id),
                );
                if (alive()) setLog(out.content);
              })
            }
          />
        ))}
        {log && (
          <Text selectable style={a.body}>
            {log}
          </Text>
        )}
      </View>
      <View style={a.card}>
        <Text style={a.subtitle}>项目文件 · {dir}</Text>
        <Text style={a.muted}>手机端可编辑 app/src 中未截断的源码与资源，保存时核对文件版本。</Text>
        {dir !== '.' && (
          <AButton
            title="上一级目录"
            disabled={!!busy}
            onPress={() => setDir(dir.split('/').slice(0, -1).join('/') || '.')}
          />
        )}
        <AcademicQuery {...files} retry={files.reload} />
        {files.data?.entries.map((entry) => (
          <AButton
            key={entry.path || entry.name}
            title={(entry.type === 'dir' ? '目录 · ' : '') + entry.name}
            onPress={() => {
              const path = entry.path || (dir === '.' ? '' : dir + '/') + entry.name;
              if (entry.type === 'dir') setDir(path.replace(/\/$/, ''));
              else openFile(path);
            }}
          />
        ))}
      </View>
      <View style={a.card}>
        <Text style={a.subtitle}>任务历史</Text>
        <AcademicQuery {...jobs} retry={jobs.reload} />
        {jobs.data?.items.length === 0 && <Text style={a.muted}>暂无 AI 任务；无需 AI 也可编辑并构建。</Text>}
        {jobs.data?.items.map((j) => (
          <AButton
            key={j.id}
            title={androidTaskStatus(j.status) + ' · ' + j.prompt.slice(0, 60)}
            onPress={() => setSelected(j.id)}
          />
        ))}
      </View>
      {selected && <AndroidTask key={selected} client={client} id={selected} projectId={id} />}
    </ScrollView>
  );
}
function AndroidTask({ client, id, projectId }: { client: MobileClient; id: string; projectId: string }) {
  const base = androidBase + '/jobs/' + id,
    task = useResource<AndroidJob>(client, base, 3000),
    approvals = useResource<{
      approvals: { id: string; kind: string; payload?: unknown; request?: unknown }[];
    }>(client, base + '/approvals', 5000),
    alive = useAcademicLive(client),
    [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  const decide = async (path: string, body: unknown) => {
    if (busy) return;
    setBusy(true);
    try {
      await client.request(path, body, 'POST');
      if (alive()) {
        task.reload();
        approvals.reload();
      }
    } catch (e) {
      if (alive()) setError((e as Error).message);
    } finally {
      if (alive()) setBusy(false);
    }
  };
  if (task.data && task.data.projectId !== projectId)
    return <Text style={a.error}>任务不属于当前项目，请重新选择。</Text>;
  return (
    <View style={a.card}>
      <Text style={a.subtitle}>任务详情</Text>
      <AcademicQuery {...task} retry={task.reload} />
      {error && <Text style={a.error}>{error}</Text>}
      {task.data && (
        <>
          <Text style={a.body}>{androidTaskStatus(task.data.status)}</Text>
          <Text selectable style={a.body}>
            {task.data.prompt}
          </Text>
          {task.data.result && (
            <Text selectable style={a.body}>
              {task.data.result}
            </Text>
          )}
          {task.data.error && <Text style={a.error}>{task.data.error}</Text>}
          {androidTaskActive(task.data.status) && (
            <AButton title="取消这个任务" disabled={busy} onPress={() => void decide(base + '/cancel', {})} />
          )}
        </>
      )}
      {approvals.data?.approvals.map((item) => (
        <View style={a.card} key={item.id}>
          <Text style={a.subtitle}>待确认操作 · {item.kind}</Text>
          <Text selectable style={a.body}>
            {JSON.stringify(item.payload || item.request || {}, null, 2)}
          </Text>
          <AButton
            title="拒绝操作"
            disabled={busy}
            onPress={() => void decide(base + '/approvals/' + item.id, { approved: false })}
          />
          <AButton
            title="审阅后允许此操作"
            disabled={busy}
            onPress={() =>
              Alert.alert('允许这项操作？', '仅确认上方列出的当前项目操作；执行结果仍需检查。', [
                { text: '取消', style: 'cancel' },
                {
                  text: '允许',
                  onPress: () => void decide(base + '/approvals/' + item.id, { approved: true }),
                },
              ])
            }
          />
        </View>
      ))}
    </View>
  );
}
export function AndroidFileEditor({
  client,
  id,
  path,
  registerLeave,
}: Common & { id: string; path: string }) {
  const uri = androidBase + '/projects/' + id + '/file',
    source = useResource<AndroidFile>(client, uri + '?path=' + encodeURIComponent(path)),
    alive = useAcademicLive(client),
    [saved, setSaved] = useState<AndroidFile | null>(null),
    [code, setCode] = useState(''),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(''),
    [conflict, setConflict] = useState(false),
    [notice, setNotice] = useState(''),
    flight = useRef(false);
  React.useEffect(() => {
    if (source.data && !saved) {
      setSaved(source.data);
      setCode(source.data.content);
    }
  }, [source.data, saved]);
  useAcademicLeave(registerLeave, !!saved && code !== saved.content, busy);
  const save = async () => {
    if (!saved || flight.current) return;
    flight.current = true;
    setBusy(true);
    setError('');
    try {
      const out = await client.request<AndroidFile>(
        uri,
        { path, content: code, revision: saved.revision },
        'PUT',
      );
      if (alive()) {
        setSaved(out);
        setCode(out.content);
        setNotice('已保存到项目');
        setConflict(false);
      }
    } catch (e) {
      if (alive()) {
        setError((e as Error).message);
        setConflict((e as { status?: number }).status === 409);
      }
    } finally {
      flight.current = false;
      if (alive()) setBusy(false);
    }
  };
  const refresh = async () => {
    setBusy(true);
    try {
      const out = await client.request<AndroidFile>(uri + '?path=' + encodeURIComponent(path));
      if (alive()) {
        setSaved(out);
        setConflict(false);
        setNotice('已更新服务器版本；你的输入保留，请核对后再次保存。');
      }
    } catch (e) {
      if (alive()) setError((e as Error).message);
    } finally {
      if (alive()) setBusy(false);
    }
  };
  return (
    <ScrollView contentContainerStyle={a.page} keyboardShouldPersistTaps="handled">
      <Text style={a.title}>Android 源码</Text>
      <Text selectable style={a.muted}>
        {path}
      </Text>
      <AcademicQuery {...source} retry={source.reload} />
      {saved && (
        <>
          <Text style={a.muted}>
            {saved.writable
              ? '编辑后需要手动保存；构建只读取已保存内容。'
              : saved.truncated
                ? '文件仅显示截断预览，禁止覆盖保存。'
                : '此文件只读，手机编辑仅限 app/src 源码与资源。'}
          </Text>
          <TextInput
            accessibilityLabel="Android 源码内容"
            multiline
            value={code}
            onChangeText={setCode}
            maxLength={200000}
            editable={saved.writable && !busy}
            autoCapitalize="none"
            autoCorrect={false}
            style={[a.input, { minHeight: 380, fontFamily: 'monospace', textAlignVertical: 'top' }]}
          />
          <AButton
            title={busy ? '处理中…' : '保存文件'}
            disabled={busy || !saved.writable || conflict || code === saved.content}
            onPress={() => void save()}
          />
          {conflict && (
            <>
              <Text style={a.error}>
                服务器文件已变化。刷新版本会保留当前输入，请结合下方服务器源码核对。
              </Text>
              <AButton title="保留输入并刷新版本" disabled={busy} onPress={() => void refresh()} />
            </>
          )}
          {saved.content !== code && notice && (
            <>
              <Text style={a.subtitle}>当前服务器源码</Text>
              <Text selectable style={a.body}>
                {saved.content}
              </Text>
            </>
          )}
          {notice && <Text style={a.notice}>{notice}</Text>}
          {error && <Text style={a.error}>{error}</Text>}
        </>
      )}
    </ScrollView>
  );
}
