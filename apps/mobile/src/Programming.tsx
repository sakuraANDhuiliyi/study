import React, { useEffect, useState } from 'react';
import { Alert, KeyboardAvoidingView, Platform, ScrollView, Text, TextInput, View } from 'react-native';
import type { MobileClient } from './client';
import type { LeaveGuard } from './Assignments';
import { a, AButton } from './assignment-ui';
import { State } from './staff-ui';
import { useResource } from './resource';
import { formatPlanTime } from './planner-model';
import {
  programmingRoot,
  programmingApi,
  validateProjectFiles,
  sourceBytes,
  type Project,
  type ProjectSummary,
  type ProjectTemplate,
  type ProjectVersion,
  type ProjectBackup,
  type ProgrammingStatus,
  type ProgrammingDraft,
} from './programming-model';
import { pickProjectBackup, shareProgrammingFile } from './programming-files';
import { ReadonlyProjectFiles, useProgrammingOperation } from './programming-ui';

export function Programming({
  client,
  open,
  openCreative,
}: {
  client: MobileClient;
  open(id: string): void;
  openCreative(): void;
}) {
  const [page, setPage] = useState(1),
    [title, setTitle] = useState(''),
    [template, setTemplate] = useState<ProjectTemplate['id']>('starter'),
    [backup, setBackup] = useState<ProjectBackup | null>(null);
  const q = useResource<{ items: ProjectSummary[]; total: number }>(
    client,
    programmingRoot + '/projects?page=' + page + '&pageSize=12',
  );
  const templates = useResource<{ items: ProjectTemplate[] }>(client, programmingRoot + '/templates');
  const operation = useProgrammingOperation(client);
  return (
    <ScrollView contentContainerStyle={a.page} keyboardShouldPersistTaps="handled">
      <Text style={a.title}>编程工作区</Text>
      <Text style={a.muted}>
        原生多文件编辑、版本快照和可移植备份。HTML、CSS、JavaScript
        作为源码保存；手机编辑器不执行代码。可导出源码包，在自己的开发环境验证。
      </Text>
      <View style={a.row}>
        <AButton title="浏览编程创意" onPress={openCreative} />
        <AButton title="刷新我的项目" secondary disabled={operation.busy} onPress={q.reload} />
        <AButton
          title="选择项目JSON备份"
          secondary
          disabled={operation.busy}
          onPress={() => void operation.run(() => pickProjectBackup(client), setBackup)}
        />
      </View>
      {!!operation.notice && (
        <Text accessibilityRole="alert" style={a.notice}>
          {operation.notice}
        </Text>
      )}
      {backup && (
        <View style={a.card}>
          <Text style={a.subtitle}>待导入：{backup.title}</Text>
          <Text style={a.muted}>
            {backup.files.length} 个文件 · {backup.templateId} · 将创建独立新项目
          </Text>
          <AButton
            title="确认导入项目"
            disabled={operation.busy}
            onPress={() =>
              void operation.run(
                () => programmingApi.import(client, backup),
                (project) => {
                  setBackup(null);
                  open(project.id);
                },
              )
            }
          />
          <AButton title="取消导入" secondary disabled={operation.busy} onPress={() => setBackup(null)} />
        </View>
      )}
      <View style={a.card}>
        <Text style={a.subtitle}>从模板开始</Text>
        <State resource={templates} />
        {!templates.error &&
          templates.data?.items.map((item) => (
            <View key={item.id}>
              <AButton
                title={item.title}
                secondary={template !== item.id}
                disabled={operation.busy}
                onPress={() => setTemplate(item.id)}
              />
              <Text style={a.muted}>{item.description}</Text>
            </View>
          ))}
        <TextInput
          accessibilityLabel="新项目名称"
          style={a.input}
          value={title}
          onChangeText={setTitle}
          maxLength={160}
          placeholder="为你的项目取个名字"
          editable={!operation.busy}
        />
        <AButton
          title="创建编程项目"
          disabled={operation.busy || !title.trim() || !!templates.error || !templates.data}
          onPress={() =>
            void operation.run(
              () => programmingApi.create(client, title, template),
              (project) => open(project.id),
            )
          }
        />
      </View>
      <State resource={q} />
      {!q.error &&
        q.data?.items.map((item) => (
          <View key={item.id} style={a.card}>
            <Text style={a.subtitle}>{item.title}</Text>
            <Text style={a.muted}>
              {item.fileCount} 个文件 · 版本 {item.revision} · {formatPlanTime(item.updatedAt)}
            </Text>
            <AButton
              title={'编辑项目：' + item.title}
              disabled={operation.busy}
              onPress={() => open(item.id)}
            />
          </View>
        ))}
      {!q.error && q.data?.items.length === 0 && (
        <Text style={a.muted}>还没有项目，选择模板创建第一个作品。</Text>
      )}
      <View style={a.row}>
        <AButton
          title="上一页项目"
          secondary
          disabled={page === 1 || operation.busy}
          onPress={() => setPage(page - 1)}
        />
        <Text style={a.muted}>
          第 {page} 页 · 共 {q.data?.total ?? '—'} 项
        </Text>
        <AButton
          title="下一页项目"
          secondary
          disabled={operation.busy || !!q.error || !q.data || page * 12 >= q.data.total}
          onPress={() => setPage(page + 1)}
        />
      </View>
    </ScrollView>
  );
}
export function ProgrammingProject({
  client,
  id,
  registerLeave,
  openProject,
  openPreview,
  removed,
}: {
  client: MobileClient;
  id: string;
  registerLeave(g: LeaveGuard): void;
  openProject(id: string): void;
  openPreview(): void;
  removed(): void;
}) {
  const q = useResource<Project>(client, programmingRoot + '/projects/' + encodeURIComponent(id));
  const [project, setProject] = useState<Project | null>(null),
    [baseline, setBaseline] = useState(''),
    [selected, setSelected] = useState('index.html'),
    [newPath, setNewPath] = useState(''),
    [note, setNote] = useState(''),
    [copyTitle, setCopyTitle] = useState('');
  const operation = useProgrammingOperation(client);
  const accepted = (next: Project) => {
    setProject(next);
    setBaseline(JSON.stringify({ title: next.title, files: next.files }));
  };
  useEffect(() => {
    if (!project && q.data) accepted(q.data);
  }, [q.data, project]);
  const dirty = !!project && JSON.stringify({ title: project.title, files: project.files }) !== baseline;
  useEffect(() => {
    registerLeave(
      operation.busy
        ? () => Alert.alert('正在处理项目', '请等待操作完成。')
        : dirty
          ? (proceed) =>
              Alert.alert('离开项目？', '未保存源码只保留在当前页面。', [
                { text: '继续编辑', style: 'cancel' },
                { text: '放弃并离开', style: 'destructive', onPress: proceed },
              ])
          : null,
    );
    return () => registerLeave(null);
  }, [dirty, operation.busy, registerLeave]);
  const refresh = () =>
    Alert.alert(
      '重新载入服务器项目？',
      dirty ? '将丢弃当前未保存修改。请先复制需要保留的代码。' : '将读取最新保存版本。',
      [
        { text: '取消', style: 'cancel' },
        {
          text: '重新载入',
          onPress: () =>
            void operation.run(
              () => client.request<Project>(programmingRoot + '/projects/' + encodeURIComponent(id)),
              accepted,
            ),
        },
      ],
    );
  const file = project?.files.find((item) => item.path === selected) || project?.files[0];
  const protectedNotice = project?.templateId.startsWith('creative:') && file?.path === 'NOTICE.txt';
  const add = () => {
    if (!project) return;
    try {
      const files = [...project.files, { path: newPath.trim(), content: '' }];
      validateProjectFiles(files);
      setProject({ ...project, files });
      setSelected(newPath.trim());
      setNewPath('');
    } catch (e) {
      operation.setNotice((e as Error).message);
    }
  };
  return (
    <KeyboardAvoidingView style={a.flex} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView contentContainerStyle={a.page} keyboardShouldPersistTaps="handled">
        <Text style={a.title}>项目编辑器</Text>
        <State resource={q} />
        {!!operation.notice && (
          <Text accessibilityRole="alert" style={a.notice}>
            {operation.notice}
          </Text>
        )}
        {project && !q.error && (
          <>
            <Text style={a.notice}>
              {dirty ? '有未保存修改' : '已保存'} · 版本 {project.revision} · {project.files.length}/24 文件
            </Text>
            {q.data && q.data.revision > project.revision && (
              <Text style={a.notice}>
                服务器版本与当前编辑版本不同。保存发生冲突时会保留你的输入，请核对后重新载入。
              </Text>
            )}
            <TextInput
              accessibilityLabel="项目名称"
              style={a.input}
              value={project.title}
              onChangeText={(title) => setProject({ ...project, title })}
              maxLength={160}
              editable={!operation.busy}
            />
            <View style={a.row}>
              <AButton
                title="保存项目源码"
                disabled={operation.busy || !dirty || !project.title.trim()}
                onPress={() => void operation.run(() => programmingApi.save(client, project), accepted)}
              />
              <AButton title="重新载入项目" secondary disabled={operation.busy} onPress={refresh} />
            </View>
            <View style={a.card}>
              <View style={a.row}>
                {project.files.map((item) => (
                  <AButton
                    key={item.path}
                    title={item.path}
                    secondary={item.path !== file?.path}
                    disabled={operation.busy}
                    onPress={() => setSelected(item.path)}
                  />
                ))}
              </View>
              {file && (
                <>
                  <Text style={a.muted}>
                    {file.path} · {sourceBytes(file.content)} / 65536 字节
                    {protectedNotice ? ' · 来源许可须完整保留' : ''}
                  </Text>
                  <TextInput
                    accessibilityLabel={'项目源码：' + file.path}
                    style={[
                      a.input,
                      {
                        minHeight: 300,
                        maxHeight: 540,
                        fontFamily: 'monospace',
                        fontSize: 13,
                        textAlignVertical: 'top',
                      },
                    ]}
                    multiline
                    scrollEnabled
                    autoCapitalize="none"
                    autoCorrect={false}
                    value={file.content}
                    editable={!operation.busy && !protectedNotice}
                    maxLength={65536}
                    onChangeText={(content) =>
                      setProject({
                        ...project,
                        files: project.files.map((item) =>
                          item.path === file.path ? { ...item, content } : item,
                        ),
                      })
                    }
                  />
                  <AButton
                    title={'删除文件 ' + file.path}
                    secondary
                    disabled={operation.busy || file.path === 'index.html' || !!protectedNotice}
                    onPress={() =>
                      Alert.alert('删除此文件？', '删除会成为待保存修改，不会立即删除服务器版本。', [
                        { text: '取消', style: 'cancel' },
                        {
                          text: '删除文件',
                          style: 'destructive',
                          onPress: () => {
                            setProject({
                              ...project,
                              files: project.files.filter((item) => item.path !== file.path),
                            });
                            setSelected('index.html');
                          },
                        },
                      ])
                    }
                  />
                </>
              )}
              <TextInput
                accessibilityLabel="新文件路径"
                placeholder="例如 components/card.js"
                style={a.input}
                value={newPath}
                onChangeText={setNewPath}
                maxLength={160}
                editable={!operation.busy}
              />
              <AButton
                title="添加文件"
                secondary
                disabled={operation.busy || !newPath.trim()}
                onPress={add}
              />
            </View>
            <View style={a.card}>
              <Text style={a.subtitle}>版本与产物</Text>
              <AButton secondary title="预览已保存的作品" onPress={openPreview} />
              <Text style={a.muted}>
                以下操作使用已保存的服务器源码，请先保存本地修改。ZIP用于移植，JSON可重新导入本站。
              </Text>
              <TextInput
                accessibilityLabel="版本说明"
                style={a.input}
                value={note}
                onChangeText={setNote}
                maxLength={200}
                placeholder="记录这次改动"
                editable={!operation.busy}
              />
              <AButton
                title="保存版本快照"
                disabled={operation.busy || dirty}
                onPress={() =>
                  void operation.run(
                    () => programmingApi.version(client, id, project.revision, note),
                    (result) => {
                      accepted(result.project);
                      setNote('');
                    },
                  )
                }
              />
              <View style={a.row}>
                <AButton
                  title="导出源码ZIP"
                  secondary
                  disabled={operation.busy || dirty}
                  onPress={() => void operation.run(() => shareProgrammingFile(client, id, 'zip'))}
                />
                <AButton
                  title="保存JSON备份"
                  secondary
                  disabled={operation.busy || dirty}
                  onPress={() => void operation.run(() => shareProgrammingFile(client, id, 'backup'))}
                />
              </View>
              <TextInput
                accessibilityLabel="复制项目名称"
                style={a.input}
                value={copyTitle}
                onChangeText={setCopyTitle}
                maxLength={160}
                placeholder="新副本名称"
                editable={!operation.busy}
              />
              <AButton
                title="创建独立项目副本"
                disabled={operation.busy || dirty || !copyTitle.trim()}
                onPress={() =>
                  void operation.run(
                    () => programmingApi.duplicate(client, id, project.revision, copyTitle),
                    (result) => {
                      registerLeave(null);
                      openProject(result.id);
                    },
                  )
                }
              />
            </View>
            <ProjectHistory
              key={project.revision}
              client={client}
              project={project}
              locked={operation.busy || dirty}
              restore={(versionId) =>
                void operation.run(
                  () => programmingApi.restore(client, id, project.revision, versionId),
                  accepted,
                )
              }
            />
            <ProjectAi
              key={'ai-' + project.revision}
              client={client}
              project={project}
              locked={operation.busy || dirty}
              applied={accepted}
            />
            <AButton
              title="删除这个项目"
              secondary
              disabled={operation.busy || dirty}
              onPress={() =>
                Alert.alert('永久删除项目？', '项目源码、版本和AI草稿将一并删除。建议先保存JSON备份。', [
                  { text: '取消', style: 'cancel' },
                  {
                    text: '删除项目',
                    style: 'destructive',
                    onPress: () =>
                      void operation.run(
                        () => programmingApi.remove(client, id),
                        () => {
                          registerLeave(null);
                          removed();
                        },
                      ),
                  },
                ])
              }
            />
          </>
        )}
      </ScrollView>
    </KeyboardAvoidingView>
  );
}
function ProjectHistory({
  client,
  project,
  locked,
  restore,
}: {
  client: MobileClient;
  project: Project;
  locked: boolean;
  restore(versionId: string): void;
}) {
  const q = useResource<{ items: ProjectVersion[] }>(
    client,
    programmingRoot + '/projects/' + encodeURIComponent(project.id) + '/versions',
  );
  const [selected, setSelected] = useState<ProjectVersion | null>(null),
    operation = useProgrammingOperation(client);
  return (
    <View style={a.card}>
      <Text style={a.subtitle}>已保存版本</Text>
      <State resource={q} />
      {!!operation.notice && <Text style={a.notice}>{operation.notice}</Text>}
      {!q.error &&
        q.data?.items.map((version) => (
          <AButton
            key={version.id}
            title={'查看版本 ' + version.number + ' · ' + version.note}
            secondary
            disabled={operation.busy || locked}
            onPress={() =>
              void operation.run(
                () =>
                  client.request<ProjectVersion>(
                    programmingRoot +
                      '/projects/' +
                      encodeURIComponent(project.id) +
                      '/versions/' +
                      encodeURIComponent(version.id),
                  ),
                setSelected,
              )
            }
          />
        ))}
      {selected?.files && (
        <>
          <ReadonlyProjectFiles files={selected.files} label={'版本 ' + selected.number + ' 源码'} />
          <AButton
            title={'恢复版本 ' + selected.number}
            disabled={locked || operation.busy}
            onPress={() =>
              Alert.alert('恢复历史版本？', '将替换已保存源码；服务器会保留恢复前的草稿快照。', [
                { text: '取消', style: 'cancel' },
                { text: '确认恢复', onPress: () => restore(selected.id) },
              ])
            }
          />
        </>
      )}
    </View>
  );
}
function ProjectAi({
  client,
  project,
  locked,
  applied,
}: {
  client: MobileClient;
  project: Project;
  locked: boolean;
  applied(project: Project): void;
}) {
  const status = useResource<ProgrammingStatus>(client, programmingRoot + '/status'),
    history = useResource<{ items: ProgrammingDraft[] }>(
      client,
      programmingRoot + '/projects/' + encodeURIComponent(project.id) + '/ai-drafts',
      30000,
    );
  const [prompt, setPrompt] = useState(''),
    [draft, setDraft] = useState<ProgrammingDraft | null>(null),
    operation = useProgrammingOperation(client);
  return (
    <View style={a.card}>
      <Text style={a.subtitle}>AI源码建议</Text>
      <State resource={status} />
      <Text style={a.muted}>
        {status.data?.ai.available
          ? 'AI只生成待审阅源码与说明，不能证明运行结果。'
          : status.data?.ai.reason || '正在查询AI配置…'}
      </Text>
      <TextInput
        accessibilityLabel="AI项目改进需求"
        value={prompt}
        onChangeText={setPrompt}
        style={[a.input, a.textarea]}
        maxLength={3000}
        multiline
        editable={!locked && !operation.busy}
        placeholder="描述需要改进的功能和学习问题"
      />
      <AButton
        title="生成AI项目草稿"
        disabled={
          locked ||
          operation.busy ||
          !status.data?.ai.available ||
          !prompt.trim() ||
          history.data?.items.some((item) => item.status === 'pending')
        }
        onPress={() =>
          Alert.alert(
            '生成AI草稿？',
            '当前已保存项目源码和需求将发送至机构配置的AI服务。生成后需你审阅并确认才会应用。',
            [
              { text: '取消', style: 'cancel' },
              {
                text: '开始生成',
                onPress: () =>
                  void operation.run(
                    () => programmingApi.generate(client, project.id, project.revision, prompt),
                    (result) => {
                      setDraft(result);
                      history.reload();
                    },
                  ),
              },
            ],
          )
        }
      />
      {!!operation.notice && (
        <Text accessibilityRole="alert" style={a.notice}>
          {operation.notice} 如请求中断，请先刷新草稿记录核对结果。
        </Text>
      )}
      <AButton title="刷新AI草稿记录" secondary disabled={operation.busy} onPress={history.reload} />
      <State resource={history} />
      {!history.error &&
        history.data?.items.map((item) => (
          <AButton
            key={item.id}
            title={item.status + ' · ' + item.prompt.slice(0, 60)}
            secondary
            disabled={operation.busy || locked}
            onPress={() =>
              void operation.run(
                () =>
                  client.request<ProgrammingDraft>(
                    programmingRoot +
                      '/projects/' +
                      encodeURIComponent(project.id) +
                      '/ai-drafts/' +
                      encodeURIComponent(item.id),
                  ),
                setDraft,
              )
            }
          />
        ))}
      {draft && (
        <>
          <Text style={a.subtitle}>{draft.summary || 'AI草稿状态：' + draft.status}</Text>
          {draft.error && <Text style={a.error}>{draft.error}</Text>}
          {draft.plan?.map((text, index) => (
            <Text key={'plan-' + index} style={a.body}>
              {index + 1}. {text}
            </Text>
          ))}
          {draft.teaching?.map((text, index) => (
            <Text key={'teach-' + index} style={a.muted}>
              {text}
            </Text>
          ))}
          {draft.files && <ReadonlyProjectFiles files={draft.files} label="AI候选源码" />}
          <AButton
            title="确认应用此AI源码"
            disabled={
              locked || operation.busy || draft.status !== 'ready' || draft.baseRevision !== project.revision
            }
            onPress={() =>
              Alert.alert(
                '应用已审阅的AI草稿？',
                '将用候选文件替换当前已保存源码，服务器会保留原草稿快照。',
                [
                  { text: '取消', style: 'cancel' },
                  {
                    text: '确认应用',
                    onPress: () =>
                      void operation.run(
                        () => programmingApi.apply(client, project.id, draft.id, project.revision),
                        (result) => applied(result.project),
                      ),
                  },
                ],
              )
            }
          />
        </>
      )}
    </View>
  );
}
