import React, { useEffect, useRef, useState } from 'react';
import { Alert, ScrollView, Text, TextInput, View } from 'react-native';
import type { LeaveGuard } from './Assignments';
import { MobileApiError, type MobileClient } from './client';
import { useResource } from './resource';
import { a, AButton } from './assignment-ui';
import { AcademicChoice, AcademicQuery, useAcademicLeave, useAcademicLive } from './academic-ui';
import {
  authoringRoot,
  authoringTypeLabels,
  authoringLines,
  editAuthoringQuestion,
  commitAuthoringQuestions,
  type AuthoringType,
  type AuthoringDraft,
  type AuthoringStatus,
  type AuthoringQuestionEdit,
} from './ai-authoring-model';
export function AiAuthoringHome({
  client,
  courseId: initialCourse,
  openDraft,
  registerLeave,
  initialTab = 'new',
}: {
  client: MobileClient;
  courseId?: string;
  openDraft(id: string): void;
  registerLeave(guard: LeaveGuard): void;
  initialTab?: 'new' | 'history';
}) {
  const [tab, setTab] = useState(initialTab),
    [courseId, setCourseId] = useState(initialCourse || ''),
    [mode, setMode] = useState<'questions' | 'paper'>('questions'),
    [title, setTitle] = useState(''),
    [knowledge, setKnowledge] = useState(''),
    [requirements, setRequirements] = useState(''),
    [material, setMaterial] = useState(''),
    [page, setPage] = useState(1),
    [coursePage, setCoursePage] = useState(1),
    [search, setSearch] = useState('');
  const [blueprint, setBlueprint] = useState(
    (Object.keys(authoringTypeLabels) as AuthoringType[]).map((type) => ({
      type,
      count: type === 'single' ? '3' : '0',
      score: '2',
      difficulty: '3',
    })),
  );
  const [busy, setBusy] = useState(false),
    [uncertain, setUncertain] = useState(false),
    [error, setError] = useState('');
  const status = useResource<AuthoringStatus>(client, authoringRoot + '/status'),
    courses = useResource<{ items: { id: string; title: string; status: string }[]; total: number }>(
      client,
      '/courses?' + new URLSearchParams({ page: String(coursePage), pageSize: '10', search }),
    ),
    history = useResource<{ items: (AuthoringDraft & { questionCount: number })[]; total: number }>(
      client,
      authoringRoot + '/drafts?page=' + page + '&pageSize=10',
      30000,
    );
  const live = useAcademicLive(client),
    flight = useRef(false);
  useAcademicLeave(registerLeave, !!title || !!knowledge || !!requirements || !!material || uncertain, busy);
  const create = () => {
    let rows: { type: AuthoringType; count: number; scoreCents: number; difficulty: number }[];
    try {
      rows = blueprint
        .filter((row) => row.count !== '' && Number(row.count) !== 0)
        .map((row) => {
          const count = Number(row.count),
            score = Number(row.score),
            difficulty = Number(row.difficulty);
          if (
            !Number.isInteger(count) ||
            count < 1 ||
            count > 10 ||
            !/^\d+(?:\.\d{1,2})?$/.test(row.score) ||
            score < 0.01 ||
            score > 10000 ||
            !Number.isInteger(difficulty) ||
            difficulty < 1 ||
            difficulty > 5
          )
            throw new Error('请核对题型数量、分值与难度');
          return { type: row.type, count, scoreCents: Math.round(score * 100), difficulty };
        });
      if (
        !courseId ||
        !title.trim() ||
        !authoringLines(knowledge).length ||
        !rows.length ||
        rows.reduce((n, r) => n + r.count, 0) > 10
      )
        throw new Error('请选择课程、填写标题和知识点，一次生成1至10道题');
    } catch (e) {
      setError((e as Error).message);
      return;
    }
    Alert.alert(
      '生成 AI 出题草稿？',
      '教学要求和参考材料会发送给平台配置的 AI 服务。生成后须由你审阅确认，保存时不会自动开放练习或发布试卷。',
      [
        { text: '取消', style: 'cancel' },
        {
          text: '生成草稿',
          onPress: () => {
            if (flight.current || uncertain) return;
            flight.current = true;
            setBusy(true);
            setError('');
            void client
              .request<AuthoringDraft>(
                authoringRoot + '/drafts',
                {
                  mode,
                  courseId,
                  title: title.trim(),
                  knowledgePoints: authoringLines(knowledge),
                  requirements,
                  material,
                  blueprint: rows,
                },
                'POST',
              )
              .then((draft) => {
                if (live()) {
                  setTitle('');
                  setKnowledge('');
                  setRequirements('');
                  setMaterial('');
                  registerLeave(null);
                  registerLeave?.(null);
                  openDraft(draft.id);
                }
              })
              .catch((e) => {
                if (live()) {
                  setError((e as Error).message);
                  if (!(e instanceof MobileApiError) || e.status === 0 || e.status >= 500) {
                    setUncertain(true);
                    history.reload();
                  }
                }
              })
              .finally(() => {
                flight.current = false;
                if (live()) setBusy(false);
              });
          },
        },
      ],
    );
  };
  return (
    <ScrollView contentContainerStyle={a.page} keyboardShouldPersistTaps="handled">
      <View style={a.card}>
        <Text style={a.title}>AI 教学备课与出题</Text>
        <Text style={a.body}>按教学目标与参考材料生成题目或草稿试卷，逐题审阅后保存。</Text>
        <View style={a.row}>
          <AButton
            title="新建出题草稿"
            secondary={tab !== 'new'}
            disabled={busy}
            onPress={() => setTab('new')}
          />
          <AButton
            title="我的历史草稿"
            secondary={tab !== 'history'}
            disabled={busy}
            onPress={() => {
              setTab('history');
              history.reload();
            }}
          />
        </View>
      </View>
      <AcademicQuery loading={status.loading} error={status.error} retry={status.reload} />
      {status.data && (
        <Text style={a.notice}>
          {status.data.available
            ? `AI 可用 · ${status.data.model} · 每次最多 ${status.data.limits.maxQuestions} 题`
            : status.data.reason}
        </Text>
      )}
      {!!error && <Text style={a.error}>{error}</Text>}
      {uncertain && (
        <View style={a.card}>
          <Text style={a.notice}>未能确认生成结果，请先查看历史草稿，避免重复消耗额度。</Text>
          <AButton
            title="查看历史草稿核对"
            onPress={() => {
              setTab('history');
              history.reload();
            }}
          />
          <AButton
            title="已核对，可重新生成"
            secondary
            onPress={() =>
              Alert.alert('确认没有重复草稿？', '重新生成将使用新的服务额度。', [
                { text: '取消', style: 'cancel' },
                { text: '确认', onPress: () => setUncertain(false) },
              ])
            }
          />
        </View>
      )}
      {tab === 'history' ? (
        <>
          <AcademicQuery loading={history.loading} error={history.error} retry={history.reload} />
          {!history.error &&
            history.data?.items.map((d) => (
              <View key={d.id} style={a.card}>
                <Text style={a.subtitle}>{d.title}</Text>
                <Text style={a.muted}>
                  {{ pending: '生成中', ready: '待审阅', failed: '生成失败', saved: '已保存' }[d.status]} ·{' '}
                  {d.questionCount} 题 · {new Date(d.createdAt).toLocaleString()}
                </Text>
                {d.error && <Text style={a.error}>{d.error}</Text>}
                <AButton title="打开并审阅草稿" onPress={() => openDraft(d.id)} />
              </View>
            ))}
          {!history.loading && !history.error && !history.data?.total && (
            <Text style={a.muted}>还没有可查看的出题草稿。</Text>
          )}
          <View style={a.row}>
            <AButton
              title="上一页草稿"
              secondary
              disabled={page === 1}
              onPress={() => setPage((p) => p - 1)}
            />
            <AButton
              title="下一页草稿"
              secondary
              disabled={!history.data || page * 10 >= history.data.total}
              onPress={() => setPage((p) => p + 1)}
            />
          </View>
        </>
      ) : (
        <>
          <View style={a.card}>
            <Text style={a.subtitle}>选择授课课程</Text>
            <TextInput
              accessibilityLabel="搜索出题课程"
              style={a.input}
              value={search}
              onChangeText={(value) => {
                setSearch(value);
                setCoursePage(1);
              }}
              editable={!busy}
            />
            <AcademicQuery loading={courses.loading} error={courses.error} retry={courses.reload} />
            {courses.data?.items
              .filter((c) => c.status !== 'ARCHIVED')
              .map((c) => (
                <AcademicChoice
                  key={c.id}
                  title={c.title}
                  selected={courseId === c.id}
                  disabled={busy}
                  onPress={() => setCourseId(c.id)}
                />
              ))}
            <View style={a.row}>
              <AButton
                title="上一页课程"
                secondary
                disabled={coursePage === 1 || busy}
                onPress={() => setCoursePage((p) => p - 1)}
              />
              <AButton
                title="下一页课程"
                secondary
                disabled={!courses.data || coursePage * 10 >= courses.data.total || busy}
                onPress={() => setCoursePage((p) => p + 1)}
              />
            </View>
            <AcademicChoice
              title="生成题目"
              selected={mode === 'questions'}
              disabled={busy}
              onPress={() => setMode('questions')}
            />
            <AcademicChoice
              title="生成草稿试卷"
              selected={mode === 'paper'}
              disabled={busy || !status.data?.canCreatePaper}
              onPress={() => setMode('paper')}
            />
            <TextInput
              accessibilityLabel="出题草稿标题"
              style={a.input}
              value={title}
              onChangeText={setTitle}
              maxLength={200}
              editable={!busy}
              placeholder="本次教学主题"
            />
            <TextInput
              accessibilityLabel="出题知识点"
              style={[a.input, a.textarea]}
              value={knowledge}
              onChangeText={setKnowledge}
              multiline
              editable={!busy}
              placeholder="每行一个知识点，最多20项"
            />
            <TextInput
              accessibilityLabel="教学与出题要求"
              style={[a.input, a.textarea]}
              value={requirements}
              onChangeText={setRequirements}
              maxLength={2000}
              multiline
              editable={!busy}
              placeholder="教学目标、易错点、情境或难度要求"
            />
            <TextInput
              accessibilityLabel="出题参考材料"
              style={[a.input, a.textarea]}
              value={material}
              onChangeText={setMaterial}
              maxLength={10000}
              multiline
              editable={!busy}
              placeholder="可选：粘贴有权使用的纯文本材料"
            />
          </View>
          <View style={a.card}>
            <Text style={a.subtitle}>题型与分值</Text>
            <Text style={a.muted}>数量填0表示不生成该题型，总计最多10题。分值最多两位小数，难度1至5。</Text>
            {blueprint.map((row, i) => (
              <View key={row.type} style={a.child}>
                <Text style={a.subtitle}>{authoringTypeLabels[row.type]}</Text>
                {(
                  [
                    ['count', '数量'],
                    ['score', '每题分值'],
                    ['difficulty', '难度'],
                  ] as const
                ).map(([key, label]) => (
                  <View key={key}>
                    <Text style={a.muted}>{label}</Text>
                    <TextInput
                      accessibilityLabel={authoringTypeLabels[row.type] + label}
                      style={a.input}
                      value={row[key]}
                      keyboardType="numbers-and-punctuation"
                      editable={!busy}
                      onChangeText={(value) =>
                        setBlueprint((old) =>
                          old.map((item, j) => (j === i ? { ...item, [key]: value } : item)),
                        )
                      }
                    />
                  </View>
                ))}
              </View>
            ))}
            <AButton
              title={busy ? '正在生成…' : '生成草稿并进入审阅'}
              disabled={busy || uncertain || !status.data?.available || !!status.error}
              onPress={create}
            />
          </View>
        </>
      )}
    </ScrollView>
  );
}

export function AiAuthoringEditor({
  client,
  id,
  openHistory,
  registerLeave,
}: {
  client: MobileClient;
  id: string;
  openHistory(): void;
  registerLeave(guard: LeaveGuard): void;
}) {
  const path = authoringRoot + '/drafts/' + encodeURIComponent(id),
    q = useResource<AuthoringDraft>(client, path, 5000);
  const [base, setBase] = useState<AuthoringDraft | null>(null),
    [title, setTitle] = useState(''),
    [questions, setQuestions] = useState<AuthoringQuestionEdit[]>([]),
    [baseline, setBaseline] = useState(''),
    [confirmed, setConfirmed] = useState(false),
    [busy, setBusy] = useState(false),
    [blocked, setBlocked] = useState(false),
    [message, setMessage] = useState('');
  const live = useAcademicLive(client),
    flight = useRef(false);
  const adopt = (draft: AuthoringDraft) => {
    const rows = draft.questions.map(editAuthoringQuestion);
    setBase(draft);
    setTitle(draft.title);
    setQuestions(rows);
    setBaseline(JSON.stringify({ title: draft.title, questions: rows }));
    setBlocked(false);
    setConfirmed(false);
  };
  const dirty = !!base && JSON.stringify({ title, questions }) !== baseline;
  useEffect(() => {
    if (q.data && (!base || (base.status === 'pending' && !dirty))) adopt(q.data);
  }, [q.data, base, dirty]);
  useAcademicLeave(registerLeave, dirty || blocked, busy);
  const change = (index: number, patch: Partial<AuthoringQuestionEdit>) => {
    setQuestions((old) => old.map((q, i) => (i === index ? { ...q, ...patch } : q)));
    setConfirmed(false);
  };
  const save = () => {
    if (!base || !confirmed) return;
    let payload: unknown;
    try {
      if (!title.trim()) throw new Error('请填写草稿标题');
      payload = {
        revision: base.revision,
        title: title.trim(),
        questions: commitAuthoringQuestions(questions),
      };
    } catch (e) {
      setMessage((e as Error).message);
      return;
    }
    Alert.alert(
      '确认保存已审阅内容？',
      base.mode === 'paper'
        ? '会创建私人题目和草稿试卷，不会自动发布考试。'
        : '会创建私人题目，默认不开放学生练习。',
      [
        { text: '取消', style: 'cancel' },
        {
          text: '确认保存',
          onPress: () => {
            if (flight.current || blocked) return;
            flight.current = true;
            setBusy(true);
            setMessage('');
            void client
              .request<AuthoringDraft>(path + '/commit', payload, 'POST')
              .then((draft) => {
                if (live()) {
                  adopt(draft);
                  setMessage('已保存为私人题目' + (draft.savedPaperId ? '和草稿试卷' : '') + '。');
                }
              })
              .catch((e) => {
                if (live()) {
                  setMessage((e as Error).message);
                  if (!(e instanceof MobileApiError) || e.status === 0 || e.status >= 500 || e.status === 409)
                    setBlocked(true);
                }
              })
              .finally(() => {
                flight.current = false;
                if (live()) setBusy(false);
              });
          },
        },
      ],
    );
  };
  const refresh = async () => {
    if (flight.current) return;
    flight.current = true;
    setBusy(true);
    try {
      const latest = await client.request<AuthoringDraft>(path);
      if (!live()) return;
      setBase(latest);
      setBlocked(false);
      setConfirmed(false);
      setMessage(
        latest.status === 'saved'
          ? '服务器已保存此草稿，当前本机输入仍保留供核对，不能重复提交。'
          : '已刷新版本并保留当前输入，请重新审阅并确认后保存。',
      );
    } catch (e) {
      if (live()) setMessage((e as Error).message);
    } finally {
      flight.current = false;
      if (live()) setBusy(false);
    }
  };
  const remove = () =>
    Alert.alert('删除此 AI 草稿？', '已经保存到题库或试卷库的内容不会因此删除。', [
      { text: '取消', style: 'cancel' },
      {
        text: '删除草稿',
        style: 'destructive',
        onPress: () => {
          if (flight.current) return;
          flight.current = true;
          setBusy(true);
          void client
            .request(path, undefined, 'DELETE')
            .then(() => {
              if (live()) {
                registerLeave(null);
                openHistory();
              }
            })
            .catch((e) => {
              if (live()) setMessage((e as Error).message);
            })
            .finally(() => {
              flight.current = false;
              if (live()) setBusy(false);
            });
        },
      },
    ]);
  const disabled = busy || !!q.error || base?.status !== 'ready';
  return (
    <ScrollView contentContainerStyle={a.page} keyboardShouldPersistTaps="handled">
      <AcademicQuery loading={q.loading} error={q.error} retry={q.reload} />
      {base && !q.error && (
        <>
          <View style={a.card}>
            <Text style={a.title}>审阅 AI 出题草稿</Text>
            <Text style={a.muted}>
              {{ pending: '生成中', ready: '待教师审阅', failed: '生成失败', saved: '已保存' }[base.status]} ·{' '}
              {base.model}
            </Text>
            {base.error && <Text style={a.error}>{base.error}</Text>}
            <TextInput
              accessibilityLabel="审阅草稿标题"
              style={a.input}
              value={title}
              onChangeText={(value) => {
                setTitle(value);
                setConfirmed(false);
              }}
              editable={!disabled}
              maxLength={200}
            />
            {!!message && <Text style={a.notice}>{message}</Text>}
            {base.status === 'saved' && (
              <Text style={a.notice}>
                已保存 {base.savedQuestionIds.length} 道私人题目{base.savedPaperId ? '和一份草稿试卷' : ''}
                。发布或安排考试仍需在对应教学工作台完成。
              </Text>
            )}
          </View>
          {questions.map((question, index) => (
            <View key={index} style={a.card}>
              <Text style={a.subtitle}>
                第 {index + 1} 题 · {authoringTypeLabels[question.type]}
              </Text>
              <Text style={a.muted}>题干（纯文本；填空用 ___ 标记）</Text>
              <TextInput
                accessibilityLabel={`第${index + 1}题题干`}
                value={question.stem}
                onChangeText={(stem) => change(index, { stem })}
                style={[a.input, a.textarea]}
                multiline
                maxLength={8000}
                editable={!disabled}
              />
              {question.options.map((option, j) => (
                <View key={option.id}>
                  <Text style={a.muted}>选项 {option.id}</Text>
                  <TextInput
                    accessibilityLabel={`第${index + 1}题选项${option.id}`}
                    style={a.input}
                    value={option.text}
                    onChangeText={(text) =>
                      change(index, {
                        options: question.options.map((o, k) => (k === j ? { ...o, text } : o)),
                      })
                    }
                    maxLength={1000}
                    editable={!disabled}
                  />
                  <AcademicChoice
                    title={'正确答案包含 ' + option.id}
                    selected={question.answer.includes(option.id)}
                    disabled={disabled}
                    onPress={() =>
                      change(index, {
                        answer:
                          question.type === 'single'
                            ? [option.id]
                            : question.answer.includes(option.id)
                              ? question.answer.filter((v) => v !== option.id)
                              : [...question.answer, option.id],
                      })
                    }
                  />
                </View>
              ))}
              {question.type === 'boolean' ? (
                ['true', 'false'].map((answer) => (
                  <AcademicChoice
                    key={answer}
                    title={answer === 'true' ? '正确' : '错误'}
                    selected={question.answer[0] === answer}
                    disabled={disabled}
                    onPress={() => change(index, { answer: [answer] })}
                  />
                ))
              ) : ['blank', 'short'].includes(question.type) ? (
                <>
                  <Text style={a.muted}>
                    {question.type === 'blank' ? '每行填写一个空位的答案' : '参考答案'}
                  </Text>
                  <TextInput
                    accessibilityLabel={`第${index + 1}题参考答案`}
                    style={[a.input, a.textarea]}
                    multiline
                    value={question.answerText}
                    onChangeText={(answerText) => change(index, { answerText })}
                    editable={!disabled}
                  />
                </>
              ) : null}
              <Text style={a.muted}>解析</Text>
              <TextInput
                accessibilityLabel={`第${index + 1}题解析`}
                style={[a.input, a.textarea]}
                multiline
                maxLength={8000}
                value={question.explanation}
                onChangeText={(explanation) => change(index, { explanation })}
                editable={!disabled}
              />
              <Text style={a.muted}>知识点（每行一个）</Text>
              <TextInput
                accessibilityLabel={`第${index + 1}题知识点`}
                style={[a.input, a.textarea]}
                multiline
                value={question.knowledgeText}
                onChangeText={(knowledgeText) => change(index, { knowledgeText })}
                editable={!disabled}
              />
              <Text style={a.muted}>分值</Text>
              <TextInput
                accessibilityLabel={`第${index + 1}题分值`}
                style={a.input}
                keyboardType="numbers-and-punctuation"
                value={question.scoreText}
                onChangeText={(scoreText) => change(index, { scoreText })}
                editable={!disabled}
              />
              <Text style={a.muted}>难度（1至5）</Text>
              <TextInput
                accessibilityLabel={`第${index + 1}题难度`}
                style={a.input}
                keyboardType="number-pad"
                value={question.difficultyText}
                onChangeText={(difficultyText) => change(index, { difficultyText })}
                editable={!disabled}
              />
              <AButton
                title={`移除第${index + 1}题`}
                secondary
                disabled={disabled || questions.length === 1}
                onPress={() => {
                  setQuestions((old) => old.filter((_, i) => i !== index));
                  setConfirmed(false);
                }}
              />
            </View>
          ))}
          <View style={a.card}>
            <Text style={a.notice}>
              请逐题核对事实、答案、解析、题目歧义和材料使用权限。AI 生成不等于经过审核。
            </Text>
            {blocked && (
              <AButton
                title="保留输入并核对服务器版本"
                secondary
                disabled={busy}
                onPress={() => void refresh()}
              />
            )}
            <AcademicChoice
              title="我已逐题审阅并确认可保存"
              selected={confirmed}
              disabled={disabled || blocked}
              onPress={() => setConfirmed((v) => !v)}
            />
            <AButton
              title={busy ? '正在保存…' : '保存审阅后的题目'}
              disabled={disabled || blocked || !confirmed}
              onPress={save}
            />
            <AButton
              title="删除此草稿"
              secondary
              disabled={busy || base.status === 'pending'}
              onPress={remove}
            />
            <AButton title="返回历史草稿" secondary disabled={busy} onPress={openHistory} />
          </View>
        </>
      )}
    </ScrollView>
  );
}
