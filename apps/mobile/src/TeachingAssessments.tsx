import { TeachingField as Field, TeachingPanel } from './teaching-ui';
import React, { useEffect, useState } from 'react';
import { Text, View } from 'react-native';
import type { MobileClient, MobileUser } from './client';
import { a, AButton, RichText } from './assignment-ui';
import { Pager, Picker, State, confirmAction, usePage } from './staff-ui';
import { useResource } from './resource';
import {
  teachingApi,
  teachingDate,
  teachingInteger,
  teachingRoot,
  type TeachingQuestion,
  type TeachingPaper,
  type TeachingAssessment,
  type TeachingRoster,
} from './teaching-model';
import {
  TeachingAudience,
  TeachingNotice,
  useTeachingGuard,
  useTeachingOperation,
  type TeachingGuard,
} from './teaching-ui';
export function TeachingPapers({
  client,
  course,
  registerLeave,
}: {
  client: MobileClient;
  course: string;
  registerLeave: TeachingGuard;
}) {
  const [page, setPage] = useState(1),
    [qpage, setQpage] = useState(1),
    [title, setTitle] = useState(''),
    [ids, setIds] = useState<string[]>([]),
    [reuse, setReuse] = useState<TeachingPaper>();
  const list = usePage<TeachingPaper>(client, teachingRoot + '/papers?courseId=' + course, page),
    questions = usePage<TeachingQuestion>(client, teachingRoot + '/questions?courseId=' + course, qpage),
    op = useTeachingOperation(client);
  useTeachingGuard(!reuse && (!!title || ids.length > 0), op.busy, registerLeave, !reuse);
  if (reuse)
    return (
      <PaperReuse
        key={reuse.id}
        client={client}
        course={course}
        paper={reuse}
        back={() => setReuse(undefined)}
        registerLeave={registerLeave}
      />
    );
  return (
    <TeachingPanel busy={op.busy}>
      <Text style={a.subtitle}>试卷库</Text>
      <Text style={a.muted}>
        选中的题目版本固定保存，可复用生成测评草稿。保密考试须使用未公开、未用于正式考试的题目。
      </Text>
      <Field label="试卷名称" value={title} set={setTitle} />
      <Text>已选择 {ids.length} 题</Text>
      <State resource={questions} />
      {!questions.error &&
        questions.data?.items.map((q) => {
          const v = q.versions[0];
          return v ? (
            <View key={q.id} style={a.child}>
              <RichText html={v.stem} />
              <Text>
                版本 {v.version} · {v.scoreCents / 100} 分
              </Text>
              <AButton
                secondary={!ids.includes(v.id)}
                title={ids.includes(v.id) ? '取消选题' : '选择题目'}
                onPress={() => setIds(ids.includes(v.id) ? ids.filter((id) => id !== v.id) : [...ids, v.id])}
              />
            </View>
          ) : null;
        })}
      {questions.data && <Pager page={qpage} total={questions.data.total} change={setQpage} />}
      <AButton
        title="保存试卷"
        disabled={op.busy || !title.trim() || !ids.length || ids.length > 200}
        onPress={() =>
          void op.run(
            () =>
              client.request(
                teachingRoot + '/papers',
                { courseId: course, title, questionVersionIds: ids },
                'POST',
              ),
            () => {
              setTitle('');
              setIds([]);
              list.reload();
            },
          )
        }
      />
      <TeachingNotice operation={op} />
      <State resource={list} />
      {!list.error &&
        list.data?.items.map((p) => (
          <View key={p.id} style={a.child}>
            <Text style={a.subtitle}>{p.title}</Text>
            <Text>
              {p.items.length} 题 · {p.totalCents / 100} 分
            </Text>
            <AButton
              title="查看并复用试卷"
              disabled={op.busy}
              onPress={() => {
                const go = () => setReuse(p);
                if (title || ids.length)
                  confirmAction('暂离选题表单', '本次未保存的选题将保留在当前页面，返回后可继续。', go);
                else go();
              }}
            />
          </View>
        ))}
      {list.data && <Pager page={page} total={list.data.total} change={setPage} />}
    </TeachingPanel>
  );
}
function PaperReuse({
  client,
  course,
  paper,
  back,
  registerLeave,
}: {
  client: MobileClient;
  course: string;
  paper: TeachingPaper;
  back(): void;
  registerLeave: TeachingGuard;
}) {
  const [kind, setKind] = useState<'assignments' | 'exams'>('assignments'),
    [title, setTitle] = useState(paper.title),
    [start, setStart] = useState(''),
    [end, setEnd] = useState(''),
    [entry, setEntry] = useState(''),
    [duration, setDuration] = useState('60'),
    [pass, setPass] = useState('0'),
    [graders, setGraders] = useState<string[]>([]),
    [audience, setAudience] = useState<string[]>([]),
    [created, setCreated] = useState<TeachingAssessment>(),
    op = useTeachingOperation(client);
  useTeachingGuard(
    !created &&
      (!!start ||
        !!end ||
        !!entry ||
        audience.length > 0 ||
        graders.length > 0 ||
        title !== paper.title ||
        duration !== '60' ||
        pass !== '0'),
    op.busy,
    registerLeave,
  );
  const create = () =>
    op.run(async () => {
      const from = teachingDate(start, '开始时间'),
        to = teachingDate(end, '截止时间');
      if (to <= from) throw new Error('截止时间必须晚于开始时间');
      const common = {
        courseId: course,
        title,
        questionVersionIds: paper.items.map((i) => i.questionVersionId),
        audienceIds: audience,
      };
      return client.request<TeachingAssessment>(
        teachingRoot + '/' + kind,
        kind === 'assignments'
          ? { ...common, opensAt: from, dueAt: to }
          : {
              ...common,
              startsAt: from,
              endsAt: to,
              entryClosesAt: entry.trim() ? teachingDate(entry, '最晚入场时间') : to,
              durationMinutes: teachingInteger(duration, '答题时长', 1, 1440),
              passCents: teachingInteger(pass, '及格分数', 0, 1000000) * 100,
              graderIds: graders,
            },
        'POST',
      );
    }, setCreated);
  return (
    <TeachingPanel busy={op.busy}>
      <AButton
        secondary
        title="返回试卷库"
        disabled={op.busy}
        onPress={() =>
          !created && (start || end || entry || audience.length || graders.length || title !== paper.title)
            ? confirmAction('放弃测评草稿输入？', '尚未保存的时间、标题和人员选择将丢失。', back)
            : back()
        }
      />
      <Text style={a.subtitle}>{paper.title}</Text>
      {paper.items.map((item, index) => (
        <View key={item.questionVersionId} style={a.child}>
          <Text>
            第 {index + 1} 题 · 版本 {item.questionVersion.version}
          </Text>
          <RichText html={item.questionVersion.stem} />
        </View>
      ))}
      {created ? (
        <>
          <Text style={a.notice}>
            已创建{kind === 'exams' ? '考试' : '作业'}草稿：{created.title}
          </Text>
          <Text>发布前请在“作业安排”或“考试安排”检查受众及时间。</Text>
          <AButton
            title="确认发布此草稿"
            disabled={op.busy || created.status !== 'draft'}
            onPress={() =>
              confirmAction(
                '发布测评',
                created.title + '。将按当前学生名单开放。',
                () =>
                  void op.run(
                    () =>
                      client.request<TeachingAssessment>(
                        teachingRoot + '/' + kind + '/' + created.id + '/publish',
                        {},
                        'POST',
                      ),
                    (next) => setCreated({ ...created, ...next, status: 'published' }),
                  ),
              )
            }
          />
        </>
      ) : (
        <>
          <Picker
            label="复用方式"
            id={kind}
            change={(x) => setKind(x as 'assignments' | 'exams')}
            items={[
              { id: 'assignments', name: '创建作业草稿' },
              { id: 'exams', name: '创建考试草稿' },
            ]}
          />
          <Field label="测评标题" value={title} set={setTitle} />
          <Field label="开始时间（本地，如 2026-12-01T09:00）" value={start} set={setStart} />
          <Field label="截止时间（本地）" value={end} set={setEnd} />
          {kind === 'exams' && (
            <>
              <Field label="最晚入场时间（空白采用截止时间）" value={entry} set={setEntry} />
              <Field label="答题时长（分钟）" value={duration} set={setDuration} />
              <Field label="及格分数（整数）" value={pass} set={setPass} />
              <TeachingAudience
                client={client}
                course={course}
                kind="teacher"
                ids={graders}
                change={setGraders}
              />
              <Text style={a.muted}>含主观题时必须指定本课程阅卷教师。</Text>
            </>
          )}
          <Text style={a.muted}>未勾选学生时采用当前课程全部学生。保存后名单固定，可在测评安排中修订。</Text>
          <TeachingAudience client={client} course={course} ids={audience} change={setAudience} />
          <AButton
            title="创建测评草稿"
            disabled={op.busy || !title.trim() || !start || !end}
            onPress={() => void create()}
          />
        </>
      )}
      <TeachingNotice operation={op} />
    </TeachingPanel>
  );
}
export function TeachingAssessments({
  client,
  user,
  course,
  kind,
  registerLeave,
}: {
  client: MobileClient;
  user: MobileUser;
  course: string;
  kind: 'assignments' | 'exams';
  registerLeave: TeachingGuard;
}) {
  const [page, setPage] = useState(1),
    [selected, select] = useState('');
  const q = usePage<TeachingAssessment>(client, teachingRoot + '/' + kind + '?courseId=' + course, page);
  if (selected)
    return (
      <Arrangement
        key={selected}
        client={client}
        user={user}
        course={course}
        kind={kind}
        id={selected}
        back={() => {
          select('');
          q.reload();
        }}
        registerLeave={registerLeave}
      />
    );
  return (
    <View style={a.card}>
      <Text style={a.subtitle}>{kind === 'exams' ? '考试' : '作业'}安排</Text>
      <State resource={q} />
      {!q.error &&
        q.data?.items.map((row) => (
          <View key={row.id} style={a.child}>
            <Text>
              {row.title} · {row.status}
            </Text>
            <AButton title="名单与个别安排" onPress={() => select(row.id)} />
          </View>
        ))}
      {q.data && <Pager page={page} total={q.data.total} change={setPage} />}
    </View>
  );
}
function Arrangement({
  client,
  user,
  course,
  kind,
  id,
  back,
  registerLeave,
}: {
  client: MobileClient;
  user: MobileUser;
  course: string;
  kind: 'assignments' | 'exams';
  id: string;
  back(): void;
  registerLeave: TeachingGuard;
}) {
  const q = useResource<TeachingAssessment>(client, teachingRoot + '/' + kind + '/' + id),
    [record, setRecord] = useState<TeachingAssessment>(),
    [ids, setIds] = useState<string[]>([]),
    [baseline, setBaseline] = useState(''),
    [roster, setRoster] = useState(false),
    op = useTeachingOperation(client);
  const accept = (r: TeachingAssessment) => {
    setRecord(r);
    const ids = (r.audience || []).map((x) => x.userId);
    setIds(ids);
    setBaseline(JSON.stringify(ids));
  };
  useEffect(() => {
    if (q.data && !record) accept(q.data);
  }, [q.data, record]);
  const dirty = JSON.stringify(ids) !== baseline && !!record;
  useTeachingGuard(!roster && dirty, op.busy, registerLeave, !roster);
  if (roster && record)
    return (
      <Roster
        client={client}
        record={record}
        kind={kind}
        registerLeave={registerLeave}
        back={() => setRoster(false)}
      />
    );
  const reload = () => client.request<TeachingAssessment>(teachingRoot + '/' + kind + '/' + id);
  return (
    <TeachingPanel busy={op.busy}>
      <AButton
        secondary
        title="返回测评列表"
        disabled={op.busy}
        onPress={() => (dirty ? confirmAction('放弃名单修改？', '未保存的学生选择将丢失。', back) : back())}
      />
      <State resource={q} />
      {record && (
        <>
          <Text style={a.subtitle}>{record.title}</Text>
          <Text>
            状态 {record.status} · 修订 {record.revision}
          </Text>
          <Text>
            开始 {record.opensAt || record.startsAt} / 截止 {record.dueAt || record.endsAt}
          </Text>
          {record.status === 'draft' && record.audience && user.permissions.includes('assessment.manage') && (
            <>
              <TeachingAudience client={client} course={course} ids={ids} change={setIds} />
              <Text style={a.muted}>未勾选学生会采用当前课程全部学生；发布后名单冻结，请改用个别安排。</Text>
              <AButton
                title="保存受众名单"
                disabled={op.busy || !dirty}
                onPress={() =>
                  confirmAction(
                    '更新测评受众',
                    '服务器将检查学生课程资格、已有作答和当前修订版本。',
                    () =>
                      void op.run(async () => {
                        await teachingApi.audience(client, kind, record, ids);
                        return reload();
                      }, accept),
                  )
                }
              />
            </>
          )}
          {record.status === 'draft' && user.permissions.includes('assessment.manage') && (
            <AButton
              title="发布测评"
              disabled={op.busy || dirty}
              onPress={() =>
                confirmAction(
                  '发布测评',
                  record.title,
                  () =>
                    void op.run(async () => {
                      await client.request(teachingRoot + '/' + kind + '/' + id + '/publish', {}, 'POST');
                      return reload();
                    }, accept),
                )
              }
            />
          )}
          <AButton
            secondary
            title="重新读取最新名单"
            disabled={op.busy}
            onPress={() =>
              confirmAction(
                '重新读取',
                '未保存的名单选择将被服务器内容替换。',
                () => void op.run(reload, accept),
              )
            }
          />
          {user.permissions.includes('assessment.grade') && (
            <AButton title="逐人处理与例外" disabled={op.busy || dirty} onPress={() => setRoster(true)} />
          )}
        </>
      )}
      <TeachingNotice operation={op} />
    </TeachingPanel>
  );
}
function Roster({
  client,
  record,
  kind,
  back,
  registerLeave,
}: {
  client: MobileClient;
  record: TeachingAssessment;
  kind: 'assignments' | 'exams';
  back(): void;
  registerLeave: TeachingGuard;
}) {
  const [page, setPage] = useState(1),
    [selected, setSelected] = useState<TeachingRoster>(),
    [reason, setReason] = useState(''),
    [until, setUntil] = useState(''),
    [attempts, setAttempts] = useState('0'),
    [exempt, setExempt] = useState(false),
    op = useTeachingOperation(client);
  const q = usePage<TeachingRoster>(client, teachingRoot + '/' + kind + '/' + record.id + '/roster', page);
  useTeachingGuard(!!reason || !!until || attempts !== '0', op.busy, registerLeave);
  const choose = (row: TeachingRoster) => {
    setSelected(row);
    setReason(row.exception?.reason || '');
    setUntil(row.exception?.allowUntil || '');
    setAttempts(String(row.exception?.extraAttempts || 0));
    setExempt(row.exception?.exempt || false);
  };
  const done = () => {
    setSelected(undefined);
    setReason('');
    setUntil('');
    setAttempts('0');
    q.reload();
  };
  return (
    <TeachingPanel busy={op.busy}>
      <AButton
        secondary
        title="返回受众安排"
        disabled={op.busy}
        onPress={() =>
          reason || until
            ? confirmAction('放弃未保存个别安排？', '尚未提交的原因和时间将丢失。', back)
            : back()
        }
      />
      <Text style={a.subtitle}>{record.title} · 学生处理</Text>
      <State resource={q} />
      {!q.error &&
        q.data?.items.map((row) => (
          <View style={a.child} key={row.user.id}>
            <Text>
              {row.user.name} · {row.user.username} · {row.status}
            </Text>
            {row.reason && <Text>资格说明：{row.reason}</Text>}
            <AButton
              title="处理此学生"
              disabled={op.busy}
              onPress={() => {
                if (selected && selected.user.id !== row.user.id && (reason || until))
                  confirmAction('更换处理对象', '将替换当前未提交的个别安排。', () => choose(row));
                else choose(row);
              }}
            />
          </View>
        ))}
      {q.data && <Pager page={page} total={q.data.total} change={setPage} />}{' '}
      {selected && (
        <View style={a.child}>
          <Text style={a.subtitle}>{selected.user.name}</Text>
          <Field label="处理原因（至少3字，学生可见）" multiline value={reason} set={setReason} />
          <Field
            label={kind === 'exams' ? '延时截止（本地时间）' : '允许补交至（本地时间，可选）'}
            value={until}
            set={setUntil}
          />
          <Field label="额外作答次数" value={attempts} set={setAttempts} />
          {kind === 'assignments' ? (
            <>
              <AButton
                secondary
                title={exempt ? '本次作业：豁免' : '本次作业：不豁免'}
                onPress={() => setExempt(!exempt)}
              />
              <AButton
                title="保存作业个别安排"
                disabled={op.busy || reason.trim().length < 3}
                onPress={() =>
                  confirmAction(
                    '保存个别安排',
                    selected.user.name,
                    () =>
                      void op.run(
                        () =>
                          client.request(
                            teachingRoot + '/assignments/' + record.id + '/exceptions',
                            {
                              userId: selected.user.id,
                              reason,
                              extraAttempts: teachingInteger(attempts, '额外次数', 0, 20),
                              exempt,
                              ...(until.trim() ? { allowUntil: teachingDate(until, '补交截止时间') } : {}),
                            },
                            'POST',
                          ),
                        done,
                      ),
                  )
                }
              />
              {selected.submission?.status === 'submitted' && (
                <AButton
                  title="退回本次提交重做"
                  disabled={op.busy || reason.trim().length < 3}
                  onPress={() =>
                    confirmAction(
                      '退回重做',
                      '将退回该学生最新提交，开放一次重做并通知学生。',
                      () =>
                        void op.run(
                          () =>
                            client.request(
                              teachingRoot + '/submissions/' + selected.submission!.id + '/return',
                              { reason },
                              'POST',
                            ),
                          done,
                        ),
                    )
                  }
                />
              )}
            </>
          ) : (
            <>
              <AButton
                title={selected.eligible ? '撤销考试资格' : '恢复考试资格'}
                disabled={op.busy || reason.trim().length < 3}
                onPress={() =>
                  confirmAction(
                    selected.eligible ? '撤销考试资格' : '恢复考试资格',
                    selected.eligible
                      ? '进行中的答卷将取消；恢复资格不会自动恢复已取消答卷。'
                      : '重新允许此学生参加考试，仍须满足考试时间和次数限制。',
                    () =>
                      void op.run(
                        () =>
                          client.request(
                            teachingRoot + '/exams/' + record.id + '/eligibility',
                            { userId: selected.user.id, eligible: !selected.eligible, reason },
                            'POST',
                          ),
                        done,
                      ),
                  )
                }
              />
              <AButton
                title="批准延时或额外考试次数"
                disabled={op.busy || !selected.eligible || reason.trim().length < 3 || !until.trim()}
                onPress={() =>
                  confirmAction(
                    '批准考试个别安排',
                    '服务端将检查成绩公开时间、考试状态和现有截止时间；不会缩短有效作答时间。',
                    () =>
                      void op.run(
                        () =>
                          client.request(
                            teachingRoot + '/exams/' + record.id + '/extension',
                            {
                              userId: selected.user.id,
                              reason,
                              deadlineAt: teachingDate(until, '延时截止'),
                              extraAttempts: teachingInteger(attempts, '额外次数', 0, 10),
                            },
                            'POST',
                          ),
                        done,
                      ),
                  )
                }
              />
            </>
          )}
        </View>
      )}
      <TeachingNotice operation={op} />
    </TeachingPanel>
  );
}
