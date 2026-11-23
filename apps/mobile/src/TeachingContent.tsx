import { TeachingField as Field, TeachingPanel } from './teaching-ui';
import React, { useState } from 'react';
import { Text, View } from 'react-native';
import type { MobileClient, MobileUser } from './client';
import { a, AButton } from './assignment-ui';
import { Pager, Picker, State, confirmAction } from './staff-ui';
import { useResource } from './resource';
import {
  teachingDate,
  teachingInteger,
  teachingRoot,
  type TeachingCourse,
  type TeachingChapter,
  type TeachingLesson,
  type TeachingFile,
  type TeachingPage,
} from './teaching-model';
import { TeachingNotice, useTeachingGuard, useTeachingOperation, type TeachingGuard } from './teaching-ui';
import { shareTeachingCourseFile, uploadTeachingFile } from './teaching-operation-files';
export function TeachingContent({
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
  const q = useResource<TeachingCourse>(client, teachingRoot + '/courses/' + course),
    [edit, setEdit] = useState<{ chapter: TeachingChapter; lesson?: TeachingLesson }>(),
    [chapter, setChapter] = useState<TeachingChapter>(),
    [title, setTitle] = useState(''),
    [sort, setSort] = useState('0'),
    op = useTeachingOperation(client);
  useTeachingGuard(!edit && (!!title || sort !== '0'), op.busy, registerLeave, !edit);
  if (edit)
    return (
      <LessonEdit
        key={edit.lesson?.id || edit.chapter.id + 'new'}
        client={client}
        user={user}
        course={course}
        chapter={edit.chapter}
        lesson={edit.lesson}
        registerLeave={registerLeave}
        back={() => {
          setEdit(undefined);
          q.reload();
        }}
      />
    );
  const reset = () => {
    setChapter(undefined);
    setTitle('');
    setSort('0');
  };
  return (
    <TeachingPanel busy={op.busy}>
      <Text style={a.subtitle}>章节与课件维护</Text>
      <State resource={q} />
      {!q.error &&
        q.data?.chapters.map((ch) => (
          <View key={ch.id} style={a.child}>
            <Text style={a.subtitle}>
              {ch.title} · 顺序 {ch.sortOrder}
            </Text>
            <AButton
              secondary
              title="修改章节名称与顺序"
              disabled={op.busy}
              onPress={() => {
                const go = () => {
                  setChapter(ch);
                  setTitle(ch.title);
                  setSort(String(ch.sortOrder));
                };
                if (title) confirmAction('替换章节编辑表单', '当前未保存的章节输入将被替换。', go);
                else go();
              }}
            />
            {ch.lessons.map((l) => (
              <View key={l.id} style={a.child}>
                <Text>
                  {l.title} · {l.type}
                </Text>
                <AButton
                  secondary
                  title="编辑此课时"
                  disabled={op.busy}
                  onPress={() => {
                    const go = () => {
                      reset();
                      setEdit({ chapter: ch, lesson: l });
                    };
                    if (title) confirmAction('离开章节表单', '未保存的章节输入将丢失。', go);
                    else go();
                  }}
                />
              </View>
            ))}
            <AButton
              title="添加课时与资源"
              disabled={op.busy}
              onPress={() => {
                const go = () => {
                  reset();
                  setEdit({ chapter: ch });
                };
                if (title) confirmAction('离开章节表单', '未保存的章节输入将丢失。', go);
                else go();
              }}
            />
          </View>
        ))}
      <Text style={a.subtitle}>{chapter ? '修改章节' : '新增章节'}</Text>
      <Field label="章节标题" value={title} set={setTitle} />
      <Field label="章节顺序（从0开始）" value={sort} set={setSort} />
      <AButton
        title="保存章节"
        disabled={op.busy || !title.trim()}
        onPress={() =>
          void op.run(
            () =>
              client.request(
                chapter
                  ? teachingRoot + '/chapters/' + chapter.id
                  : teachingRoot + '/courses/' + course + '/chapters',
                { title, sortOrder: teachingInteger(sort, '章节顺序', 0, 1000000) },
                chapter ? 'PATCH' : 'POST',
              ),
            () => {
              reset();
              q.reload();
            },
          )
        }
      />
      {chapter && <AButton secondary title="取消章节修改" onPress={reset} />}
      <TeachingNotice operation={op} />
    </TeachingPanel>
  );
}
function LessonEdit({
  client,
  user,
  course,
  chapter,
  lesson,
  back,
  registerLeave,
}: {
  client: MobileClient;
  user: MobileUser;
  course: string;
  chapter: TeachingChapter;
  lesson?: TeachingLesson;
  back(): void;
  registerLeave: TeachingGuard;
}) {
  const [title, setTitle] = useState(lesson?.title || ''),
    [content, setContent] = useState(lesson?.content || ''),
    [type, setType] = useState<TeachingLesson['type']>(lesson?.type || 'TEXT'),
    [url, setUrl] = useState(lesson?.resourceUrl || ''),
    [attachment, setAttachment] = useState(lesson?.attachmentId || ''),
    [opens, setOpens] = useState(lesson?.opensAt || ''),
    [sort, setSort] = useState(String(lesson?.sortOrder || 0)),
    [saved, setSaved] = useState(lesson),
    [page, setPage] = useState(1),
    [baseline, setBaseline] = useState(JSON.stringify([title, content, type, url, attachment, opens, sort])),
    op = useTeachingOperation(client);
  const files = useResource<TeachingPage<TeachingFile> & { maxUploadBytes: number }>(
      client,
      teachingRoot + '/courses/' + course + '/files?page=' + page + '&pageSize=20',
    ),
    dirty = JSON.stringify([title, content, type, url, attachment, opens, sort]) !== baseline;
  useTeachingGuard(dirty, op.busy, registerLeave);
  return (
    <TeachingPanel busy={op.busy}>
      <AButton
        secondary
        title="返回章节列表"
        disabled={op.busy}
        onPress={() => (dirty ? confirmAction('放弃课时修改？', '本页未保存输入将丢失。', back) : back())}
      />
      <Text style={a.subtitle}>
        {chapter.title} · {saved ? '编辑课时' : '新课时'}
      </Text>
      <Field label="课时名称" value={title} set={setTitle} />
      <Picker
        label="课时类型"
        id={type}
        change={(v) => setType(v as TeachingLesson['type'])}
        items={[
          ['TEXT', '文字'],
          ['PDF', 'PDF课件'],
          ['DOCUMENT', '文档课件'],
          ['VIDEO', '视频'],
          ['LINK', '外部链接'],
        ].map(([id, name]) => ({ id, name }))}
      />
      <Field label="课时正文（可保留原HTML）" multiline value={content} set={setContent} />
      <Field label="外部资源网址（可选，HTTP或HTTPS）" value={url} set={setUrl} />
      <Field label="开放时间（本地时间，可选）" value={opens} set={setOpens} />
      <Field label="课时顺序（从0开始）" value={sort} set={setSort} />
      {lesson?.relatedTasks.length ? (
        <Text style={a.muted}>原有 {lesson.relatedTasks.length} 个学习任务关联将保留。</Text>
      ) : null}
      <Text style={a.subtitle}>私有课件</Text>
      <Text style={a.muted}>仅列出本人上传或已用于本课程的资源。下载与分享须经明确确认。</Text>
      {attachment && (
        <>
          <Text>
            已选择资源：
            {files.data?.items.find((f) => f.id === attachment)?.originalName || '已保存的课程资源'}
          </Text>
          <AButton secondary title="移除课时资源引用" onPress={() => setAttachment('')} />
        </>
      )}
      <State resource={files} />
      {!files.error &&
        files.data?.items.map((file) => (
          <View key={file.id} style={a.child}>
            <Text>
              {file.originalName} · {(file.size / 1024).toFixed(1)} KB
            </Text>
            <AButton
              title={attachment === file.id ? '✓ 已选课件' : '用于此课时'}
              secondary={attachment !== file.id}
              onPress={() => setAttachment(file.id)}
            />
            <AButton
              secondary
              title="保存或分享课件"
              disabled={op.busy}
              onPress={() =>
                confirmAction(
                  '保存或分享课件',
                  '所选系统应用会获得该文件副本，请确认内容适合分享。',
                  () => void op.run(() => shareTeachingCourseFile(client, course, file, op.live)),
                )
              }
            />
          </View>
        ))}
      {files.data && <Pager page={page} total={files.data.total} change={setPage} />}{' '}
      {files.data && user.permissions.includes('file.upload') && (
        <AButton
          secondary
          title="从手机选择并上传课件"
          disabled={op.busy}
          onPress={() =>
            void op.run(
              () => uploadTeachingFile(client, course, files.data!.maxUploadBytes, op.live),
              (file) => {
                if (file) {
                  setAttachment(file.id);
                  setPage(1);
                  files.reload();
                }
              },
            )
          }
        />
      )}
      <AButton
        title="保存课时"
        disabled={op.busy || !title.trim() || (!dirty && !!saved)}
        onPress={() =>
          void op.run(
            async () => {
              const body = {
                title,
                content,
                type,
                resourceUrl: url.trim() || null,
                attachmentId: attachment || null,
                opensAt: opens.trim() ? teachingDate(opens, '开放时间') : null,
                sortOrder: teachingInteger(sort, '课时顺序', 0, 1000000),
                ...(saved ? {} : { relatedTasks: [] }),
              };
              return client.request<TeachingLesson>(
                saved
                  ? teachingRoot + '/lessons/' + saved.id
                  : teachingRoot + '/chapters/' + chapter.id + '/lessons',
                body,
                saved ? 'PATCH' : 'POST',
              );
            },
            (row) => {
              setSaved(row);
              setContent(row.content);
              setTitle(row.title);
              setBaseline(JSON.stringify([row.title, row.content, type, url, attachment, opens, sort]));
            },
          )
        }
      />
      <TeachingNotice operation={op} />
    </TeachingPanel>
  );
}
