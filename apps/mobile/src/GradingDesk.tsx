import React, { useState } from 'react';
import { Text, View, ScrollView } from 'react-native';
import { a, AButton, RichText, AnswerInput } from './assignment-ui';
import { type AnswerValue, type Question } from './assignment-model';
import type { MobileClient } from './client';
import { useResource } from './resource';
import { confirmAction, Field, Pager, State, usePage, useSave } from './staff-ui';
type Entry = {
  id: string;
  parentId: string;
  title: string;
  studentName: string;
  courseTitle: string;
  type: 'assignment' | 'exam' | 'appeal';
};
type Answer = { questionVersionId: string; value: AnswerValue; scoreCents?: number | null; comment?: string };
type Feedback = { questionVersionId: string; scoreCents: number | null; comment: string };
type Paper = {
  revision: number;
  comment: string;
  questions: { id: string; q: Question }[];
  answers: Answer[];
  previous: Feedback[];
};
type AssignmentPaper = {
  assignment: { items: { questionVersionId: string; question: Question }[] };
  submission: {
    answers: Answer[];
    revision: number;
    feedback?: string;
    grading?: { comment: string; items: Feedback[] }[];
  };
};
type ExamPaper = {
  items: (Question & { questionVersionId?: string })[];
  gradingRevision: number;
  feedback?: string;
  answers: Answer[];
};
const names = { assignment: '作业', exam: '考试', appeal: '成绩复核' };
const base = '/mobile/staff/grading';
export function GradingDesk({ client }: { client: MobileClient }) {
  const [page, setPage] = useState(1),
    [entry, setEntry] = useState<Entry | null>(null);
  const q = usePage<Entry>(client, base, page);
  function close() {
    setEntry(null);
    q.reload();
  }
  return (
    <ScrollView contentContainerStyle={a.page} keyboardShouldPersistTaps="handled">
      <Text style={a.title}>批阅中心</Text>
      {entry ? (
        <>
          <Text style={a.subtitle}>
            {entry.title} · {entry.studentName}
          </Text>
          <AButton secondary title="返回待批列表" onPress={close} />
          {entry.type === 'appeal' ? (
            <Appeal client={client} id={entry.id} close={close} />
          ) : (
            <LoadPaper client={client} entry={entry} close={close} />
          )}
        </>
      ) : (
        <>
          <State resource={q} />
          {!q.error &&
            q.data?.items.map((e) => (
              <View style={a.card} key={e.type + e.id}>
                <Text style={a.subtitle}>{e.title}</Text>
                <Text>
                  {e.courseTitle} · {e.studentName} · {names[e.type]}
                </Text>
                <AButton title="查看并处理" onPress={() => setEntry(e)} />
              </View>
            ))}
          {q.data && !q.error && (
            <>
              {!q.data.total && <Text>暂无待处理记录</Text>}
              <Pager page={page} total={q.data.total} change={setPage} />
            </>
          )}
        </>
      )}
    </ScrollView>
  );
}
function LoadPaper({ client, entry, close }: { client: MobileClient; entry: Entry; close(): void }) {
  const assignment = entry.type === 'assignment';
  const q = useResource<AssignmentPaper | ExamPaper>(
    client,
    base +
      '/' +
      (assignment ? 'assignments/' + encodeURIComponent(entry.parentId) + '/' : 'exams/') +
      encodeURIComponent(entry.id),
  );
  if (!q.data || q.error) return <State resource={q} />;
  let paper: Paper;
  if ('assignment' in q.data) {
    const { assignment, submission } = q.data;
    paper = {
      revision: submission.revision,
      comment: submission.grading?.[0]?.comment || submission.feedback || '',
      questions: assignment.items.map((i) => ({ id: i.questionVersionId, q: i.question })),
      answers: submission.answers,
      previous: submission.grading?.[0]?.items || [],
    };
  } else {
    const d = q.data;
    paper = {
      revision: d.gradingRevision,
      comment: d.feedback || '',
      questions: d.items.map((q) => ({ id: q.questionVersionId || q.id, q })),
      answers: d.answers,
      previous: d.answers.map((a) => ({ ...a, scoreCents: a.scoreCents ?? null, comment: a.comment || '' })),
    };
  }
  return (
    <Grade
      key={entry.id + ':' + paper.revision}
      client={client}
      paper={paper}
      path={base + '/' + (assignment ? 'submissions/' : 'exams/') + encodeURIComponent(entry.id)}
      close={close}
      reload={q.reload}
    />
  );
}
function Grade({
  client,
  paper,
  path,
  close,
  reload,
}: {
  client: MobileClient;
  paper: Paper;
  path: string;
  close(): void;
  reload(): void;
}) {
  const [scores, setScores] = useState<Record<string, string>>(() =>
      Object.fromEntries(
        paper.previous
          .filter((f) => f.scoreCents != null)
          .map((f) => [f.questionVersionId, String(f.scoreCents! / 100)]),
      ),
    ),
    [comments, setComments] = useState<Record<string, string>>(() =>
      Object.fromEntries(paper.previous.map((f) => [f.questionVersionId, f.comment])),
    ),
    [feedback, setFeedback] = useState(paper.comment);
  const write = useSave(client);
  const items = paper.questions
    .filter(({ id }) => scores[id]?.trim())
    .map(({ id }) => ({
      questionVersionId: id,
      scoreCents: Math.round(Number(scores[id]) * 100),
      comment: comments[id] || '',
    }));
  const invalid = paper.questions.some(
    ({ id, q }) =>
      scores[id]?.trim() &&
      (!/^\d+(\.\d{1,2})?$/.test(scores[id]) || Number(scores[id]) * 100 > q.scoreCents + 1e-6),
  );
  return (
    <View style={a.card}>
      {paper.questions.map(({ id, q }, i) => (
        <View key={id} style={a.child}>
          <Text>
            第 {i + 1} 题 · 满分 {q.scoreCents / 100}
          </Text>
          <RichText html={q.stem} />
          <AnswerInput
            question={q}
            value={paper.answers.find((v) => v.questionVersionId === id)?.value}
            label={'第' + (i + 1) + '题'}
            change={() => {}}
            disabled
          />
          <Field
            label="本题得分"
            value={scores[id] || ''}
            set={(v) => setScores((p) => ({ ...p, [id]: v }))}
          />
          <Field
            label="本题评语"
            value={comments[id] || ''}
            set={(v) => setComments((p) => ({ ...p, [id]: v }))}
          />
        </View>
      ))}
      <Field label="总体反馈" multiline value={feedback} set={setFeedback} />
      {!!write.notice && <Text style={a.notice}>{write.notice}</Text>}
      <AButton
        title="核对服务器版本"
        secondary
        onPress={() => confirmAction('重新读取批阅记录', '其他设备更新时，将载入服务器上的评分。', reload)}
      />
      {[false, true].map((finalize) => (
        <AButton
          key={String(finalize)}
          title={finalize ? '完成批阅' : '暂存评分'}
          disabled={write.busy || invalid}
          onPress={() =>
            confirmAction(
              finalize ? '确认完成批阅' : '暂存当前评分',
              feedback || '保存本次评分与评语？',
              () =>
                void write.save(
                  path,
                  { revision: paper.revision, comment: feedback, items, finalize },
                  'PUT',
                  close,
                ),
            )
          }
        />
      ))}
    </View>
  );
}
function Appeal({ id, client, close }: { id: string; client: MobileClient; close(): void }) {
  const path = base + '/appeals/' + encodeURIComponent(id),
    q = useResource<{ reason: string; status: string }>(client, path),
    write = useSave(client);
  const [resolution, set] = useState(''),
    [score, setScore] = useState('');
  return (
    <View style={a.card}>
      <State resource={q} />
      {q.data && !q.error && (
        <>
          <Text style={a.body}>{q.data.reason}</Text>
          <Field label="处理意见" value={resolution} set={set} />
          <Field label="调整后的总分（维持原分可留空）" value={score} set={setScore} />
          <AButton
            title="确认处理复核"
            disabled={
              write.busy || resolution.trim().length < 5 || (!!score && !/^\d+(\.\d{1,2})?$/.test(score))
            }
            onPress={() =>
              confirmAction(
                '处理成绩复核',
                resolution,
                () =>
                  void write.save(
                    path,
                    { resolution, ...(score ? { scoreCents: Math.round(Number(score) * 100) } : {}) },
                    'POST',
                    close,
                  ),
              )
            }
          />
        </>
      )}
      {!!write.notice && <Text>{write.notice}</Text>}
    </View>
  );
}
