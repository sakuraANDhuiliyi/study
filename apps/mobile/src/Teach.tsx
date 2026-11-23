import React, { useState } from 'react';
import { ScrollView, Text, View } from 'react-native';
import { AButton, a, RichText } from './assignment-ui';
import type { MobileClient, MobileUser } from './client';
import { Members, PersonPicker } from './SchoolSetup';
import { useResource } from './resource';
import { confirmAction, Field, Pager, Picker, State, usePage, useSave } from './staff-ui';

type Course = { id: string; title: string; status: string; chapters: { id: string; title: string }[] };
type Version = { id: string; stem: string; scoreCents: number };
type Question = { id: string; versions: Version[] };
type Tab = 'content' | 'questions' | 'assignments' | 'exams' | 'live';
const tabLabels: Record<Tab, string> = {
  content: '课程内容',
  questions: '题库',
  assignments: '作业',
  exams: '考试',
  live: '预约直播',
};

export function Teach({ client, user }: { client: MobileClient; user: MobileUser }) {
  const [page, setPage] = useState(1),
    [selected, select] = useState(''),
    [name, setName] = useState(''),
    [tab, setTab] = useState<Tab>('content');
  const [teacher, setTeacher] = useState('');
  const q = usePage<Course>(client, '/courses', page),
    write = useSave(client);
  if (user.role === 'STUDENT' || user.accountMode !== 'ORGANIZATION')
    return <Text style={a.error}>请切换到授课身份</Text>;
  return (
    <ScrollView contentContainerStyle={a.page} keyboardShouldPersistTaps="handled">
      <View style={a.card}>
        <Text style={a.title}>教学工作台</Text>
        <State resource={q} />
        {!q.error && q.data && (
          <>
            <Picker
              label="授课课程"
              id={selected}
              items={q.data.items.map((c) => ({ id: c.id, name: c.title }))}
              change={select}
            />
            <Pager
              page={page}
              total={q.data.total}
              change={(p) => {
                setPage(p);
                select('');
              }}
            />
          </>
        )}
        {(user.permissions.includes('course.manage') || user.permissions.includes('course.admin')) && (
          <>
            {user.role !== 'TEACHER' && (
              <PersonPicker client={client} role="TEACHER" id={teacher} change={setTeacher} />
            )}
            <Field label="新课程名称" value={name} set={setName} />
            <AButton
              title="创建课程草稿"
              disabled={name.trim().length < 2 || write.busy || (user.role !== 'TEACHER' && !teacher)}
              onPress={() =>
                void write.save(
                  '/mobile/staff/courses',
                  { title: name.trim(), ...(user.role !== 'TEACHER' ? { teacherId: teacher } : {}) },
                  'POST',
                  () => {
                    setName('');
                    setPage(1);
                    q.reload();
                  },
                )
              }
            />
          </>
        )}
        {!!write.notice && <Text style={a.notice}>{write.notice}</Text>}
      </View>
      {!!selected && (
        <>
          <View style={a.row}>
            {(Object.entries(tabLabels) as [Tab, string][])
              .filter(
                ([k]) =>
                  k === 'content' ||
                  k === 'live' ||
                  user.permissions.includes(k === 'questions' ? 'question.manage' : 'assessment.manage'),
              )
              .map(([id, label]) => (
                <AButton key={id} title={label} secondary={tab !== id} onPress={() => setTab(id)} />
              ))}
          </View>
          {tab === 'content' ? (
            <>
              <CourseContent key={selected} client={client} id={selected} />
              <Members key={'members' + selected} client={client} kind="courses" id={selected} />
            </>
          ) : tab === 'questions' ? (
            <QuestionBank key={selected} client={client} id={selected} />
          ) : (
            <Schedule key={selected + tab} client={client} id={selected} tab={tab} />
          )}
        </>
      )}
    </ScrollView>
  );
}
function CourseContent({ client, id }: { client: MobileClient; id: string }) {
  const q = useResource<Course>(client, '/courses/' + encodeURIComponent(id)),
    write = useSave(client);
  const [chapter, setChapter] = useState(''),
    [chapterTitle, setChapterTitle] = useState(''),
    [title, setTitle] = useState(''),
    [body, setBody] = useState('');
  return (
    <View style={a.card}>
      <State resource={q} />
      {!q.error && q.data && (
        <>
          <Text style={a.subtitle}>{q.data.title}</Text>
          <Field label="章节名称" value={chapterTitle} set={setChapterTitle} />
          <AButton
            title="添加章节"
            disabled={!chapterTitle.trim() || write.busy}
            onPress={() =>
              void write.save(
                '/mobile/staff/courses/' + id + '/chapters',
                { title: chapterTitle },
                'POST',
                () => {
                  setChapterTitle('');
                  q.reload();
                },
              )
            }
          />
          <Picker
            label="课时所属章节"
            items={q.data.chapters.map((c) => ({ id: c.id, name: c.title }))}
            id={chapter}
            change={setChapter}
          />
          <Field label="课时名称" value={title} set={setTitle} />
          <Field multiline label="课时正文" value={body} set={setBody} />
          <AButton
            title="添加文字课时"
            disabled={!chapter || !title.trim() || !body.trim() || write.busy}
            onPress={() =>
              void write.save(
                '/mobile/staff/chapters/' + chapter + '/lessons',
                { title, content: body, type: 'TEXT' },
                'POST',
                () => {
                  setTitle('');
                  setBody('');
                  q.reload();
                },
              )
            }
          />
          {q.data.status !== 'ARCHIVED' && (
            <AButton
              title={q.data.status === 'PUBLISHED' ? '下架课程' : '发布课程'}
              disabled={write.busy}
              onPress={() => {
                const status = q.data!.status === 'PUBLISHED' ? 'UNPUBLISHED' : 'PUBLISHED';
                confirmAction(
                  '更改课程可见性',
                  q.data!.title,
                  () =>
                    void write.save('/mobile/staff/courses/' + id + '/status', { status }, 'PATCH', q.reload),
                );
              }}
            />
          )}
        </>
      )}
      {!!write.notice && <Text style={a.notice}>{write.notice}</Text>}
    </View>
  );
}
function QuestionBank({ client, id }: { client: MobileClient; id: string }) {
  const [page, setPage] = useState(1),
    [type, setType] = useState('short'),
    [stem, setStem] = useState(''),
    [answer, setAnswer] = useState(''),
    [choices, setChoices] = useState(''),
    [score, setScore] = useState('10');
  const q = usePage<Question>(client, '/mobile/staff/questions?courseId=' + encodeURIComponent(id), page),
    write = useSave(client);
  const options = choices
    .split('\n')
    .map((s) => s.trim())
    .filter(Boolean)
    .map((text, i) => ({ id: String(i + 1), text }));
  const solution =
    type === 'boolean'
      ? answer === 'true'
      : type === 'blank'
        ? answer.split('\n').map((s) => s.split('|').map((v) => v.trim()))
        : type === 'multiple'
          ? answer.split(',').map((s) => s.trim())
          : answer;
  return (
    <View style={a.card}>
      <Text style={a.subtitle}>新题目</Text>
      <Picker
        label="题型"
        id={type}
        change={(v) => {
          setType(v);
          setAnswer('');
        }}
        items={[
          ['short', '简答'],
          ['single', '单选'],
          ['multiple', '多选'],
          ['boolean', '判断'],
          ['blank', '填空'],
        ].map(([id, name]) => ({ id, name }))}
      />
      <Field multiline label="题干" value={stem} set={setStem} />
      {['single', 'multiple'].includes(type) && (
        <Field multiline label="选项（每行一项，从 1 编号）" value={choices} set={setChoices} />
      )}
      {type === 'boolean' ? (
        <Picker
          label="正确答案"
          id={answer}
          change={setAnswer}
          items={[
            { id: 'true', name: '正确' },
            { id: 'false', name: '错误' },
          ]}
        />
      ) : (
        <Field
          multiline
          label={
            type === 'multiple'
              ? '答案编号（英文逗号分隔）'
              : type === 'single'
                ? '答案编号'
                : type === 'blank'
                  ? '每行一空，同义答案用 | 分隔'
                  : '参考答案'
          }
          value={answer}
          set={setAnswer}
        />
      )}
      <Field label="分值" value={score} set={setScore} />
      <AButton
        title="保存题目"
        disabled={write.busy || !stem.trim() || !answer.trim() || !(Number(score) > 0)}
        onPress={() =>
          void write.save(
            '/mobile/staff/questions',
            {
              courseId: id,
              type,
              stem,
              answer: solution,
              scoreCents: Math.round(Number(score) * 100),
              options: ['single', 'multiple'].includes(type) ? options : [],
            },
            'POST',
            () => {
              setStem('');
              setAnswer('');
              setChoices('');
              q.reload();
            },
          )
        }
      />
      {!!write.notice && <Text style={a.notice}>{write.notice}</Text>}
      <State resource={q} />
      {!q.error &&
        q.data?.items.map((row) => (
          <View key={row.id} style={a.child}>
            <RichText html={row.versions[0]?.stem || ''} />
          </View>
        ))}
      {q.data && <Pager page={page} total={q.data.total} change={setPage} />}
    </View>
  );
}
function Schedule({
  client,
  id,
  tab,
}: {
  client: MobileClient;
  id: string;
  tab: 'assignments' | 'exams' | 'live';
}) {
  const [title, setTitle] = useState(''),
    [start, setStart] = useState(''),
    [end, setEnd] = useState(''),
    [duration, setDuration] = useState('60'),
    [pass, setPass] = useState('0'),
    [grader, setGrader] = useState(''),
    [ids, setIds] = useState<string[]>([]),
    [page, setPage] = useState(1);
  const write = useSave(client);
  const base = tab === 'live' ? '/live/classes' : '/mobile/staff/' + tab;
  const q = usePage<{ id: string; title: string; status: string }>(
    client,
    base + '?courseId=' + encodeURIComponent(id),
    page,
  );
  const valid =
    Number.isFinite(Date.parse(start)) &&
    (tab === 'live' || (Date.parse(end) > Date.parse(start) && ids.length > 0)) &&
    (tab !== 'exams' ||
      (Number.isInteger(+duration) &&
        +duration > 0 &&
        +duration <= 1440 &&
        pass.trim() !== '' &&
        Number.isFinite(+pass) &&
        +pass >= 0));
  return (
    <View style={a.card}>
      <Text style={a.subtitle}>{tabLabels[tab]}</Text>
      <Field label="标题" value={title} set={setTitle} />
      <Field label="开始时间（本地时间，如 2026-12-01T09:00）" value={start} set={setStart} />
      {tab !== 'live' && (
        <>
          <Field label="截止时间（本地时间）" value={end} set={setEnd} />
          <SelectQuestions client={client} course={id} selected={ids} change={setIds} />
        </>
      )}
      {tab === 'exams' && (
        <>
          <Field label="答题时长（分钟）" value={duration} set={setDuration} />
          <Field label="及格分数" value={pass} set={setPass} />
          <Text style={a.body}>含主观题时须指定本课程的阅卷教师</Text>
          <PersonPicker client={client} role="TEACHER" id={grader} change={setGrader} />
        </>
      )}
      <AButton
        title={tab === 'live' ? '确认预约' : '保存草稿'}
        disabled={!valid || title.trim().length < 2 || write.busy}
        onPress={() => {
          const common = { courseId: id, title };
          const from = new Date(start).toISOString();
          let body;
          if (tab === 'live') body = { ...common, scheduledAt: from };
          else if (tab === 'exams')
            body = {
              ...common,
              startsAt: from,
              endsAt: new Date(end).toISOString(),
              entryClosesAt: new Date(end).toISOString(),
              durationMinutes: +duration,
              passCents: Math.round(+pass * 100),
              graderIds: grader ? [grader] : [],
              questionVersionIds: ids,
            };
          else
            body = { ...common, opensAt: from, dueAt: new Date(end).toISOString(), questionVersionIds: ids };
          void write.save(base, body, 'POST', () => {
            setTitle('');
            setIds([]);
            q.reload();
          });
        }}
      />
      {!!write.notice && <Text style={a.notice}>{write.notice}</Text>}
      <State resource={q} />
      {!q.error &&
        q.data?.items.map((row) => (
          <View key={row.id} style={a.child}>
            <Text style={a.body}>
              {row.title} · {row.status}
            </Text>
            {tab !== 'live' && row.status === 'draft' && (
              <AButton
                title="发布"
                disabled={write.busy}
                onPress={() =>
                  confirmAction(
                    '向学生发布',
                    row.title,
                    () => void write.save(base + '/' + row.id + '/publish', {}, 'POST', q.reload),
                  )
                }
              />
            )}
            {tab !== 'live' && row.status === 'published' && (
              <AButton
                secondary
                title="统一发布成绩"
                disabled={write.busy}
                onPress={() =>
                  confirmAction(
                    '向学生发布成绩',
                    row.title,
                    () => void write.save(base + '/' + row.id + '/release', {}, 'POST', q.reload),
                  )
                }
              />
            )}
          </View>
        ))}
      {q.data && <Pager page={page} total={q.data.total} change={setPage} />}
    </View>
  );
}
function SelectQuestions({
  client,
  course,
  selected,
  change,
}: {
  client: MobileClient;
  course: string;
  selected: string[];
  change(ids: string[]): void;
}) {
  const [page, setPage] = useState(1);
  const q = usePage<Question>(client, '/mobile/staff/questions?courseId=' + encodeURIComponent(course), page);
  return (
    <View>
      <Text style={a.body}>选择题目（已选 {selected.length}）</Text>
      <State resource={q} />
      {!q.error &&
        q.data?.items.map((item) => {
          const v = item.versions[0];
          if (!v) return null;
          const chosen = selected.includes(v.id);
          return (
            <View style={a.child} key={item.id}>
              <RichText html={v.stem} />
              <AButton
                title={chosen ? '取消选择' : '选入'}
                secondary={!chosen}
                onPress={() => change(chosen ? selected.filter((i) => i !== v.id) : [...selected, v.id])}
              />
            </View>
          );
        })}
      {q.data && <Pager page={page} total={q.data.total} change={setPage} />}
    </View>
  );
}
