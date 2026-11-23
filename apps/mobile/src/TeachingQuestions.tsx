import { TeachingField as Field, TeachingPanel } from './teaching-ui';
import React, { useEffect, useState } from 'react';
import { Text, View } from 'react-native';
import type { MobileClient, MobileUser } from './client';
import { a, AButton, RichText } from './assignment-ui';
import { Pager, Picker, State, confirmAction, usePage } from './staff-ui';
import { useResource } from './resource';
import {
  teachingApi,
  teachingRoot,
  teachingScore,
  type TeachingQuestion,
  type TeachingQuestionContent,
  type TeachingVersion,
} from './teaching-model';
import { TeachingNotice, useTeachingGuard, useTeachingOperation, type TeachingGuard } from './teaching-ui';
export function TeachingQuestions({
  client,
  user,
  course,
  registerLeave,
}: {
  client: MobileClient;
  user: MobileUser;
  course: string;
  registerLeave: TeachingGuard;
}) {
  const [page, setPage] = useState(1),
    [selected, select] = useState(''),
    [inactive, setInactive] = useState(false);
  const q = usePage<TeachingQuestion>(
    client,
    teachingRoot + '/questions?courseId=' + encodeURIComponent(course) + (inactive ? '&status=inactive' : ''),
    page,
  );
  if (selected)
    return (
      <QuestionRevision
        key={selected}
        client={client}
        user={user}
        id={selected}
        registerLeave={registerLeave}
        back={() => {
          select('');
          q.reload();
        }}
      />
    );
  return (
    <View style={a.card}>
      <Text style={a.subtitle}>修订教学题库</Text>
      <Text style={a.muted}>修改会生成新版本，已发布作业、考试和试卷继续保留原题快照。</Text>
      <AButton
        secondary
        title={inactive ? '查看启用题目' : '查看停用题目'}
        onPress={() => {
          setInactive(!inactive);
          setPage(1);
        }}
      />
      <State resource={q} />
      {!q.error &&
        q.data?.items.map((row) => (
          <View style={a.child} key={row.id}>
            <RichText html={row.versions[0]?.stem || ''} />
            <Text style={a.muted}>
              版本 {row.currentVersion} · {row.scope === 'shared' ? '共享题' : '私人题'}
            </Text>
            <AButton title="查看与修订" onPress={() => select(row.id)} />
          </View>
        ))}
      {q.data && <Pager page={page} total={q.data.total} change={setPage} />}
    </View>
  );
}
function QuestionRevision({
  client,
  user,
  id,
  back,
  registerLeave,
}: {
  client: MobileClient;
  user: MobileUser;
  id: string;
  back(): void;
  registerLeave: TeachingGuard;
}) {
  const q = useResource<TeachingQuestion>(client, teachingRoot + '/questions/' + id),
    [current, setCurrent] = useState<TeachingQuestion>(),
    [edit, setEdit] = useState<TeachingVersion>(),
    [scope, setScope] = useState<'private' | 'shared'>('private'),
    [practice, setPractice] = useState(false),
    [active, setActive] = useState(true),
    [baseline, setBaseline] = useState(''),
    [versions, setVersions] = useState(false),
    op = useTeachingOperation(client);
  const accept = (row: TeachingQuestion) => {
    setCurrent(row);
    setEdit(row.versions[0]);
    setScope(row.scope);
    setPractice(row.practiceEnabled);
    setActive(row.active);
    setBaseline(JSON.stringify([row.versions[0], row.scope, row.practiceEnabled, row.active]));
  };
  useEffect(() => {
    if (q.data && !current) accept(q.data);
  }, [q.data, current]);
  const dirty = !!edit && JSON.stringify([edit, scope, practice, active]) !== baseline;
  useTeachingGuard(dirty, op.busy, registerLeave);
  const leave = () =>
    dirty ? confirmAction('放弃未保存修订？', '返回题库后将丢弃本页未保存输入。', back) : back();
  return (
    <TeachingPanel busy={op.busy}>
      <AButton secondary title="返回题库" disabled={op.busy} onPress={leave} />
      <State resource={q} />
      {current && edit && (
        <>
          <Text style={a.subtitle}>题目版本 {current.currentVersion}</Text>
          {current.creatorId === user.id ? (
            <>
              <ContentEditor value={edit} change={(v) => setEdit({ ...v, version: edit.version })} />
              <Picker
                label="共享范围"
                id={scope}
                change={(v) => setScope(v as 'private' | 'shared')}
                items={[
                  { id: 'private', name: '本人私有' },
                  { id: 'shared', name: '课程教师共享' },
                ]}
              />
              <AButton
                secondary
                title={practice ? '练习开放：是' : '练习开放：否'}
                onPress={() => setPractice(!practice)}
              />
              <AButton
                secondary
                title={active ? '题目启用：是' : '题目启用：否'}
                onPress={() => setActive(!active)}
              />
              <AButton
                title="保存为新版本"
                disabled={op.busy || !dirty || !validContentScores(edit)}
                onPress={() =>
                  confirmAction(
                    '生成题目新版本',
                    '旧试卷与已发布测评不会自动替换题目。',
                    () =>
                      void op.run(
                        () =>
                          teachingApi.revise(client, id, current.currentVersion, {
                            type: edit.type,
                            stem: edit.stem,
                            answer: edit.answer,
                            options: edit.options,
                            explanation: edit.explanation,
                            scoreCents: edit.scoreCents,
                            difficulty: edit.difficulty,
                            rules: edit.rules,
                            children: edit.children,
                            knowledgePoints: edit.knowledgePoints,
                            tags: edit.tags,
                            scope,
                            practiceEnabled: practice,
                            active,
                          }),
                        accept,
                      ),
                  )
                }
              />
            </>
          ) : (
            <>
              <RichText html={edit.stem} />
              <Text style={a.muted}>共享题只能由创建者修改。可复制为本人题目再编辑。</Text>
            </>
          )}
          <AButton
            secondary
            title="复制为本人题目"
            disabled={op.busy}
            onPress={() =>
              confirmAction(
                '复制题目',
                '将保留当前题目内容创建新的私人题目。',
                () =>
                  void op.run(
                    () => client.request(teachingRoot + '/questions/' + id + '/copy', {}, 'POST'),
                    back,
                  ),
              )
            }
          />
          <AButton
            secondary
            title="重新读取最新版本"
            disabled={op.busy}
            onPress={() =>
              confirmAction(
                '重新读取题目',
                '未保存的输入将被最新服务器版本替换。',
                () =>
                  void op.run(
                    () => client.request<TeachingQuestion>(teachingRoot + '/questions/' + id),
                    accept,
                  ),
              )
            }
          />
          <AButton
            secondary
            title={versions ? '收起历史版本' : '查看历史版本'}
            onPress={() => setVersions(!versions)}
          />
          {versions && <VersionHistory client={client} id={id} />}
        </>
      )}
      <TeachingNotice operation={op} />
    </TeachingPanel>
  );
}
function ContentEditor({
  value: v,
  change,
}: {
  value: TeachingQuestionContent;
  change(v: TeachingQuestionContent): void;
}) {
  const [score, setScore] = useState(String(v.scoreCents / 100)),
    [scoreError, setScoreError] = useState('');
  const patch = (x: Partial<TeachingQuestionContent>) => change({ ...v, ...x });
  useEffect(() => {
    if (Number.isFinite(v.scoreCents)) setScore(String(v.scoreCents / 100));
  }, [v.scoreCents]);
  return (
    <View style={a.child}>
      <Text style={a.body}>
        题型：
        {
          {
            single: '单选',
            multiple: '多选',
            boolean: '判断',
            blank: '填空',
            short: '简答',
            composite: '综合',
          }[v.type]
        }
      </Text>
      <Field multiline label="题干" value={v.stem} set={(stem) => patch({ stem })} />
      {['single', 'multiple'].includes(v.type) && (
        <>
          {v.options.map((o, index) => (
            <View key={o.id}>
              <Field
                label={'选项 ' + (index + 1)}
                value={o.text}
                set={(text) => patch({ options: v.options.map((x) => (x.id === o.id ? { ...x, text } : x)) })}
              />
              <AButton
                secondary
                title={
                  (
                    v.type === 'single'
                      ? v.answer === o.id
                      : Array.isArray(v.answer) && v.answer.includes(o.id)
                  )
                    ? '✓ 正确选项'
                    : '设为正确选项'
                }
                onPress={() => {
                  const previous = Array.isArray(v.answer) ? v.answer : [];
                  patch({
                    answer:
                      v.type === 'single'
                        ? o.id
                        : previous.includes(o.id)
                          ? previous.filter((x) => x !== o.id)
                          : [...previous, o.id],
                  });
                }}
              />
            </View>
          ))}
        </>
      )}
      {v.type === 'boolean' && (
        <Picker
          label="正确答案"
          id={String(v.answer)}
          items={[
            { id: 'true', name: '正确' },
            { id: 'false', name: '错误' },
          ]}
          change={(x) => patch({ answer: x === 'true' })}
        />
      )}
      {v.type === 'short' && (
        <Field
          label="参考答案"
          multiline
          value={typeof v.answer === 'string' ? v.answer : ''}
          set={(answer) => patch({ answer })}
        />
      )}
      {v.type === 'blank' && (
        <Field
          label="每行一空，同义答案用 | 分隔"
          multiline
          value={
            Array.isArray(v.answer)
              ? v.answer.map((x) => (Array.isArray(x) ? x.join('|') : String(x))).join('\n')
              : ''
          }
          set={(text) => patch({ answer: text.split('\n').map((x) => x.split('|').map((t) => t.trim())) })}
        />
      )}
      {v.type === 'composite' &&
        v.children.map((child, index) => (
          <View key={child.id}>
            <Text style={a.subtitle}>子题 {index + 1}</Text>
            <ContentEditor
              value={child}
              change={(next) => {
                const children = v.children.map((x) => (x.id === child.id ? next : x));
                patch({ children, scoreCents: children.reduce((sum, x) => sum + x.scoreCents, 0) });
              }}
            />
          </View>
        ))}
      <Field multiline label="题目解析" value={v.explanation} set={(explanation) => patch({ explanation })} />
      {v.type !== 'composite' ? (
        <Field
          label="分值"
          value={score}
          set={(text) => {
            setScore(text);
            try {
              patch({ scoreCents: teachingScore(text) });
              setScoreError('');
            } catch (e) {
              setScoreError((e as Error).message);
              patch({ scoreCents: NaN });
            }
          }}
        />
      ) : (
        <Text>总分 {v.scoreCents / 100}</Text>
      )}
      {!!scoreError && <Text style={a.error}>{scoreError}（请更正后再保存）</Text>}
      <Picker
        label="难度"
        id={String(v.difficulty)}
        change={(x) => patch({ difficulty: Number(x) })}
        items={[1, 2, 3, 4, 5].map((n) => ({ id: String(n), name: String(n) }))}
      />
    </View>
  );
}
function VersionHistory({ client, id }: { client: MobileClient; id: string }) {
  const [page, setPage] = useState(1);
  const q = usePage<TeachingVersion>(client, teachingRoot + '/questions/' + id + '/versions', page);
  return (
    <View>
      <State resource={q} />
      {!q.error &&
        q.data?.items.map((v) => (
          <View key={v.id} style={a.child}>
            <Text>
              版本 {v.version} · {v.scoreCents / 100} 分
            </Text>
            <RichText html={v.stem} />
            <Text selectable>
              参考答案：{typeof v.answer === 'string' ? v.answer : JSON.stringify(v.answer)}
            </Text>
            <Text selectable>解析：{v.explanation}</Text>
          </View>
        ))}
      {q.data && <Pager page={page} total={q.data.total} change={setPage} />}
    </View>
  );
}

function validContentScores(v: TeachingQuestionContent): boolean {
  return (
    Number.isSafeInteger(v.scoreCents) &&
    v.scoreCents > 0 &&
    v.scoreCents <= 1000000 &&
    (v.children?.every(validContentScores) ?? true)
  );
}
