import React, { useCallback, useEffect, useRef, useState } from 'react';
import { ScrollView, Text, View } from 'react-native';
import type { MobileClient, MobileUser } from './client';
import type { LeaveGuard } from './Assignments';
import { a, AButton } from './assignment-ui';
import { Pager, Picker, State, usePage } from './staff-ui';
import { teachingRoot, type TeachingCourse } from './teaching-model';
import { TeachingQuestions } from './TeachingQuestions';
import { TeachingAssessments, TeachingPapers } from './TeachingAssessments';
import { TeachingContent } from './TeachingContent';
const labels = {
  content: '章节与课件',
  questions: '题库修订',
  papers: '试卷库',
  assignments: '作业安排',
  exams: '考试安排',
};
type Tab = keyof typeof labels;
export function TeachingOperations({
  client,
  user,
  registerLeave,
}: {
  client: MobileClient;
  user: MobileUser;
  registerLeave(g: LeaveGuard): void;
}) {
  const [page, setPage] = useState(1),
    [course, setCourse] = useState(''),
    [tab, setTab] = useState<Tab>('content'),
    guard = useRef<LeaveGuard>(null),
    q = usePage<TeachingCourse>(client, teachingRoot + '/courses', page);
  const register = useCallback(
    (next: LeaveGuard) => {
      guard.current = next;
      registerLeave(next);
    },
    [registerLeave],
  );
  useEffect(() => () => registerLeave(null), [registerLeave]);
  const navigate = (go: () => void) => (guard.current ? guard.current(go) : go());
  if (user.accountMode !== 'ORGANIZATION' || !['TEACHER', 'ADMIN', 'SUPER_ADMIN'].includes(user.role))
    return <Text style={a.error}>请使用机构教职人员身份。</Text>;
  return (
    <ScrollView contentContainerStyle={a.page} keyboardShouldPersistTaps="handled">
      <View style={a.card}>
        <Text style={a.title}>教学管理</Text>
        <Text style={a.muted}>管理题目版本、试卷与个别教学安排。所有操作沿用当前课程授权。</Text>
        <State resource={q} />
        {!q.error && q.data && (
          <>
            <Picker
              label="授课课程"
              id={course}
              items={q.data.items.map((x) => ({ id: x.id, name: x.title }))}
              change={(id) => navigate(() => setCourse(id))}
            />
            <Pager
              page={page}
              total={q.data.total}
              change={(p) =>
                navigate(() => {
                  setPage(p);
                  setCourse('');
                })
              }
            />
          </>
        )}
      </View>
      {course && (
        <>
          <View style={a.row}>
            {(Object.keys(labels) as Tab[])
              .filter((t) =>
                t === 'content'
                  ? user.permissions.includes('course.manage') || user.permissions.includes('course.admin')
                  : t === 'questions'
                    ? user.permissions.includes('question.manage')
                    : t === 'papers'
                      ? user.permissions.includes('assessment.manage')
                      : user.permissions.includes('assessment.manage') ||
                        user.permissions.includes('assessment.grade'),
              )
              .map((t) => (
                <AButton
                  key={t}
                  title={labels[t]}
                  secondary={t !== tab}
                  onPress={() => navigate(() => setTab(t))}
                />
              ))}
          </View>
          {tab === 'content' ? (
            <TeachingContent
              key={course + tab}
              client={client}
              user={user}
              course={course}
              registerLeave={register}
            />
          ) : tab === 'questions' ? (
            <TeachingQuestions
              key={course + tab}
              client={client}
              user={user}
              course={course}
              registerLeave={register}
            />
          ) : tab === 'papers' ? (
            <TeachingPapers key={course + tab} client={client} course={course} registerLeave={register} />
          ) : (
            <TeachingAssessments
              key={course + tab}
              client={client}
              user={user}
              course={course}
              kind={tab}
              registerLeave={register}
            />
          )}
        </>
      )}
    </ScrollView>
  );
}
